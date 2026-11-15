"""Weather factor in the A* cost: C = T * F + P, F = 1 + beta * W_t * s."""

import heapq
import math

import numpy as np
import pytest

from app.core.eva_config import WeatherCostConfig
from app.core.routing.astar import MOVEMENTS, astar_search, heuristic
from app.core.routing.weather_cost import build_cost_surface, slope_weight, weather_factor
from app.services.route_service import calculate_route


def test_flat_cells_have_factor_one_and_terrain_only_cost():
    terrain_cost = np.array([1.0, 1.0, 1.4])
    slope = np.array([0.0, 0.0, 6.0])
    blocked = np.zeros(3, dtype=bool)

    surface = build_cost_surface(
        terrain_cost, blocked, terrain_weight=1.0, slope_deg=slope, reference_slope=10.0, w_t=1.0, beta=3.0
    )

    assert surface.weather_factor[0] == 1.0 and surface.weather_factor[1] == 1.0
    assert surface.cost[0] == surface.terrain_part[0] == 1.0
    assert surface.cost[2] > surface.terrain_part[2]


def test_steep_cost_increases_with_w_t():
    terrain_cost = np.array([1.0, 1.81])
    slope = np.array([0.0, 9.0])
    blocked = np.zeros(2, dtype=bool)

    costs = [
        build_cost_surface(
            terrain_cost, blocked, 1.0, slope_deg=slope, reference_slope=10.0, w_t=w, beta=0.5
        ).cost[1]
        for w in (0.0, 0.25, 0.5, 1.0)
    ]
    assert costs == sorted(costs) and len(set(costs)) == 4
    # T = 1.81, s = 0.9: C = 1.81 * (1 + 0.5 * W_t * 0.9)
    assert costs[-1] == pytest.approx(1.81 * (1 + 0.5 * 1.0 * 0.9))


def test_slope_weight_is_clipped():
    s = slope_weight(np.array([-1.0, 0.0, 5.0, 10.0, 40.0]), 10.0)
    assert np.allclose(s, [0.0, 0.0, 0.5, 1.0, 1.0])
    assert np.all(weather_factor(s, None, 2.0) == 1.0)


def detour_grid():
    """Straight line crosses one sloped (not blocked) column; a flat detour exists below it."""
    rows, cols = 7, 15
    slope = np.zeros((rows, cols))
    slope[0:5, 7] = 15.0  # sloped band, rows 0-4; row 5-6 flat
    reference = 15.0
    terrain_cost = 1.0 + (np.clip(slope / reference, 0, 1)) ** 2  # existing slope_cost form
    blocked = np.zeros((rows, cols), dtype=bool)
    return terrain_cost, slope, reference, blocked


def test_route_changes_to_flat_detour_when_weather_is_strong():
    terrain_cost, slope, reference, blocked = detour_grid()
    kwargs = dict(
        terrain_cost=terrain_cost,
        blocked_mask=blocked,
        start=(2, 0),
        goal=(2, 14),
        resolution=20.0,
        mode_name="balanced",
        slope=slope,
        reference_slope=reference,
        weather_beta=1.0,
    )

    calm = calculate_route(w_t=0.0, **kwargs)
    stormy = calculate_route(w_t=1.0, **kwargs)

    crosses_band = lambda path: any(slope[c] > 0 for c in path)  # noqa: E731
    assert crosses_band(calm["path"])
    assert not crosses_band(stormy["path"])
    assert stormy["distance_km"] > calm["distance_km"]


def test_blocked_cells_stay_infinite_and_are_never_traversed():
    terrain_cost, slope, reference, blocked = detour_grid()
    blocked[0:6, 7] = True
    surface = build_cost_surface(
        terrain_cost, blocked, 1.0, slope_deg=slope, reference_slope=reference, w_t=1.0, beta=5.0,
        penalty_coefficient=2.0,
    )
    assert np.all(np.isinf(surface.cost[blocked]))

    result = calculate_route(
        terrain_cost, blocked, (2, 0), (2, 14), 20.0, "conservative",
        slope=slope, reference_slope=reference, w_t=1.0, weather_beta=5.0,
    )
    assert all(not blocked[c] for c in result["path"])


def test_nodata_stays_infinite():
    terrain_cost = np.array([[1.0, np.inf], [1.0, 1.0]])
    slope = np.array([[0.0, np.nan], [0.0, 0.0]])
    blocked = np.array([[False, True], [False, False]])
    surface = build_cost_surface(terrain_cost, blocked, 1.0, slope_deg=slope, reference_slope=5.0, w_t=0.5, beta=1.0)
    assert np.isinf(surface.cost[0, 1])
    assert np.isfinite(surface.cost[1]).all()


def exact_cost_to_goal(cost: np.ndarray, goal, cell_size: float) -> np.ndarray:
    """Reverse Dijkstra: cheapest cost from every cell to the goal (move charged at destination)."""
    rows, cols = cost.shape
    dist = np.full(cost.shape, np.inf)
    dist[goal] = 0.0
    queue = [(0.0, goal)]
    while queue:
        d, (r, c) = heapq.heappop(queue)
        if d > dist[r, c]:
            continue
        for dr, dc, mult in MOVEMENTS:
            pr, pc = r - dr, c - dc  # predecessor that moves into (r, c)
            if 0 <= pr < rows and 0 <= pc < cols and np.isfinite(cost[pr, pc]):
                nd = d + cell_size * mult * cost[r, c]
                if nd < dist[pr, pc]:
                    dist[pr, pc] = nd
                    heapq.heappush(queue, (nd, (pr, pc)))
    return dist


@pytest.mark.parametrize("seed", range(12))
def test_heuristic_is_admissible_and_astar_is_optimal(seed):
    rng = np.random.default_rng(100 + seed)
    size = 10
    terrain_cost = 1.0 + rng.random((size, size))
    slope = rng.random((size, size)) * 25.0
    blocked = slope > 20.0
    blocked[0, 0] = blocked[-1, -1] = False
    w_t = float(rng.random())

    surface = build_cost_surface(
        terrain_cost, blocked, float(rng.choice([0.2, 1.0, 2.0])),
        slope_deg=slope, reference_slope=12.0, w_t=w_t, beta=float(rng.random() * 3), penalty_coefficient=0.5,
    )
    finite = surface.cost[np.isfinite(surface.cost)]
    assert finite.min() >= 1.0

    goal = (size - 1, size - 1)
    exact = exact_cost_to_goal(surface.cost, goal, 20.0)
    reachable = np.isfinite(exact)
    for r, c in zip(*np.nonzero(reachable)):
        assert heuristic((r, c), goal, 20.0, 1.0) <= exact[r, c] + 1e-9

    found = astar_search(surface.cost, (0, 0), goal, 20.0)
    if not math.isfinite(exact[0, 0]):
        assert found is None
    else:
        assert found[1] == pytest.approx(exact[0, 0], rel=1e-12)


def test_penalty_needs_documented_justification():
    with pytest.raises(ValueError):
        WeatherCostConfig(penalty_coefficient=0.3).validate()
    WeatherCostConfig(penalty_coefficient=0.3, penalty_justification="cited study").validate()
    with pytest.raises(ValueError):
        WeatherCostConfig(beta=-0.1).validate()


def test_w_t_outside_unit_interval_is_rejected():
    with pytest.raises(ValueError):
        build_cost_surface(np.ones(2), np.zeros(2, bool), 1.0, slope_deg=np.ones(2), reference_slope=1.0, w_t=1.2)
