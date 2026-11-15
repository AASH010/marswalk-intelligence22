"""Model objects shared by training and serving.

Each target (air and ground temperature) and each lead time (1-7 sols) has
  * a LightGBM model and
  * a ridge model,
both predicting the residual over the baseline (same-hour mean of the last 7
sols). The forecast adds a weighted share of each correction to the baseline:

    forecast = baseline + w_ridge * (ridge - baseline) + w_gbm * (gbm - baseline)

with w_ridge + w_gbm <= 1 chosen on the validation sols, so at long leads the
forecast can fall back towards the baseline when the corrections stop helping.

Uncertainty comes from out-of-sample errors (split-conformal): the errors the
walk-forward evaluation actually made at each lead and hour. Air and ground
errors are kept in pairs, so probabilities of joint conditions (for example
"air above A *and* ground above G") use their real correlation.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .features import TARGETS, ridge_design

try:  # LightGBM is optional at serving time: without it the ridge models are used alone.
    import lightgbm as lgb
except ImportError:  # pragma: no cover - exercised only where lightgbm is missing
    lgb = None

QUANTILE_LEVELS = (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)


@dataclass
class RidgeModel:
    columns: list
    mu: np.ndarray
    sd: np.ndarray
    coef: np.ndarray
    intercept: float
    alpha: float

    def predict_residual(self, design: np.ndarray) -> np.ndarray:
        filled = np.where(np.isnan(design), self.mu, design)
        return ((filled - self.mu) / self.sd) @ self.coef + self.intercept

    def to_json(self) -> dict:
        return {
            "columns": self.columns,
            "mu": self.mu.tolist(),
            "sd": self.sd.tolist(),
            "coef": self.coef.tolist(),
            "intercept": float(self.intercept),
            "alpha": self.alpha,
        }

    @classmethod
    def from_json(cls, data: dict) -> "RidgeModel":
        return cls(
            columns=data["columns"],
            mu=np.asarray(data["mu"], dtype=float),
            sd=np.asarray(data["sd"], dtype=float),
            coef=np.asarray(data["coef"], dtype=float),
            intercept=float(data["intercept"]),
            alpha=float(data["alpha"]),
        )


def fit_ridge(design: np.ndarray, residual: np.ndarray, columns: list, alpha: float) -> RidgeModel:
    """Ridge on standardized features; missing values are set to the training mean.

    A column with no values in the training rows (pressure before sol 301) gets
    mean 0 and scale 1, so it contributes nothing.
    """
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", category=RuntimeWarning)
        mu = np.nanmean(design, 0)
        sd = np.nanstd(design, 0)
    mu = np.where(np.isfinite(mu), mu, 0.0)
    sd = np.where(np.isfinite(sd) & (sd > 1e-9), sd, 1.0)
    z = (np.where(np.isnan(design), mu, design) - mu) / sd
    y_mean = residual.mean()
    yc = residual - y_mean
    gram = z.T @ z + alpha * np.eye(z.shape[1])
    coef = np.linalg.solve(gram, z.T @ yc)
    intercept = y_mean - z.mean(0) @ coef  # z has zero mean by construction, kept for safety
    return RidgeModel(columns=columns, mu=mu, sd=sd, coef=coef, intercept=float(intercept), alpha=float(alpha))


@dataclass
class WeatherModel:
    feature_names: list
    ridge: dict  # target -> {lead: RidgeModel}
    gbm: dict  # target -> {lead: lightgbm.Booster or None}
    weights: dict  # target -> {lead: {"ridge": float, "gbm": float}}
    meta: dict = field(default_factory=dict)

    @property
    def uses_gbm(self) -> bool:
        return lgb is not None and all(b is not None for leads in self.gbm.values() for b in leads.values())

    def predict(self, matrix: np.ndarray, target: str, lead: int) -> dict:
        """Forecast for one target and lead. ``matrix`` rows follow ``feature_names``."""
        tag = TARGETS[target]
        baseline = matrix[:, self.feature_names.index(f"{tag}_mean7")]
        design, _ = ridge_design(matrix, self.feature_names, tag)
        ridge_pred = baseline + self.ridge[target][lead].predict_residual(design)
        w = self.weights[target][lead]
        if self.uses_gbm:
            gbm_pred = baseline + self.gbm[target][lead].predict(matrix)
            blend = baseline + w["ridge"] * (ridge_pred - baseline) + w["gbm"] * (gbm_pred - baseline)
        else:
            # Without LightGBM the ridge correction carries the combined weight.
            gbm_pred = np.full_like(ridge_pred, np.nan)
            blend = baseline + min(1.0, w["ridge"] + w["gbm"]) * (ridge_pred - baseline)
        return {"forecast": blend, "ridge": ridge_pred, "gbm": gbm_pred, "baseline": baseline}

    # ------------------------------------------------------------ persistence
    def save(self, directory: Path) -> None:
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        for target, leads in self.gbm.items():
            for lead, booster in leads.items():
                if booster is not None:
                    booster.save_model(str(directory / f"gbm_{TARGETS[target]}_lead{lead}.txt"))
        payload = {
            "feature_names": self.feature_names,
            "weights": {t: {str(k): v for k, v in w.items()} for t, w in self.weights.items()},
            "ridge": {t: {str(k): m.to_json() for k, m in leads.items()} for t, leads in self.ridge.items()},
            "meta": self.meta,
        }
        (directory / "model.json").write_text(json.dumps(payload))

    @classmethod
    def load(cls, directory: Path) -> "WeatherModel":
        directory = Path(directory)
        payload = json.loads((directory / "model.json").read_text())
        ridge = {t: {int(k): RidgeModel.from_json(m) for k, m in leads.items()} for t, leads in payload["ridge"].items()}
        gbm = {}
        for target, tag in TARGETS.items():
            gbm[target] = {}
            for lead in ridge[target]:
                path = directory / f"gbm_{tag}_lead{lead}.txt"
                gbm[target][lead] = lgb.Booster(model_file=str(path)) if (lgb is not None and path.exists()) else None
        return cls(
            feature_names=payload["feature_names"],
            ridge=ridge,
            gbm=gbm,
            weights={t: {int(k): {"ridge": float(v["ridge"]), "gbm": float(v["gbm"])} for k, v in w.items()} for t, w in payload["weights"].items()},
            meta=payload.get("meta", {}),
        )


class ResidualPool:
    """Out-of-sample forecast errors (actual - forecast) by lead and hour.

    Errors are pooled by exact lead and hour: around sunrise the error spread
    changes from one hour to the next, so neighbouring hours are not mixed.
    Each (lead, hour) cell still rests on a few hundred real errors.
    """

    def __init__(self, lead: np.ndarray, hour: np.ndarray, air: np.ndarray, ground: np.ndarray, hour_window: int = 0):
        self.lead = np.asarray(lead, dtype=int)
        self.hour = np.asarray(hour, dtype=int)
        self.air = np.asarray(air, dtype=float)
        self.ground = np.asarray(ground, dtype=float)
        self.hour_window = hour_window
        self._cache = {}

    def _select(self, lead: int, hour: int) -> np.ndarray:
        key = (int(lead), int(hour))
        if key not in self._cache:
            distance = np.abs(((self.hour - hour) + 12) % 24 - 12)
            self._cache[key] = np.flatnonzero((self.lead == lead) & (distance <= self.hour_window))
        return self._cache[key]

    def marginal(self, target: str, lead: int, hour: int) -> np.ndarray:
        values = (self.air if target == "air_temp_k" else self.ground)[self._select(lead, hour)]
        return values[np.isfinite(values)]

    def joint(self, lead: int, hour: int) -> tuple[np.ndarray, np.ndarray]:
        idx = self._select(lead, hour)
        a, g = self.air[idx], self.ground[idx]
        both = np.isfinite(a) & np.isfinite(g)
        return a[both], g[both]

    def quantiles(self, target: str, lead: int, hour: int, levels=QUANTILE_LEVELS) -> np.ndarray:
        values = self.marginal(target, lead, hour)
        if values.size < 10:
            return np.full(len(levels), np.nan)
        return np.quantile(values, levels)

    def save(self, path: Path) -> None:
        np.savez_compressed(path, lead=self.lead, hour=self.hour, air=self.air, ground=self.ground)

    @classmethod
    def load(cls, path: Path) -> "ResidualPool":
        data = np.load(path)
        return cls(data["lead"], data["hour"], data["air"], data["ground"])


def exceedance_probability(forecast: float, residuals: np.ndarray, threshold: float) -> float:
    """P(actual >= threshold) using the empirical distribution of past errors."""
    if residuals.size == 0 or not np.isfinite(forecast):
        return float("nan")
    return float(np.mean(forecast + residuals >= threshold))


def joint_probability(air_forecast: float, ground_forecast: float, air_res: np.ndarray, ground_res: np.ndarray,
                      air_min: float, ground_min: float) -> float:
    """P(air >= air_min and ground >= ground_min) from paired past errors."""
    if air_res.size == 0 or not (np.isfinite(air_forecast) and np.isfinite(ground_forecast)):
        return float("nan")
    return float(np.mean((air_forecast + air_res >= air_min) & (ground_forecast + ground_res >= ground_min)))
