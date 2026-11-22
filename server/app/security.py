"""JWT issuance + request authentication + password hashing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import User

_ALGORITHM = "HS256"
_TOKEN_TTL = timedelta(days=7)

_bearer = HTTPBearer(auto_error=False)


def create_jwt(user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + _TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode a JWT; raises JWTError on invalid/expired."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])


def hash_password(password: str) -> str:
    """bcrypt-hash a plaintext password (12 rounds, library default)."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time check of plaintext against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed stored hash — treat as mismatch, never raise.
        return False


async def require_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid bearer token",
        )
    try:
        payload = decode_jwt(creds.credentials)
        user_id = payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired token",
        ) from None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    # Stash on request.state so downstream rate-limit dependencies can key
    # buckets by user id without re-resolving the token.
    request.state.user_id = user.id
    return user
