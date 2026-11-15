"""Route Profile: per-segment facts built on the server from the A* path.

Segmentation: one segment per move between consecutive path cells (no
merging). Each move is what A* charged, so per-segment values add up exactly
to the route totals and to the A* objective.

A segment takes its terrain values from its DESTINATION cell, the same cell
A* charges for the move. Its along-track grade is the signed elevation change
between the two cells divided by the move length.

The client never supplies any of this.
"""

from __future__ import annotations

import math

import numpy as np

from app.core.routing.astar import movement_distance
from app.core.routing.weather_cost import CostSurface
from app.core.terrain.geotiff import grid_to_map
from app.services.weather_intensity_service import WeatherSelection

SEGMENT_METHOD = "one segment per A* move between consecutive grid cells (not merged)"

# Kind of each profile value (measured / calculated / modeled / assumed).
PROFILE_FIELD_TAGS = {
    "distance_m": "calculated",
    "elevation_from_m": "measured",
    "elevation_to_m": "measured",
    "grade_percent": "calculated",
    "slope_deg": "calculated",
    "slope_percent": "calculated",
    "terrain_cost": "modeled",
    "terrain_part": "modeled",
    "slope_weight": "calculated",
    "weather_factor": "modeled",
    "weather_penalty": "modeled",
    "cell_cost": "modeled",
    "objective_contribution": "modeled",
    "w_t": "calculated",
}

PROFILE_FIELD_UNITS = {
    "distance_m": "m",
    "elevation_from_m": "m",
    "elevation_to_m": "m",
    "grade_percent": "%",
    "slope_deg": "deg",
    "slope_percent": "%",
    "terrain_cost": "1",
    "terrain_part": "1",
    "slope_weight": "1",
    "weather_factor": "1",
    "weather_penalty": "1",
    "cell_cost": "1",
    "objective_contribution": "cost-weighted m",
    "w_t": "1",
}


def slope_percent(slope_deg: float) -> float:
    return math.tan(math.radians(slope_deg)) * 100.0


def build_route_profile(
    path: list[tuple[int, int]],
    terrain: dict,
    surface: CostSurface,
    resolution: float,
    selection: WeatherSelection,
    mode_name: str,
    mode_id: str,
    optimization_objective: float,
) -> dict:
    """Full profile: summary plus one entry per segment."""
    dem = terrain["dem"]
    slope = terrain["slope"]
    terrain_cost = terrain["terrain_cost"]
    transform = terrain["transform"]
    w_t = surface.w_t

    segments = []
    for index, (previous, current) in enumerate(zip(path, path[1:])):
        distance = movement_distance(previous, current, resolution)
        z_from = float(dem[previous])
        z_to = float(dem[current])
        slope_deg = float(slope[current])
        cell_cost = float(surface.cost[current])

        segments.append(
            {
                "index": index,
                "from_cell": [int(previous[0]), int(previous[1])],
                "to_cell": [int(current[0]), int(current[1])],
                "from_xy": list(grid_to_map(previous[0], previous[1], transform)),
                "to_xy": list(grid_to_map(current[0], current[1], transform)),
                "distance_m": distance,
                "elevation_from_m": z_from,
                "elevation_to_m": z_to,
                "grade_percent": (z_to - z_from) / distance * 100.0,
                "slope_deg": slope_deg,
                "slope_percent": slope_percent(slope_deg),
                "terrain_cost": float(terrain_cost[current]),
                "terrain_part": float(surface.terrain_part[current]),
                "slope_weight": float(surface.slope_weight[current]),
                "weather_factor": float(surface.weather_factor[current]),
                "weather_penalty": float(surface.weather_penalty[current]),
                "cell_cost": cell_cost,
                "objective_contribution": distance * cell_cost,
                "w_t": w_t,
                "weather_status": selection.status,
            }
        )

    summary = summarize_profile(
        segments,
        selection=selection,
        mode_name=mode_name,
        mode_id=mode_id,
        optimization_objective=optimization_objective,
        start_cell=path[0],
        goal_cell=path[-1],
    )

    return {
        "summary": summary,
        "segments": segments,
        "field_tags": PROFILE_FIELD_TAGS,
        "field_units": PROFILE_FIELD_UNITS,
    }


def summarize_profile(
    segments: list[dict],
    selection: WeatherSelection,
    mode_name: str,
    mode_id: str,
    optimization_objective: float,
    start_cell: tuple[int, int],
    goal_cell: tuple[int, int],
) -> dict:
    distances = np.array([s["distance_m"] for s in segments], dtype=float)
    slopes = np.array([s["slope_deg"] for s in segments], dtype=float)
    grades = np.array([s["grade_percent"] for s in segments], dtype=float)
    rises = np.array([s["elevation_to_m"] - s["elevation_from_m"] for s in segments], dtype=float)

    total = math.fsum(distances)
    if total > 0:
        mean_slope = float(math.fsum(distances * slopes) / total)
    else:
        mean_slope = None

    record = selection.record
    return {
        "segment_method": SEGMENT_METHOD,
        "segment_count": len(segments),
        "start_cell": [int(start_cell[0]), int(start_cell[1])],
        "goal_cell": [int(goal_cell[0]), int(goal_cell[1])],
        "total_distance_m": total,
        "mean_slope_deg": mean_slope,
        "mean_slope_method": "distance-weighted mean of segment slopes",
        "max_slope_deg": float(slopes.max()) if slopes.size else None,
        "mean_slope_percent": slope_percent(mean_slope) if mean_slope is not None else None,
        "max_slope_percent": slope_percent(float(slopes.max())) if slopes.size else None,
        "max_uphill_grade_percent": float(grades.max()) if grades.size else None,
        "max_downhill_grade_percent": float(grades.min()) if grades.size else None,
        "elevation_gain_m": float(rises[rises > 0].sum()) if rises.size else 0.0,
        "elevation_loss_m": float(-rises[rises < 0].sum()) if rises.size else 0.0,
        "mode": mode_name,
        "mode_id": mode_id,
        "optimization_objective": optimization_objective,
        "objective_from_segments": math.fsum(s["objective_contribution"] for s in segments),
        "weather_status": selection.status,
        "w_t": selection.w_t,
        "weather_time": (
            {"sol": record.sol, "lmst": record.lmst, "ltst": record.ltst, "sclk": record.sclk}
            if record is not None
            else None
        ),
        "requested_time": (
            {"sol": selection.requested_sol, "lmst": selection.requested_time}
            if selection.requested_time is not None
            else None
        ),
    }
