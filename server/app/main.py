from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.middleware.bodylimit import BodySizeLimitMiddleware
from app.middleware.ratelimit import RateLimitExceeded
from app.services.privacy import MAX_UPLOAD_BYTES


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Civic Sense", version="0.1.0", lifespan=lifespan)
# Headroom over the file cap covers multipart boundaries and part headers.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_UPLOAD_BYTES + 64 * 1024)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Render 429 with the spec'd body shape {detail, retry_after}."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "rate limit exceeded", "retry_after": exc.retry_after},
        headers={"Retry-After": str(exc.retry_after)},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Routers mounted in PHASE B tasks.
from app.routers import auth, classify, compose, contacts, map, media, models, reports, routing, stats, verify  # noqa: E402

app.include_router(auth.router)
app.include_router(classify.router)
app.include_router(reports.router)
app.include_router(media.router)
app.include_router(routing.router)
app.include_router(map.router)
app.include_router(models.router)
app.include_router(verify.router)
app.include_router(contacts.router)
app.include_router(compose.router)
app.include_router(stats.router)
