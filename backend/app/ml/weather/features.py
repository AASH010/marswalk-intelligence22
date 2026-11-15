"""Shared data preparation and feature engineering for the MEDA weather model.

The same functions are used by the training script (scripts/train_weather_model.py)
and by the live API (app/services/weather_service.py), so a forecast served by the
backend is computed exactly the way the model was trained and evaluated.

Forecast set-up
---------------
A forecast is *issued* at the end of sol ``t`` and covers every hour (0-23 LTST)
of sols ``t+1 ... t+7``. Every feature therefore uses observations from sols
``<= t`` only. Rows of the feature grid are indexed by the sol *after* the issue
sol: row ``i`` holds the features available at the end of sol ``sols[i] - 1``.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from functools import wraps
from pathlib import Path

import numpy as np
import pandas as pd

# Perseverance landing site (Jezero crater), planetocentric latitude.
JEZERO_LATITUDE_DEG = 18.4447
MARS_OBLIQUITY_DEG = 25.19

TARGETS = {"air_temp_k": "air", "ground_temp_k": "gnd"}
SENSOR_VARS = ["air_temp_k", "ground_temp_k", "up_sw_wm2", "up_lw_wm2", "down_lw_wm2", "pressure_pa"]
CONTEXT_VARS = [("pressure_pa", "p"), ("down_lw_wm2", "dlw"), ("up_lw_wm2", "ulw"), ("up_sw_wm2", "usw")]

FIRST_SOL = 14  # commissioning sols before this have only 1-2 hours each
MIN_ROWS = 100  # hourly means built from <= 100 samples are ~3x noisier
QC_WINDOW = 21  # sols in the same-hour median used by the temporal check
QC_TEMPORAL_THRESHOLD = {"air_temp_k": 10.0, "ground_temp_k": 15.0}
QC_BUMP_THRESHOLD = 12.0  # K above the normal same-sol diurnal curvature (air only)
MAX_LEAD_SOLS = 7


def _quiet(func):
    """Silence numpy's all-NaN warnings: missing hours are expected and handled explicitly."""

    @wraps(func)
    def wrapper(*args, **kwargs):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            return func(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------- astronomy

def mars_ls(sol) -> np.ndarray:
    """Areocentric solar longitude Ls (deg) for a Perseverance mission sol.

    Allison & McEwen (2000) / Mars24 algorithm. Sol 0 = landing, 2021-02-18 20:55 UTC.
    The SOLAR_LONGITUDE_ANGLE column in MEDA ancillary files is a rover-frame angle,
    not Ls, so the season is always computed from the sol number.
    """
    sol = np.asarray(sol, dtype=float)
    jd_tt = 2459264.3715 + 69.184 / 86400.0 + sol * 1.0274912517
    dt = jd_tt - 2451545.0
    m = np.radians(19.3871 + 0.52402050 * dt)
    afms = 270.3863 + 0.52403840 * dt
    amp = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018, 0.0016]
    tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493, 6.4301]
    phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095, 20.989]
    pbs = sum(a * np.cos(np.radians(0.985626 * dt / t + p)) for a, t, p in zip(amp, tau, phi))
    eoc = (
        (10.691 + 3.0e-7 * dt) * np.sin(m)
        + 0.623 * np.sin(2 * m)
        + 0.050 * np.sin(3 * m)
        + 0.005 * np.sin(4 * m)
        + 0.0005 * np.sin(5 * m)
        + pbs
    )
    return (afms + eoc) % 360.0


def solar_elevation_deg(ls_deg, ltst_hours, latitude_deg: float = JEZERO_LATITUDE_DEG) -> np.ndarray:
    """Sun elevation above the horizon (deg) at a local true solar time.

    Uses the solar declination from Ls and the hour angle from LTST, which is
    exact for true solar time (no equation of time needed).
    """
    ls = np.radians(np.asarray(ls_deg, dtype=float))
    dec = np.arcsin(np.sin(np.radians(MARS_OBLIQUITY_DEG)) * np.sin(ls))
    hour_angle = np.radians((np.asarray(ltst_hours, dtype=float) - 12.0) * 15.0)
    lat = np.radians(latitude_deg)
    sin_el = np.sin(lat) * np.sin(dec) + np.cos(lat) * np.cos(dec) * np.cos(hour_angle)
    return np.degrees(np.arcsin(np.clip(sin_el, -1.0, 1.0)))


def season_name(ls_deg: float) -> str:
    """Season at Jezero (northern hemisphere) for an Ls in degrees."""
    ls = float(ls_deg) % 360
    if ls < 90:
        return "Northern spring"
    if ls < 180:
        return "Northern summer"
    if ls < 270:
        return "Northern autumn"
    return "Northern winter"


