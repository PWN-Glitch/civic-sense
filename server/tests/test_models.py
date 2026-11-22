"""B-W2-2: GET /models/civic-classifier.tflite + /models/civic-classifier.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient

MODEL_STORE = Path(__file__).resolve().parents[1] / "app" / "models_store"
TFLITE = MODEL_STORE / "civic-classifier.tflite"
MANIFEST = MODEL_STORE / "civic-classifier.json"


@pytest.mark.asyncio
async def test_models_tflite_streams_with_cache_headers(client: AsyncClient) -> None:
    if not TFLITE.exists():
        pytest.skip("tflite not exported")
    r = await client.get("/models/civic-classifier.tflite")
    assert r.status_code == 200, r.text
    assert int(r.headers["content-length"]) == TFLITE.stat().st_size
    assert "max-age" in r.headers.get("cache-control", "")
    assert r.headers["content-type"].startswith("application/")
    assert len(r.content) == TFLITE.stat().st_size


@pytest.mark.asyncio
async def test_models_json_returns_manifest(client: AsyncClient) -> None:
    if not MANIFEST.exists():
        pytest.skip("manifest not exported")
    r = await client.get("/models/civic-classifier.json")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["labels"]) == 6
    assert data["input"]["shape"] == [1, 224, 224, 3]
    # The exported TFLite graph is NHWC; clients must read the shape, not assume.
    assert data["input"]["dtype"] == "float32"
    assert data["input"]["normalization"] == "imagenet"
    assert data["version"]


@pytest.mark.asyncio
async def test_models_json_404_when_missing(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.routers import models as models_router

    monkeypatch.setattr(models_router, "_MODEL_DIR", tmp_path)
    r = await client.get("/models/civic-classifier.json")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_models_tflite_404_when_missing(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.routers import models as models_router

    monkeypatch.setattr(models_router, "_MODEL_DIR", tmp_path)
    r = await client.get("/models/civic-classifier.tflite")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_models_json_is_valid_json_on_disk() -> None:
    if not MANIFEST.exists():
        pytest.skip("manifest not exported")
    data = json.loads(MANIFEST.read_text())
    assert isinstance(data, dict)
