"""S-1: rate limiting — sliding window, per-route limits, key strategy."""

from __future__ import annotations

import io
import time
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from app.middleware.ratelimit import RateLimiter, rate_limiter


def _jpeg(size: tuple[int, int] = (16, 16)) -> bytes:
    img = Image.new("RGB", size, color=(80, 80, 80))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def _signup(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": sub, "aud": "any", "name": f"User {sub}"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


# ---- unit tests on the limiter itself ----


def test_limiter_allows_up_to_limit() -> None:
    rl = RateLimiter()
    for _ in range(5):
        allowed, _ = rl.hit(route_key="r", subject="s", limit=5, window_s=60.0)
        assert allowed


def test_limiter_blocks_at_limit() -> None:
    rl = RateLimiter()
    for _ in range(5):
        rl.hit(route_key="r", subject="s", limit=5, window_s=60.0)
    allowed, retry_after = rl.hit(route_key="r", subject="s", limit=5, window_s=60.0)
    assert not allowed
    assert 0 < retry_after <= 60.0


def test_limiter_sliding_window_recovers() -> None:
    """After the oldest hit ages out of the window, a new hit is allowed."""
    rl = RateLimiter()
    # Use a very short window and simulate the passage of time by monkeypatching
    # time.monotonic inside the module under test.
    import app.middleware.ratelimit as rl_mod

    t = [1000.0]
    monkey = pytest.MonkeyPatch()
    monkey.setattr(rl_mod.time, "monotonic", lambda: t[0])
    try:
        for _ in range(3):
            rl.hit(route_key="r", subject="s", limit=3, window_s=10.0)
        allowed, _ = rl.hit(route_key="r", subject="s", limit=3, window_s=10.0)
        assert not allowed
        # Slide the window forward past the oldest hit.
        t[0] += 11.0
        allowed, _ = rl.hit(route_key="r", subject="s", limit=3, window_s=10.0)
        assert allowed
    finally:
        monkey.undo()


def test_limiter_route_isolation() -> None:
    """Hits to route A do not consume route B's budget."""
    rl = RateLimiter()
    for _ in range(3):
        rl.hit(route_key="a", subject="s", limit=3, window_s=60.0)
    blocked, _ = rl.hit(route_key="a", subject="s", limit=3, window_s=60.0)
    assert not blocked
    allowed, _ = rl.hit(route_key="b", subject="s", limit=3, window_s=60.0)
    assert allowed


def test_limiter_subject_isolation() -> None:
    """Different subjects on the same route get independent budgets."""
    rl = RateLimiter()
    for _ in range(3):
        rl.hit(route_key="r", subject="alice", limit=3, window_s=60.0)
    blocked, _ = rl.hit(route_key="r", subject="alice", limit=3, window_s=60.0)
    assert not blocked
    allowed, _ = rl.hit(route_key="r", subject="bob", limit=3, window_s=60.0)
    assert allowed


# ---- endpoint tests ----


@pytest.mark.asyncio
async def test_auth_google_burst_triggers_429(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """10/min on /auth/google per IP — the 11th call within a minute 429s."""
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": "rl-user", "aud": "any"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        for _ in range(10):
            r = await client.post("/auth/google", json={"id_token": "tok"})
            assert r.status_code == 200, r.text
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 429
    body = r.json()
    assert body["detail"] == "rate limit exceeded"
    assert body["retry_after"] >= 1
    assert "retry_after" in body


@pytest.mark.asyncio
async def test_auth_google_under_limit_ok(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": "rl-user2", "aud": "any"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        for _ in range(5):
            r = await client.post("/auth/google", json={"id_token": "tok"})
            assert r.status_code == 200


@pytest.mark.asyncio
async def test_media_burst_triggers_429(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """20/min on POST /media per user."""
    headers = await _signup(client, monkeypatch, "rl-media")
    files = {"file": ("p.jpg", _jpeg(), "image/jpeg")}
    for i in range(20):
        r = await client.post("/media", files=files, headers=headers)
        assert r.status_code == 201, f"call {i}: {r.text}"
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 429
    body = r.json()
    assert body["detail"] == "rate limit exceeded"
    assert body["retry_after"] >= 1


@pytest.mark.asyncio
async def test_media_under_limit_ok(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _signup(client, monkeypatch, "rl-media-ok")
    files = {"file": ("p.jpg", _jpeg(), "image/jpeg")}
    for _ in range(5):
        r = await client.post("/media", files=files, headers=headers)
        assert r.status_code == 201


@pytest.mark.asyncio
async def test_media_keyed_per_user_not_ip(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Two distinct users on the same source IP have independent buckets."""
    h1 = await _signup(client, monkeypatch, "rl-media-a")
    h2 = await _signup(client, monkeypatch, "rl-media-b")
    files = {"file": ("p.jpg", _jpeg(), "image/jpeg")}
    # Burn user A's budget.
    for _ in range(20):
        r = await client.post("/media", files=files, headers=h1)
        assert r.status_code == 201
    r = await client.post("/media", files=files, headers=h1)
    assert r.status_code == 429
    # User B is unaffected.
    r = await client.post("/media", files=files, headers=h2)
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_classify_burst_triggers_429(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "rl-cls")
    files = {"file": ("p.jpg", _jpeg(), "image/jpeg")}
    for i in range(20):
        r = await client.post("/classify", files=files, headers=headers)
        assert r.status_code in (200, 503), f"call {i}: {r.status_code} {r.text}"
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 429
    assert r.json()["detail"] == "rate limit exceeded"


@pytest.mark.asyncio
async def test_reports_burst_triggers_429(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """30/min on POST /reports per user."""
    headers = await _signup(client, monkeypatch, "rl-rep")
    body = {"category": "trash", "description": "x", "lat": 39.0, "lng": -76.6}
    for i in range(30):
        r = await client.post("/reports", json=body, headers=headers)
        assert r.status_code == 201, f"call {i}: {r.text}"
    r = await client.post("/reports", json=body, headers=headers)
    assert r.status_code == 429
    assert r.json()["detail"] == "rate limit exceeded"


@pytest.mark.asyncio
async def test_verify_burst_triggers_429(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """10/min on POST /reports/{id}/verify per user."""
    headers = await _signup(client, monkeypatch, "rl-ver")
    body = {"category": "trash", "description": "x", "lat": 39.0, "lng": -76.6}
    r = await client.post("/reports", json=body, headers=headers)
    report_id = r.json()["report"]["id"]
    vote = {"response": "still_present"}
    for i in range(10):
        r = await client.post(f"/reports/{report_id}/verify", json=vote, headers=headers)
        assert r.status_code == 200, f"call {i}: {r.text}"
    r = await client.post(f"/reports/{report_id}/verify", json=vote, headers=headers)
    assert r.status_code == 429
    assert r.json()["detail"] == "rate limit exceeded"


@pytest.mark.asyncio
async def test_rate_limit_body_shape(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """429 body matches the contract: {detail: "rate limit exceeded", retry_after: int}."""
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": "rl-shape", "aud": "any"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        for _ in range(11):
            r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 429
    body = r.json()
    assert set(body.keys()) == {"detail", "retry_after"}
    assert body["detail"] == "rate limit exceeded"
    assert isinstance(body["retry_after"], int)
    assert body["retry_after"] >= 1
    # And the standard Retry-After header is set for well-behaved clients.
    assert "retry-after" in {k.lower() for k in r.headers.keys()}


def test_process_singleton_reset_clears_buckets() -> None:
    """Sanity: the autouse conftest fixture calls this between tests."""
    rate_limiter.hit(route_key="x", subject="y", limit=1, window_s=60.0)
    rate_limiter.reset()
    allowed, _ = rate_limiter.hit(route_key="x", subject="y", limit=1, window_s=60.0)
    assert allowed
