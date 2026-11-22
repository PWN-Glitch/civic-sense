"""Auth routes — Google id_token, and email/password register + login."""

from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.middleware.ratelimit import rate_limit
from app.models import User
from app.schemas import GoogleAuthRequest, GoogleAuthResponse, LoginRequest, RegisterRequest, UserOut
from app.security import (
    create_jwt,
    hash_password,
    require_user,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Single message for both failure modes so the endpoint doesn't reveal
# whether an email is registered (user-enumeration defense).
_INVALID_CREDENTIALS = "invalid email or password"


async def _verify_google_token(id_token: str) -> dict | None:
    """Call Google's tokeninfo endpoint. Returns payload dict on HTTP 200, else None."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(_TOKENINFO_URL, params={"id_token": id_token})
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    try:
        return r.json()
    except ValueError:
        return None


async def _upsert_user(db: AsyncSession, google_sub: str, display_name: str | None) -> User:
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(id=str(uuid.uuid4()), google_sub=google_sub, display_name=display_name)
        db.add(user)
    elif display_name and user.display_name != display_name:
        user.display_name = display_name
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)) -> User:
    """The signed-in account, for a client that holds a token but no profile.

    The app caches the profile beside the token; this endpoint is the
    self-healing path when that cache is missing or stale.
    """
    return user


@router.post(
    "/google",
    response_model=GoogleAuthResponse,
    dependencies=[Depends(rate_limit(route_key="auth.google", limit=10, window_s=60.0))],
)
async def google_auth(body: GoogleAuthRequest, db: AsyncSession = Depends(get_db)) -> GoogleAuthResponse:
    # Dev bypass (offline dev only).
    if settings.dev_auth_bypass and body.id_token == "dev":
        user = await _upsert_user(db, google_sub=f"dev-{settings.google_client_id or 'local'}", display_name="Dev User")
        return GoogleAuthResponse(jwt=create_jwt(user.id), user=UserOut.model_validate(user))

    payload = await _verify_google_token(body.id_token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid id_token")

    aud = payload.get("aud")
    if not settings.google_client_id or aud != settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid audience")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing sub")

    name = payload.get("name") or payload.get("email")
    user = await _upsert_user(db, google_sub=sub, display_name=name)
    return GoogleAuthResponse(jwt=create_jwt(user.id), user=UserOut.model_validate(user))


@router.post(
    "/register",
    response_model=GoogleAuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit(route_key="auth.register", limit=10, window_s=60.0))],
)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> GoogleAuthResponse:
    email = body.email.lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name or email.split("@", 1)[0],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return GoogleAuthResponse(jwt=create_jwt(user.id), user=UserOut.model_validate(user))


@router.post(
    "/login",
    response_model=GoogleAuthResponse,
    dependencies=[Depends(rate_limit(route_key="auth.login", limit=10, window_s=60.0))],
)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> GoogleAuthResponse:
    email = body.email.lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    # Run verify even when the user doesn't exist so the timing matches the
    # wrong-password path (blunts user-enumeration via response timing).
    candidate = user.password_hash if user and user.password_hash else _DUMMY_HASH
    if not verify_password(body.password, candidate) or user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_CREDENTIALS)
    return GoogleAuthResponse(jwt=create_jwt(user.id), user=UserOut.model_validate(user))


# Precomputed bcrypt hash of a throwaway password, used to equalize login
# timing when the email isn't registered (see login()).
_DUMMY_HASH = hash_password("dummy-password-for-timing")
