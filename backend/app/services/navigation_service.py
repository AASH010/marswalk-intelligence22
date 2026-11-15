"""Shared route pipeline for POST /navigate and POST /mission/eva-estimate.

    coordinates -> grid cells -> W_t selection -> cost surface + A*
    -> Route Profile (from the exact A* path)

Both endpoints run exactly this, so the EVA estimate always describes the
route the planner would return for the same inputs.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import rasterio
import rasterio.errors

from app.core.eva_config import EvaWeatherSettings, get_settings
from app.core.routing.route_modes import get_route_mode
from app.core.terrain.geotiff import MAX_WALKABLE_SLOPE, grid_to_map, load_terrain
from app.services.route_profile import build_route_profile
from app.services.route_service import calculate_route
from app.services.weather_intensity_service import WeatherSelection, select_weather


class RouteInputError(ValueError):
    """Invalid request values (HTTP 400)."""


class RouteNotFound(LookupError):
    """No route between valid start and goal (HTTP 404)."""


class WeatherRequired(RuntimeError):
    """Configuration requires W_t and none could be selected (HTTP 422)."""


class TerrainUnavailable(RuntimeError):
    """The processed DEM cannot be read (HTTP 503)."""


@dataclass
class PlannedRoute:
    result: dict
    selection: WeatherSelection
    profile: dict
    coordinates: list[tuple[float, float]]
    confidence: str
    cost_model: dict
    timings_ms: dict = field(default_factory=dict)


def _to_cell(name: str, point, transform, shape) -> tuple[int, int]:
    x, y = point
    if not (math.isfinite(x) and math.isfinite(y)):
        raise RouteInputError(f"{name} coordinates must be finite numbers.")
    row, col = rasterio.transform.rowcol(transform, x, y)
    row, col = int(row), int(col)
    rows, cols = shape
    if not (0 <= row < rows and 0 <= col < cols):
        raise RouteInputError(f"{name} coordinates outside terrain raster.")
    return row, col


def confidence_for(selection: WeatherSelection, route_valid: bool) -> str:
    """high: weather applied and DEM valid; reduced: weather off; invalid: not evaluable."""
    if not route_valid:
        return "invalid"
    return "high" if selection.status == "applied" else "reduced"


def plan_route(
    start_xy,
    goal_xy,
    mode: str,
    sol: int | None,
    start_time: str | None,
    settings: EvaWeatherSettings | None = None,
) -> PlannedRoute:
    settings = settings or get_settings()
    timings: dict[str, float] = {}

    t0 = time.perf_counter()
    try:
        terrain = load_terrain()
    except (FileNotFoundError, rasterio.errors.RasterioIOError) as error:
        raise TerrainUnavailable("Processed Jezero DEM is unavailable.") from error
    timings["terrain"] = (time.perf_counter() - t0) * 1000

    transform = terrain["transform"]
    shape = terrain["terrain_cost"].shape
    start = _to_cell("Start", start_xy, transform, shape)
    goal = _to_cell("Goal", goal_xy, transform, shape)
    if start == goal:
        raise RouteInputError("Start and goal fall in the same terrain cell.")

    t0 = time.perf_counter()
    try:
        selection = select_weather(sol, start_time, settings.time, settings.cost)
    except ValueError as error:
        raise RouteInputError(str(error)) from error
    timings["weather"] = (time.perf_counter() - t0) * 1000

    if settings.cost.weather_required and selection.status != "applied":
        raise WeatherRequired(
            "Weather intensity is required by the configuration but is not available: "
            + (selection.reason or selection.status)
        )

    t0 = time.perf_counter()
    try:
        result = calculate_route(
            terrain_cost=terrain["terrain_cost"],
            blocked_mask=terrain["blocked_mask"],
            start=start,
            goal=goal,
            resolution=terrain["resolution"],
            mode_name=mode,
            slope=terrain["slope"],
            reference_slope=terrain["reference_slope"],
            w_t=selection.w_t,
            weather_beta=settings.cost.beta,
            weather_penalty_coefficient=settings.cost.penalty_coefficient,
        )
    except ValueError as error:
        raise RouteInputError(str(error)) from error
    timings["route"] = (time.perf_counter() - t0) * 1000

    if result is None:
        raise RouteNotFound("No valid route found.")

    t0 = time.perf_counter()
    profile = build_route_profile(
        path=result["path"],
        terrain=terrain,
        surface=result["surface"],
        resolution=terrain["resolution"],
        selection=selection,
        mode_name=result["mode"],
        mode_id=result["mode_id"],
        optimization_objective=result["optimization_cost"],
    )
    timings["profile"] = (time.perf_counter() - t0) * 1000

    coordinates = [grid_to_map(row, col, transform) for row, col in result["path"]]

    cost_model = {
        "formula": "C = T * F + P; T = 1 + w (C_t - 1); F = 1 + beta * W_t * s; s = clip(slope / reference_slope, 0, 1)",
        "terrain_weight": get_route_mode(mode).terrain_weight,
        "beta": settings.cost.beta,
        "beta_tag": "modeled",
        "penalty_coefficient": settings.cost.penalty_coefficient,
        "penalty_tag": "modeled",
        "reference_slope_deg": terrain["reference_slope"],
        "reference_slope_tag": "calculated",
        "weather_hard_constraints": "none (only the slope mask blocks cells)",
        "max_walkable_slope_deg": MAX_WALKABLE_SLOPE,
        "w_t_scope": "regional (one value for the whole AOI)",
        "validated": False,
    }

    return PlannedRoute(
        result=result,
        selection=selection,
        profile=profile,
        coordinates=coordinates,
        confidence=confidence_for(selection, route_valid=True),
        cost_model=cost_model,
        timings_ms=timings,
    )
