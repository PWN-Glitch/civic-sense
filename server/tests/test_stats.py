"""GET /stats/impact — every figure must be counted from real rows."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings


async def _auth_headers(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch(
        "app.routers.auth._verify_google_token",
        new=AsyncMock(return_value={"sub": sub, "aud": "any"}),
    ):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.mark.asyncio
async def test_impact_counts_reports_and_resolutions(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth_headers(client, monkeypatch, "stats-user")
    payloads = [
        {"category": "pothole", "description": "a", "lat": 39.2904, "lng": -76.6122},
        {"category": "pothole", "description": "b", "lat": 39.2905, "lng": -76.6120},
        {"category": "trash", "description": "c", "lat": 39.2906, "lng": -76.6121},
    ]
    ids = []
    for body in payloads:
        r = await client.post("/reports", json=body, headers=headers)
        assert r.status_code == 201, r.text
        ids.append(r.json()["report"]["id"])

    # Walk the first report all the way to Resolved (forward-only lifecycle).
    for status in ["Confirmed", "Submitted", "Acknowledged", "InProgress", "Resolved"]:
        r = await client.patch(f"/reports/{ids[0]}", json={"status": status}, headers=headers)
        assert r.status_code == 200, r.text

    r = await client.get("/stats/impact")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["total_reports"] == 3
    assert body["resolved_reports"] == 1
    assert body["resolution_rate"] == pytest.approx(1 / 3, rel=1e-6)
    assert body["reports_last_30_days"] == 3
    assert body["by_status"]["Resolved"] == 1
    assert body["by_status"]["Draft"] == 2

    by_category = {row["category"]: row for row in body["by_category"]}
    assert by_category["pothole"]["total"] == 2
    assert by_category["pothole"]["resolved"] == 1
    assert by_category["trash"]["total"] == 1
    assert by_category["trash"]["resolved"] == 0
    # Resolved inside the same transaction, so the elapsed time is ~0 days.
    assert body["avg_days_to_resolve"] is not None
    assert body["avg_days_to_resolve"] >= 0


@pytest.mark.asyncio
async def test_impact_is_zeroed_with_no_reports(client: AsyncClient) -> None:
    r = await client.get("/stats/impact")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_reports"] == 0
    assert body["resolution_rate"] == 0.0
    assert body["avg_days_to_resolve"] is None
    assert body["by_category"] == []
    assert body["by_status"] == {}