def daylight_span(ls_deg: float, latitude_deg: float = JEZERO_LATITUDE_DEG) -> tuple[float, float]:
    """Sunrise and sunset in LTST hours for a given Ls."""
    dec = np.arcsin(np.sin(np.radians(MARS_OBLIQUITY_DEG)) * np.sin(np.radians(ls_deg)))
    lat = np.radians(latitude_deg)
    cos_h0 = -np.tan(lat) * np.tan(dec)
    h0 = np.degrees(np.arccos(np.clip(cos_h0, -1.0, 1.0))) / 15.0
    return 12.0 - h0, 12.0 + h0


# ---------------------------------------------------------------- loading and QC

def load_hourly(paths) -> pd.DataFrame:
    """Read the hourly MEDA tables (one or more CSV files) into one frame."""
    required = {"sol", "hour", "air_temp_k", "ground_temp_k", "n_rows"}
    frames = []
    for path in paths:
        frame = pd.read_csv(path)
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"{Path(path).name}: missing column(s) {sorted(missing)}. Expected {sorted(required)} plus the optional radiation and pressure columns.")
        frames.append(frame.drop(columns=[c for c in ("ls",) if c in frame.columns]))
    data = pd.concat(frames, ignore_index=True)
    # Files are read in name order; when two files hold the same (sol, hour), the later file wins.
    data = data.drop_duplicates(["sol", "hour"], keep="last").sort_values(["sol", "hour"]).reset_index(drop=True)
    return data


@dataclass
class WeatherGrids:
    """Sol x hour arrays. The last row is the sol after the last observation."""

    sols: np.ndarray  # (n,)
    ls: np.ndarray  # (n,)
    raw: dict  # observed values (after sample-count filter)
    targets: dict  # QC for scoring: centered temporal median (best estimate of truth)
    inputs: dict  # QC for model inputs: trailing temporal median only (no look-ahead)
    partial: np.ndarray  # 1 = partially sampled hour (MEDA checkerboard cadence)
    qc_counts: dict
    last_observed_sol: int


def diurnal_bump(values: np.ndarray) -> np.ndarray:
    """Value minus the straight line through hours h-2 and h+2 of the same sol."""
    bump = values - (np.roll(values, 2, 1) + np.roll(values, -2, 1)) / 2
    bump[:, [0, 1, 22, 23]] = np.nan
    return bump


@_quiet
def prepare_grids(hourly: pd.DataFrame, normal_bump: np.ndarray | None = None, train_end: int = 400) -> tuple[WeatherGrids, np.ndarray]:
    """Clean the hourly table and pivot it to sol x hour grids.

    Quality control (justified in the EDA notebook):
      A. Same-sol diurnal shape (air temperature): sun contamination of the sensor
         makes some hours stick out of the smooth daily curve by +20..+50 K, often
         on many consecutive sols. Values more than 12 K above the normal bump for
         that hour are removed. Uses one sol only, so it is safe for inputs.
      B. Temporal check on what is left (10 K air, 15 K ground) against the 21-sol
         same-hour median: centered for targets, trailing for inputs.

    ``normal_bump`` (typical curvature per hour) is estimated on the training sols
    when not given, and saved with the model so serving uses the same value.
    """
    data = hourly[(hourly.sol >= FIRST_SOL) & (hourly.n_rows > MIN_ROWS)].copy()
    data["partial"] = (data.n_rows / data.groupby("sol").n_rows.transform("max") < 0.75).astype(float)
    last_sol = int(data.sol.max())
    sols = np.arange(int(data.sol.min()), last_sol + 2)

    def grid(column):
        return (
            data.pivot(index="sol", columns="hour", values=column)
            .reindex(index=sols, columns=range(24))
            .to_numpy(dtype=float)
        )

    raw = {v: grid(v) for v in SENSOR_VARS if v in data.columns}
    for v in SENSOR_VARS:
        raw.setdefault(v, np.full((len(sols), 24), np.nan))
    partial = grid("partial")

    bump = diurnal_bump(raw["air_temp_k"])
    if normal_bump is None:
        with np.errstate(all="ignore"):
            normal_bump = np.nanmedian(bump[sols < train_end], 0)
    stage_a = (bump - normal_bump) > QC_BUMP_THRESHOLD
    stage_in = {"air_temp_k": np.where(stage_a, np.nan, raw["air_temp_k"]), "ground_temp_k": raw["ground_temp_k"]}

    targets, inputs = dict(raw), dict(raw)
    counts = {"stage_a_air": int(stage_a.sum())}
    for v, threshold in QC_TEMPORAL_THRESHOLD.items():
        values = stage_in[v]
        frame = pd.DataFrame(values)
        centered = frame.rolling(QC_WINDOW, center=True, min_periods=5).median().to_numpy()
        trailing = frame.rolling(QC_WINDOW, min_periods=5).median().shift(1).to_numpy()
        targets[v] = np.where(np.abs(values - centered) > threshold, np.nan, values)
        inputs[v] = np.where(np.abs(values - trailing) > threshold, np.nan, values)
        counts[f"stage_b_{v}_targets"] = int(np.isfinite(values).sum() - np.isfinite(targets[v]).sum())
        counts[f"stage_b_{v}_inputs"] = int(np.isfinite(values).sum() - np.isfinite(inputs[v]).sum())
    counts["observed_hours"] = int(np.isfinite(raw["air_temp_k"]).sum())

    grids = WeatherGrids(
        sols=sols,
        ls=mars_ls(sols),
        raw=raw,
        targets=targets,
        inputs=inputs,
        partial=partial,
        qc_counts=counts,
        last_observed_sol=last_sol,
    )
    return grids, normal_bump


