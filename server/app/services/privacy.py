"""Privacy pipeline: EXIF strip + face/plate blur (EgoBlur → OpenCV Haar → no-op)."""

from __future__ import annotations

import io
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

# Pillow's own decompression-bomb guard. 89_478_485 px is the library default;
# we keep it and rely on ``Image.open`` + ``img.load()`` raising
# ``DecompressionBombError`` for anything larger. Anything over that is
# rejected by the caller as 413/422.
# (We surface the constant here so callers can mention it in error messages.)
MAX_IMAGE_PIXELS = Image.MAX_IMAGE_PIXELS

# Largest image file /media and /classify accept.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class InvalidImageError(ValueError):
    """Raised when input bytes cannot be decoded as an image."""


class DecompressionBombError(InvalidImageError):
    """Raised when an image exceeds the pixel budget (decompression bomb)."""


# Magic-byte signatures for the two formats we accept. We sniff these BEFORE
# handing bytes to Pillow so a ``.php`` file renamed to ``.jpg`` never reaches
# the decoder at all — defense in depth alongside Pillow's own header checks.
_JPEG_MAGIC = (b"\xff\xd8\xff",)
_PNG_MAGIC = (b"\x89PNG\r\n\x1a\n",)


def sniff_image_format(image_bytes: bytes) -> str | None:
    """Return 'jpeg' / 'png' if magic bytes match, else None.

    Pure byte-prefix check; does NOT decode the image.
    """
    for magic in _JPEG_MAGIC:
        if image_bytes.startswith(magic):
            return "jpeg"
    for magic in _PNG_MAGIC:
        if image_bytes.startswith(magic):
            return "png"
    return None


def strip_exif(image_bytes: bytes, *, output_format: str = "JPEG") -> bytes:
    """Re-save the image without EXIF metadata.

    Raises:
        InvalidImageError: bytes do not decode as an image.
        DecompressionBombError: image exceeds Pillow's pixel budget.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Image.DecompressionBombError as exc:
        raise DecompressionBombError(f"image exceeds pixel budget: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise InvalidImageError(f"could not decode image: {exc}") from exc

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    out = io.BytesIO()
    fmt = output_format if output_format in ("JPEG", "PNG") else "JPEG"
    # Re-save without passing `exif`, `icc_profile`, or `info` — strips metadata.
    save_kwargs: dict = {"format": fmt}
    if fmt == "JPEG":
        save_kwargs.update({"quality": 90, "optimize": True})
    img.save(out, **save_kwargs)
    return out.getvalue()


def _noop(reason: str) -> dict:
    return {"blurred": False, "faces_blurred": 0, "plates_blurred": 0, "engine": f"none:{reason}"}


def _try_egoblur(image_path: Path) -> dict | None:
    """Run EgoBlur via subprocess if a binary is on PATH. Returns None if unavailable."""
    binary = shutil.which("egoblur")
    if binary is None:
        return None
    try:
        result = subprocess.run(
            [binary, "--input", str(image_path), "--output", str(image_path)],
            capture_output=True,
            timeout=120,
            check=False,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    # Parse detection counts from stdout when present; fall back to unknown (0).
    faces = plates = 0
    m = re.search(r"faces[=:]\s*(\d+)", result.stdout or "")
    if m:
        faces = int(m.group(1))
    m = re.search(r"plates[=:]\s*(\d+)", result.stdout or "")
    if m:
        plates = int(m.group(1))
    return {"blurred": True, "faces_blurred": faces, "plates_blurred": plates, "engine": "egoblur"}


def _blur_regions_cv2(image_path: Path, boxes: list[tuple[int, int, int, int]]) -> None:
    """Overwrite ``image_path`` with the same image, each (x,y,w,h) box blurred."""
    import cv2
    import numpy as np

    img = cv2.imread(str(image_path))
    if img is None:
        raise InvalidImageError(f"cv2 could not read {image_path}")
    for x, y, w, h in boxes:
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(img.shape[1], x + w), min(img.shape[0], y + h)
        if x1 <= x0 or y1 <= y0:
            continue
        roi = img[y0:y1, x0:x1]
        k = max(9, ((min(roi.shape[:2]) // 6) | 1))  # odd kernel scaled to roi
        img[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (k, k), 0)
    cv2.imwrite(str(image_path), img)


def _try_opencv_haar(image_path: Path) -> dict | None:
    """OpenCV Haar-cascade face detection + Gaussian blur. None if cv2/cascade missing."""
    try:
        import cv2
    except ImportError:
        return None
    try:
        cascade_path = str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        if not Path(cascade_path).exists():
            return None
        detector = cv2.CascadeClassifier(cascade_path)
        img = cv2.imread(str(image_path))
        if img is None:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
        boxes = [(int(x), int(y), int(w), int(h)) for x, y, w, h in faces]
        if not boxes:
            return {"blurred": False, "faces_blurred": 0, "plates_blurred": 0, "engine": "opencv-haar"}
        _blur_regions_cv2(image_path, boxes)
        return {"blurred": True, "faces_blurred": len(boxes), "plates_blurred": 0, "engine": "opencv-haar"}
    except Exception:  # noqa: BLE001
        return None


def blur_sensitive(image_path: Path) -> dict:
    """Blur faces/plates in-place at ``image_path`` if any blurrer is available.

    Ladder: EgoBlur (binary on PATH) → OpenCV Haar cascade → explicit no-op.
    NEVER raises for a missing/failing blurrer — an upload must not fail
    because privacy tooling is absent.

    Returns {blurred, faces_blurred, plates_blurred, engine}.
    """
    image_path = Path(image_path)
    for attempt in (_try_egoblur, _try_opencv_haar):
        result = attempt(image_path)
        if result is not None:
            return result
    return _noop("no blurrer available")
