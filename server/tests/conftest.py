"""Shared pytest fixtures.

Tests run against the real PostGIS database `civicsense_test` on localhost:5433
because geo behavior (ST_DWithin, geometry(Point,4326)) cannot be faked with
aiosqlite. Schema is created/dropped per session; each test gets a fresh
transaction-safe state via table truncation.
"""

from __future__ import annotations

import os

# Tests flip the dev auth bypass on, which only a dev/test environment allows.
os.environ["APP_ENV"] = "test"

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db import get_db
from app.main import app


_SCHEMA_READY = False


@pytest.fixture
async def _test_engine():
    """Function-scoped engine. Schema is created once per process on first use."""
    global _SCHEMA_READY
    engine = create_async_engine(settings.test_database_url, echo=False)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
    if not _SCHEMA_READY:
        from app import models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.drop_all)
            await conn.run_sync(models.Base.metadata.create_all)
        _SCHEMA_READY = True
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(_test_engine) -> AsyncIterator[AsyncSession]:
    """Per-test session; truncates all tables after each test for isolation."""
    session_factory = async_sessionmaker(_test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    # Truncate in FK-safe order.
    async with _test_engine.begin() as conn:
        await conn.exec_driver_sql(
            "TRUNCATE photos, user_confirmations, ai_predictions, "
            "report_status_history, community_verifications, report_drafts, "
            "report_events, contacts, reports, "
            "departments, jurisdictions, users RESTART IDENTITY CASCADE"
        )


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """Reset the process-wide rate-limiter singleton between tests so limits
    are deterministic (each test starts with empty buckets). Tests that want
    to assert 429 behavior build their own burst; tests that don't care get a
    clean slate automatically."""
    from app.middleware.ratelimit import rate_limiter

    rate_limiter.reset()


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def tmp_upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point upload_dir at a tmp dir for media tests."""
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    return tmp_path