# ---------------------------------------------------------------- features

def _lagstack(values: np.ndarray, k: int) -> np.ndarray:
    out = np.full((values.shape[0], 24, k), np.nan)
    for lag in range(1, k + 1):
        out[lag:, :, lag - 1] = values[:-lag]
    return out


def _nmean(x, axis=-1):
    with np.errstate(all="ignore"):
        return np.nanmean(x, axis=axis)


def _ewm(lags: np.ndarray, half_life: float) -> np.ndarray:
    weights = 0.5 ** (np.arange(lags.shape[-1]) / half_life)
    mask = ~np.isnan(lags)
    total = (mask * weights).sum(-1)
    return np.where(mask.any(-1), (np.nan_to_num(lags) * weights).sum(-1) / np.maximum(total, 1e-9), np.nan)


def _slope(lags: np.ndarray) -> np.ndarray:
    x = -np.arange(1, lags.shape[-1] + 1, dtype=float)
    mask = ~np.isnan(lags)
    count = mask.sum(-1)
    xm = (mask * x).sum(-1) / np.maximum(count, 1)
    ym = np.nan_to_num(lags).sum(-1) / np.maximum(count, 1)
    num = (mask * (x - xm[..., None]) * (np.nan_to_num(lags) - ym[..., None])).sum(-1)
    den = (mask * (x - xm[..., None]) ** 2).sum(-1)
    return np.where(count >= 4, num / np.maximum(den, 1e-9), np.nan)


def _hsmooth(values: np.ndarray, k: int) -> np.ndarray:
    """Mean over hours h-k..h+k; wrapping uses the neighbouring hours of the same past sol."""
    return _nmean(np.stack([np.roll(values, s, 1) for s in range(-k, k + 1)], -1))


def _prev_sol(values: np.ndarray) -> np.ndarray:
    return np.r_[np.nan, values[:-1]]


def _roll_prev(values: np.ndarray, window: int) -> np.ndarray:
    return pd.Series(values).rolling(window, min_periods=3).mean().shift(1).to_numpy()


