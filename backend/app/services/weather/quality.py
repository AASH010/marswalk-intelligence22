"""Record-level quality classification using only label-defined information.

Statuses: valid, invalid, missing, suspect, unverified.
  missing    value cell is empty / a configured sentinel token / a numeric sentinel
  invalid    value cannot be read as a finite number, or the record has no usable SCLK
  unverified a quality flag the rule depends on comes from a channel that failed verification
  suspect    a label-defined flag (config rule) says the measurement conditions were degraded
  valid      none of the above
Precedence when several apply: missing > invalid > unverified > suspect > valid.
Nothing is deleted: every status is kept in the output with a quality_code naming the rule(s).
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

SEVERITY = {"valid": 0, "suspect": 1, "unverified": 2, "invalid": 3, "missing": 4}
STATUS_BY_SEVERITY = {v: k for k, v in SEVERITY.items()}

BUILTIN_CODES = {
    "MISSING_EMPTY_FIELD": "value cell empty",
    "MISSING_SENTINEL_TOKEN": "value is a configured missing-data token",
    "MISSING_SENTINEL_NUMERIC": "value equals a configured numeric sentinel",
    "INVALID_NON_NUMERIC": "value is not a number",
    "INVALID_NON_FINITE": "value is NaN/inf",
    "INVALID_BAD_SCLK": "record has no parseable SCLK",
}


@dataclass
class FlagSpec:
    rule_id: str
    code: str
    equals: float
    status: str  # "suspect" | "invalid"
    tokens: Optional[pd.Series]  # raw flag tokens; None if the flag channel is unverified/absent


def classify(tokens: pd.Series, sentinels, flags: list, time_ok: np.ndarray):
    """Return (numeric_values float64 with NaN where not a usable number, status ndarray[str], codes ndarray[object])."""
    n = len(tokens)
    stripped = tokens.str.strip()
    sev = np.zeros(n, dtype=np.int8)
    masks = {}  # code -> bool mask

    def hit(code, mask, severity):
        if mask.any():
            masks[code] = masks.get(code, np.zeros(n, dtype=bool)) | mask
            np.maximum(sev, np.where(mask, severity, 0).astype(np.int8), out=sev)

    miss_empty = (stripped == "").to_numpy()
    miss_tok = stripped.isin([t for t in sentinels.missing_tokens if t != ""]).to_numpy()
    num = pd.to_numeric(stripped.where(~(miss_empty | miss_tok)), errors="coerce").to_numpy(dtype="float64")
    nonnumeric = np.isnan(num) & ~(miss_empty | miss_tok)
    # 'nan'/'inf' parse as numbers in pandas; treat them as non-finite, not as numbers
    nonfinite = ~np.isfinite(num) & ~np.isnan(num)
    nan_token = stripped.str.lower().isin(["nan", "+nan", "-nan"]).to_numpy() & ~(miss_empty | miss_tok)
    numeric_sentinel = np.zeros(n, dtype=bool)
    for s in sentinels.numeric_sentinels:
        numeric_sentinel |= np.isclose(num, s, rtol=0, atol=0, equal_nan=False)

    hit("MISSING_EMPTY_FIELD", miss_empty, SEVERITY["missing"])
    hit("MISSING_SENTINEL_TOKEN", miss_tok, SEVERITY["missing"])
    hit("MISSING_SENTINEL_NUMERIC", numeric_sentinel, SEVERITY["missing"])
    hit("INVALID_NON_NUMERIC", nonnumeric & ~nan_token, SEVERITY["invalid"])
    hit("INVALID_NON_FINITE", nonfinite | nan_token, SEVERITY["invalid"])
    bad_time = ~np.asarray(time_ok, dtype=bool)
    hit("INVALID_BAD_SCLK", bad_time & ~miss_empty & ~miss_tok, SEVERITY["invalid"])

    usable = ~(miss_empty | miss_tok | numeric_sentinel | nonnumeric | nonfinite | nan_token)
    values = np.where(usable, num, np.nan)

    for fl in flags:
        if fl.tokens is None:
            hit(f"FLAG_UNVERIFIED:{fl.rule_id}", usable, SEVERITY["unverified"])
            continue
        ft = fl.tokens.str.strip()
        fnum = pd.to_numeric(ft.where(ft != ""), errors="coerce").to_numpy(dtype="float64")
        flag_missing = np.isnan(fnum)
        hit(f"FLAG_MISSING:{fl.rule_id}", flag_missing & usable, SEVERITY["suspect"])
        hit(fl.code, (fnum == fl.equals) & usable, SEVERITY[fl.status])

    status = np.array([STATUS_BY_SEVERITY[s] for s in range(5)], dtype=object)[sev]
    codes = np.full(n, None, dtype=object)
    for code in sorted(masks):
        for i in np.flatnonzero(masks[code]):
            codes[i] = code if codes[i] is None else codes[i] + "|" + code
    return values, status, codes, masks


class QAAccumulator:
    """Counts needed by the QA report: status by Sol x variable, rule effects, unverified channels, W_t, warnings."""

    def __init__(self):
        self.status_counts = Counter()  # (sol, variable, status) -> n
        self.rule_flagged = defaultdict(Counter)  # code -> {variable: n}
        self.rule_removed_from_w_t = defaultdict(Counter)  # code -> {variable: n}
        self.warnings = []
        self.failures = []
        self.misc = Counter()

    def add_status(self, sol, variable, status_array):
        vals, counts = np.unique(np.asarray(status_array, dtype=str), return_counts=True)
        for v, c in zip(vals, counts):
            self.status_counts[(int(sol), variable, str(v))] += int(c)

    def add_rule_effects(self, variable, masks, is_w_t_component):
        for code, m in masks.items():
            n = int(m.sum())
            self.rule_flagged[code][variable] += n
            if is_w_t_component:
                self.rule_removed_from_w_t[code][variable] += n

    def warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)
