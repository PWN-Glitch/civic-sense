"""B-W2-3: blur pipeline — EgoBlur → OpenCV Haar → no-op, surfaced via /media."""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from app.services import privacy


def _jpeg(color=(120, 90, 60), size=(64, 64)) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def _auth(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": "blur-user", "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


# ---- service unit tests ----


def test_blur_noop_returns_explicit_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(privacy, "_try_egoblur", lambda p: None)
    monkeypatch.setattr(privacy, "_try_opencv_haar", lambda p: None)
    p = tmp_path / "x.jpg"
    p.write_bytes(_jpeg())
    out = privacy.blur_sensitive(p)
    assert out["blurred"] is False
    assert out["faces_blurred"] == 0
    assert out["plates_blurred"] == 0
    assert out["engine"].startswith("none")


def test_blur_egoblur_success_parses_counts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = tmp_path / "x.jpg"
    p.write_bytes(_jpeg())

    class _R:
        returncode = 0
        stdout = "faces=2 plates=1"

    monkeypatch.setattr(privacy.shutil, "which", lambda name: "/usr/bin/egoblur")
    monkeypatch.setattr(privacy.subprocess, "run", lambda *a, **k: _R())
    out = privacy.blur_sensitive(p)
    assert out == {"blurred": True, "faces_blurred": 2, "plates_blurred": 1, "engine": "egoblur"}


def test_blur_egoblur_failure_falls_to_haar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = tmp_path / "x.jpg"
    p.write_bytes(_jpeg())
    monkeypatch.setattr(privacy, "_try_egoblur", lambda p: None)
    called = {}

    def _haar(path):
        called["yes"] = True
        return {"blurred": True, "faces_blurred": 1, "plates_blurred": 0, "engine": "opencv-haar"}

    monkeypatch.setattr(privacy, "_try_opencv_haar", _haar)
    out = privacy.blur_sensitive(p)
    assert called.get("yes")
    assert out["engine"] == "opencv-haar"
    assert out["blurred"] is True


def test_haar_no_faces_returns_unblurred(tmp_path: Path) -> None:
    pytest.importorskip("cv2", reason="OpenCV comes with the optional `ai` extra")
    p = tmp_path / "flat.jpg"
    p.write_bytes(_jpeg(size=(96, 96)))
    out = privacy._try_opencv_haar(p)
    assert out is not None
    assert out["engine"] == "opencv-haar"
    # A flat color square should not detect faces.
    assert out["faces_blurred"] == 0
    assert out["blurred"] is False


def test_blur_never_raises_on_corrupt_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = tmp_path / "bad.jpg"
    p.write_bytes(b"not an image")
    # Even if cv2 can't read it, we must not raise out of blur_sensitive.
    out = privacy.blur_sensitive(p)
    assert out["blurred"] is False


# ---- endpoint ----


@pytest.mark.asyncio
async def test_media_response_includes_blur_fields(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert "blurred" in body
    assert "faces_blurred" in body and isinstance(body["faces_blurred"], int)
    assert "plates_blurred" in body and isinstance(body["plates_blurred"], int)
    assert "blur_engine" in body and isinstance(body["blur_engine"], str)


@pytest.mark.asyncio
async def test_media_upload_succeeds_with_no_blurrer(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    headers = await _auth(client, monkeypatch)
    monkeypatch.setattr(privacy, "_try_egoblur", lambda p: None)
    monkeypatch.setattr(privacy, "_try_opencv_haar", lambda p: None)
    files = {"file": ("photo.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["blurred"] is False
    assert body["blur_engine"].startswith("none")
