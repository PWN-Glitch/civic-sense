"""S-2: upload/input hardening — magic bytes, decompression bombs, EXIF removal."""

from __future__ import annotations

import io
import re
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from app.services import privacy


def _jpeg(size: tuple[int, int] = (16, 16), color: tuple[int, int, int] = (100, 100, 100)) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _jpeg_with_gps_exif() -> bytes:
    """JPEG with EXIF GPS lat/lng embedded."""
    from PIL.TiffImagePlugin import IFDRational

    img = Image.new("RGB", (32, 32), color=(10, 20, 30))
    exif = Image.Exif()
    exif[0x010F] = "TestMake"
    exif[0x0110] = "TestModel"
    # GPS IFD (tag 0x8825) — Baltimore City Hall, roughly.
    gps_ifd = exif.get_ifd(0x8825)
    gps_ifd[0x0001] = "N"
    gps_ifd[0x0002] = (IFDRational(39, 1), IFDRational(17, 1), IFDRational(26, 1))
    gps_ifd[0x0003] = "W"
    gps_ifd[0x0004] = (IFDRational(76, 1), IFDRational(36, 1), IFDRational(44, 1))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def _png(size: tuple[int, int] = (16, 16)) -> bytes:
    img = Image.new("RGB", size, color=(200, 50, 100))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _signup(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    payload = {"sub": sub, "aud": "any"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


# ---- magic-byte sniffing ----


def test_sniff_jpeg() -> None:
    assert privacy.sniff_image_format(_jpeg()) == "jpeg"


def test_sniff_png() -> None:
    assert privacy.sniff_image_format(_png()) == "png"


def test_sniff_rejects_random_bytes() -> None:
    assert privacy.sniff_image_format(b"#!/bin/sh\nrm -rf /") is None
    assert privacy.sniff_image_format(b"<?php echo 1; ?>") is None
    assert privacy.sniff_image_format(b"") is None


@pytest.mark.asyncio
async def test_media_php_renamed_jpg_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Classic polyglot: PHP webshell renamed .jpg with image/jpeg content-type.
    Header lies — magic bytes don't. Must 415."""
    headers = await _signup(client, monkeypatch, "s2-php")
    php_shell = b"<?php system($_GET['cmd']); ?>"
    files = {"file": ("shell.jpg", php_shell, "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 415
    # Confirm nothing was written to disk.
    assert list(Path(tmp_upload_dir).iterdir()) == []


@pytest.mark.asyncio
async def test_media_executable_renamed_jpg_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """ELF binary with image/jpeg content-type → 415."""
    headers = await _signup(client, monkeypatch, "s2-elf")
    elf = b"\x7fELF" + b"\x00" * 60
    files = {"file": ("evil.jpg", elf, "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_media_mime_mismatch_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Real PNG bytes with image/jpeg header → 415 (bytes don't match declaration)."""
    headers = await _signup(client, monkeypatch, "s2-mismatch")
    files = {"file": ("photo.jpg", _png(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_classify_php_renamed_jpg_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """classify never trusted content-type; now it sniffs bytes → 415."""
    headers = await _signup(client, monkeypatch, "s2-cls-php")
    files = {"file": ("x.jpg", b"<?php echo 1; ?>", "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 415


# ---- decompression bomb ----


@pytest.mark.asyncio
async def test_media_pixel_bomb_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """An image declaring more pixels than MAX_IMAGE_PIXELS must be rejected.

    Pillow emits DecompressionBombError when w*h > MAX_IMAGE_PIXELS. We
    monkeypatch the constant down to something tiny so we don't have to
    construct a real 90-megapixel upload."""
    headers = await _signup(client, monkeypatch, "s2-bomb")
    # Drop the budget so a 256×256 upload exceeds it.
    monkeypatch.setattr(privacy.Image, "MAX_IMAGE_PIXELS", 1024)
    files = {"file": ("big.jpg", _jpeg(size=(256, 256)), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    # 413 per FastAPI convention; the plan allows 413 or 422.
    assert r.status_code in (413, 422), r.text
    assert list(Path(tmp_upload_dir).iterdir()) == []


@pytest.mark.asyncio
async def test_classify_pixel_bomb_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "s2-cls-bomb")
    monkeypatch.setattr(privacy.Image, "MAX_IMAGE_PIXELS", 1024)
    files = {"file": ("big.jpg", _jpeg(size=(256, 256)), "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code in (413, 422)


def test_strip_exif_raises_bomb_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Direct service check: strip_exif translates Pillow's DecompressionBombError
    into our typed DecompressionBombError."""
    monkeypatch.setattr(privacy.Image, "MAX_IMAGE_PIXELS", 64)
    with pytest.raises(privacy.DecompressionBombError):
        privacy.strip_exif(_jpeg(size=(64, 64)))


# ---- uuid filename / path traversal ----


@pytest.mark.asyncio
async def test_media_ignores_client_filename(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Client sends a hostile filename; only the server uuid touches disk."""
    headers = await _signup(client, monkeypatch, "s2-trav")
    hostile_names = [
        "../../etc/passwd.jpg",
        "..\\..\\windows\\system32\\config.jpg",
        "shell.php.jpg",
        "a\x00b.jpg",  # null byte
    ]
    for name in hostile_names:
        files = {"file": (name, _jpeg(), "image/jpeg")}
        r = await client.post("/media", files=files, headers=headers)
        assert r.status_code == 201, f"{name}: {r.text}"
    # Every file on disk is a bare uuid with a .jpg extension.
    for path in Path(tmp_upload_dir).iterdir():
        stem = path.stem
        # Raises ValueError if not a uuid.
        uuid.UUID(stem)
        assert path.suffix == ".jpg"
        assert "/" not in path.name and "\\" not in path.name


# ---- EXIF actually stripped ----


@pytest.mark.asyncio
async def test_media_gps_exif_removed(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Upload a JPEG with GPS EXIF; the stored file must have empty exif."""
    headers = await _signup(client, monkeypatch, "s2-gps")
    files = {"file": ("photo.jpg", _jpeg_with_gps_exif(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text

    stored = next(Path(tmp_upload_dir).glob("*.jpg"))
    img = Image.open(stored)
    exif = img.getexif()
    # EXIF dict is empty — no Make, no Model, no GPS IFD pointer.
    assert dict(exif) == {}
    # Specifically, the GPSInfo tag 0x8825 must not be present.
    assert 0x8825 not in exif
    # And the raw bytes no longer contain the literal "TestMake" string.
    assert b"TestMake" not in stored.read_bytes()


@pytest.mark.asyncio
async def test_media_png_also_stripped(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """PNG re-save also drops ancillary chunks (text metadata)."""
    headers = await _signup(client, monkeypatch, "s2-png")
    img = Image.new("RGB", (16, 16), color=(1, 2, 3))
    buf = io.BytesIO()
    # PngInfo let us attach text metadata.
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Author", "attacker@example.com")
    info.add_text("GPS", "39.29,-76.61")
    img.save(buf, format="PNG", pnginfo=info)

    files = {"file": ("photo.png", buf.getvalue(), "image/png")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text

    stored = next(Path(tmp_upload_dir).glob("*.png"))
    body = stored.read_bytes()
    assert b"attacker@example.com" not in body
    assert b"39.29,-76.61" not in body


def test_pillow_max_pixels_constant_exposed() -> None:
    """Sanity: our wrapper exposes MAX_IMAGE_PIXELS so config/tests can audit it."""
    assert privacy.MAX_IMAGE_PIXELS > 0
    assert privacy.MAX_IMAGE_PIXELS == privacy.Image.MAX_IMAGE_PIXELS


# ---- size caps ----


@pytest.mark.asyncio
async def test_classify_oversize_file_413(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "s2-cls-big")
    big = b"\xff\xd8\xff\xe0" + b"\x00" * privacy.MAX_UPLOAD_BYTES
    r = await client.post("/classify", files={"file": ("big.jpg", big, "image/jpeg")}, headers=headers)
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_declared_oversize_body_rejected_before_parsing(client: AsyncClient, tmp_upload_dir) -> None:
    # No auth: the cap answers before routing, so nothing is parsed or spooled.
    r = await client.post(
        "/media",
        content=b"x",
        headers={"Content-Type": "multipart/form-data; boundary=b", "Content-Length": str(20 * 1024 * 1024)},
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_chunked_oversize_body_rejected(client: AsyncClient, tmp_upload_dir) -> None:
    # No Content-Length and no auth: only the streamed byte count can answer 413 here.
    boundary = "civicsensetest"
    head = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode() + b"\xff\xd8\xff\xe0"

    async def body():
        yield head
        chunk = b"\x00" * (1024 * 1024)
        for _ in range(12):
            yield chunk
        yield f"\r\n--{boundary}--\r\n".encode()

    r = await client.post(
        "/media",
        content=body(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    assert r.status_code == 413
    assert list(Path(tmp_upload_dir).iterdir()) == []
