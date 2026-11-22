"""Media: photo upload (EXIF strip + optional blur) and read-back."""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.middleware.ratelimit import rate_limit_authed
from app.models import Photo, User
from app.schemas import MediaResponse
from app.security import require_user
from app.services.privacy import (
    MAX_UPLOAD_BYTES,
    DecompressionBombError,
    InvalidImageError,
    blur_sensitive,
    sniff_image_format,
    strip_exif,
)

router = APIRouter(prefix="/media", tags=["media"])

_ALLOWED_MIME = {"image/jpeg": ".jpg", "image/png": ".png"}

# Exactly the shape upload_media generates. Validating this before touching the
# filesystem means a path like "../../etc/passwd" can never resolve to a file.
_SAFE_KEY = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png)$"
)


@router.post(
    "",
    response_model=MediaResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_authed(route_key="media.upload", limit=20, window_s=60.0))],
)
async def upload_media(
    file: UploadFile,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> MediaResponse:
    # Layer 1: Content-Type header sanity check. This is NOT sufficient on its
    # own — a malicious client can lie — but it lets us fail fast on obvious
    # mismatches and pick the right extension for the stored file.
    mime = (file.content_type or "").lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"unsupported media type: {mime or 'unknown'}",
        )
    ext = _ALLOWED_MIME[mime]

    # Read at most one byte past the cap so an oversized file never lands in memory whole.
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="file exceeds 10MB limit",
        )

    # Layer 2: magic-byte sniffing — verify actual JPEG/PNG signature before
    # we hand bytes to Pillow. Defeats the classic "shell.php renamed .jpg"
    # upload. Pillow will still refuse anything malformed; this is the
    # defense-in-depth outer gate.
    sniffed = sniff_image_format(raw)
    expected = "jpeg" if ext == ".jpg" else "png"
    if sniffed != expected:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"file bytes do not match declared type {mime}",
        )

    # Layer 3: Pillow decode + EXIF strip. DecompressionBombError → 413.
    try:
        clean = strip_exif(raw, output_format="PNG" if ext == ".png" else "JPEG")
    except DecompressionBombError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc)
        ) from exc
    except InvalidImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    # Server-generated uuid filename only — the client's ``file.filename`` is
    # NEVER used as a filesystem path component, so path traversal via
    # filename (``../../etc/passwd.jpg`` etc.) is impossible by construction.
    photo_id = str(uuid.uuid4())
    filename = f"{photo_id}{ext}"
    dest = settings.upload_dir / filename
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(clean)

    blur_result = blur_sensitive(dest)

    photo = Photo(
        id=photo_id,
        report_id=None,
        uploader_id=user.id,
        storage_key=filename,
        exif_stripped=True,
        blurred=blur_result["blurred"],
    )
    db.add(photo)
    await db.commit()

    return MediaResponse(
        photo_id=photo_id,
        url=f"/media/{filename}",
        exif_stripped=True,
        blurred=blur_result["blurred"],
        faces_blurred=blur_result["faces_blurred"],
        plates_blurred=blur_result["plates_blurred"],
        blur_engine=blur_result["engine"],
    )


@router.get("/{key}", include_in_schema=False)
async def read_media(key: str, db: AsyncSession = Depends(get_db)) -> FileResponse:
    """Serve an uploaded photo by its server-generated key.

    The key is an unguessable UUID filename (a capability URL), so no bearer
    token is required — RN's <Image> cannot attach one. Bytes on disk have
    already had EXIF stripped and best-effort face blurring at upload time.
    """
    if not _SAFE_KEY.match(key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    # A file whose photo row is gone (deleted report, wiped demo user) stays on
    # disk but is no longer served.
    known = await db.execute(select(Photo.id).where(Photo.storage_key == key).limit(1))
    if known.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    path = settings.upload_dir / key
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    media_type = "image/png" if key.endswith(".png") else "image/jpeg"
    return FileResponse(
        path, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"}
    )
