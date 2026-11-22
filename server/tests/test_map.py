"""B7: map queries with privacy jitter."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings


async def _auth_headers(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": sub, "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.mark.asyncio
async def test_map_issues_returns_only_in_bbox(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch, "map-user")
    # Three Baltimore pins, one in NYC
    pins = [
        {"category": "pothole", "description": "a", "lat": 39.2904, "lng": -76.6122},
        {"category": "trash", "description": "b", "lat": 39.3100, "lng": -76.6200},
        {"category": "graffiti", "description": "c", "lat": 39.2800, "lng": -76.6000},
        {"category": "pothole", "description": "nyc", "lat": 40.7128, "lng": -74.0060},
    ]
    for p in pins:
        r = await client.post("/reports", json=p, headers=headers)
        assert r.status_code == 201

    # bbox covering Baltimore only
    r = await client.get(
        "/map/issues",
        params={"bbox": "-76.7,39.2,-76.5,39.4"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    descriptions_cats = {(item["category"], item["status"]) for item in body}
    # Should include the 3 Baltimore reports
    assert len(body) == 3
    # None of them should be the NYC one — all returned should be within bbox
    for item in body:
        assert 39.2 <= item["lat"] <= 39.4
        assert -76.7 <= item["lng"] <= -76.5


@pytest.mark.asyncio
async def test_map_issues_jitter_deterministic_per_id(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch, "map-user-2")
    r = await client.post(
        "/reports",
        json={"category": "pothole", "description": "pin", "lat": 39.2904, "lng": -76.6122},
        headers=headers,
    )
    report_id = r.json()["report"]["id"]
    raw_lat, raw_lng = 39.2904, -76.6122

    # Two identical queries → same jittered coords for same id
    r1 = await client.get("/map/issues", params={"bbox": "-76.7,39.2,-76.5,39.4"}, headers=headers)
    r2 = await client.get("/map/issues", params={"bbox": "-76.7,39.2,-76.5,39.4"}, headers=headers)
    assert r1.status_code == 200 and r2.status_code == 200
    b1, b2 = r1.json(), r2.json()
    item1 = next(i for i in b1 if i["id"] == report_id)
    item2 = next(i for i in b2 if i["id"] == report_id)
    assert item1["lat"] == item2["lat"]
    assert item1["lng"] == item2["lng"]
    # Jittered ≠ raw
    assert (item1["lat"], item1["lng"]) != (raw_lat, raw_lng)
    # Jitter magnitude ≤ ~50m ≈ 0.0005 degrees latitude; allow 0.001 deg slack
    assert abs(item1["lat"] - raw_lat) <= 0.001
    assert abs(item1["lng"] - raw_lng) <= 0.001


@pytest.mark.asyncio
async def test_map_issues_filters_category_and_status(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch, "map-user-3")
    await client.post(
        "/reports", json={"category": "pothole", "description": "p", "lat": 39.29, "lng": -76.61}, headers=headers
    )
    r2 = await client.post(
        "/reports", json={"category": "trash", "description": "t", "lat": 39.29, "lng": -76.61}, headers=headers
    )
    trash_id = r2.json()["report"]["id"]

    # Filter by category=pothole → excludes trash
    r = await client.get(
        "/map/issues",
        params={"bbox": "-76.7,39.2,-76.5,39.4", "category": "pothole"},
        headers=headers,
    )
    assert r.status_code == 200
    cats = {i["category"] for i in r.json()}
    assert cats == {"pothole"}

    # Filter by status=Draft (both are Draft) → both returned
    r2 = await client.get(
        "/map/issues",
        params={"bbox": "-76.7,39.2,-76.5,39.4", "status": "Draft"},
        headers=headers,
    )
    assert r2.status_code == 200
    assert len(r2.json()) == 2


@pytest.mark.asyncio
async def test_map_issues_invalid_bbox_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch, "map-user-4")
    r = await client.get("/map/issues", params={"bbox": "not-a-bbox"}, headers=headers)
    assert r.status_code == 422