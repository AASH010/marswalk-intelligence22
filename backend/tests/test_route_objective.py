"""Defect 1: the reported optimization_cost must be the objective A* minimises."""

import math

import numpy as np
import pytest

from app.core.routing.astar import astar_search, movement_distance, path_objective
from app.core.routing.weather_cost import build_cost_surface
from app.services.route_service import calculate_route


def random_case(seed: int, size: int = 15):
    rng = np.random.default_rng(seed)
    terrain_cost = 1.0 + rng.random((size, size))
    slope = rng.random((size, size)) * 18.0
    blocked = rng.random((size, size)) < 0.15
    blocked[0, 0] = blocked[-1, -1] = False
    return terrain_cost, slope, blocked


@pytest.mark.parametrize("seed", range(8))
@pytest.mark.parametrize("w_t", [None, 0.0, 0.7])
def test_reported_objective_equals_recomputed_path_objective(seed, w_t):
    terrain_cost, slope, blocked = random_case(seed)
    result = calculate_route(
        terrain_cost=terrain_cost,
        blocked_mask=blocked,
        start=(0, 0),
        goal=(14, 14),
        resolution=20.0,
        mode_name="balanced",
        slope=slope,
        reference_slope=12.0,
        w_t=w_t,
        weather_beta=0.8,
    )
    if result is None:
        pytest.skip("random grid has no route")

    recomputed = path_objective(result["surface"].cost, result["path"], 20.0)
    assert result["optimization_cost"] == pytest.approx(recomputed, rel=1e-12, abs=1e-9)
    assert result["average_optimization_cost"] == pytest.approx(
        recomputed / (result["distance_km"] * 1000), rel=1e-12
    )


def test_start_cell_is_not_charged_and_diagonal_uses_sqrt2():
    cost = np.full((3, 3), np.inf)  # only the diagonal is open
    cost[0, 0] = 50.0  # start cell: must not appear in the objective
    cost[1, 1] = 3.0
    cost[2, 2] = 5.0

    path, objective = astar_search(cost, (0, 0), (2, 2), cell_size=10.0)

    assert path == [(0, 0), (1, 1), (2, 2)]
    expected = 10.0 * math.sqrt(2) * 3.0 + 10.0 * math.sqrt(2) * 5.0
    assert objective == pytest.approx(expected)
    assert path_objective(cost, path, 10.0) == pytest.approx(expected)


def test_movement_distance_straight_diagonal_and_non_neighbours():
    assert movement_distance((0, 0), (0, 1), 20.0) == 20.0
    assert movement_distance((0, 0), (1, 0), 20.0) == 20.0
    assert movement_distance((0, 0), (1, 1), 20.0) == pytest.approx(20.0 * math.sqrt(2))
    with pytest.raises(ValueError):
        movement_distance((0, 0), (0, 2), 20.0)


def test_old_objective_definition_would_differ():
    """The previous value (sum of cell costs, start included, no distance) is not the objective."""
    terrain_cost = np.full((5, 5), 1.5)
    blocked = np.zeros((5, 5), dtype=bool)
    result = calculate_route(terrain_cost, blocked, (0, 0), (0, 4), 20.0, "balanced")
    old = float(np.sum([result["surface"].cost[c] for c in result["path"]]))
    assert old == pytest.approx(5 * 1.5)
    assert result["optimization_cost"] == pytest.approx(4 * 20.0 * 1.5)


def test_surface_without_weather_matches_terrain_only_cost():
    terrain_cost = np.array([[1.0, 1.5], [2.0, 1.2]])
    blocked = np.array([[False, False], [True, False]])
    surface = build_cost_surface(terrain_cost, blocked, terrain_weight=2.0)
    expected = 1.0 + 2.0 * (terrain_cost - 1.0)
    expected[blocked] = np.inf
    assert np.array_equal(surface.cost, expected)
