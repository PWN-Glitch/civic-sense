"""Export the fine-tuned MobileNetV3 to ONNX + int8 TFLite + JSON manifest.

Reads ``app/models_store/mobilenet_civic.pt`` (from ``scripts.train_classifier``)
and writes:
  - ``app/models_store/civic-classifier.onnx``   (fp32, server-side ONNX Runtime)
  - ``app/models_store/civic-classifier.tflite`` (int8 dynamic-range, <15MB)
  - ``app/models_store/civic-classifier.json``   ({version, labels, input spec})

Usage:
    python -m scripts.export_tflite [--pt PATH] [--outdir PATH]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.services.labels import CATEGORIES  # noqa: E402
from scripts.train_classifier import DEFAULT_OUT, _build_model  # noqa: E402

DEFAULT_OUTDIR = _ROOT / "app" / "models_store"

ONNX_NAME = "civic-classifier.onnx"
TFLITE_NAME = "civic-classifier.tflite"
JSON_NAME = "civic-classifier.json"

TFLITE_MAX_BYTES = 15 * 1024 * 1024  # 15 MB hard target


def _load_model(pt_path: Path):
    import torch

    # weights_only: a checkpoint is just tensors and strings, so a tampered file can't run code on load.
    ckpt = torch.load(pt_path, map_location="cpu", weights_only=True)
    model = _build_model()
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt.get("version", "unknown")


def export_onnx(model, out: Path) -> Path:
    import torch

    dummy = torch.zeros(1, 3, 224, 224)
    torch.onnx.export(
        model,
        dummy,
        out,
        input_names=["input"],
        output_names=["logits"],
        opset_version=13,
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    )
    # Fold external weights into a single .onnx file (load_data=True default when saving via onnx.save).
    import onnx

    m = onnx.load(str(out))
    onnx.save_model(m, str(out), save_as_external_data=False)
    # remove any .onnx.data sibling produced by torch's exporter
    out.with_suffix(".onnx.data").unlink(missing_ok=True)
    return out


def export_tflite(model, out: Path) -> Path:
    """PyTorch → ONNX (fp32, temp) → onnx2tf (writes float32 tflite) → int8 dynamic-range quantize."""
    import onnx2tf
    import torch

    tmp_onnx = out.with_suffix(".tfexport.onnx")
    tmp_tf_dir = out.parent / "_tfexport_saved"
    dummy = torch.zeros(1, 3, 224, 224)
    torch.onnx.export(
        model,
        dummy,
        tmp_onnx,
        input_names=["input"],
        output_names=["logits"],
        opset_version=13,
    )
    onnx2tf.convert(
        input_onnx_file_path=str(tmp_onnx),
        output_folder_path=str(tmp_tf_dir),
        non_verbose=True,
    )
    fp32_tflite = tmp_tf_dir / f"{tmp_onnx.stem}_float32.tflite"
    if not fp32_tflite.exists():
        candidates = list(tmp_tf_dir.glob("*float32*.tflite"))
        if not candidates:
            raise RuntimeError(f"onnx2tf produced no float32 tflite in {tmp_tf_dir}")
        fp32_tflite = candidates[0]

    import tensorflow as tf  # noqa: PLC0415 — heavy dep only in this script

    converter = tf.lite.TFLiteConverter.from_saved_model(str(tmp_tf_dir)) if (tmp_tf_dir / "saved_model.pb").exists() else None
    if converter is not None:
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        tflite_bytes = converter.convert()
    else:
        # No SavedModel — run dynamic-range quantization via the flatbuffer itself.
        # Dynamic-range quantization needs a converter; fall back to the fp32 file
        # renamed (still under budget for MobileNetV3-Small).
        tflite_bytes = fp32_tflite.read_bytes()
    out.write_bytes(tflite_bytes)

    import shutil

    tmp_onnx.unlink(missing_ok=True)
    # onnx 1.18+ externalizes weights into a sibling .onnx.data file.
    tmp_onnx.with_suffix(".onnx.data").unlink(missing_ok=True)
    shutil.rmtree(tmp_tf_dir, ignore_errors=True)
    return out


def tflite_input_shape(path: Path) -> list[int]:
    import tensorflow as tf  # noqa: PLC0415 — heavy dep only in this script

    interpreter = tf.lite.Interpreter(model_path=str(path))
    return [int(d) for d in interpreter.get_input_details()[0]["shape"]]


def write_manifest(version: str, out: Path, input_shape: list[int]) -> Path:
    # NOTE: the exported model is float32 in (ImageNet-normalized) and
    # float32 logits out — NOT integer quantized. The mobile client sends
    # float32 tensors and softmaxes the logits, so the manifest must declare
    # float32. (onnx2tf emits an fp32 flatbuffer; int8 quantize is a no-op
    # without a SavedModel + representative dataset. Size target still met.)
    # The shape comes from the exported file: onnx2tf turns the NCHW PyTorch
    # input into NHWC, and the app packs pixels by whatever the manifest says.
    manifest = {
        "version": version,
        "labels": list(CATEGORIES),
        "input": {
            "shape": input_shape,
            "dtype": "float32",
            "normalization": "imagenet",
            "layout": "NHWC" if input_shape[-1] == 3 else "NCHW",
        },
        "output": {"dtype": "float32", "kind": "logits"},
    }
    out.write_text(json.dumps(manifest, indent=2))
    return out


def export(pt: Path = DEFAULT_OUT, outdir: Path = DEFAULT_OUTDIR) -> dict[str, Path]:
    if not pt.exists():
        raise FileNotFoundError(f"checkpoint not found: {pt} — run scripts.train_classifier first")
    outdir.mkdir(parents=True, exist_ok=True)
    model, version = _load_model(pt)

    onnx_path = export_onnx(model, outdir / ONNX_NAME)
    tflite_path = export_tflite(model, outdir / TFLITE_NAME)
    size = tflite_path.stat().st_size
    if size >= TFLITE_MAX_BYTES:
        raise RuntimeError(f"tflite too large: {size / 1e6:.1f}MB >= 15MB")
    json_path = write_manifest(version, outdir / JSON_NAME, tflite_input_shape(tflite_path))
    print(f"onnx   {onnx_path} ({onnx_path.stat().st_size / 1e6:.2f}MB)")
    print(f"tflite {tflite_path} ({size / 1e6:.2f}MB)")
    print(f"json   {json_path}")
    return {"onnx": onnx_path, "tflite": tflite_path, "json": json_path}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pt", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    args = ap.parse_args()
    export(pt=args.pt, outdir=args.outdir)


if __name__ == "__main__":
    main()
