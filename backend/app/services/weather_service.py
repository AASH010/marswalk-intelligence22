"""Surface-weather forecasts and EVA windows for the Jezero operating site.

Loads the hourly MEDA record (data/weather/meda) and the trained model
(app/ml/weather/artifacts), and answers three questions:

  * current conditions: what the last observed sol looked like;
  * forecast: hourly air and ground temperature for up to 7 sols after an
    issue sol, with uncertainty bands and the probability that each hour
    meets the planning limits;
  * EVA windows: stretches of GO hours, and the best departure for a route
    of a given duration.

Any past sol can be used as the issue sol ("replay"): the forecast is then
computed from the data available at that time and compared with what was
actually observed.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.ml.weather.features import (
    MAX_LEAD_SOLS,
    TARGETS,
    build_issue_features,
    daylight_span,
    file_list,
    lead_feature_names,
    lead_rows,
    load_hourly,
    mars_ls,
    prepare_grids,
    season_name,
    solar_elevation_deg,
)
from app.ml.weather.model import QUANTILE_LEVELS, ResidualPool, WeatherModel

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = PROJECT_ROOT / "data" / "weather" / "meda"
ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "ml" / "weather" / "artifacts"

SITE = "Jezero crater (Perseverance, MEDA)"
MAX_HORIZON_HOURS = MAX_LEAD_SOLS * 24
HISTORY_SOLS_NEEDED = 14  # the earliest issue sol needs the 14 sols of lags the model was trained on
DEFAULT_LIMITS = {
    "air_min_k": 205.0,
    "ground_min_k": 210.0,
    "go_confidence": 0.8,
    "caution_confidence": 0.5,
    "min_sun_elevation_deg": 0.0,
}


class WeatherUnavailable(RuntimeError):
    """Raised when the data or the trained model cannot be loaded."""


def _num(value, digits: int = 2):
    """JSON-safe float: None for NaN / inf."""
    if value is None:
        return None
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


class WeatherService:
    def __init__(self, data_dir: Path = DATA_DIR, artifact_dir: Path = ARTIFACT_DIR):
        files = file_list(data_dir)
        if not files:
            raise WeatherUnavailable(f"No MEDA hourly files found in {data_dir}.")
        if not (Path(artifact_dir) / "model.json").exists():
            raise WeatherUnavailable("The weather model has not been trained (run scripts/train_weather_model.py).")

        self.model = WeatherModel.load(artifact_dir)
        bump = np.array([np.nan if v is None else v for v in self.model.meta["normal_bump"]], dtype=float)
        try:
            self.grids, _ = prepare_grids(load_hourly(files), normal_bump=bump)
        except ValueError as error:
            raise WeatherUnavailable(str(error)) from error
        if len(self.grids.sols) <= HISTORY_SOLS_NEEDED + 1:
            raise WeatherUnavailable(f"Need at least {HISTORY_SOLS_NEEDED + 2} sols of MEDA data (35 or more recommended).")
        self.issue_names = self.model.meta["issue_feature_names"]
        self.feats = build_issue_features(self.grids.inputs, self.grids.partial, self.grids.ls)
        if lead_feature_names(self.issue_names) != self.model.feature_names or list(self.feats) != self.issue_names:
            raise WeatherUnavailable("The trained model does not match the current feature definition. Retrain the model.")

        self.pool = ResidualPool.load(Path(artifact_dir) / "residuals.npz")
        report_path = Path(artifact_dir) / "report.json"
        self.report = json.loads(report_path.read_text()) if report_path.exists() else None

        # quantile offsets of past errors, by target, lead and hour
        self.offsets = {
            target: np.array([[self.pool.quantiles(target, k, h) for h in range(24)] for k in range(1, MAX_LEAD_SOLS + 1)])
            for target in TARGETS
        }
        self.sols = self.grids.sols
        self.first_issue_sol = int(self.sols[HISTORY_SOLS_NEEDED] - 1)
        self.latest_issue_sol = int(self.grids.last_observed_sol)
        self._predict_cached = lru_cache(maxsize=256)(self._predict)

    # ------------------------------------------------------------ basics
    @property
    def engine(self) -> str:
        return "ridge + LightGBM blend" if self.model.uses_gbm else "ridge only (LightGBM not installed)"

    def status(self) -> dict:
        return {
            "available": True,
            "site": SITE,
            "latest_observed_sol": self.latest_issue_sol,
            "first_issue_sol": self.first_issue_sol,
            "latest_issue_sol": self.latest_issue_sol,
            "max_horizon_hours": MAX_HORIZON_HOURS,
            "model_trained_at": self.model.meta.get("trained_at"),
            "model_engine": self.engine,
            "default_limits": {**DEFAULT_LIMITS, "placeholder": True},
        }

    def _row(self, sol: int) -> int:
        return int(sol - self.sols[0])

    def _observed(self, target: str, sol: int) -> np.ndarray:
        row = self._row(sol)
        if 0 <= row < len(self.sols) - 1:
            return self.grids.targets[target][row]
        return np.full(24, np.nan)

    # ------------------------------------------------------------ model
    def _predict(self, issue_sol: int) -> dict:
        """Forecasts for leads 1..7 issued at the end of ``issue_sol``: arrays of shape (7, 24)."""
        row = self._row(issue_sol + 1)
        out = {t: {"forecast": np.full((MAX_LEAD_SOLS, 24), np.nan), "baseline": np.full((MAX_LEAD_SOLS, 24), np.nan)} for t in TARGETS}
        for lead in range(1, MAX_LEAD_SOLS + 1):
            matrix = lead_rows(self.feats, self.issue_names, self.grids.partial, self.sols, row, lead)
            for target in TARGETS:
                result = self.model.predict(matrix, target, lead)
                out[target]["forecast"][lead - 1] = result["forecast"]
                out[target]["baseline"][lead - 1] = result["baseline"]
        return out

    def validate_issue_sol(self, issue_sol: int | None) -> int:
        if issue_sol is None:
            return self.latest_issue_sol
        if not (self.first_issue_sol <= issue_sol <= self.latest_issue_sol):
            raise ValueError(
                f"issue_sol must be between {self.first_issue_sol} and {self.latest_issue_sol} (the sols with enough observed history)."
            )
        return int(issue_sol)

    # ------------------------------------------------------------ forecast
    def forecast(self, issue_sol: int | None = None, start_hour: int = 0, end_hour: int = 48, limits: dict | None = None,
                 route_hours: float | None = None) -> dict:
        issue_sol = self.validate_issue_sol(issue_sol)
        if not (0 <= start_hour < end_hour <= MAX_HORIZON_HOURS):
            raise ValueError(f"The horizon must satisfy 0 <= start_hour < end_hour <= {MAX_HORIZON_HOURS}.")
        lim = {**DEFAULT_LIMITS, **(limits or {})}
        if not (0 < lim["caution_confidence"] <= lim["go_confidence"] <= 1):
            raise ValueError("Confidence levels must satisfy 0 < caution_confidence <= go_confidence <= 1.")
        if route_hours is not None and not (0 < route_hours <= MAX_HORIZON_HOURS):
            raise ValueError("route_hours must be positive and within the forecast range.")

        pred = self._predict_cached(issue_sol)
        hours = []
        for offset in range(start_hour, end_hour):
            lead, hour = offset // 24 + 1, offset % 24
            sol = issue_sol + lead
            ls = float(mars_ls(sol))
            elevation = float(solar_elevation_deg(ls, hour + 0.5))
            daylight = elevation > lim["min_sun_elevation_deg"]
            entry = {"offset_hours": offset, "sol": sol, "hour": hour, "lead_sols": lead, "ls_deg": round(ls, 2),
                     "solar_elevation_deg": round(elevation, 1), "daylight": daylight}
            point = {}
            for target in TARGETS:
                f = pred[target]["forecast"][lead - 1, hour]
                q = self.offsets[target][lead - 1, hour]
                actual = self._observed(target, sol)[hour]
                key = "air" if target == "air_temp_k" else "ground"
                entry[key] = {
                    "forecast": _num(f), "baseline": _num(pred[target]["baseline"][lead - 1, hour]),
                    **{f"q{int(round(level * 100)):02d}": _num(f + off) for level, off in zip(QUANTILE_LEVELS, q) if level != 0.5},
                    "actual": _num(actual),
                }
                point[target] = f
            ra, rg = self.pool.joint(lead, hour)
            fa, fg = point["air_temp_k"], point["ground_temp_k"]
            p_air = float(np.mean(fa + self.pool.marginal("air_temp_k", lead, hour) >= lim["air_min_k"])) if np.isfinite(fa) else float("nan")
            p_gnd = float(np.mean(fg + self.pool.marginal("ground_temp_k", lead, hour) >= lim["ground_min_k"])) if np.isfinite(fg) else float("nan")
            p_joint = float(np.mean((fa + ra >= lim["air_min_k"]) & (fg + rg >= lim["ground_min_k"]))) if ra.size and np.isfinite(fa) and np.isfinite(fg) else float("nan")
            p_go = p_joint if daylight else 0.0
            entry.update({"p_air_ok": _num(p_air, 3), "p_ground_ok": _num(p_gnd, 3), "p_go": _num(p_go, 3)})
            entry["status"], entry["reason"] = self._status(daylight, elevation, p_go, p_air, p_gnd, lim)

            a_air, a_gnd = entry["air"]["actual"], entry["ground"]["actual"]
            if a_air is not None and a_gnd is not None:
                ok = daylight and a_air >= lim["air_min_k"] and a_gnd >= lim["ground_min_k"]
                entry["actual_status"] = "GO" if ok else "NOT_GO"
            hours.append(entry)

        windows, departure = self._windows(hours, route_hours)
        return {
            "issue_sol": issue_sol,
            "issued_after": {"offset_hours": -1, "sol": issue_sol, "hour": 23},
            "is_replay": issue_sol + 1 <= self.latest_issue_sol,
            "start_offset_hours": start_hour,
            "end_offset_hours": end_hour,
            "limits": {**lim, "placeholder": True},
            "route_hours": route_hours,
            "hours": hours,
            "windows": windows,
            "recommended_departure": departure,
            "summary": self._summary(hours, windows, departure, route_hours, lim),
            "verification": self._verification(hours),
            "model_engine": self.engine,
        }

    @staticmethod
    def _status(daylight, elevation, p_go, p_air, p_gnd, lim) -> tuple[str, str]:
        if not daylight:
            return "NO_GO", f"Sun below the daylight limit (elevation {elevation:.0f}°)."
        if not np.isfinite(p_go):
            return "NO_GO", "No forecast is available for this hour."
        limiting = "air" if p_air <= p_gnd else "ground"
        limit_value = lim["air_min_k"] if limiting == "air" else lim["ground_min_k"]
        if p_go >= lim["go_confidence"]:
            return "GO", f"{p_go:.0%} chance that air and ground stay inside the limits."
        if p_go >= lim["caution_confidence"]:
            return "CAUTION", f"Only {p_go:.0%} confidence: {limiting} temperature may fall below {limit_value:.0f} K."
        return "NO_GO", f"{limiting.capitalize()} temperature likely below {limit_value:.0f} K ({p_go:.0%} confidence of meeting limits)."

    @staticmethod
    def _point(entry) -> dict:
        return {"offset_hours": entry["offset_hours"], "sol": entry["sol"], "hour": entry["hour"]}

    def _after(self, entry) -> dict:
        offset = entry["offset_hours"] + 1
        sol = entry["sol"] + (1 if entry["hour"] == 23 else 0)
        return {"offset_hours": offset, "sol": sol, "hour": (entry["hour"] + 1) % 24}

    def _windows(self, hours: list, route_hours: float | None):
        need = max(1, math.ceil(route_hours - 1e-9)) if route_hours else None
        windows, departure = [], None
        i = 0
        while i < len(hours):
            if hours[i]["status"] != "GO":
                i += 1
                continue
            j = i
            while j < len(hours) and hours[j]["status"] == "GO":
                j += 1
            probs = [h["p_go"] for h in hours[i:j]]
            windows.append({
                "start": self._point(hours[i]), "end": self._after(hours[j - 1]), "length_hours": j - i,
                "min_p_go": round(min(probs), 3), "mean_p_go": round(float(np.mean(probs)), 3),
                "fits_route": (j - i >= need) if need else None,
            })
            if need and j - i >= need:
                for start in range(i, j - need + 1):
                    block = [h["p_go"] for h in hours[start:start + need]]
                    candidate = (min(block), float(np.mean(block)))
                    if departure is None or candidate > (departure["min_p_go"], departure["mean_p_go"]):
                        departure = {"start": self._point(hours[start]), "end": self._after(hours[start + need - 1]),
                                     "hours_needed": need, "min_p_go": round(candidate[0], 3), "mean_p_go": round(candidate[1], 3)}
            i = j
        return windows, departure

    @staticmethod
    def _fmt(point) -> str:
        return f"Sol {point['sol']} {point['hour']:02d}:00"

    def _summary(self, hours, windows, departure, route_hours, lim) -> list[str]:
        first, last = hours[0], hours[-1]
        go_hours = sum(h["status"] == "GO" for h in hours)
        caution = sum(h["status"] == "CAUTION" for h in hours)
        lines = [f"{self._fmt(first)} to {self._fmt(self._after(last))} LTST: {go_hours} GO hours, {caution} CAUTION hours, "
                 f"{len(windows)} GO window{'s' if len(windows) != 1 else ''}."]
        air = [h["air"]["forecast"] for h in hours if h["air"]["forecast"] is not None]
        gnd = [h["ground"]["forecast"] for h in hours if h["ground"]["forecast"] is not None]
        if air and gnd:
            lines.append(f"Air temperature {min(air):.0f} to {max(air):.0f} K ({min(air) - 273.15:.0f} to {max(air) - 273.15:.0f} °C); "
                         f"ground {min(gnd):.0f} to {max(gnd):.0f} K.")
        if windows:
            best = max(windows, key=lambda w: (w["length_hours"], w["min_p_go"]))
            lines.append(f"Longest window: {self._fmt(best['start'])} to {self._fmt(best['end'])} ({best['length_hours']} h, "
                         f"lowest hourly confidence {best['min_p_go']:.0%}).")
        if route_hours:
            if departure:
                lines.append(f"For a {route_hours:.1f} h route: depart {self._fmt(departure['start'])}, back by {self._fmt(departure['end'])} "
                             f"(confidence never below {departure['min_p_go']:.0%}).")
            else:
                lines.append(f"No window in this range is long enough for a {route_hours:.1f} h route. Extend the range or shorten the route.")
        return lines

    @staticmethod
    def _verification(hours) -> dict | None:
        scored = [h for h in hours if h["air"]["actual"] is not None or h["ground"]["actual"] is not None]
        if not scored:
            return None

        def mae(key, field):
            pairs = [(h[key][field], h[key]["actual"]) for h in scored if h[key]["actual"] is not None and h[key][field] is not None]
            return round(float(np.mean([abs(a - b) for a, b in pairs])), 3) if pairs else None

        both = [h for h in scored if "actual_status" in h]
        agree = [(h["status"] == "GO") == (h["actual_status"] == "GO") for h in both]
        return {
            "hours_scored": len(scored),
            "mae_air_model": mae("air", "forecast"), "mae_air_baseline": mae("air", "baseline"),
            "mae_ground_model": mae("ground", "forecast"), "mae_ground_baseline": mae("ground", "baseline"),
            "status_agreement": round(float(np.mean(agree)), 3) if agree else None,
        }

    # ------------------------------------------------------------ current conditions
    def _daily(self, sol: int, upto_hour: int = 23) -> dict | None:
        """Daily statistics of one sol, using only the hours up to ``upto_hour`` (inclusive)."""
        row = self._row(sol)
        if not (0 <= row < len(self.sols) - 1):
            return None
        keep = slice(0, upto_hour + 1)
        air, gnd = self.grids.targets["air_temp_k"][row][keep], self.grids.targets["ground_temp_k"][row][keep]
        pressure = self.grids.raw["pressure_pa"][row][keep]
        with np.errstate(all="ignore"):
            def stat(fn, values):
                return _num(fn(values)) if np.isfinite(values).any() else None
            return {
                "sol": int(sol), "air_min_k": stat(np.nanmin, air), "air_max_k": stat(np.nanmax, air), "air_mean_k": stat(np.nanmean, air),
                "ground_min_k": stat(np.nanmin, gnd), "ground_max_k": stat(np.nanmax, gnd),
                "pressure_mean_pa": stat(np.nanmean, pressure), "hours_observed": int(np.isfinite(air).sum()),
            }

    def current(self, sol: int | None = None, hour: int | None = None) -> dict:
        """Observed conditions at one sol. With ``hour`` only what was measured up to that LTST hour counts (nothing from later hours leaks in)."""
        sol = self.latest_issue_sol if sol is None else int(sol)
        if not (self.sols[0] <= sol <= self.latest_issue_sol):
            raise ValueError(f"sol must be between {int(self.sols[0])} and {self.latest_issue_sol}.")
        if hour is not None and not (0 <= int(hour) <= 23):
            raise ValueError("hour must be between 0 and 23.")
        upto = 23 if hour is None else int(hour)
        row = self._row(sol)
        air, gnd = self.grids.targets["air_temp_k"][row].copy(), self.grids.targets["ground_temp_k"][row].copy()
        air[upto + 1:], gnd[upto + 1:] = np.nan, np.nan
        observed = np.flatnonzero(np.isfinite(air) | np.isfinite(gnd))
        hour = int(observed[-1]) if observed.size else None
        ls = float(mars_ls(sol))
        sunrise, sunset = daylight_span(ls)
        series = []
        for s in range(max(int(self.sols[0]), sol - 2), sol + 1):
            r = self._row(s)
            for h in range(24 if s < sol else upto + 1):
                series.append({"sol": s, "hour": h, "air_temp_k": _num(self.grids.targets["air_temp_k"][r, h]),
                               "ground_temp_k": _num(self.grids.targets["ground_temp_k"][r, h]),
                               "pressure_pa": _num(self.grids.raw["pressure_pa"][r, h])})
        flagged = int(np.sum(np.isfinite(self.grids.raw["air_temp_k"][row][:upto + 1]) & ~np.isfinite(air[:upto + 1]))
                      + np.sum(np.isfinite(self.grids.raw["ground_temp_k"][row][:upto + 1]) & ~np.isfinite(gnd[:upto + 1])))

        def at(values):
            return _num(values[hour]) if hour is not None else None

        return {
            "sol": sol, "hour": hour, "ls_deg": round(ls, 2), "season": season_name(ls),
            "sunrise_ltst": round(float(sunrise), 2), "sunset_ltst": round(float(sunset), 2),
            "solar_elevation_deg": _num(solar_elevation_deg(ls, hour + 0.5), 1) if hour is not None else None,
            "air_temp_k": at(air), "ground_temp_k": at(gnd),
            "pressure_pa": at(self.grids.raw["pressure_pa"][row]), "downward_lw_wm2": at(self.grids.raw["down_lw_wm2"][row]),
            "today": self._daily(sol, upto), "previous": self._daily(sol - 1), "series": series,
            "source": "NASA PDS Mars 2020 MEDA (TIRS air and ground temperature, PS pressure), hourly means after quality control",
            "flagged_hours": flagged,
        }


@lru_cache(maxsize=1)
def get_weather_service() -> WeatherService:
    return WeatherService()
