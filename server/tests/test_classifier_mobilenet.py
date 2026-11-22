"""B-W2-1: fine-tuned MobileNetV3 classifier + ?engine= wiring."""

from __future__ import annotations

import json
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.services import classifier_mobilenet
from app.services.classifier import ClassifierUnavailable
from scripts.synthetic_data import category_sample_bytes

MODEL_STORE = Path(__file__).resolve().parents[1] / "app" / "models_store"
ONNX = MODEL_STORE / "civic-classifier.onnx"
TFLITE = MODEL_STORE / "civic-classifier.tflite"
MANIFEST = MODEL_STORE / "civic-classifier.json"

pytestmark = pytest.mark.skipif(
    not ONNX.exists() or find_spec("onnxruntime") is None,
    reason="mobilenet not exported yet, or the optional `ai` extra is not installed",
)


async def _auth_header(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr("app.routers.auth.settings.dev_auth_bypass", True)
    r = await client.post("/auth/google", json={"id_token": "dev"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.fixture(autouse=True)
def _reset_session():
    classifier_mobilenet.reset()
    yield
    classifier_mobilenet.reset()


# ---- artifacts ----


def test_export_artifacts_exist() -> None:
    assert ONNX.exists(), "civic-classifier.onnx missing — run scripts.export_tflite"
    assert TFLITE.exists(), "civic-classifier.tflite missing"
    assert MANIFEST.exists(), "civic-classifier.json missing"


def test_tflite_under_15mb() -> None:
    size = TFLITE.stat().st_size
    assert size < 15 * 1024 * 1024, f"tflite too large: {size / 1e6:.1f}MB"


def test_manifest_shape() -> None:
    data = json.loads(MANIFEST.read_text())
    assert data["version"]
    assert len(data["labels"]) == 6
    assert set(data["labels"]) == {"pothole", "streetlight", "trash", "graffiti", "sidewalk damage", "other"}
    assert data["input"]["shape"] == [1, 224, 224, 3]
    # The exported TFLite graph is NHWC; clients must read the shape, not assume.
    assert data["input"]["dtype"] == "float32"
    assert data["input"]["normalization"] == "imagenet"


# ---- service ----


def test_mobilenet_classify_shape() -> None:
    preds = classifier_mobilenet.classify(category_sample_bytes("pothole", seed=7))
    assert len(preds) == 6
    assert abs(sum(p["confidence"] for p in preds) - 1.0) < 1e-3
    assert preds == sorted(preds, key=lambda p: p["confidence"], reverse=True)
    assert {p["category"] for p in preds} == set(classifier_mobilenet._LABELS)


def test_mobilenet_unavailable_when_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(classifier_mobilenet, "_ONNX_PATH", tmp_path / "nope.onnx")
    classifier_mobilenet.reset()
    with pytest.raises(ClassifierUnavailable):
        classifier_mobilenet.classify(b"anything")


@pytest.mark.parametrize(
    "category",
    ["pothole", "streetlight", "trash", "graffiti", "sidewalk damage", "other"],
)
def test_mobilenet_top1_on_synthetic(category: str) -> None:
    """Per-category synthetic exemplar must classify top-1 as its label."""
    preds = classifier_mobilenet.classify(category_sample_bytes(category, seed=99))
    assert preds[0]["category"] == category, (
        f"top-1 for {category} was {preds[0]['category']} ({preds[0]['confidence']:.2f})"
    )


def test_mobilenet_beats_chance_on_synthetic_batch() -> None:
    """Accuracy over a synthetic batch must exceed chance (1/6) by a margin."""
    from app.services.labels import CATEGORIES

    correct = 0
    total = 0
    for cat in CATEGORIES:
        for seed in range(5):
            preds = classifier_mobilenet.classify(category_sample_bytes(cat, seed=seed))
            if preds[0]["category"] == cat:
                correct += 1
            total += 1
    assert correct / total > 1 / 3, f"accuracy {correct}/{total} not meaningfully above chance"


# ---- router ----


@pytest.mark.asyncio
async def test_classify_engine_mobilenet_default(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _auth_header(client, monkeypatch)
    files = {"file": ("p.jpg", category_sample_bytes("pothole", seed=3), "image/jpeg")}
    r = await client.post("/classify", files=files, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["predictions"]) == 6


@pytest.mark.asyncio
async def test_classify_engine_explicit_clip(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = await _auth_header(client, monkeypatch)

    def _fake_clip(image_bytes: bytes):
        return [
            {"category": c, "confidence": 1.0 / 6}
            for c in ("pothole", "streetlight", "trash", "graffiti", "sidewalk damage", "other")
        ]

    with patch("app.routers.classify.clip_engine.classify", side_effect=_fake_clip):
        files = {"file": ("p.jpg", category_sample_bytes("trash", seed=5), "image/jpeg")}
        r = await client.post("/classify?engine=clip", files=files, headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_classify_engine_mobilenet_503_when_unavailable(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    headers = await _auth_header(client, monkeypatch)
    monkeypatch.setattr(classifier_mobilenet, "_ONNX_PATH", tmp_path / "missing.onnx")
    classifier_mobilenet.reset()
    files = {"file": ("p.jpg", category_sample_bytes("trash", seed=5), "image/jpeg")}
    r = await client.post("/classify?engine=mobilenet", files=files, headers=headers)
    assert r.status_code == 503
    assert r.json().get("fallback") is True


def test_manifest_records_exported_shape(tmp_path: Path) -> None:
    from scripts.export_tflite import write_manifest

    out = write_manifest("v-test", tmp_path / "m.json", [1, 224, 224, 3])
    data = json.loads(out.read_text())
    assert data["input"]["shape"] == [1, 224, 224, 3]
    assert data["input"]["layout"] == "NHWC"
