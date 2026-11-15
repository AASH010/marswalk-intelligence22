import math

import numpy as np

from app.core.routing.astar import astar_search, movement_distance
from app.core.routing.route_modes import get_route_mode
from app.core.routing.weather_cost import build_cost_surface


def calculate_route(
    terrain_cost: np.ndarray,
    blocked_mask: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
    resolution: float,
    mode_name: str,
    slope: np.ndarray | None = None,
    reference_slope: float | None = None,
    w_t: float | None = None,
    weather_beta: float = 0.0,
    weather_penalty_coefficient: float = 0.0,
):
    """
    Calculate a route using A* and a selected route mode.

    The A* cost surface is built here:

        C(i) = T(i) * F(i) + P(i),  blocked cells -> inf
        T(i) = 1 + w * (C_t(i) - 1)
        F(i) = 1 + beta * W_t * s(i),  s(i) = clip(slope / reference_slope, 0, 1)

    w_t = None (or no slope data) means weather is off: F = 1, P = 0, and
    the surface equals the terrain-only cost.

    Reported costs
    --------------
    optimization_cost
        The objective A* minimised: sum over moves of
        movement distance (m, diagonal = sqrt(2) x cell) x C(destination).
        The start cell is not charged. Unit: cost-weighted metres.
    average_optimization_cost
        optimization_cost / route distance (m): the distance-weighted mean
        cell cost along the route (dimensionless, >= 1).
    raw_terrain_cost / average_raw_terrain_cost
        Unchanged descriptive statistics: sum and mean of C_t over the path
        cells (start cell included). They are not the objective.
    """

    # Get route mode configuration
    mode = get_route_mode(mode_name)

    surface = build_cost_surface(
        terrain_cost=terrain_cost,
        blocked_mask=blocked_mask,
        terrain_weight=mode.terrain_weight,
        slope_deg=slope,
        reference_slope=reference_slope,
        w_t=w_t,
        beta=weather_beta,
        penalty_coefficient=weather_penalty_coefficient,
    )

    # Run A*
    result = astar_search(
        cost_grid=surface.cost,
        start=start,
        goal=goal,
        cell_size=resolution,
    )

    if result is None:
        return None

    path, objective = result

    # Calculate route distance
    route_distance = 0.0

    for previous, current in zip(path, path[1:]):
        route_distance += movement_distance(
            previous,
            current,
            resolution,
        )

    # Raw terrain cost along route (descriptive)
    route_costs = np.array(
        [
            terrain_cost[row, col]
            for row, col in path
        ]
    )

    raw_accumulated_cost = float(
        np.sum(route_costs)
    )

    raw_average_cost = float(
        np.mean(route_costs)
    )

    if route_distance > 0:
        average_objective = objective / route_distance
    else:
        average_objective = 0.0

    if not math.isfinite(objective):
        raise ValueError("Route objective is not finite.")

    return {
        "mode": mode.name,
        "mode_id": mode_name,
        "path": path,
        "distance_km": route_distance / 1000,
        "distance_m": route_distance,
        "raw_terrain_cost": raw_accumulated_cost,
        "average_raw_terrain_cost": raw_average_cost,
        "optimization_cost": float(objective),
        "average_optimization_cost": float(average_objective),
        "surface": surface,
    }
