"""Report compose, draft, submission and audit event endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.models import Report, ReportDraft, ReportEvent, User
from app.schemas import (
    ComposeRequest,
    ComposeResponse,
    DraftOut,
    DraftPatch,
    RegenerateRequest,
    ReportEventOut,
    SubmissionChannelOut,
    SubmissionUpdateRequest,
    SubmissionUpdateResponse,
)
from app.security import require_user
from app.services import report_composer, requirements
from app.services.contact_resolver import CHANNEL_TO_DRAFT_KIND, build_universal_report, resolve_contacts

router = APIRouter(prefix="/reports", tags=["reports"])

# Channels where an upstream response confirms submission.
_API_CHANNELS = {"API", "OPEN311"}
# Submission state per user-confirmed action.
_ACTION_STATE = {
    "prepared": "prepared",
    "approved": "user_approved",
    "attempted": "submission_attempted",
}


async def _get_owned_report(db: AsyncSession, report_id: str, user: User) -> Report:
    result = await db.execute(
        select(Report).where(Report.id == report_id).options(selectinload(Report.photos))
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    if report.reporter_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your report")
    return report


async def _universal_for_report(db: AsyncSession, report: Report) -> tuple[dict, SubmissionChannelOut]:
    """Rebuild the IR for an existing report from its stored fields + resolver."""
    res = await resolve_contacts(
        db, lat=report.lat, lng=report.lng, category=report.category, severity=report.severity
    )
    top = res.options[0] if res.options else None
    evidence = [p.id for p in sorted(report.photos, key=lambda x: x.created_at)]
    universal = build_universal_report(
        category=report.category,
        severity=report.severity,
        lat=report.lat,
        lng=report.lng,
        jurisdiction=res.jurisdiction,
        department=res.department,
        description=report.description,
        channel=top,
        confidence=(top.confidence if top else 0.0),
        reasons=(top.reasons if top else []),
    )
    universal["evidence"] = evidence
    channel_out = _channel_to_out(top) if top else _channel_to_out(None)
    return universal, channel_out


def _channel_to_out(ch) -> SubmissionChannelOut:
    if ch is None:
        return SubmissionChannelOut(type="MANUAL", verification_status="unknown")
    return SubmissionChannelOut(
        type=ch.type,
        destination=ch.destination,
        confidence=ch.confidence,
        reasons=ch.reasons,
        source_url=ch.source_url,
        verification_status=ch.verification_status,
        requires=ch.requires,
    )


async def _latest_draft(db: AsyncSession, report_id: str) -> ReportDraft | None:
    result = await db.execute(
        select(ReportDraft)
        .where(ReportDraft.report_id == report_id)
        .order_by(ReportDraft.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _append_event(db: AsyncSession, report_id: str, event_type: str, detail: dict) -> ReportEvent:
    event = ReportEvent(report_id=report_id, event_type=event_type, detail=detail)
    db.add(event)
    await db.flush()
    return event


@router.post("/{report_id}/compose", response_model=ComposeResponse)
async def compose_endpoint(
    report_id: str,
    body: ComposeRequest | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ComposeResponse:
    report = await _get_owned_report(db, report_id, user)
    universal, channel = await _universal_for_report(db, report)

    # If the client picked a specific channel, re-resolve to find it.
    if body and body.channel_type:
        res = await resolve_contacts(
            db, lat=report.lat, lng=report.lng, category=report.category, severity=report.severity
        )
        match = next((o for o in res.options if o.type == body.channel_type), None)
        if match is not None:
            channel = _channel_to_out(match)
            universal["submission"] = {
                "method": match.type,
                "destination": match.destination,
                "source": match.source_url,
            }

    composed = report_composer.compose(universal)
    required = requirements.required_fields(
        channel.model_dump(), report.category, universal["location"].get("jurisdiction")
    )
    missing = requirements.missing_fields(universal, required)
    missing_keys = requirements.missing_field_keys(universal, required)

    draft = ReportDraft(
        id=str(uuid.uuid4()),
        report_id=report.id,
        kind=CHANNEL_TO_DRAFT_KIND.get(channel.type, "manual"),
        subject=composed["subject"],
        body=composed["body"],
        recipient=channel.destination,
        user_edited=False,
    )
    db.add(draft)
    if report.submission_state == "draft":
        report.submission_state = "prepared"
    await _append_event(db, report.id, "composed", {"channel_type": channel.type, "draft_id": draft.id})
    await db.commit()
    await db.refresh(draft)
    return ComposeResponse(
        draft=DraftOut.model_validate(draft),
        channel=channel,
        missing_fields=missing,
        missing_field_keys=missing_keys,
    )


@router.post("/{report_id}/compose/regenerate", response_model=DraftOut)
async def regenerate_endpoint(
    report_id: str,
    body: RegenerateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> DraftOut:
    report = await _get_owned_report(db, report_id, user)
    draft = await _latest_draft(db, report_id)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no draft to regenerate")
    if draft.user_edited:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="draft has your edits; save or discard them before regenerating",
        )

    universal, _ = await _universal_for_report(db, report)
    current = draft.body if body.section == "body" else draft.subject
    try:
        new_text = report_composer.regenerate(
            universal,
            section=body.section,
            instruction=body.instruction,
            current_text=current,
            correction=body.correction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from None

    if body.section == "body":
        draft.body = new_text
    else:
        draft.subject = new_text
    await _append_event(db, report.id, "regenerated", {"section": body.section, "instruction": body.instruction})
    await db.commit()
    await db.refresh(draft)
    return DraftOut.model_validate(draft)


@router.get("/{report_id}/draft")
async def get_draft(
    report_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_owned_report(db, report_id, user)
    draft = await _latest_draft(db, report_id)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no draft yet")
    return {"draft": DraftOut.model_validate(draft)}


@router.patch("/{report_id}/draft")
async def patch_draft(
    report_id: str,
    body: DraftPatch,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    report = await _get_owned_report(db, report_id, user)
    draft = await _latest_draft(db, report_id)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no draft yet")
    if body.subject is not None:
        draft.subject = body.subject
    if body.body is not None:
        draft.body = body.body
    if body.recipient is not None:
        draft.recipient = body.recipient
    draft.user_edited = True
    await _append_event(db, report.id, "draft_edited", {"draft_id": draft.id})
    await db.commit()
    await db.refresh(draft)
    return {"draft": DraftOut.model_validate(draft)}


def _state_for_action(action: str, channel_type: str) -> str:
    """Map action to submission state. User-driven channels default to status_unknown."""
    if action == "sent":
        return "submitted" if channel_type in _API_CHANNELS else "status_unknown"
    return _ACTION_STATE[action]


@router.post("/{report_id}/submission", response_model=SubmissionUpdateResponse)
async def update_submission(
    report_id: str,
    body: SubmissionUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> SubmissionUpdateResponse:
    report = await _get_owned_report(db, report_id, user)
    channel_type = body.channel_type.upper()
    new_state = _state_for_action(body.action, channel_type)
    report.submission_state = new_state
    event = await _append_event(
        db,
        report.id,
        f"submission_{body.action}",
        {"channel_type": channel_type, "submission_state": new_state},
    )
    await db.commit()
    await db.refresh(event)
    return SubmissionUpdateResponse(
        report_id=report.id,
        submission_state=new_state,
        event=ReportEventOut.model_validate(event),
    )


@router.get("/{report_id}/events", response_model=list[ReportEventOut])
async def list_events(
    report_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReportEventOut]:
    await _get_owned_report(db, report_id, user)
    result = await db.execute(
        select(ReportEvent).where(ReportEvent.report_id == report_id).order_by(ReportEvent.created_at, ReportEvent.id)
    )
    return [ReportEventOut.model_validate(e) for e in result.scalars().all()]
