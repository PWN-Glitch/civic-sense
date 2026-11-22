"""Reports CRUD + lifecycle + duplicate detection + before/after photo attach."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import get_db
from app.middleware.ratelimit import rate_limit_authed
from app.models import (
    AiPrediction,
    CommunityVerification,
    Photo,
    Report,
    ReportStatusHistory,
    User,
    UserConfirmation,
)
from app.schemas import (
    PHOTO_KINDS,
    PhotoOut,
    ReportCreate,
    ReportCreateResponse,
    ReportOut,
    ReportPatch,
    ReportPhotoAttachResponse,
    StatusHistoryOut,
    VerificationCounts,
)
from app.security import require_user
from app.services.jitter import jitter

router = APIRouter(prefix="/reports", tags=["reports"])

# Allowed forward-only status transitions: Draft→Confirmed→Submitted→Acknowledged→InProgress→Resolved.
_STATUS_ORDER = ["Draft", "Confirmed", "Submitted", "Acknowledged", "InProgress", "Resolved"]
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    cur: {_STATUS_ORDER[i + 1]} for i, cur in enumerate(_STATUS_ORDER[:-1])
}
_ALLOWED_TRANSITIONS[_STATUS_ORDER[-1]] = set()  # Resolved is terminal


def _point_wkt(lng: float, lat: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


async def _verification_counts(db: AsyncSession, report_id: str) -> VerificationCounts:
    result = await db.execute(
        select(CommunityVerification.response, func.count())
        .where(CommunityVerification.report_id == report_id)
        .group_by(CommunityVerification.response)
    )
    tally = dict(result.all())
    return VerificationCounts(
        still_present=tally.get("still_present", 0),
        appears_fixed=tally.get("appears_fixed", 0),
        not_sure=tally.get("not_sure", 0),
    )


def _photo_out(p: Photo) -> PhotoOut:
    return PhotoOut(photo_id=p.id, kind=p.kind, url=f"/media/{p.storage_key}", blurred=p.blurred)


async def _status_history(db: AsyncSession, report_id: str) -> list[StatusHistoryOut]:
    result = await db.execute(
        select(ReportStatusHistory)
        .where(ReportStatusHistory.report_id == report_id)
        .order_by(ReportStatusHistory.created_at, ReportStatusHistory.id)
    )
    return [StatusHistoryOut.model_validate(row) for row in result.scalars().all()]


async def _report_out(db: AsyncSession, report: Report) -> ReportOut:
    # Build explicitly — model_validate(report) would try to coerce the ORM
    # photos relationship into PhotoOut and fail before we can override it.
    out = ReportOut(
        id=report.id,
        category=report.category,
        description=report.description,
        lat=report.lat,
        lng=report.lng,
        location_accuracy=report.location_accuracy,
        severity=report.severity,
        status=report.status,
        reporter_id=report.reporter_id,
        jurisdiction_id=report.jurisdiction_id,
        department_id=report.department_id,
        created_at=report.created_at,
        updated_at=report.updated_at,
        photos=[_photo_out(p) for p in sorted(report.photos, key=lambda x: x.created_at)],
        verifications=await _verification_counts(db, report.id),
        status_history=await _status_history(db, report.id),
        submission_state=report.submission_state,
    )
    return out


async def _report_out_for(db: AsyncSession, report: Report, user: User) -> ReportOut:
    out = await _report_out(db, report)
    if report.reporter_id == user.id:
        return out
    # Anyone else sees the pin where the public map puts it. Returning exact
    # coordinates here would undo the jitter for anyone holding the id.
    lat, lng = jitter(report.id, out.lat, out.lng)
    return out.model_copy(update={"lat": lat, "lng": lng})


async def _find_duplicates(
    db: AsyncSession, *, category: str, lat: float, lng: float, exclude_id: str | None = None
) -> list[Report]:
    """PostGIS ST_DWithin(25m) + same category + created within 30 days."""
    cutoff = datetime.now(UTC) - timedelta(days=30)
    point = func.ST_GeogFromText(f"SRID=4326;POINT({lng} {lat})")
    geom_geog = func.geography(Report.geom)
    stmt = (
        select(Report)
        .where(Report.category == category)
        .where(Report.created_at >= cutoff)
        .where(func.ST_DWithin(geom_geog, point, 25))
        .options(selectinload(Report.photos))
        # Newest first: when several people reported the same pothole, the
        # sheet should offer the most recent report, not an arbitrary one.
        .order_by(Report.created_at.desc())
    )
    if exclude_id:
        stmt = stmt.where(Report.id != exclude_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _by_client_ref(db: AsyncSession, reporter_id: str, client_ref: str) -> Report | None:
    result = await db.execute(
        select(Report)
        .where(Report.reporter_id == reporter_id, Report.client_ref == client_ref)
        .options(selectinload(Report.photos))
    )
    return result.scalar_one_or_none()


@router.post(
    "",
    response_model=ReportCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_authed(route_key="reports.create", limit=30, window_s=60.0))],
)
async def create_report(
    body: ReportCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ReportCreateResponse:
    if body.client_ref:
        replay = await _by_client_ref(db, user.id, body.client_ref)
        if replay is not None:
            return ReportCreateResponse(report=await _report_out(db, replay))

    duplicates = await _find_duplicates(db, category=body.category, lat=body.lat, lng=body.lng)

    report = Report(
        id=str(uuid.uuid4()),
        category=body.category,
        description=body.description,
        lat=body.lat,
        lng=body.lng,
        location_accuracy=body.location_accuracy,
        severity=body.severity,
        status="Draft",
        reporter_id=user.id,
        client_ref=body.client_ref,
        geom=_point_wkt(body.lng, body.lat),
    )
    db.add(report)
    await db.flush()

    # ai_prediction row (only if the client supplied a real prediction id or we have classifier output).
    # For Week 1 the client sends ai_prediction_id optional; we always create a server-side prediction
    # placeholder sourced from the request body so the data-model invariant prediction≠confirmation holds.
    ai = AiPrediction(
        id=str(uuid.uuid4()),
        report_id=report.id,
        model_version="request",
        category=body.category,
        confidence=0.0,
        severity_estimate=body.severity,
        raw_scores={},
    )
    db.add(ai)

    confirmation = UserConfirmation(
        id=str(uuid.uuid4()),
        report_id=report.id,
        confirmed_category=body.category,
        corrected=False,
    )
    db.add(confirmation)

    history = ReportStatusHistory(report_id=report.id, status="Draft", source="user")
    db.add(history)

    try:
        await db.commit()
    except IntegrityError:
        # A concurrent replay with the same client_ref won the insert.
        await db.rollback()
        replay = await _by_client_ref(db, user.id, body.client_ref) if body.client_ref else None
        if replay is None:
            raise
        return ReportCreateResponse(report=await _report_out(db, replay))
    await db.refresh(report)
    await db.refresh(report, attribute_names=["photos"])

    return ReportCreateResponse(
        report=await _report_out(db, report),
        possible_duplicates=[await _report_out_for(db, d, user) for d in duplicates],
    )


@router.get("/mine", response_model=list[ReportOut])
async def list_mine(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReportOut]:
    result = await db.execute(
        select(Report)
        .where(Report.reporter_id == user.id)
        .options(selectinload(Report.photos))
        .order_by(Report.created_at.desc())
    )
    return [await _report_out(db, r) for r in result.scalars().all()]


@router.get("/duplicates", response_model=list[ReportOut])
async def list_duplicates(
    category: str = Query(..., min_length=1, max_length=32),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    exclude_id: str | None = Query(default=None),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReportOut]:
    """Pre-flight duplicate check.

    The client asks this before creating anything so the "possible existing
    report" sheet can appear without first filing a draft the user may then
    abandon. Same rules as the create-time check: same category, within 25 m,
    last 30 days.
    """
    duplicates = await _find_duplicates(
        db, category=category, lat=lat, lng=lng, exclude_id=exclude_id
    )
    return [await _report_out_for(db, d, user) for d in duplicates]


@router.get("/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    result = await db.execute(
        select(Report).where(Report.id == report_id).options(selectinload(Report.photos))
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    return await _report_out_for(db, report, user)


@router.post(
    "/{report_id}/photos",
    response_model=ReportPhotoAttachResponse,
    status_code=status.HTTP_201_CREATED,
)
async def attach_photo(
    report_id: str,
    photo_id: str = Query(...),
    kind: Literal["before", "progress", "after"] | None = Query(default=None),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ReportPhotoAttachResponse:
    """Attach an already-uploaded photo (POST /media) to a report with a kind.

    Any signed-in resident may add evidence to any report (the duplicate sheet's
    "Add photo"), but only with a photo they uploaded themselves.
    First attached photo defaults to ``before`` when kind is omitted.
    """
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")

    result = await db.execute(select(Photo).where(Photo.id == photo_id))
    photo = result.scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="photo not found")
    if photo.uploader_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your photo")
    if photo.report_id is not None and photo.report_id != report_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="photo already attached to another report"
        )
    if photo.report_id == report_id:
        # A retried attach is fine; turning a "before" into an "after" is not.
        if kind is not None and kind != photo.kind:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="photo already attached with another kind"
            )
        return ReportPhotoAttachResponse(
            photo_id=photo.id, kind=photo.kind, url=f"/media/{photo.storage_key}", blurred=photo.blurred
        )

    if kind is None:
        existing = await db.execute(
            select(func.count()).select_from(Photo).where(Photo.report_id == report_id)
        )
        kind = "before" if int(existing.scalar_one()) == 0 else "progress"
    if kind not in PHOTO_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid kind")

    photo.report_id = report_id
    photo.kind = kind
    await db.commit()
    return ReportPhotoAttachResponse(
        photo_id=photo.id, kind=photo.kind, url=f"/media/{photo.storage_key}", blurred=photo.blurred
    )


@router.patch("/{report_id}", response_model=ReportOut)
async def patch_report(
    report_id: str,
    body: ReportPatch,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    result = await db.execute(
        select(Report).where(Report.id == report_id).options(selectinload(Report.photos))
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    if report.reporter_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your report")

    if body.description is not None:
        report.description = body.description
    if body.category is not None:
        report.category = body.category

    if body.status is not None:
        allowed = _ALLOWED_TRANSITIONS.get(report.status, set())
        if body.status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"invalid status transition: {report.status} -> {body.status}",
            )
        report.status = body.status
        source = "reported_by_user" if body.status in ("Acknowledged", "InProgress", "Resolved") else "user"
        db.add(ReportStatusHistory(report_id=report.id, status=body.status, source=source))

    await db.commit()
    await db.refresh(report)
    await db.refresh(report, attribute_names=["photos"])
    return await _report_out(db, report)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    report_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(Report)
        .where(Report.id == report_id)
        .options(
            selectinload(Report.photos),
            selectinload(Report.ai_predictions),
            selectinload(Report.user_confirmations),
            selectinload(Report.status_history),
            selectinload(Report.drafts),
            selectinload(Report.events),
        )
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    if report.reporter_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your report")

    # Collect storage keys before deleting DB records
    storage_keys = [p.storage_key for p in report.photos if p.storage_key]

    # Clean community verifications (no ORM cascade)
    await db.execute(delete(CommunityVerification).where(CommunityVerification.report_id == report_id))

    # Delete the report and its cascaded children
    await db.delete(report)
    await db.commit()

    # Safely remove orphaned media files from storage_dir if no other photo references them
    for key in storage_keys:
        other_ref = await db.execute(select(Photo).where(Photo.storage_key == key))
        if other_ref.scalar_one_or_none() is None:
            file_path = settings.upload_dir / key
            try:
                # Ensure path is safely within upload_dir and exists
                if file_path.is_file() and settings.upload_dir.resolve() in file_path.resolve().parents:
                    file_path.unlink()
            except OSError:
                pass
