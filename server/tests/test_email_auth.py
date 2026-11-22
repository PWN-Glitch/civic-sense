"""B2b: email/password auth — register, login, and failure modes."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.security import decode_jwt, hash_password, verify_password

_PW = "correct-horse-battery"
_EMAIL = "resident@example.com"


async def _register(client: AsyncClient, email: str = _EMAIL, password: str = _PW, **extra):
    return await client.post("/auth/register", json={"email": email, "password": password, **extra})


# ---- register ----


async def test_register_success_returns_jwt_and_user(client: AsyncClient) -> None:
    r = await _register(client, display_name="Resident One")
    assert r.status_code == 201, r.text
    body = r.json()
    assert "jwt" in body
    assert body["user"]["email"] == _EMAIL
    assert body["user"]["display_name"] == "Resident One"
    assert body["user"]["google_sub"] is None
    assert "password" not in body["user"]
    assert "password_hash" not in body["user"]
    # JWT round-trips to this user.
    assert decode_jwt(body["jwt"])["sub"] == body["user"]["id"]


async def test_register_defaults_display_name_to_email_local_part(client: AsyncClient) -> None:
    r = await _register(client)
    assert r.status_code == 201, r.text
    assert r.json()["user"]["display_name"] == "resident"


async def test_register_duplicate_email_conflict(client: AsyncClient) -> None:
    assert (await _register(client)).status_code == 201
    r = await _register(client)
    assert r.status_code == 409
    assert r.json()["detail"] == "email already registered"


async def test_register_short_password_rejected(client: AsyncClient) -> None:
    r = await _register(client, password="short7!")
    r2 = await _register(client, password="x" * 7)
    assert r.status_code == 422
    assert r2.status_code == 422


async def test_register_invalid_email_rejected(client: AsyncClient) -> None:
    for bad in ("not-an-email", "missing@tld", "@nowhere.com", "spaces in@addr.com"):
        r = await _register(client, email=bad)
        assert r.status_code == 422, bad


async def test_password_not_stored_plaintext(client: AsyncClient, db_session: AsyncSession) -> None:
    assert (await _register(client)).status_code == 201
    user = (await db_session.execute(select(User).where(User.email == _EMAIL))).scalar_one()
    assert user.password_hash is not None
    assert user.password_hash != _PW
    assert user.password_hash.startswith("$2")  # bcrypt identifier
    assert verify_password(_PW, user.password_hash)


# ---- login ----


async def test_login_success_returns_jwt_and_user(client: AsyncClient) -> None:
    await _register(client)
    r = await client.post("/auth/login", json={"email": _EMAIL, "password": _PW})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "jwt" in body
    assert body["user"]["email"] == _EMAIL


async def test_login_wrong_password_rejected_generic(client: AsyncClient) -> None:
    await _register(client)
    r = await client.post("/auth/login", json={"email": _EMAIL, "password": "wrong-password-1"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid email or password"


async def test_login_unknown_email_rejected_generic(client: AsyncClient) -> None:
    r = await client.post("/auth/login", json={"email": "ghost@example.com", "password": _PW})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid email or password"


async def test_login_failure_messages_identical(client: AsyncClient) -> None:
    """Unknown email and wrong password must return the same detail string."""
    await _register(client)
    wrong_pw = await client.post("/auth/login", json={"email": _EMAIL, "password": "wrong-password-1"})
    unknown = await client.post("/auth/login", json={"email": "ghost@example.com", "password": _PW})
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json()["detail"] == unknown.json()["detail"]


async def test_login_jwt_authenticates_protected_route(client: AsyncClient) -> None:
    await _register(client)
    login = await client.post("/auth/login", json={"email": _EMAIL, "password": _PW})
    token = login.json()["jwt"]
    r = await client.post(
        "/reports",
        json={"category": "pothole", "lat": 39.29, "lng": -76.61},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text


# ---- /auth/me ----


async def test_me_returns_the_token_owner(client: AsyncClient) -> None:
    reg = await _register(client, display_name="Resident One")
    token = reg.json()["jwt"]

    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == _EMAIL
    assert body["display_name"] == "Resident One"
    assert "password_hash" not in body


async def test_me_rejects_missing_and_invalid_tokens(client: AsyncClient) -> None:
    assert (await client.get("/auth/me")).status_code == 401
    r = await client.get("/auth/me", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


# ---- hashing helpers ----


def test_hash_password_round_trip() -> None:
    h = hash_password("hunter2-hunter2")
    assert h != "hunter2-hunter2"
    assert verify_password("hunter2-hunter2", h)
    assert not verify_password("hunter2-hunter3", h)


def test_verify_password_malformed_hash_returns_false() -> None:
    assert not verify_password("whatever", "not-a-bcrypt-hash")
