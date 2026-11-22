"""B2: auth — Google verification + JWT issuance + dev bypass."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings
from app.security import create_jwt, decode_jwt


_TEST_CLIENT_ID = "test-client-id.apps.googleusercontent.com"


def _google_payload(sub: str = "g-sub-1", aud: str | None = None, name: str = "Tester") -> dict:
    return {
        "sub": sub,
        "aud": aud if aud is not None else _TEST_CLIENT_ID,
        "email": "tester@example.com",
        "name": name,
    }


@pytest.fixture(autouse=True)
def _google_client_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", _TEST_CLIENT_ID)


@pytest.mark.asyncio
async def test_google_auth_success(client: AsyncClient) -> None:
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=_google_payload())):
        r = await client.post("/auth/google", json={"id_token": "valid-token"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "jwt" in body
    assert body["user"]["google_sub"] == "g-sub-1"
    # JWT round-trips
    payload = decode_jwt(body["jwt"])
    assert payload["sub"] == body["user"]["id"]


@pytest.mark.asyncio
async def test_google_auth_bad_audience_rejected(client: AsyncClient) -> None:
    bad = _google_payload(aud="not-our-client")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=bad)):
        r = await client.post("/auth/google", json={"id_token": "wrong-aud"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_google_auth_invalid_token_rejected(client: AsyncClient) -> None:
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=None)):
        r = await client.post("/auth/google", json={"id_token": "bogus"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_dev_auth_bypass_mints_user(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    r = await client.post("/auth/google", json={"id_token": "dev"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["google_sub"].startswith("dev-")


@pytest.mark.asyncio
async def test_dev_bypass_disabled_rejects_dev_token(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass", False)
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=None)):
        r = await client.post("/auth/google", json={"id_token": "dev"})
    assert r.status_code == 401


def test_jwt_round_trip() -> None:
    token = create_jwt("user-123")
    payload = decode_jwt(token)
    assert payload["sub"] == "user-123"
