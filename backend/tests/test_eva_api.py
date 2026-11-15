"""API contract: /navigate additions, /mission/eva-estimate, legacy endpoint."""

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.terrain import geotiff
from app.main import app
from tests.conftest import cell_center, ridge_dem, write_dem

client = TestClient(app)

START = cell_center(5, 2)
GOAL = cell_center(5, 27)
OLD_PROPERTY_KEYS = {
    "mode",
    "distance_km",
    "raw_terrain_cost",
    "average_raw_terrain_cost",
    "optimization_cost",
    "average_optimization_cost",
}


def navigate(**body):
    return client.post("/api/v1/navigate", json={"start": START, "goal": GOAL, **body})


def eva(**body):
    return client.post("/api/v1/mission/eva-estimate", json={"start": START, "goal": GOAL, **body})


# ------------------------------------------------------------------ navigate


def test_navigate_keeps_old_fields_and_adds_weather(synthetic_env):
    response = navigate(mode="balanced", sol=300, start_time="12:00")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    feature = body["features"][0]
    props = feature["properties"]
    assert OLD_PROPERTY_KEYS <= set(props)
    assert feature["geometry"]["type"] == "LineString"
    assert props["weather_status"] == "applied"
    assert props["weather_time"]["lmst"] == "00300M12:00:00.000"
    assert props["weather_time_difference_s"] == 0.0
    assert props["weather"]["selection_method"] == "exact_match"
    assert props["confidence"] == "high"
    assert props["cost_model"]["beta_tag"] == "modeled"
    assert props["route_profile_summary"]["segment_count"] == len(feature["geometry"]["coordinates"]) - 1
    assert "profile" not in props


def test_navigate_optimization_cost_is_the_objective(synthetic_env):
    props = navigate(sol=300, start_time="12:00", include_profile=True).json()["features"][0]["properties"]
    segments = props["profile"]["segments"]
    objective = math.fsum(s["distance_m"] * s["cell_cost"] for s in segments)
    assert props["optimization_cost"] == pytest.approx(objective, abs=0.005)
    assert props["average_optimization_cost"] == pytest.approx(
        objective / (props["distance_km"] * 1000), rel=1e-3
    )


def test_navigate_without_sol_uses_config_default(synthetic_env):
    props = navigate().json()["features"][0]["properties"]
    assert props["weather"]["requested_sol"] == 300
    assert set(props["weather"]["defaults_used"]) == {"sol", "start_time"}


def test_navigate_weather_unavailable_routes_without_weather(synthetic_env):
    props = navigate(sol=999, start_time="12:00").json()["features"][0]["properties"]
    assert props["weather_status"] == "unavailable"
    assert props["weather_time"] is None
    assert props["weather_time_difference_s"] is None
    assert props["weather"]["w_t"] is None
    assert props["confidence"] == "reduced"
    assert "Sol 999" in props["weather"]["reason"]


def test_navigate_weather_required_returns_422(synthetic_env):
    synthetic_env(weather_required=True)
    response = navigate(sol=999, start_time="12:00")
    assert response.status_code == 422
    assert "required" in response.json()["detail"]
    assert navigate(sol=300, start_time="12:00").status_code == 200


def test_navigate_errors(synthetic_env):
    assert navigate(start=[0.0, 0.0]).status_code == 400
    assert navigate(goal=START).status_code == 400
    assert navigate(start_time="25:00").status_code == 400
    assert navigate(start_time="noon").status_code == 422  # schema error, as before
    assert navigate(mode="sprint").status_code == 422


def test_navigate_blocked_start_and_no_route(tmp_path, monkeypatch, synthetic_env):
    dem = ridge_dem()
    dem[:, 14] = 500.0  # wall steeper than 20 deg, full height -> no route
    monkeypatch.setattr(geotiff, "DEM_PATH", write_dem(tmp_path / "wall.tif", dem))
    geotiff.clear_terrain_cache()
    assert navigate(sol=300, start_time="12:00").status_code == 404
    assert navigate(start=cell_center(5, 13)).status_code == 400  # wall flank: slope > 20 deg


def test_navigate_dem_missing_returns_503(tmp_path, monkeypatch, synthetic_env):
    monkeypatch.setattr(geotiff, "DEM_PATH", tmp_path / "none.tif")
    assert navigate().status_code == 503


# -------------------------------------------------------------- eva-estimate


