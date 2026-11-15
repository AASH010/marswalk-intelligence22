"""Regional weather intensity W_t.

For each configured component: take verified, `valid` observations only, normalise with the FIXED min/max
from the config (never recomputed from data), clip to [0, 1] (optionally inverted). W_t at a timestamp is the
weighted mean of the components available at that timestamp.

Time handling: a W_t row exists at an SCLK value for which at least `min_components` components have a valid
record with *exactly that SCLK* (MEDA sensors share the instrument clock; see QA report). There is no
tolerance matching, interpolation, or resampling. Components with no valid record at that SCLK are listed in
`components_missing`. W_t is `observed` (direct measurements only).
"""

import numpy as np
import pandas as pd

from .normalization import record_id

WT_COLUMNS = [
    "sol", "sclk", "lmst", "ltst", "utc", "w_t", "components_used", "components_missing",
    "source_record_ids", "quality_status", "observation_type",
]


def normalise(values, comp) -> np.ndarray:
    """(x - min) / (max - min) with the configured constants, clipped to [0, 1]; then optional inversion."""
    n = (np.asarray(values, dtype="float64") - comp.norm_min) / (comp.norm_max - comp.norm_min)
    n = np.clip(n, 0.0, 1.0)
    return 1.0 - n if comp.invert else n


def empty_frame() -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype=object) for c in WT_COLUMNS})


def compute_w_t(obs: pd.DataFrame, cfg, sol: int):
    """obs: normalised observations of ONE Sol. Returns (w_t DataFrame, stats dict)."""
    comps = sorted(cfg.weather_intensity.components, key=lambda c: c.name)
    min_c = cfg.weather_intensity.min_components
    m = len(comps)
    stats = {"sol": int(sol), "candidate_timestamps": 0, "emitted": 0, "complete": 0, "partial": 0,
             "no_valid_component": 0, "component_used": {c.name: 0 for c in comps},
             "duplicate_sclk_dropped": 0, "lmst_conflicts": 0}
    if obs.empty:
        return empty_frame(), stats

    per = []
    all_ts = []
    for c in comps:
        sub = obs[obs["variable"] == c.variable]
        all_ts.append(sub["sclk"].dropna().to_numpy())
        ok = sub[(sub["quality_status"] == "valid") & sub["value"].notna() & sub["sclk"].notna()]
        ok = ok.sort_values(["sclk", "source_row"], kind="mergesort")
        dup = ok["sclk"].duplicated(keep="first")
        stats["duplicate_sclk_dropped"] += int(dup.sum())
        per.append(ok[~dup])
    cand = np.unique(np.concatenate(all_ts)) if all_ts else np.array([])
    stats["candidate_timestamps"] = int(len(cand))
    valid_ts = [p["sclk"].to_numpy() for p in per]
    idx = np.unique(np.concatenate(valid_ts)) if any(len(v) for v in valid_ts) else np.array([])
    if len(idx) == 0:
        stats["no_valid_component"] = stats["candidate_timestamps"]
        return empty_frame(), stats

    k = len(idx)
    used = np.zeros((m, k), dtype=bool)
    norm = np.zeros((m, k), dtype="float64")
    rid = np.full((m, k), None, dtype=object)
    lmst = np.full(k, None, dtype=object)
    ltst = np.full(k, None, dtype=object)
    for j, (c, p) in enumerate(zip(comps, per)):
        if p.empty:
            continue
        pos = np.searchsorted(idx, p["sclk"].to_numpy())
        used[j, pos] = True
        norm[j, pos] = normalise(p["value"].to_numpy(), c)
        rid[j, pos] = [record_id(a, b, d) for a, b, d in zip(p["source_product"], p["source_row"], p["source_channel"])]
        for arr, col in ((lmst, "lmst"), (ltst, "ltst")):
            incoming = p[col].to_numpy(dtype=object)
            have = np.array([x is not None for x in arr[pos]])
            if col == "lmst":
                new = np.array([x is not None for x in incoming])
                differ = have & new & (arr[pos] != incoming)
                stats["lmst_conflicts"] += int(differ.sum())
            fill = ~have
            arr[pos[fill]] = incoming[fill]

    weights = np.array([c.weight for c in comps], dtype="float64")[:, None]
    wsum = (weights * used).sum(axis=0)
    num = (weights * norm * used).sum(axis=0)
    count = used.sum(axis=0)
    keep = count >= min_c
    with np.errstate(invalid="ignore", divide="ignore"):
        w = np.clip(num / np.where(wsum > 0, wsum, np.nan), 0.0, 1.0)

    names = [c.name for c in comps]
    keep_idx = np.flatnonzero(keep)
    code = (used.astype(np.int64) * (1 << np.arange(m))[:, None]).sum(axis=0)
    used_lists = {}
    miss_lists = {}
    for cd in np.unique(code[keep_idx]):
        used_lists[cd] = [names[j] for j in range(m) if cd >> j & 1]
        miss_lists[cd] = [names[j] for j in range(m) if not cd >> j & 1]
    comp_used = [list(used_lists[cd]) for cd in code[keep_idx]]
    comp_miss = [list(miss_lists[cd]) for cd in code[keep_idx]]
    rids = [[rid[j, i] for j in range(m) if used[j, i]] for i in keep_idx]
    complete = count[keep_idx] == m
    out = pd.DataFrame({
        "sol": np.int32(sol),
        "sclk": idx[keep_idx],
        "lmst": lmst[keep_idx],
        "ltst": ltst[keep_idx],
        "utc": [None] * len(keep_idx),
        "w_t": w[keep_idx],
        "components_used": comp_used,
        "components_missing": comp_miss,
        "source_record_ids": rids,
        "quality_status": np.where(complete, "valid", "suspect").astype(object),
        "observation_type": "observed",
    }, columns=WT_COLUMNS)
    stats["emitted"] = int(len(out))
    stats["complete"] = int(complete.sum())
    stats["partial"] = int((~complete).sum())
    stats["no_valid_component"] = stats["candidate_timestamps"] - stats["emitted"]
    for j, c in enumerate(comps):
        stats["component_used"][c.name] = int(used[j, keep_idx].sum())
    return out, stats
