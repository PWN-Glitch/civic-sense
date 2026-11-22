"""The server must start without the optional `ai` extra installed."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_AI_ONLY = ["numpy", "cv2", "torch", "onnxruntime", "open_clip"]


def test_app_imports_without_ai_extra() -> None:
    # A None entry in sys.modules makes `import x` raise ImportError, as if x were not installed.
    code = (
        "import sys\n"
        f"for m in {_AI_ONLY!r}: sys.modules[m] = None\n"
        "import app.main\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "APP_ENV": "test"},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
