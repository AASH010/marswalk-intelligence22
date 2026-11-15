"""Makes `app` importable when pytest is run from the repository root; harmless under unittest."""
import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parents[2])
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
