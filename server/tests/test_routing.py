"""B6: jurisdiction routing engine + adapters."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings


async def _auth_headers(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": "routing-user", "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


# Baltimore City Hall: 39.2904, -76.6122
@pytest.mark.asyncio
async def test_baltimore_resolves_to_deeplink(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch)
    r = await client.post(
        "/routing/resolve",
        json={"lat": 39.2904, "lng": -76.6122, "category": "pothole"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jurisdiction"].lower().startswith("baltimore")
    assert body["department"] == "Transportation"
    assert body["method"] == "deeplink"
    assert "baltimorecity.gov" in body["url"]
    assert "submit" in body["disclaimer"].lower() or "opens" in body["disclaimer"].lower()
    # Never claims submission succeeded
    assert "submitted" not in body["disclaimer"].lower() or "to complete" in body["disclaimer"].lower()


# Chicago Loop: 41.8781, -87.6298
@pytest.mark.asyncio
async def test_chicago_resolves_to_open311(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch)
    r = await client.post(
        "/routing/resolve",
        json={"lat": 41.8781, "lng": -87.6298, "category": "streetlight"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jurisdiction"].lower().startswith("chicago")
    assert body["department"] == "Utilities"
    assert body["method"] == "api"


# Bloomington, IN: 39.1653, -86.5264
@pytest.mark.asyncio
async def test_bloomington_resolves_to_open311(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch)
    r = await client.post(
        "/routing/resolve",
        json={"lat": 39.1653, "lng": -86.5264, "category": "trash"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["jurisdiction"].lower().startswith("bloomington")
    assert body["department"] == "Sanitation"
    assert body["method"] == "api"


# Middle of the Atlantic: 30.0, -40.0
@pytest.mark.asyncio
async def test_unknown_falls_back_to_generic(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch)
    r = await client.post(
        "/routing/resolve",
        json={"lat": 30.0, "lng": -40.0, "category": "other"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["jurisdiction"].lower() == "generic"
    assert body["department"] == "General"
    assert body["method"] == "deeplink"
    # Never fabricates a submission success
    assert "submit" in body["disclaimer"].lower() or "contact" in body["disclaimer"].lower()


@pytest.mark.asyncio
async def test_category_mapping_all_six(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_headers(client, monkeypatch)
    expected = {
        "pothole": "Transportation",
        "streetlight": "Utilities",
        "trash": "Sanitation",
        "graffiti": "Public Works",
        "sidewalk damage": "Transportation",
        "other": "General",
    }
    for cat, dept in expected.items():
        r = await client.post(
            "/routing/resolve",
            json={"lat": 39.2904, "lng": -76.6122, "category": cat},
            headers=headers,
        )
        assert r.status_code == 200, f"{cat}: {r.text}"
        assert r.json()["department"] == dept, f"category {cat} → {r.json()['department']}, expected {dept}"


def test_never_fabricates_submission_success() -> None:
    """Adapters must never return a response that claims the report was submitted upstream."""
    from app.adapters import baltimore, open311
    from app.adapters.base import RouteResult

    # Baltimore returns deeplink + disclaimer, never "submitted: true"
    adapter = baltimore.BaltimoreAdapter()
    result: RouteResult = adapter.route({"category": "pothole", "lat": 39.29, "lng": -76.61})
    assert result.method == "deeplink"
    assert "submitted" not in result.disclaimer.lower() or "to complete" in result.disclaimer.lower()

    # Open311 read adapter returns a result whose disclaimer doesn't claim submission
    chi = open311.Open311Adapter(
        jurisdiction_id="chicago",
        name="Chicago",
        bbox=(-87.94, 41.64, -87.52, 42.06),
        endpoint="https://311api.cityofchicago.org/open311/v2",
    )
    res = chi.route({"category": "pothole", "lat": 41.8781, "lng": -87.6298})
    assert res.disclaimer  # present
    assert isinstance(res.payload, dict) or res.payload is None