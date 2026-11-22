"""Fine-tuned MobileNetV3-Small classification via ONNX Runtime (CPU, lazy).

Same interface as ``app.services.classifier`` (CLIP): ``classify(bytes)`` →
[{category, confidence}] sorted desc; ``ClassifierUnavailable`` on any load /
inference failure so the router can answer 503 + {fallback:true}.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

from PIL import Image

from app.services.classifier import ClassifierUnavailable
from app.services.labels import CATEGORIES

_MODEL_DIR = Path(__file__).resolve().parent.parent / "models_store"
_ONNX_PATH = _MODEL_DIR / "civic-classifier.onnx"
_MANIFEST_PATH = _MODEL_DIR / "civic-classifier.json"

_SESSION: Any = None
_LABELS: tuple[str, ...] = CATEGORIES
_MODEL_VERSION = "mobilenetv3-small-civic-v1"

_IMAGENET_MEAN = (0.485, 0.456, 0.406)
_IMAGENET_STD = (0.229, 0.224, 0.225)


def onnx_path() -> Path:
    return _ONNX_PATH


def manifest_path() -> Path:
    return _MANIFEST_PATH


def available() -> bool:
    return _ONNX_PATH.exists()


def _load_labels() -> tuple[str, ...]:
    global _LABELS
    if _MANIFEST_PATH.exists():
        try:
            data = json.loads(_MANIFEST_PATH.read_text())
            labels = tuple(data["labels"])
            if len(labels) == 6:
                _LABELS = labels
        except Exception:  # noqa: BLE001,S110
            pass
    return _LABELS


def _load() -> None:
    global _SESSION
    if _SESSION is not None:
        return
    if not _ONNX_PATH.exists():
        raise ClassifierUnavailable(f"mobilenet onnx not exported: {_ONNX_PATH}")
    try:
        import onnxruntime as ort

        _SESSION = ort.InferenceSession(str(_ONNX_PATH), providers=["CPUExecutionProvider"])
        _load_labels()
    except ClassifierUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ClassifierUnavailable(f"failed to load mobilenet onnx: {exc}") from exc


def _preprocess(image_bytes: bytes):
    # numpy comes with the optional `ai` extra; a base install must still import this module.
    import numpy as np

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - np.array(_IMAGENET_MEAN, dtype=np.float32)) / np.array(_IMAGENET_STD, dtype=np.float32)
    return arr.transpose(2, 0, 1)[np.newaxis, ...]  # NCHW


def classify(image_bytes: bytes) -> list[dict[str, Any]]:
    """Return [{category, confidence}] sorted desc, softmax over 6 classes."""
    _load()
    import numpy as np  # present whenever _load() succeeded: onnxruntime depends on it

    try:
        tensor = _preprocess(image_bytes)
        logits = _SESSION.run(None, {"input": tensor})[0][0]
        exps = np.exp(logits - logits.max())
        probs = (exps / exps.sum()).tolist()
    except ClassifierUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ClassifierUnavailable(f"mobilenet inference failed: {exc}") from exc

    out = [{"category": c, "confidence": float(p)} for c, p in zip(_LABELS, probs, strict=True)]
    out.sort(key=lambda d: d["confidence"], reverse=True)
    return out


def model_version() -> str:
    if _MANIFEST_PATH.exists():
        try:
            return str(json.loads(_MANIFEST_PATH.read_text()).get("version", _MODEL_VERSION))
        except Exception:  # noqa: BLE001
            pass
    return _MODEL_VERSION


def reset() -> None:
    """Test hook: drop the cached session."""
    global _SESSION
    _SESSION = None
