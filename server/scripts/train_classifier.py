"""Fine-tune MobileNetV3-Small on the 6 civic categories.

Dataset = synthetic bootstrap (``synthetic_data.generate_dataset``) plus any
real images under ``data/seed_images/<category>/*.{jpg,jpeg,png}``. Trains
briefly on CPU and writes ``app/models_store/mobilenet_civic.pt``.

Usage:
    python -m scripts.train_classifier [--epochs N] [--per-class N] [--out PATH]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.services.labels import CATEGORIES  # noqa: E402
from scripts.synthetic_data import _LABEL_INDEX, generate_dataset  # noqa: E402

DEFAULT_OUT = _ROOT / "app" / "models_store" / "mobilenet_civic.pt"
SEED_DIR = _ROOT / "data" / "seed_images"

MODEL_VERSION = "mobilenetv3-small-civic-v1"


def _build_model():
    import torch
    from torchvision.models import mobilenet_v3_small

    model = mobilenet_v3_small(weights=None)
    in_features = model.classifier[3].in_features
    model.classifier[3] = torch.nn.Linear(in_features, len(CATEGORIES))
    return model


def _load_seed_images(size: int = 224) -> list:
    """(image, label) pairs from data/seed_images/<category>/ if present."""
    from PIL import Image

    pairs: list = []
    if not SEED_DIR.is_dir():
        return pairs
    for cat in CATEGORIES:
        cat_dir = SEED_DIR / cat
        if not cat_dir.is_dir():
            continue
        for p in sorted(cat_dir.glob("*")):
            if p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            try:
                img = Image.open(p).convert("RGB").resize((size, size))
            except Exception:  # noqa: BLE001,S112
                continue
            pairs.append((img, _LABEL_INDEX[cat]))
    return pairs


def train(epochs: int = 3, per_class: int = 40, out: Path = DEFAULT_OUT) -> Path:
    import torch
    from torch.utils.data import DataLoader, Dataset

    data = generate_dataset(per_class=per_class)
    data += _load_seed_images()
    if not data:
        raise RuntimeError("empty training set")

    from torchvision import transforms

    tfm = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.1),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    class _DS(Dataset):
        def __init__(self, pairs):
            self.pairs = pairs

        def __len__(self) -> int:
            return len(self.pairs)

        def __getitem__(self, i: int):
            img, label = self.pairs[i]
            return tfm(img), label

    loader = DataLoader(_DS(data), batch_size=16, shuffle=True)
    model = _build_model()
    model.train()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = torch.nn.CrossEntropyLoss()

    for epoch in range(epochs):
        total_loss = 0.0
        correct = 0
        seen = 0
        for xb, yb in loader:
            opt.zero_grad()
            logits = model(xb)
            loss = loss_fn(logits, yb)
            loss.backward()
            opt.step()
            total_loss += float(loss) * len(yb)
            correct += int((logits.argmax(1) == yb).sum())
            seen += len(yb)
        print(f"epoch {epoch + 1}/{epochs} loss={total_loss / seen:.4f} acc={correct / seen:.3f}")

    # MobileNetV3's BatchNorm running stats lag with few steps/epoch (default momentum
    # 0.1 over ~100 batches leaves them near init). Re-estimate running mean/var over
    # the full training set so eval()/ONNX inference matches train-mode accuracy.
    def _reset_bn(module):
        if isinstance(module, torch.nn.modules.batchnorm._BatchNorm):
            module.reset_running_stats()
            module.momentum = None  # cumulative moving average → exact dataset stats

    model.apply(_reset_bn)
    model.train()
    with torch.no_grad():
        for xb, _ in loader:
            model(xb)
    model.eval()

    # quick held-in sanity check (same seeds as training)
    correct = seen = 0
    with torch.no_grad():
        for xb, yb in loader:
            correct += int((model(xb).argmax(1) == yb).sum())
            seen += len(yb)
    print(f"post-BN-recalibration train acc={correct / seen:.3f}")

    model.eval()
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "labels": list(CATEGORIES),
            "version": MODEL_VERSION,
        },
        out,
    )
    print(f"saved {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--per-class", type=int, default=40)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    train(epochs=args.epochs, per_class=args.per_class, out=args.out)


if __name__ == "__main__":
    main()
