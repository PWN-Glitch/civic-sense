"""Endpoints: /contacts/resolve, /contacts, compose, draft, submission, events.

Focus: never-fabricate, truthful submission transitions (§27/§28), provenance,
and that the registry-driven contract holds end to end.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Contact, Jurisdiction

BALTIMORE = {"lat": 39.2904, "lng": -76.6122, "category": "pothole", "severity": "low"}
CHICAGO = {"lat": 41.8781, "lng": -87.6298, "category": "streetlight", "severity": "low"}


async def _auth(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str = "cu") -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": sub, "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


async def _seed_baltimore(db: AsyncSession) -> None:
    if await db.get(Jurisdiction, "baltimore") is None:
        db.add(Jurisdiction(id="baltimore", name="Baltimore", adapter_type="baltimore_deeplink"))
        await db.flush()  # jurisdiction must exist before contacts FK to it
    db.add_all(
        [
            Contact(
                organization="Baltimore City 311",
                department="Transportation",
                jurisdiction_id="baltimore",
                channel_type="WEB_FORM",
                value="https://seeclickfix.com/baltimore",
                purpose="Report a pothole",
                source_url="https://seeclickfix.com/baltimore",
                source_type="official",
                verification_status="verified",
                handles_categories=["pothole"],
                requires={"fields": ["description", "location", "photo"]},
            ),
            Contact(
                organization="Baltimore City 311",
                department=None,
                jurisdiction_id="baltimore",
                channel_type="GOVERNMENT_PORTAL",
                value="https://www.baltimorecity.gov/311",
                purpose="City 311 portal",
                source_url="https://www.baltimorecity.gov/311",
                source_type="official",
                verification_status="verified",
                handles_categories=[],
                requires={},
            ),
            Contact(
                organization="Baltimore City 311",
                jurisdiction_id="baltimore",
                channel_type="PHONE",
                value="311",
                purpose="Call 311",
                source_url="https://www.baltimorecity.gov/311",
                source_type="official",
                verification_status="verified",
                handles_categories=[],
                requires={},
            ),
        ]
    )
    await db.commit()


async def _make_report(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/reports",
        json={"category": "pothole", "description": "Big pothole", "lat": 39.2904, "lng": -76.6122, "severity": "low"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["report"]["id"]


# ---- /contacts/resolve ----


@pytest.mark.asyncio
async def test_resolve_returns_ranked_verified_channels_and_universal_report(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    r = await client.post("/contacts/resolve", json=BALTIMORE, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jurisdiction"].lower().startswith("baltimore")
    assert body["department"] == "Transportation"
    assert len(body["options"]) >= 1
    # Top option is the verified, category-matching SeeClickFix web form.
    top = body["options"][0]
    assert top["verification_status"] == "verified"
    assert top["type"] == "WEB_FORM"
    assert "seeclickfix.com" in top["destination"]
    assert top["confidence"] > 0
    assert top["reasons"]
    # universal_report comes back in the same call.
    ur = body["universal_report"]
    assert ur["issue"]["category"] == "pothole"
    assert ur["location"]["jurisdiction"].lower().startswith("baltimore")
    assert ur["verification"]["user_approved"] is False


@pytest.mark.asyncio
async def test_resolve_empty_registry_never_fabricates(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    # No contacts seeded.
    r = await client.post("/contacts/resolve", json=BALTIMORE, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["options"]) == 1
    opt = body["options"][0]
    assert opt["type"] == "MANUAL"
    assert opt["verification_status"] == "unknown"
    # Only the official source URL we genuinely have — no invented email/phone.
    assert opt["destination"] == "https://www.baltimorecity.gov/311"
    assert "@" not in (opt["destination"] or "")


@pytest.mark.asyncio
async def test_resolve_provenance_fields_present(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    r = await client.post("/contacts/resolve", json=BALTIMORE, headers=headers)
    for opt in r.json()["options"]:
        assert "source_url" in opt
        assert "verification_status" in opt
        assert "reasons" in opt
        assert "requires" in opt


@pytest.mark.asyncio
async def test_contacts_list_requires_auth(client: AsyncClient) -> None:
    r = await client.get("/contacts")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_contacts_list_returns_seeded(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    r = await client.get("/contacts", headers=headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 3
    assert all(row["verification_status"] == "verified" for row in rows)
    assert any(row["channel_type"] == "PHONE" and row["value"] == "311" for row in rows)


# ---- compose / draft ----


@pytest.mark.asyncio
async def test_compose_creates_draft_with_a_prose_disclosure(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    rid = await _make_report(client, headers)
    r = await client.post(f"/reports/{rid}/compose", json={}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["draft"]["subject"]
    # The draft is citizen-facing prose: the model's contribution is disclosed
    # in one sentence, not tagged line by line.
    assert "Big pothole" in body["draft"]["body"]
    assert "Civic Sense" in body["draft"]["body"]
    assert "USER PROVIDED" not in body["draft"]["body"]
    assert body["draft"]["user_edited"] is False
    # Channel + requirements came along.
    assert body["channel"]["type"] == "WEB_FORM"
    # Photo is required by the seeded contact but none attached → gap surfaced.
    assert any("photo" in g for g in body["missing_fields"])
    assert body["missing_field_keys"] == ["photo"]
    # Compose moved submission_state to 'prepared'.
    assert body["draft"]["kind"] == "webform"


@pytest.mark.asyncio
async def test_draft_patch_sets_user_edited_and_regenerate_blocked(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    rid = await _make_report(client, headers)
    await client.post(f"/reports/{rid}/compose", json={}, headers=headers)

    # User edits the draft.
    r = await client.patch(f"/reports/{rid}/draft", json={"body": "My own words."}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["user_edited"] is True
    assert r.json()["draft"]["body"] == "My own words."

    # Regenerate must refuse to clobber user edits (409).
    r2 = await client.post(
        f"/reports/{rid}/compose/regenerate",
        json={"instruction": "make_shorter", "section": "body"},
        headers=headers,
    )
    assert r2.status_code == 409, r2.text

    # GET returns the user's edited draft intact.
    r3 = await client.get(f"/reports/{rid}/draft", headers=headers)
    assert r3.json()["draft"]["body"] == "My own words."


@pytest.mark.asyncio
async def test_regenerate_shorter_when_not_edited(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    rid = await _make_report(client, headers)
    c = await client.post(f"/reports/{rid}/compose", json={}, headers=headers)
    full = c.json()["draft"]["body"]
    r = await client.post(
        f"/reports/{rid}/compose/regenerate",
        json={"instruction": "make_shorter", "section": "body"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert "AI OBSERVED" not in r.json()["body"]
    assert len(r.json()["body"]) < len(full)


# ---- submission transitions ----


@pytest.mark.asyncio
async def test_email_sent_marks_status_unknown_not_submitted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    rid = await _make_report(client, headers)
    r = await client.post(
        f"/reports/{rid}/submission",
        json={"channel_type": "EMAIL", "action": "sent"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    # External client dispatch cannot prove receipt -> status_unknown
    assert r.json()["submission_state"] == "status_unknown"


@pytest.mark.asyncio
async def test_api_sent_marks_submitted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    rid = await _make_report(client, headers)
    r = await client.post(
        f"/reports/{rid}/submission",
        json={"channel_type": "OPEN311", "action": "sent"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["submission_state"] == "submitted"


@pytest.mark.asyncio
async def test_submission_events_appended_truthfully(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth(client, monkeypatch)
    await _seed_baltimore(db_session)
    rid = await _make_report(client, headers)
    await client.post(f"/reports/{rid}/compose", json={}, headers=headers)
    await client.post(f"/reports/{rid}/submission", json={"channel_type": "WEB_FORM", "action": "prepared"}, headers=headers)
    await client.post(f"/reports/{rid}/submission", json={"channel_type": "WEB_FORM", "action": "approved"}, headers=headers)
    await client.post(f"/reports/{rid}/submission", json={"channel_type": "WEB_FORM", "action": "sent"}, headers=headers)

    r = await client.get(f"/reports/{rid}/events", headers=headers)
    assert r.status_code == 200, r.text
    types = [e["event_type"] for e in r.json()]
    assert "composed" in types
    assert "submission_prepared" in types
    assert "submission_approved" in types
    assert "submission_sent" in types
    # The final event records status_unknown for a web-form send.
    sent = next(e for e in r.json() if e["event_type"] == "submission_sent")
    assert sent["detail"]["submission_state"] == "status_unknown"


@pytest.mark.asyncio
async def test_submission_404_for_other_users_report(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers_a = await _auth(client, monkeypatch, sub="user-a")
    rid = await _make_report(client, headers_a)
    headers_b = await _auth(client, monkeypatch, sub="user-b")
    r = await client.post(
        f"/reports/{rid}/submission",
        json={"channel_type": "EMAIL", "action": "sent"},
        headers=headers_b,
    )
    assert r.status_code == 403
