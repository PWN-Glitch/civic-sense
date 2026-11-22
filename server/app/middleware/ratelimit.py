"""Sliding-window in-memory rate limiter.

Why hand-rolled + in-memory (not slowapi/Redis):
- Week-3 MVP ships a single uvicorn worker; cross-process coordination is not
  a requirement yet. Adding Redis just for rate limiting would mean a new
  service, new credentials, and a new failure mode.
- ``slowapi`` pulls in the ``limits`` library and forces a global middleware
  pattern keyed off request state; we want per-route limits with distinct
  keys (user id when authed, IP otherwise), which is cleaner as a scoped
  dependency.
- The limiter below is intentionally small, fully deterministic, and
  injectable so tests can swap it out via ``app.dependency_overrides``.

When we outgrow this (multi-worker, multi-instance), replace ``RateLimiter``
with a Redis-backed implementation behind the same interface — call sites
don't change.

Security properties:
- Sliding window (per-call timestamp deque), not fixed-window — no double
  burst at the window boundary.
- Per-route bucket map: each route gets its own dictionary of subjects.
- Keys: authenticated user id when available, else source IP
  (``request.client.host``). We do NOT trust ``X-Forwarded-For`` here —
  uvicorn only populates ``request.client`` from the actual peer unless
  ``--proxy-headers`` is set, which is the correct default for this app.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Request


class RateLimitExceeded(Exception):
    """Raised by rate-limit dependencies. main.py registers a handler that
    renders this as HTTP 429 ``{"detail":"rate limit exceeded","retry_after":N}``.
    """

    def __init__(self, retry_after: float) -> None:
        super().__init__("rate limit exceeded")
        self.retry_after = max(1, int(retry_after) + 1)


@dataclass
class RateLimiter:
    """Sliding-window limiter. One instance per process, shared across routes.

    Thread-safety: FastAPI runs dependencies on the event loop; deque ops are
    atomic under the GIL. Good enough for a single-process server.
    """

    # {(route_key, subject_key): deque[timestamps]}
    _buckets: dict[tuple[str, str], deque[float]] = field(
        default_factory=lambda: defaultdict(deque)
    )

    def hit(
        self, *, route_key: str, subject: str, limit: int, window_s: float
    ) -> tuple[bool, float]:
        """Record a hit. Returns (allowed, retry_after_seconds_if_blocked)."""
        now = time.monotonic()
        cutoff = now - window_s
        bucket = self._buckets[(route_key, subject)]
        # Drop expired timestamps from the left.
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(0.0, bucket[0] + window_s - now)
            return False, retry_after
        bucket.append(now)
        return True, 0.0

    def reset(self) -> None:
        """Test helper: clear all buckets."""
        self._buckets.clear()


# Process-wide singleton; routers import this.
rate_limiter = RateLimiter()


def _subject_key(request: Request, user_id: str | None) -> str:
    """Stable subject for a bucket: user id if authed, else source IP."""
    if user_id:
        return f"u:{user_id}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


def rate_limit(*, route_key: str, limit: int, window_s: float = 60.0) -> Callable:
    """Build a FastAPI dependency enforcing ``limit`` per ``window_s`` on a route.

    IP-keyed variant — use for unauthenticated endpoints like /auth/google.
    The dependency does NOT require auth itself; if a route also depends on
    ``require_user``, declare the rate-limit dep AFTER it in the
    ``dependencies=[...]`` list (FastAPI resolves dependencies in order) and
    the limiter will key on the authed user id via ``request.state.user_id``.
    """

    async def _check(request: Request) -> None:
        user_id = getattr(request.state, "user_id", None)
        subject = _subject_key(request, user_id=user_id)
        allowed, retry_after = rate_limiter.hit(
            route_key=route_key, subject=subject, limit=limit, window_s=window_s
        )
        if not allowed:
            raise RateLimitExceeded(retry_after)

    return _check


def rate_limit_authed(*, route_key: str, limit: int, window_s: float = 60.0) -> Callable:
    """Build a dependency that requires auth (via ``require_user``) and keys
    the rate-limit bucket by the resolved user's id.

    Using this on a route implies the route is protected — unauthenticated
    callers get 401 from the auth layer before the limiter runs, which is the
    correct ordering (don't leak rate-limit budget to unauthenticated scans).
    """

    # Deferred so we can use ``Depends``; importing inside the factory keeps
    # the module dependency direction security ← middleware clean.
    from fastapi import Depends

    from app.security import require_user

    async def _check(request: Request, user=Depends(require_user)) -> None:  # noqa: B008
        subject = _subject_key(request, user_id=user.id)
        allowed, retry_after = rate_limiter.hit(
            route_key=route_key, subject=subject, limit=limit, window_s=window_s
        )
        if not allowed:
            raise RateLimitExceeded(retry_after)

    return _check
