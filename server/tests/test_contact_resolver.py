"""Contact Resolver: ranking, explainability, never-fabricate."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Contact, Jurisdiction
from app.services.contact_resolver import resolve_contacts

# Baltimore City Hall
BALTIMORE = (39.2904, -76.6122)
# Middle of the Atlantic → generic
NOWHERE = (30.0, -40.0)


async def _ensure_jurisdictions(db: AsyncSession) -> None:
    """contacts.jurisdiction_id FKs to jurisdictions.id; seed the two we use."""
    for jid, name in (("baltimore", "Baltimore"), ("chicago", "Chicago")):
        if await db.get(Jurisdiction, jid) is None:
            db.add(Jurisdiction(id=jid, name=name, adapter_type="x"))
    await db.commit()


def _contact(**kw) -> Contact:
    now = datetime.now(UTC)
    defaults = dict(
        organization="Org",
        channel_type="WEB_FORM",
        value="https://example.gov/form",
        verification_status="verified",
        retrieved_at=now,
        last_verified_at=now,
        handles_categories=[],
        requires={},
    )
    defaults.update(kw)
    return Contact(**defaults)


@pytest.mark.asyncio
async def test_empty_registry_returns_manual_unknown_no_fabrication(db_session: AsyncSession) -> None:
    """Empty registry → a MANUAL channel marked unknown, only the official source
    URL we have, and NO invented email/phone anywhere in the payload."""
    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    assert res.jurisdiction.lower().startswith("baltimore")
    assert res.department == "Transportation"
    assert len(res.options) == 1
    ch = res.options[0]
    assert ch.type == "MANUAL"
    assert ch.verification_status == "unknown"
    # Only destination present is the official source URL we genuinely have.
    assert ch.destination == "https://www.baltimorecity.gov/311"
    # Never an invented email/phone.
    for opt in res.options:
        assert opt.destination is None or "@" not in (opt.destination or "")


@pytest.mark.asyncio
async def test_generic_location_empty_registry_uses_usa_gov(db_session: AsyncSession) -> None:
    res = await resolve_contacts(db_session, lat=NOWHERE[0], lng=NOWHERE[1], category="other")
    assert res.jurisdiction_id == "generic"
    assert res.options[0].type == "MANUAL"
    assert res.options[0].destination == "https://www.usa.gov/local-governments"


@pytest.mark.asyncio
async def test_verified_ranks_above_unverified(db_session: AsyncSession) -> None:
    await _ensure_jurisdictions(db_session)
    db_session.add(
        _contact(
            organization="Unverified form",
            jurisdiction_id="baltimore",
            channel_type="WEB_FORM",
            value="https://unverified.example.com",
            verification_status="unverified",
            handles_categories=["pothole"],
        )
    )
    db_session.add(
        _contact(
            organization="Verified portal",
            jurisdiction_id="baltimore",
            channel_type="GOVERNMENT_PORTAL",
            value="https://www.baltimorecity.gov/311",
            verification_status="verified",
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()

    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    assert res.options[0].verification_status == "verified"
    assert res.options[0].destination == "https://www.baltimorecity.gov/311"
    assert res.options[0].confidence > res.options[1].confidence


@pytest.mark.asyncio
async def test_category_match_ranks_above_agnostic(db_session: AsyncSession) -> None:
    await _ensure_jurisdictions(db_session)
    db_session.add(
        _contact(
            organization="Generic line",
            jurisdiction_id="baltimore",
            channel_type="PHONE",
            value="311",
            verification_status="verified",
            handles_categories=[],  # all categories
        )
    )
    db_session.add(
        _contact(
            organization="Pothole crew",
            jurisdiction_id="baltimore",
            channel_type="WEB_FORM",
            value="https://seeclickfix.com/baltimore",
            verification_status="verified",
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()

    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    assert res.options[0].destination == "https://seeclickfix.com/baltimore"
    assert any("Handles category 'pothole'" in r for r in res.options[0].reasons)


@pytest.mark.asyncio
async def test_confidence_reasons_explainable(db_session: AsyncSession) -> None:
    await _ensure_jurisdictions(db_session)
    db_session.add(
        _contact(
            organization="Verified portal",
            jurisdiction_id="baltimore",
            channel_type="GOVERNMENT_PORTAL",
            value="https://www.baltimorecity.gov/311",
            verification_status="verified",
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()
    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    top = res.options[0]
    assert 0.0 < top.confidence <= 1.0
    assert any("jurisdiction" in r.lower() for r in top.reasons)
    assert any("verified" in r.lower() for r in top.reasons)


@pytest.mark.asyncio
async def test_stale_verification_loses_recency_point(db_session: AsyncSession) -> None:
    await _ensure_jurisdictions(db_session)
    old = datetime.now(UTC) - timedelta(days=400)
    db_session.add(
        _contact(
            organization="Stale contact",
            jurisdiction_id="baltimore",
            value="https://old.example.gov",
            verification_status="verified",
            retrieved_at=old,
            last_verified_at=old,
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()
    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    top = res.options[0]
    assert not any("Recently verified" in r for r in top.reasons)


@pytest.mark.asyncio
async def test_unverified_only_appends_manual_fallback(db_session: AsyncSession) -> None:
    """When nothing verified exists, keep the best available AND append a MANUAL
    fallback with the official source."""
    await _ensure_jurisdictions(db_session)
    db_session.add(
        _contact(
            organization="Crowd form",
            jurisdiction_id="baltimore",
            value="https://crowd.example.com",
            verification_status="unverified",
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()
    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    types = [o.type for o in res.options]
    assert "MANUAL" in types
    # The unverified option is still surfaced but marked.
    assert any(o.verification_status == "unverified" for o in res.options)


@pytest.mark.asyncio
async def test_wrong_jurisdiction_contacts_excluded(db_session: AsyncSession) -> None:
    await _ensure_jurisdictions(db_session)
    db_session.add(
        _contact(
            organization="Chicago 311",
            jurisdiction_id="chicago",
            channel_type="OPEN311",
            value="https://311api.cityofchicago.org/open311/v2",
            verification_status="verified",
            handles_categories=["pothole"],
        )
    )
    await db_session.commit()
    # Resolve for Baltimore — Chicago row must not appear.
    res = await resolve_contacts(db_session, lat=BALTIMORE[0], lng=BALTIMORE[1], category="pothole")
    assert all("cityofchicago" not in (o.destination or "") for o in res.options)
