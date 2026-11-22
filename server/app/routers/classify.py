"""POST /classify — multipart image → predictions (mobilenet default, CLIP fallback)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse

from app.middleware.ratelimit import rate_limit_authed
from app.models import User
from app.schemas import ClassifyResponse, Prediction, Severity
from app.security import require_user
from app.services import classifier as clip_engine
from app.services import classifier_mobilenet as mobilenet_engine
from app.services.classifier import (
    ClassifierUnavailable,
    confidence_band,
    severity_estimate,
)
from app.services.privacy import (
    MAX_UPLOAD_BYTES,
    DecompressionBombError,
    InvalidImageError,
    sniff_image_format,
    strip_exif,
)

router = APIRouter(prefix="/classify", tags=["classify"])

DISCLAIMER = "AI estimate — please verify"


def classify_image(image_bytes: bytes, engine: str = "clip"):
    """Indirection so tests can patch the call site."""
    if engine == "mobilenet":
        return mobilenet_engine.classify(image_bytes)
    return clip_engine.classify(image_bytes)


def _resolve_engine(requested: Literal["clip", "mobilenet"] | None) -> str:
    """Default: mobilenet if its onnx is exported, else clip."""
    if requested is not None:
        return requested
    return "mobilenet" if mobilenet_engine.available() else "clip"


def _fallback_503(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"fallback": True, "message": message},
    )


@router.post(
    "",
    response_model=ClassifyResponse,
    dependencies=[Depends(rate_limit_authed(route_key="classify.submit", limit=20, window_s=60.0))],
)
async def classify_endpoint(
    file: UploadFile,
    engine: Literal["clip", "mobilenet"] | None = Query(default=None),
    user: User = Depends(require_user),
) -> ClassifyResponse | JSONResponse:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="file exceeds 10MB limit",
        )
    if not raw:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="empty file")

    # Magic-byte gate — /classify historically did not check Content-Type, so
    # we sniff the actual bytes and reject anything that isn't JPEG or PNG.
    if sniff_image_format(raw) not in ("jpeg", "png"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported image bytes (expected JPEG or PNG)",
        )

    try:
        clean = strip_exif(raw)
    except DecompressionBombError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc)
        ) from exc
    except InvalidImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    resolved = _resolve_engine(engine)
    try:
        predictions = classify_image(clean, engine=resolved)
    except ClassifierUnavailable:
        return _fallback_503("AI classifier unavailable; pick a category manually.")

    if not predictions:
        return _fallback_503("AI classifier returned no predictions.")

    top = predictions[0]
    band = confidence_band(top["confidence"])
    scores = {p["category"]: p["confidence"] for p in predictions}
    severity = severity_estimate(top["category"], scores)

    return ClassifyResponse(
        predictions=[Prediction(**p) for p in predictions],
        band=band,  # type: ignore[arg-type]
        severity=Severity(**severity),
        disclaimer=DISCLAIMER,
    )
