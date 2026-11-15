"""Time handling. SCLK is kept numerically exact; LMST/LTST are kept verbatim as strings.

UTC is NOT derived: the labels give only product start/stop UTC, and converting per-record SCLK to UTC
needs the SCLK/leap-second kernels (SPICE), which are unavailable. The `utc` column is therefore null.
No rounding, no resampling, no interpolation, no alignment of different channels.
"""

import re
from typing import Optional

import numpy as np
import pandas as pd

UTC_STATUS = {
    "status": "unavailable",
    "reason": "no_verified_sclk_to_utc_conversion",
    "detail": "Labels give only product-level start/stop UTC; per-record conversion needs SPICE SCLK/LSK kernels.",
}

_LMST_RE = re.compile(r"^(\d{5})M\d{2}:\d{2}:\d{2}(\.\d+)?$")


def parse_sclk(tokens: pd.Series) -> np.ndarray:
    """Raw SCLK tokens -> float64 (NaN where unparseable). float64 holds seconds with ms resolution exactly."""
    return pd.to_numeric(tokens.str.strip(), errors="coerce").to_numpy(dtype="float64")


def verbatim_or_null(tokens: pd.Series) -> pd.Series:
    """Keep non-empty tokens exactly as written; empty -> None (explicit null)."""
    out = tokens.astype(object).copy()
    out[tokens.str.strip() == ""] = None
    return out


def lmst_sol(token: Optional[str]) -> Optional[int]:
    if not token:
        return None
    m = _LMST_RE.match(token.strip())
    return int(m.group(1)) if m else None


def count_lmst_sol_mismatch(lmst: pd.Series, sol: int) -> int:
    """Rows whose LMST sol prefix is present but differs from the product's Sol (informational QA)."""
    pref = lmst.dropna().astype(str).str.extract(r"^(\d{5})M", expand=False)
    ok = pref.notna()
    return int((pref[ok].astype(int) != sol).sum())


def utc_column(n: int) -> pd.Series:
    return pd.Series([None] * n, dtype=object)
