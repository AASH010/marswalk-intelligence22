"""Route Profile built from the A* path on a small synthetic DEM."""

import math

import numpy as np
import pytest

from app.core.terrain.geotiff import compute_terrain, load_terrain
from app.services.navigation_service import plan_route
from tests.conftest import cell_center, ridge_dem, write_dem


def test_profile_matches_route_dem_and_weather(synthetic_env):
    planned = plan_route(cell_center(5, 2), cell_center(5, 27), "balanced", 300, "12:00")
    terrain = load_terrain()
    profile = planned.profile
    segments = profile["segments"]
    summary = profile["summary"]
    path = planned.result["path"]

    # one segment per move
    assert len(segments) == len(path) - 1 == summary["segment_count"]

    # distances add up to the route distance
    total = math.fsum(s["distance_m"] for s in segments)
    assert total == pytest.approx(planned.result["distance_km"] * 1000, rel=1e-12)
    assert summary["total_distance_m"] == pytest.approx(total, rel=1e-12)

    # slopes come from the DEM-derived slope of the destination cell
    for segment in segments:
        r, c = segment["to_cell"]
        assert segment["slope_deg"] == terrain["slope"][r, c]
        assert segment["slope_percent"] == pytest.approx(math.tan(math.radians(terrain["slope"][r, c])) * 100)
        fr, fc = segment["from_cell"]
        rise = terrain["dem"][r, c] - terrain["dem"][fr, fc]
        assert segment["grade_percent"] == pytest.approx(rise / segment["distance_m"] * 100)

    # W_t attached to every segment
    assert planned.selection.status == "applied"
    assert all(s["w_t"] == pytest.approx(0.80) and s["weather_status"] == "applied" for s in segments)

    # objective consistency
    assert summary["objective_from_segments"] == pytest.approx(planned.result["optimization_cost"], rel=1e-12)

    # summary statistics
    slopes = np.array([s["slope_deg"] for s in segments])
    assert summary["max_slope_deg"] == pytest.approx(slopes.max())
    weights = np.array([s["distance_m"] for s in segments])
    assert summary["mean_slope_deg"] == pytest.approx(float((slopes * weights).sum() / weights.sum()))
    assert summary["weather_time"]["lmst"] == "00300M12:00:00.000"
    assert summary["mode_id"] == "balanced"


def test_profile_without_weather_reports_status(synthetic_env):
    planned = plan_route(cell_center(5, 2), cell_center(5, 27), "balanced", 999, "12:00")
    assert planned.selection.status == "unavailable"
    assert planned.confidence == "reduced"
    segments = planned.profile["segments"]
    assert all(s["w_t"] is None and s["weather_factor"] == 1.0 for s in segments)
    assert all(s["weather_status"] == "unavailable" for s in segments)


def test_terrain_is_computed_once_and_read_only(tmp_path):
    path = write_dem(tmp_path / "d.tif", ridge_dem())
    first = load_terrain(path)
    second = load_terrain(path)
    assert first is second

    fresh = compute_terrain(path)
    for key in ("dem", "slope", "terrain_cost", "blocked_mask"):
        assert np.array_equal(first[key], fresh[key], equal_nan=key in ("dem", "slope"))
        assert not first[key].flags.writeable
    assert first["reference_slope"] == fresh["reference_slope"]

    with pytest.raises(ValueError):
        first["terrain_cost"][0, 0] = 5.0


def test_nodata_cells_stay_blocked(tmp_path):
    dem = ridge_dem()
    dem[10, 5] = -9999.0
    terrain = load_terrain(write_dem(tmp_path / "n.tif", dem))
    assert terrain["blocked_mask"][10, 5]
    assert np.isinf(terrain["terrain_cost"][10, 5])
