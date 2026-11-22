"""CLIP zero-shot image classification (lazy-loaded, CPU).

Model: open_clip ViT-B/32 with laion2b_s34b_b79k weights. Loaded on first use.
Any failure to load or run inference raises ClassifierUnavailable so the router
can answer 503 + {fallback:true} instead of crashing.
"""

from __future__ import annotations

import io
from typing import Any

from PIL import Image

from app.services.labels import CATEGORIES, CLIP_PROMPTS


class ClassifierUnavailable(RuntimeError):
    """Raised when the CLIP model cannot be loaded or inference fails."""


_MODEL: Any = None
_PREPROCESS: Any = None
_TOKENIZER: Any = None
_MODEL_VERSION = "open_clip ViT-B/32 laion2b_s34b_b79k"


def _load() -> None:
    global _MODEL, _PREPROCESS, _TOKENIZER
    if _MODEL is not None:
        return
    try:
        import torch
        import open_clip

        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k", device="cpu"
        )
        model.eval()
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        _MODEL = model
        _PREPROCESS = preprocess
        _TOKENIZER = tokenizer
    except Exception as exc:  # noqa: BLE001
        raise ClassifierUnavailable(f"failed to load CLIP model: {exc}") from exc


def classify(image_bytes: bytes) -> list[dict[str, Any]]:
    """Return [{category, confidence}] sorted desc, softmax over the 6 prompts."""
    _load()
    try:
        import torch

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_tensor = _PREPROCESS(img).unsqueeze(0)
        text_tokens = _TOKENIZER([CLIP_PROMPTS[c] for c in CATEGORIES])
        with torch.no_grad():
            image_features = _MODEL.encode_image(image_tensor)
            text_features = _MODEL.encode_text(text_tokens)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            logits = (100.0 * image_features @ text_features.T).squeeze(0)
            probs = logits.softmax(dim=-1).tolist()
    except ClassifierUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ClassifierUnavailable(f"inference failed: {exc}") from exc

    out = [{"category": c, "confidence": float(p)} for c, p in zip(CATEGORIES, probs, strict=True)]
    out.sort(key=lambda d: d["confidence"], reverse=True)
    return out


def model_version() -> str:
    return _MODEL_VERSION


def confidence_band(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def severity_estimate(category: str, scores: dict[str, float]) -> dict[str, str]:
    """Heuristic severity stub. Week 2+ replaces with a learned model."""
    top = scores.get(category, 0.0)
    if category == "pothole" and top >= 0.6:
        level = "high"
        reason = "potholes at this confidence typically indicate a road-safety hazard"
    elif category in ("streetlight", "sidewalk damage") and top >= 0.5:
        level = "moderate"
        reason = f"{category} affects pedestrian or traffic safety"
    elif top >= 0.75:
        level = "moderate"
        reason = f"high-confidence {category} warrants prompt attention"
    else:
        level = "low"
        reason = f"low-confidence {category}; user verification recommended"
    return {"level": level, "reason": reason}
