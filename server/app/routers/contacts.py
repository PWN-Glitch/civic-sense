"""Contacts: resolve ranked submission channels + list the registry (read-only).

POST /contacts/resolve → jurisdiction + department + ranked SubmissionChannel
options + a pre-built UniversalReport, so the client gets everything in one call.
GET  /contacts         → the curated registry, for the admin/verification UI.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.middleware.ratelimit import rate_limit_authed
from app.models import Contact, User
from app.schemas import (
    ContactOut,
    ContactResolveRequest,
    ContactResolveResponse,
    SubmissionChannelOut,
    UniversalReport,
)
from app.security import require_user
from app.services.contact_resolver import build_universal_report, resolve_contacts

router = APIRouter(prefix="/contacts", tags=["contacts"])


def _channel_out(ch) -> SubmissionChannelOut:
    return SubmissionChannelOut(
        type=ch.type,
        destination=ch.destination,
        confidence=ch.confidence,
        reasons=ch.reasons,
        source_url=ch.source_url,
        verification_status=ch.verification_status,
        requires=ch.requires,
    )


@router.post(
    "/resolve",
    response_model=ContactResolveResponse,
    dependencies=[Depends(rate_limit_authed(route_key="contacts.resolve", limit=30, window_s=60.0))],
)
async def resolve_contacts_endpoint(
    body: ContactResolveRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ContactResolveResponse:
    res = await resolve_contacts(
        db, lat=body.lat, lng=body.lng, category=body.category, severity=body.severity
    )
    top = res.options[0] if res.options else None
    universal = build_universal_report(
        category=body.category,
        severity=body.severity,
        lat=body.lat,
        lng=body.lng,
        jurisdiction=res.jurisdiction,
        department=res.department,
        channel=top,
        confidence=(top.confidence if top else 0.0),
        reasons=(top.reasons if top else []),
    )
    return ContactResolveResponse(
        jurisdiction=res.jurisdiction,
        department=res.department,
        options=[_channel_out(c) for c in res.options],
        universal_report=UniversalReport.model_validate(universal),
    )


@router.get("", response_model=list[ContactOut])
async def list_contacts(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[ContactOut]:
    """Read-only registry listing for the admin/verification UI."""
    result = await db.execute(select(Contact).order_by(Contact.organization, Contact.id))
    return [ContactOut.model_validate(c) for c in result.scalars().all()]
