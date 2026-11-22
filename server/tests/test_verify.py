"""B-W2-4: community verification — one vote per user, advisory-only status."""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings


async def _signup(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": sub, "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


async def _make_report(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/reports",
        json={
            "category": "pothole",
            "description": "test pothole",
            "lat": 39.2904,
            "lng": -76.6122,
            "severity": "moderate",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["report"]["id"]


@pytest.mark.asyncio
async def test_verify_creates_vote_and_counts(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    voter = await _signup(client, monkeypatch, "voter-1")
    rid = await _make_report(client, reporter)

    r = await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=voter)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_id"] >= 1
    assert body["counts"] == {"still_present": 0, "appears_fixed": 1, "not_sure": 0}


@pytest.mark.asyncio
async def test_verify_revote_replaces_not_duplicates(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    voter = await _signup(client, monkeypatch, "voter-1")
    rid = await _make_report(client, reporter)

    r1 = await client.post(f"/reports/{rid}/verify", json={"response": "still_present"}, headers=voter)
    assert r1.status_code == 200
    r2 = await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=voter)
    assert r2.status_code == 200
    # Same verification row (upsert), counts reflect replacement
    assert r2.json()["verification_id"] == r1.json()["verification_id"]
    assert r2.json()["counts"] == {"still_present": 0, "appears_fixed": 1, "not_sure": 0}


@pytest.mark.asyncio
async def test_verify_multiple_users_counts(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    rid = await _make_report(client, reporter)
    v1 = await _signup(client, monkeypatch, "v1")
    v2 = await _signup(client, monkeypatch, "v2")
    v3 = await _signup(client, monkeypatch, "v3")

    await client.post(f"/reports/{rid}/verify", json={"response": "still_present"}, headers=v1)
    await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=v2)
    r = await client.post(f"/reports/{rid}/verify", json={"response": "not_sure"}, headers=v3)
    assert r.json()["counts"] == {"still_present": 1, "appears_fixed": 1, "not_sure": 1}


@pytest.mark.asyncio
async def test_verify_reporter_can_vote(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    rid = await _make_report(client, reporter)
    r = await client.post(f"/reports/{rid}/verify", json={"response": "not_sure"}, headers=reporter)
    assert r.status_code == 200
    assert r.json()["counts"]["not_sure"] == 1


@pytest.mark.asyncio
async def test_get_verifications_includes_user_vote(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    voter = await _signup(client, monkeypatch, "voter")
    rid = await _make_report(client, reporter)

    await client.post(f"/reports/{rid}/verify", json={"response": "still_present"}, headers=voter)

    r_voter = await client.get(f"/reports/{rid}/verifications", headers=voter)
    assert r_voter.json()["user_vote"] == "still_present"
    assert r_voter.json()["counts"]["still_present"] == 1
    assert r_voter.json()["community_suggests_resolved"] is False

    r_other = await client.get(f"/reports/{rid}/verifications", headers=reporter)
    assert r_other.json()["user_vote"] is None


@pytest.mark.asyncio
async def test_community_suggests_resolved_threshold(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    rid = await _make_report(client, reporter)

    for i in range(3):
        h = await _signup(client, monkeypatch, f"fixed-{i}")
        await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=h)

    r = await client.get(f"/reports/{rid}/verifications", headers=reporter)
    assert r.json()["counts"]["appears_fixed"] == 3
    assert r.json()["community_suggests_resolved"] is True

    # A 4th still_present that ties does NOT flip it back (rule is strictly >)
    for i in range(3):
        h = await _signup(client, monkeypatch,"present-" + str(i))
        await client.post(f"/reports/{rid}/verify", json={"response": "still_present"}, headers=h)
    r = await client.get(f"/reports/{rid}/verifications", headers=reporter)
    assert r.json()["community_suggests_resolved"] is False


@pytest.mark.asyncio
async def test_verify_never_changes_official_status(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Community votes are advisory and never mutate report.status."""
    reporter = await _signup(client, monkeypatch, "reporter")
    rid = await _make_report(client, reporter)
    before = (await client.get(f"/reports/{rid}", headers=reporter)).json()["status"]

    for i in range(4):
        h = await _signup(client, monkeypatch, f"fx-{i}")
        await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=h)

    after = (await client.get(f"/reports/{rid}", headers=reporter)).json()["status"]
    assert before == after == "Draft"


@pytest.mark.asyncio
async def test_verify_404_unknown_report(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _signup(client, monkeypatch, "someone")
    r = await client.post("/reports/nope/verify", json={"response": "not_sure"}, headers=h)
    assert r.status_code == 404
    r = await client.get("/reports/nope/verifications", headers=h)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_verify_invalid_response_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    reporter = await _signup(client, monkeypatch, "reporter")
    rid = await _make_report(client, reporter)
    r = await client.post(f"/reports/{rid}/verify", json={"response": "bogus"}, headers=reporter)
    assert r.status_code == 422
