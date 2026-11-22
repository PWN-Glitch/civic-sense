"""GET /models/* — serve exported on-device model artifacts.

TFLite is streamed with long-cache headers + content-length so the mobile
client's modelManager can download once and version-check. 404 until the
export script has run.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(prefix="/models", tags=["models"])

_MODEL_DIR = Path(__file__).resolve().parent.parent / "models_store"

_CACHE = "public, max-age=86400"  # 24h; clients version-check via the .json


def _serve(filename: str, media_type: str) -> FileResponse:
    path = _MODEL_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{filename} not exported yet",
        )
    return FileResponse(
        path,
        media_type=media_type,
        filename=filename,
        headers={"Cache-Control": _CACHE},
    )


@router.get("/civic-classifier.tflite")
async def get_tflite() -> FileResponse:
    return _serve("civic-classifier.tflite", "application/octet-stream")


@router.get("/civic-classifier.json")
async def get_manifest() -> FileResponse:
    return _serve("civic-classifier.json", "application/json")
