"""Procedurally generated labeled images per civic category.

Each category gets a distinct, seed-invariant visual signature (dominant hue +
coarse shape layout) so a briefly fine-tuned MobileNetV3 can genuinely learn
the classes rather than memorize noise. The synthetic set is a bootstrap, not
a substitute for real photos. If ``data/seed_images/<category>/*.jpg`` exists
those files are mixed in by the training script.
"""

from __future__ import annotations

import colorsys
import io
import random

from PIL import Image, ImageDraw

from app.services.labels import CATEGORIES

# Per-category hue (0..1) — deliberately separated around the color wheel.
_HUE: dict[str, float] = {
    "pothole": 0.0,          # red-ish (asphalt hazard)
    "streetlight": 0.13,     # amber/yellow
    "trash": 0.33,           # green
    "graffiti": 0.83,        # magenta/purple
    "sidewalk damage": 0.09,  # tan/orange concrete
    "other": 0.58,           # sky blue
}

_LABEL_INDEX: dict[str, int] = {c: i for i, c in enumerate(CATEGORIES)}


def _hue_rgb(hue: float, sat: float, val: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb(hue, sat, val)
    return (int(r * 255), int(g * 255), int(b * 255))


def _fill_with_grain(img: Image.Image, rng: random.Random, rgb: tuple[int, int, int], grain: int = 14) -> None:
    """Fill whole image with base color plus low-amplitude pixel grain."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            d = rng.randint(-grain, grain)
            px[x, y] = (
                max(0, min(255, rgb[0] + d)),
                max(0, min(255, rgb[1] + d)),
                max(0, min(255, rgb[2] + d)),
            )


def generate_image(category: str, size: int = 224, seed: int | None = None) -> Image.Image:
    """Draw one synthetic exemplar for ``category`` with a seed-invariant signature."""
    if category not in _HUE:
        raise ValueError(f"unknown category: {category}")
    rng = random.Random(seed if seed is not None else hash(category) & 0xFFFF)
    base = _hue_rgb(_HUE[category], sat=0.55, val=0.75)
    img = Image.new("RGB", (size, size), base)
    _fill_with_grain(img, rng, base)
    d = ImageDraw.Draw(img)
    cx = cy = size // 2

    if category == "pothole":
        # big dark ellipse (the hole) centered-ish, covering ~1/3 of frame
        rx, ry = size // 3, size // 4
        ox, oy = rng.randint(-size // 12, size // 12), rng.randint(-size // 12, size // 12)
        d.ellipse([cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry], fill=(20, 20, 24))
    elif category == "streetlight":
        # tall dark pole + glowing head on the amber background
        d.rectangle([cx - size // 20, 0, cx + size // 20, size], fill=(40, 36, 30))
        d.ellipse([cx - size // 5, size // 12, cx + size // 5, size // 12 + size // 3], fill=(255, 252, 215))
    elif category == "trash":
        # scattered dark debris blobs over green
        for _ in range(30):
            w, h = rng.randint(10, 34), rng.randint(10, 34)
            x, y = rng.randrange(size - w), rng.randrange(size - h)
            shade = rng.randint(10, 80)
            d.rectangle([x, y, x + w, y + h], fill=(shade, shade, shade // 2))
    elif category == "graffiti":
        # bold contrasting strokes (bright cyan/yellow on magenta)
        for _ in range(16):
            x0, y0 = rng.randrange(size), rng.randrange(size)
            x1 = max(0, min(size - 1, x0 + rng.randint(-90, 90)))
            y1 = max(0, min(size - 1, y0 + rng.randint(-90, 90)))
            color = rng.choice([(0, 240, 255), (255, 240, 0), (20, 20, 20)])
            d.line([x0, y0, x1, y1], fill=color, width=rng.randint(6, 12))
    elif category == "sidewalk damage":
        # long dark cracks across tan concrete + joint lines
        for _ in range(5):
            x0, y0 = rng.randrange(size // 3), rng.randrange(size // 2)
            pts = [(x0, y0)]
            for step in range(1, 8):
                pts.append(
                    (
                        min(size - 1, x0 + step * size // 7 + rng.randint(-8, 8)),
                        min(size - 1, y0 + step * rng.randint(10, 26)),
                    )
                )
            d.line(pts, fill=(35, 32, 28), width=6)
        d.line([cx, 0, cx, size], fill=(95, 88, 78), width=3)
        d.line([0, cy, size, cy], fill=(95, 88, 78), width=3)
    else:  # other — flat hue, no strong shape
        pass

    return img


def generate_dataset(per_class: int = 40, size: int = 224) -> list[tuple[Image.Image, int]]:
    """Return [(image, label_index)] shuffled."""
    out: list[tuple[Image.Image, int]] = []
    for cat in CATEGORIES:
        for i in range(per_class):
            out.append((generate_image(cat, size=size, seed=i * 131 + _LABEL_INDEX[cat]), _LABEL_INDEX[cat]))
    rng = random.Random(0)
    rng.shuffle(out)
    return out


def image_to_jpeg_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def category_sample_bytes(category: str, seed: int = 0) -> bytes:
    """Convenience for tests: jpeg bytes of a synthetic exemplar."""
    return image_to_jpeg_bytes(generate_image(category, seed=seed))
