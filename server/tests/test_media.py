"""B5: media upload + EXIF strip + optional blur."""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings


def _jpeg_with_exif_gps() -> bytes:
    """Build a JPEG with EXIF data embedded (Make/Model/DateTime)."""
    img = Image.new("RGB", (32, 32), color=(200, 100, 50))
    exif = Image.Exif()
    exif[0x010F] = "TestMake"  # Make
    exif[0x0110] = "TestModel"  # Model
    exif[0x9003] = "2026:10:07 12:00:00"  # DateTimeOriginal
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def _jpeg_plain() -> bytes:
    img = Image.new("RGB", (32, 32), color=(50, 100, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color=(10, 200, 90))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _auth_headers(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": "media-user", "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.mark.asyncio
async def test_upload_strips_exif(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg_with_exif_gps(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["exif_stripped"] is True
    assert body["photo_id"]
    assert body["url"].endswith(".jpg")

    # Verify the saved file has no EXIF
    from pathlib import Path
    saved = next(Path(tmp_upload_dir).glob("*.jpg"))
    img = Image.open(saved)
    exif = img.getexif()
    assert 0x010F not in exif  # Make stripped
    assert 0x0110 not in exif  # Model stripped
    assert 0x9003 not in exif  # DateTimeOriginal stripped


@pytest.mark.asyncio
async def test_upload_wrong_mime_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("doc.txt", b"hello", "text/plain")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_upload_too_big_413(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth_headers(client, monkeypatch)
    # 10MB + 1 byte of jpeg-ish payload (we don't actually decode the whole thing in validation order)
    big = b"\xff\xd8\xff\xe0" + b"\x00" * (10 * 1024 * 1024)
    files = {"file": ("big.jpg", big, "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_upload_png_ok(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("photo.png", _png_bytes(), "image/png")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["url"].endswith(".png")


@pytest.mark.asyncio
async def test_upload_blur_noop_when_binary_missing(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg_plain(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201
    # EgoBlur binary almost certainly not on PATH in test env → blurred:false
    assert r.json()["blurred"] is False

@pytest.mark.asyncio
async def test_uploaded_photo_is_served_back(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir
) -> None:
    """The url returned by POST /media must actually resolve to the bytes."""
    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg_plain(), "image/jpeg")}
    uploaded = await client.post("/media", files=files, headers=headers)
    assert uploaded.status_code == 201
    url = uploaded.json()["url"]
    assert url.startswith("/media/")

    # Capability URL: no bearer token needed (RN's <Image> cannot send one).
    served = await client.get(url)
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"
    assert served.content[:2] == b"\xff\xd8"  # JPEG SOI


@pytest.mark.asyncio
async def test_media_read_rejects_unknown_and_unsafe_keys(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir
) -> None:
    assert (await client.get("/media/00000000-0000-0000-0000-000000000000.jpg")).status_code == 404
    # Only the exact generated shape is served — no traversal, no other paths.
    assert (await client.get("/media/..%2F..%2Fetc%2Fpasswd")).status_code == 404
    assert (await client.get("/media/passwd")).status_code == 404


@pytest.mark.asyncio
async def test_file_without_a_photo_row_is_not_served(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session, tmp_upload_dir
) -> None:
    """Deleting a photo row (report deleted, demo data wiped) stops serving its file."""
    from sqlalchemy import delete

    from app.models import Photo

    headers = await _auth_headers(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg_plain(), "image/jpeg")}
    uploaded = (await client.post("/media", files=files, headers=headers)).json()
    # An unattached upload is still the uploader's photo and stays readable.
    assert (await client.get(uploaded["url"])).status_code == 200

    await db_session.execute(delete(Photo).where(Photo.id == uploaded["photo_id"]))
    await db_session.commit()

    key = uploaded["url"].removeprefix("/media/")
    assert (tmp_upload_dir / key).is_file()  # nothing is deleted from disk
    assert (await client.get(uploaded["url"])).status_code == 404
