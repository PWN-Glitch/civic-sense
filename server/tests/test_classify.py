"""B3: zero-shot classification."""

from __future__ import annotations

import io
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.security import create_jwt
from app.services import classifier
from app.services.classifier import ClassifierUnavailable, confidence_band, severity_estimate


def _jpeg_bytes(size: tuple[int, int] = (224, 224), color: tuple[int, int, int] = (128, 64, 32)) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def _auth_header(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str = "cls-user") -> dict:
    """Mint a JWT directly — bypasses Google since auth is covered in test_auth."""
    monkeypatch.setattr("app.routers.auth.settings.google_client_id", "x")
    # Insert user directly.
    from sqlalchemy.ext.asyncio import AsyncSession

    # Reach the db_session via the client's override.
    # Simpler: hit /auth/google with dev bypass.
    monkeypatch.setattr("app.routers.auth.settings.dev_auth_bypass", True)
    r = await client.post("/auth/google", json={"id_token": "dev"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.mark.asyncio
async def test_classify_returns_six_predictions(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from importlib.util import find_spec

    from app.services import classifier_mobilenet

    if not (classifier_mobilenet.available() and find_spec("onnxruntime")) and not find_spec("open_clip"):
        pytest.skip("no classifier engine installed (optional `ai` extra)")
    headers = await _auth_header(client, monkeypatch)
    files = {"file": ("photo.jpg", _jpeg_bytes(), "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "predictions" in body
    assert len(body["predictions"]) == 6
    cats = {p["category"] for p in body["predictions"]}
    assert cats == {"pothole", "streetlight", "trash", "graffiti", "sidewalk damage", "other"}
    total = sum(p["confidence"] for p in body["predictions"])
    assert abs(total - 1.0) < 1e-3
    assert body["band"] in ("high", "medium", "low")
    assert body["severity"]["level"] in ("low", "moderate", "high")
    assert body["disclaimer"] == "AI estimate — please verify"


@pytest.mark.asyncio
async def test_classify_corrupt_bytes_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Bytes that pass magic-byte sniffing but fail Pillow decode → 422."""
    headers = await _auth_header(client, monkeypatch)
    # JPEG magic bytes followed by garbage — sniffs as jpeg, fails decode.
    corrupt = b"\xff\xd8\xff\xe0" + b"\x00" * 32 + b"not-a-real-jpeg"
    files = {"file": ("photo.jpg", corrupt, "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_classify_non_image_bytes_415(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Plain non-image bytes fail the magic-byte sniff → 415."""
    headers = await _auth_header(client, monkeypatch)
    files = {"file": ("photo.jpg", b"not-an-image", "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_classify_model_failure_503(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_header(client, monkeypatch)

    def _boom(image_bytes: bytes, engine: str = "clip"):
        raise ClassifierUnavailable("model weights missing")

    with patch("app.routers.classify.classify_image", side_effect=_boom):
        files = {"file": ("photo.jpg", _jpeg_bytes(), "image/jpeg")}
        r = await client.post("/classify?engine=clip", files=files, headers=headers)
    assert r.status_code == 503
    assert r.json().get("fallback") is True


def test_confidence_band_edges() -> None:
    assert confidence_band(0.75) == "high"
    assert confidence_band(0.9) == "high"
    assert confidence_band(0.4) == "medium"
    assert confidence_band(0.7499) == "medium"
    assert confidence_band(0.3999) == "low"
    assert confidence_band(0.0) == "low"


def test_severity_estimate_shape() -> None:
    out = severity_estimate("pothole", {"pothole": 0.8, "trash": 0.1})
    assert out["level"] in ("low", "moderate", "high")
    assert isinstance(out["reason"], str) and out["reason"]