def test_eva_estimate_runs_route_and_returns_tagged_totals(synthetic_env):
    response = eva(mode="balanced", sol=300, start_time="12:00", payload_kg=5)
    assert response.status_code == 200
    body = response.json()
    assert body["weather_status"] == "applied" and body["confidence"] == "high"

    totals = body["totals"]
    for key in ("duration_hours", "energy_kcal", "oxygen_liters", "suit_time_fraction_percent"):
        assert totals[key]["tag"] in {"measured", "calculated", "modeled", "assumed"}
        assert totals[key]["unit"]
    assert "oxygen_percent_of_suit_capacity" not in totals

    segments = body["segments"]
    assert math.fsum(s["duration_s"]["value"] for s in segments) == pytest.approx(totals["duration_s"]["value"])
    assert math.fsum(s["oxygen_l"]["value"] for s in segments) == pytest.approx(totals["oxygen_liters"]["value"])
    assert len(segments) == body["route_profile_summary"]["segment_count"]

    params = {p["name"]: p for p in body["parameters"]}
    assert params["base_walking_speed_ms"]["value"] == 0.75
    assert "ALSJ" in params["base_walking_speed_ms"]["source"]

    nav = navigate(mode="balanced", sol=300, start_time="12:00").json()["features"][0]
    assert body["route"]["geometry"]["coordinates"] == [list(p) for p in nav["geometry"]["coordinates"]]


@pytest.mark.parametrize(
    "extra",
    [
        {"profile": [{"distance_m": 10}]},
        {"segments": []},
        {"average_slope_percent": 5},
        {"distance_km": 2.0},
        {"average_raw_terrain_cost": 1.1},
    ],
)
def test_eva_estimate_rejects_client_supplied_route_data(synthetic_env, extra):
    response = eva(**extra)
    assert response.status_code == 400
    assert response.json()["detail"][0]["type"] == "extra_forbidden"


def test_eva_estimate_input_errors_are_400(synthetic_env):
    assert eva(payload_kg=-1).status_code == 400
    assert eva(start_time="99:99").status_code == 400
    assert eva(start=[0.0, 0.0]).status_code == 400
    assert eva(mode="sprint").status_code == 400
    assert client.post("/api/v1/mission/eva-estimate", json={"goal": GOAL}).status_code == 400


def test_eva_estimate_weather_required_422_and_unavailable_reduced(synthetic_env):
    body = eva(sol=999, start_time="12:00").json()
    assert body["weather_status"] == "unavailable" and body["confidence"] == "reduced"
    assert body["warnings"][0].startswith("Weather not applied")

    synthetic_env(weather_required=True)
    assert eva(sol=999, start_time="12:00").status_code == 422


def test_eva_estimate_no_route_404(tmp_path, monkeypatch, synthetic_env):
    dem = ridge_dem()
    dem[:, 14] = 500.0
    monkeypatch.setattr(geotiff, "DEM_PATH", write_dem(tmp_path / "wall.tif", dem))
    geotiff.clear_terrain_cache()
    assert eva(sol=300, start_time="12:00").status_code == 404


# -------------------------------------------------------------------- legacy

LEGACY_SNAPSHOTS = [
    (
        {"distance_km": 3.0, "average_raw_terrain_cost": 1.2, "payload_kg": 10.0},
        {"estimated_duration_hours": 2.95, "estimated_oxygen_liters": 160.88,
         "oxygen_percent_of_suit_capacity": 34.71, "average_metabolic_rate_kcal_hr": 265.04,
         "slope_penalty_kcal_hr": 0.0, "payload_penalty_kcal_hr": 5.04, "safety_margin_hours": 5.55},
    ),
    (
        {"distance_km": 2.0, "average_raw_terrain_cost": 1.0, "average_slope_percent": 5.0, "payload_kg": 15.0},
        {"estimated_duration_hours": 2.159, "estimated_oxygen_liters": 130.48,
         "oxygen_percent_of_suit_capacity": 25.39, "average_metabolic_rate_kcal_hr": 293.78,
         "slope_penalty_kcal_hr": 36.34, "payload_penalty_kcal_hr": 7.44, "safety_margin_hours": 6.341},
    ),
]


@pytest.mark.parametrize("request_body, expected", LEGACY_SNAPSHOTS)
def test_legacy_consumables_unchanged(request_body, expected):
    """Values recorded from the endpoint before this change."""
    response = client.post("/api/v1/mission/consumables", json=request_body)
    assert response.status_code == 200
    body = response.json()
    for key, value in expected.items():
        assert body[key] == value


def test_legacy_endpoint_marked_deprecated():
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/api/v1/mission/consumables"]["post"].get("deprecated") is True
    assert "/api/v1/mission/eva-estimate" in schema["paths"]


def test_old_route_service_signature_still_works():
    from app.services.route_service import calculate_route

    result = calculate_route(np.ones((5, 5)), np.zeros((5, 5), bool), (0, 0), (4, 4), 20.0, "fastest")
    assert result["mode"] == "Fastest"
    assert result["surface"].w_t is None
