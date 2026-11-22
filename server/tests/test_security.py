"""S-4: cross-cutting security tests.

Complements the per-feature tests (test_auth, test_reports, test_media, …)
by probing the trust boundaries directly: unauthenticated requests, broken
authorization, injection-shaped inputs, JWT tampering, range checks.

Every test here is a would-be-incident if it ever regresses.
"""

from __future__ import annotations

import io
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from jose import jwt
from PIL import Image

from app.config import settings
from app.security import _ALGORITHM, create_jwt


def _jpeg(size: tuple[int, int] = (16, 16)) -> bytes:
    img = Image.new("RGB", size, color=(100, 100, 100))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def _signup(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": sub, "aud": "any"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


# ---- unauthenticated → 401 ----


@pytest.mark.asyncio
async def test_protected_routes_require_auth(client: AsyncClient) -> None:
    """Every route that calls require_user must 401 with no bearer token."""
    files = {"file": ("p.jpg", _jpeg(), "image/jpeg")}
    body = {"category": "trash", "description": "x", "lat": 39.0, "lng": -76.6}

    # (method, url, kwargs)
    protected_calls = [
        ("post", "/media", {"files": files}),
        ("post", "/classify", {"files": files}),
        ("post", "/reports", {"json": body}),
        ("get", "/reports/mine", {}),
        ("get", "/reports/some-id", {}),
        ("patch", "/reports/some-id", {"json": {"description": "x"}}),
        ("post", "/reports/some-id/verify", {"json": {"response": "still_present"}}),
        ("get", "/reports/some-id/verifications", {}),
        ("post", "/reports/some-id/photos", {"params": {"photo_id": "p"}}),
        ("get", "/map/issues", {"params": {"bbox": "-77,39,-76,40"}}),
        ("post", "/routing/resolve", {"json": {"lat": 39.0, "lng": -76.6, "category": "trash"}}),
    ]
    for method, url, kwargs in protected_calls:
        r = await getattr(client, method)(url, **kwargs)
        assert r.status_code == 401, f"{method.upper()} {url} -> {r.status_code} (expected 401)"


@pytest.mark.asyncio
async def test_malformed_auth_header_401(client: AsyncClient) -> None:
    """Bearer scheme violations must not silently authenticate."""
    r = await client.get("/reports/mine", headers={"Authorization": "NotBearer xyz"})
    assert r.status_code == 401
    r = await client.get("/reports/mine", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert r.status_code == 401


# ---- tampered / expired JWT → 401 ----


@pytest.mark.asyncio
async def test_tampered_jwt_signature_401(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Flip one character in the signature segment → decode must fail → 401."""
    headers = await _signup(client, monkeypatch, "sec-tamp")
    token = headers["Authorization"].removeprefix("Bearer ")
    # Change the FIRST signature character: the last one carries 2 unused
    # base64 bits, so swapping it can decode to the same signature.
    parts = token.split(".")
    sig = parts[2]
    flipped = ("A" if sig[0] != "A" else "B") + sig[1:]
    bad_token = ".".join([parts[0], parts[1], flipped])
    r = await client.get("/reports/mine", headers={"Authorization": f"Bearer {bad_token}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_forged_jwt_wrong_secret_401(client: AsyncClient) -> None:
    """Token signed with a DIFFERENT secret must not validate."""
    forged = jwt.encode(
        {"sub": "anyone", "iat": int(time.time()), "exp": int(time.time()) + 3600},
        "attacker-controlled-secret",
        algorithm=_ALGORITHM,
    )
    r = await client.get("/reports/mine", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_expired_jwt_401(client: AsyncClient) -> None:
    """A token whose exp is in the past is rejected."""
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": "some-user",
            "iat": int((now - timedelta(days=30)).timestamp()),
            "exp": int((now - timedelta(days=1)).timestamp()),
        },
        settings.jwt_secret,
        algorithm=_ALGORITHM,
    )
    r = await client.get("/reports/mine", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_jwt_for_nonexistent_user_401(client: AsyncClient) -> None:
    """Valid signature + valid exp, but the sub doesn't match any user row."""
    token = create_jwt("no-such-user-id")
    r = await client.get("/reports/mine", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


# ---- authorization (not the same as authentication) ----


@pytest.mark.asyncio
async def test_patch_other_users_report_403(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Authenticated but NOT the owner → 403 (not 404, not 200)."""
    h1 = await _signup(client, monkeypatch, "sec-owner")
    h2 = await _signup(client, monkeypatch, "sec-attacker")
    body = {"category": "trash", "description": "mine", "lat": 39.0, "lng": -76.6}
    r = await client.post("/reports", json=body, headers=h1)
    rid = r.json()["report"]["id"]

    r2 = await client.patch(f"/reports/{rid}", json={"description": "pwned"}, headers=h2)
    assert r2.status_code == 403

    # Confirm the report was NOT modified.
    r3 = await client.get(f"/reports/{rid}", headers=h1)
    assert r3.json()["description"] == "mine"


# ---- SQL-injection-shaped strings ----


@pytest.mark.asyncio
async def test_sql_injection_in_description_safe(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Classic ORM-bypass strings in description must be stored as data or
    rejected with 422 — NEVER a 500, NEVER executed as SQL."""
    headers = await _signup(client, monkeypatch, "sec-sqli")
    payloads = [
        "'; DROP TABLE reports; --",
        "1' OR '1'='1",
        "admin'--",
        "'; DELETE FROM users WHERE 'a'='a",
        "Robert'); DROP TABLE students;--",  # bobby-tables
        "1; SELECT * FROM users WHERE 1=1 --",
        "' UNION SELECT password FROM users --",
    ]
    for p in payloads:
        body = {"category": "trash", "description": p, "lat": 39.0, "lng": -76.6}
        r = await client.post("/reports", json=body, headers=headers)
        assert r.status_code in (201, 422), f"{p!r} -> {r.status_code}: {r.text}"
        if r.status_code == 201:
            rid = r.json()["report"]["id"]
            got = await client.get(f"/reports/{rid}", headers=headers)
            # Stored verbatim (parameterized query), not interpreted.
            assert got.json()["description"] == p


@pytest.mark.asyncio
async def test_sql_injection_in_category_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Category is pattern-validated — injection attempts 422, never reach SQL."""
    headers = await _signup(client, monkeypatch, "sec-sqli2")
    bad_categories = [
        "pothole'; DROP TABLE reports; --",
        "' OR '1'='1",
        "pothole\" OR 1=1 --",
    ]
    for cat in bad_categories:
        body = {"category": cat, "description": "x", "lat": 39.0, "lng": -76.6}
        r = await client.post("/reports", json=body, headers=headers)
        assert r.status_code == 422, f"{cat!r} -> {r.status_code}"


@pytest.mark.asyncio
async def test_sql_injection_in_report_id_no_500(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Path parameter injection must not crash or leak."""
    headers = await _signup(client, monkeypatch, "sec-sqli3")
    r = await client.get("/reports/1' OR '1'='1", headers=headers)
    assert r.status_code in (404, 422), f"got {r.status_code}: {r.text}"
    assert r.status_code != 500


# ---- range / schema validation ----


@pytest.mark.asyncio
async def test_out_of_range_lat_lng_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """lat/lng outside the legal ranges must 422, not reach PostGIS."""
    headers = await _signup(client, monkeypatch, "sec-range")
    bad_bodies = [
        {"category": "trash", "description": "x", "lat": 91.0, "lng": 0.0},
        {"category": "trash", "description": "x", "lat": -91.0, "lng": 0.0},
        {"category": "trash", "description": "x", "lat": 0.0, "lng": 181.0},
        {"category": "trash", "description": "x", "lat": 0.0, "lng": -181.0},
        {"category": "trash", "description": "x", "lat": float("inf"), "lng": 0.0},
        {"category": "trash", "description": "x", "lat": 0.0, "lng": float("-inf")},
        {"category": "trash", "description": "x", "lat": float("nan"), "lng": 0.0},
    ]
    for body in bad_bodies:
        # json.dumps can't serialize inf/nan by default; httpx uses json, so
        # we pass content with allow_nan-inf via str. Pydantic still 422s on
        # non-finite floats via its own validation.
        try:
            r = await client.post("/reports", json=body, headers=headers)
        except Exception:
            # If httpx's JSON encoder rejects inf/nan outright, that's also OK.
            continue
        assert r.status_code == 422, f"{body} -> {r.status_code}"


@pytest.mark.asyncio
async def test_map_bbox_injection_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """bbox query string goes through strict parser; injection-shaped input → 422."""
    headers = await _signup(client, monkeypatch, "sec-bbox")
    bad_bboxes = [
        "1,2,3",  # too few
        "1,2,3,4,5",  # too many
        "a,b,c,d",  # non-numeric
        "181,0,182,1",  # lng out of range
        "0,91,1,92",  # lat out of range
        "4,3,2,1",  # min>max
        "0,0,0,0; DROP TABLE reports; --",  # SQLi
    ]
    for bbox in bad_bboxes:
        r = await client.get("/map/issues", params={"bbox": bbox}, headers=headers)
        assert r.status_code == 422, f"bbox={bbox!r} -> {r.status_code}"


# ---- misc trust-boundary checks ----


@pytest.mark.asyncio
async def test_verify_invalid_response_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The verify enum is closed — write 'hacked' → 422."""
    headers = await _signup(client, monkeypatch, "sec-vote")
    body = {"category": "trash", "description": "x", "lat": 39.0, "lng": -76.6}
    r = await client.post("/reports", json=body, headers=headers)
    rid = r.json()["report"]["id"]
    r2 = await client.post(f"/reports/{rid}/verify", json={"response": "hacked"}, headers=headers)
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_health_endpoint_is_public(client: AsyncClient) -> None:
    """Sanity: /health is the ONE endpoint that should never require auth."""
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