@_quiet
def build_issue_features(inputs: dict, partial: np.ndarray, ls_deg: np.ndarray) -> dict:
    """Features available at the end of sol ``sols[i] - 1`` for every row ``i``.

    Returns a dict of (n, 24) arrays. ``{tag}_mean7`` is the baseline the models
    correct: the mean of the same hour over the previous 7 sols.
    """
    n = inputs["air_temp_k"].shape[0]
    rep = lambda v: np.repeat(np.asarray(v)[:, None], 24, 1)  # noqa: E731
    hours = np.tile(np.arange(24), (n, 1))
    feats = {"hour": hours, "hour_sin": np.sin(2 * np.pi * hours / 24), "hour_cos": np.cos(2 * np.pi * hours / 24)}
    feats["issue_ls_sin"] = rep(np.sin(np.radians(ls_deg)))
    feats["issue_ls_cos"] = rep(np.cos(np.radians(ls_deg)))
    # sampling flags of the two most recent sols (the cadence alternates every sol)
    feats["partial_last"] = np.r_[np.full((1, 24), np.nan), partial[:-1]]
    feats["partial_prev"] = np.r_[np.full((2, 24), np.nan), partial[:-2]]

    for v, tag in TARGETS.items():
        lags = _lagstack(inputs[v], 14)
        feats[f"{tag}_lag1"], feats[f"{tag}_lag2"] = lags[..., 0], lags[..., 1]
        feats[f"{tag}_mean3"] = _nmean(lags[..., :3])
        mean7 = _nmean(lags[..., :7])
        mean14 = _nmean(lags)
        mean7 = np.where(np.isnan(mean7), mean14, mean7)
        feats[f"{tag}_mean7"] = pd.DataFrame(mean7).interpolate(axis=1, limit=2, limit_direction="both").to_numpy()
        feats[f"{tag}_mean14"] = mean14
        with np.errstate(all="ignore"):
            feats[f"{tag}_median7"] = np.nanmedian(lags[..., :7], -1)
            feats[f"{tag}_std7"] = np.nanstd(lags[..., :7], -1)
        for half_life in (1, 2, 4, 8):
            feats[f"{tag}_ewm{half_life}"] = _ewm(lags, half_life)
        feats[f"{tag}_slope14"] = _slope(lags)
        feats[f"{tag}_par246"] = _nmean(lags[..., [1, 3, 5]])
        feats[f"{tag}_par135"] = _nmean(lags[..., [0, 2, 4]])
        anomaly = feats[f"{tag}_lag1"] - feats[f"{tag}_mean7"]
        for k in (1, 2, 3):
            feats[f"{tag}_anom1_h{k}"] = _hsmooth(anomaly, k)
        feats[f"{tag}_anom2_h2"] = _hsmooth(feats[f"{tag}_lag2"] - feats[f"{tag}_mean7"], 2)
        day_mean = _nmean(inputs[v], 1)
        feats[f"{tag}_day_anom"] = rep(_prev_sol(day_mean) - _roll_prev(day_mean, 7))
        daytime = _nmean(inputs[v][:, 9:17], 1)
        feats[f"{tag}_daytime_anom"] = rep(_prev_sol(daytime) - _roll_prev(daytime, 7))

    for v, tag in CONTEXT_VARS:
        with np.errstate(all="ignore"):
            day_mean = _nmean(inputs[v], 1)
            amplitude = np.nanmax(inputs[v], 1) - np.nanmin(inputs[v], 1)
        feats[f"{tag}_day_mean"] = rep(_prev_sol(day_mean))
        feats[f"{tag}_day_anom"] = rep(_prev_sol(day_mean) - _roll_prev(day_mean, 7))
        feats[f"{tag}_amp_anom"] = rep(_prev_sol(amplitude) - _roll_prev(amplitude, 7))
        feats[f"{tag}_lag1"] = np.r_[np.full((1, 24), np.nan), inputs[v][:-1]]
    return feats


def lead_feature_names(issue_feature_names: list[str]) -> list[str]:
    """Columns of the model matrix: issue features + lead and target-sol calendar."""
    return list(issue_feature_names) + ["lead", "target_ls_sin", "target_ls_cos", "target_partial"]


def lead_rows(feats: dict, names: list[str], partial: np.ndarray, sols: np.ndarray, row: int, lead: int) -> np.ndarray:
    """Model matrix (24 x n_features) for the forecast issued at row ``row`` (issue sol sols[row]-1).

    ``target_partial`` follows the checkerboard cadence: it is taken from the most
    recent observed sol with the same parity as the target sol, exactly as it
    would be known at issue time.
    """
    base = np.stack([feats[name][row] for name in names], axis=1)
    target_sol = sols[row] - 1 + lead
    ls_target = np.radians(mars_ls(target_sol))
    # row - 1 is the issue sol t; t + lead has the parity of t when lead is even,
    # and of t - 1 (row - 2) when lead is odd.
    same_parity_row = row - 1 if lead % 2 == 0 else row - 2
    target_partial = partial[same_parity_row] if same_parity_row >= 0 else np.full(24, np.nan)
    extra = np.column_stack([
        np.full(24, lead, dtype=float),
        np.full(24, np.sin(ls_target)),
        np.full(24, np.cos(ls_target)),
        target_partial,
    ])
    return np.hstack([base, extra])


def ridge_design(matrix: np.ndarray, columns: list[str], tag: str) -> tuple[np.ndarray, list[str]]:
    """Linear-model design: own level features relative to the baseline, plus anomalies and calendar."""
    index = {c: i for i, c in enumerate(columns)}
    base = matrix[:, index[f"{tag}_mean7"]]
    own = [c for c in columns if c.startswith(tag + "_") and any(k in c for k in ("lag", "mean", "ewm", "median", "par")) and c != f"{tag}_mean7"]
    other = [c for c in columns if ("anom" in c or "slope" in c)] + [
        "hour_sin", "hour_cos", "target_ls_sin", "target_ls_cos", "target_partial", "partial_last",
    ]
    design = np.column_stack(
        [matrix[:, index[c]] - base for c in own] + [matrix[:, index[c]] for c in other]
    )
    return design, own + other


def file_list(directory: Path) -> list[Path]:
    return sorted(Path(directory).glob("meda_hourly_*.csv"))
