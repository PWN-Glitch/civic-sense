"""Contact resolver service.

Ranks verified submission options from the database without fabricating endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import SubmissionChannel
from app.models import Contact
from app.services.routing_engine import resolve

# Channel type → draft kind the composer produces.
CHANNEL_TO_DRAFT_KIND: dict[str, str] = {
    "EMAIL": "email",
    "PHONE": "phone",
    "WEB_FORM": "webform",
    "GOVERNMENT_PORTAL": "webform",
    "OPEN311": "open311",
    "API": "open311",
    "MOBILE_APP": "manual",
    "IN_PERSON": "manual",
    "MANUAL": "manual",
}

_VERIFICATION_POINTS = {"verified": 3, "likely": 2, "unverified": 1, "unknown": 0}
# Recency: verified within this many days earns the recency point.
_RECENCY_DAYS = 365


@dataclass
class ResolutionResult:
    jurisdiction: str
    jurisdiction_id: str
    department: str
    options: list[SubmissionChannel] = field(default_factory=list)


def _recency_point(contact: Contact, now: datetime) -> bool:
    ts = contact.last_verified_at or contact.retrieved_at
    if ts is None:
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return (now - ts).days <= _RECENCY_DAYS


def _score_contact(
    contact: Contact, *, jurisdiction_id: str, category: str, now: datetime
) -> tuple[float, list[str]]:
    """Explainable confidence: sum of points, each point contributing a reason."""
    points = 0
    reasons: list[str] = []

    if contact.jurisdiction_id == jurisdiction_id:
        points += 2
        reasons.append("Matches your jurisdiction")
    elif contact.jurisdiction_id is None:
        points += 1
        reasons.append("Applies across jurisdictions")

    handles = contact.handles_categories or []
    if category in handles:
        points += 2
        reasons.append(f"Handles category '{category}'")
    elif not handles:
        points += 1
        reasons.append("Handles all categories")

    vstatus = (contact.verification_status or "unknown").lower()
    vpoints = _VERIFICATION_POINTS.get(vstatus, 0)
    points += vpoints
    if vstatus == "verified":
        reasons.append("Verified official source")
    elif vstatus == "likely":
        reasons.append("Likely official (not yet re-verified)")
    elif vstatus == "unverified":
        reasons.append("Unverified — confirm before relying on it")
    else:
        reasons.append("Verification status unknown")

    if _recency_point(contact, now):
        points += 1
        reasons.append("Recently verified")

    # Normalize to a 0..1 confidence against the max achievable (2+2+3+1).
    confidence = round(points / 8.0, 3)
    return confidence, reasons


def _channel_from_contact(
    contact: Contact, *, jurisdiction_id: str, category: str, now: datetime
) -> SubmissionChannel:
    confidence, reasons = _score_contact(
        contact, jurisdiction_id=jurisdiction_id, category=category, now=now
    )
    return SubmissionChannel(
        type=contact.channel_type,
        destination=contact.value,
        confidence=confidence,
        reasons=reasons,
        source_url=contact.source_url,
        verification_status=(contact.verification_status or "unknown").lower(),
        requires=contact.requires or {},
    )


def _manual_fallback_channel(official_source_url: str | None) -> SubmissionChannel:
    """Empty-registry fallback: a MANUAL channel, verification_status unknown,
    carrying only the official source URL we actually have. No destination is
    invented."""
    return SubmissionChannel(
        type="MANUAL",
        destination=official_source_url,
        confidence=0.0,
        reasons=[
            "No verified contact on file for this jurisdiction and category",
            "Use the official source to find the right channel yourself",
        ],
        source_url=official_source_url,
        verification_status="unknown",
        requires={},
    )


def _official_source_for(jurisdiction_id: str) -> str | None:
    """The official 'find your channel' URL we genuinely have per jurisdiction.
    Only well-known government portals — never a fabricated contact."""
    known = {
        "baltimore": "https://www.baltimorecity.gov/311",
        "chicago": "https://311.chicago.gov/",
        "bloomington": "https://bloomington.in.gov/crm",
        "generic": "https://www.usa.gov/local-governments",
    }
    return known.get(jurisdiction_id, "https://www.usa.gov/local-governments")


async def resolve_contacts(
    db: AsyncSession, *, lat: float, lng: float, category: str, severity: str = "low"
) -> ResolutionResult:
    """Resolve jurisdiction + department, then rank registry contacts.

    Always returns >= 1 channel. If nothing verified exists, the top option is
    the best available marked unverified/unknown, and a MANUAL fallback with the
    official source URL is appended so the user is never left with nothing.
    """
    adapter = resolve(lat, lng)
    department = adapter.department_for(category)
    jurisdiction_id = adapter.jurisdiction_id
    now = datetime.now(UTC)

    result = await db.execute(select(Contact))
    contacts = list(result.scalars().all())

    # Keep rows relevant to this jurisdiction (or jurisdiction-agnostic).
    relevant = [c for c in contacts if c.jurisdiction_id in (None, jurisdiction_id)]
    # Prefer category handlers but keep category-agnostic rows as options.
    category_hits = [c for c in relevant if category in (c.handles_categories or [])]
    agnostic = [c for c in relevant if not (c.handles_categories or [])]
    pool = category_hits + [c for c in agnostic if c not in category_hits]

    channels = [
        _channel_from_contact(c, jurisdiction_id=jurisdiction_id, category=category, now=now)
        for c in pool
    ]
    # Rank by confidence desc, then verified first, then most recently verified.
    channels.sort(
        key=lambda ch: (
            ch.confidence,
            _VERIFICATION_POINTS.get(ch.verification_status, 0),
        ),
        reverse=True,
    )

    has_verified = any(ch.verification_status == "verified" for ch in channels)
    if not channels:
        # Empty registry for this jurisdiction/category → MANUAL fallback only.
        channels = [_manual_fallback_channel(_official_source_for(jurisdiction_id))]
    elif not has_verified:
        # Best available is unverified/unknown → append a manual fallback too.
        channels.append(_manual_fallback_channel(_official_source_for(jurisdiction_id)))

    return ResolutionResult(
        jurisdiction=adapter.name,
        jurisdiction_id=jurisdiction_id,
        department=department,
        options=channels,
    )


def build_universal_report(
    *,
    category: str,
    severity: str,
    lat: float,
    lng: float,
    jurisdiction: str,
    department: str,
    description: str = "",
    channel: SubmissionChannel | None = None,
    confidence: float = 0.0,
    reasons: list[str] | None = None,
) -> dict[str, Any]:
    """Assemble the Universal Report intermediate representation from a resolution."""
    top = channel
    return {
        "issue": {
            "category": category,
            "subcategory": None,
            "description": description,
            "severity": severity,
        },
        "location": {"lat": lat, "lng": lng, "address": None, "jurisdiction": jurisdiction},
        "evidence": [],
        "responsibility": {
            "organization": jurisdiction,
            "department": department,
            "confidence": confidence,
            "reasons": list(reasons or []),
        },
        "submission": {
            "method": (top.type if top else None),
            "destination": (top.destination if top else None),
            "source": (top.source_url if top else None),
        },
        "report": {"subject": "", "body": ""},
        "verification": {"user_approved": False},
    }
