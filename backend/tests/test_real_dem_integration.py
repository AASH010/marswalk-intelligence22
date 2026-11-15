"""Optional integration test on the real processed DEM and Task 1 output.

Run with:  pytest --run-slow tests/test_real_dem_integration.py
"""

import math

import pytest
from fastapi.testclient import TestClient

from app.core.eva_config import get_settings
from app.core.terrain.geotiff import DEM_PATH
from app.main import app

pytestmark = pytest.mark.slow


@pytest.fixture
def real_data():
    if not DEM_PATH.exists():
        pytest.skip(f"real DEM not found at {DEM_PATH}")
    if not get_settings().time.path.exists():
        pytest.skip(f"Task 1 output not found at {get_settings().time.path}")


def test_real_dem_route_and_eva(real_data):
    client = TestClient(app)
    body = {"start": [4351010, 1098990], "goal": [4358990, 1091010], "mode": "balanced", "sol": 235, "start_time": "12:00"}

    nav = client.post("/api/v1/navigate", json={**body, "include_profile": True})
    assert nav.status_code == 200
    props = nav.json()["features"][0]["properties"]
    assert props["weather_status"] == "applied"
    segments = props["profile"]["segments"]
    objective = math.fsum(s["distance_m"] * s["cell_cost"] for s in segments)
    assert props["optimization_cost"] == pytest.approx(objective, abs=0.005)
    assert all(s["slope_deg"] <= 20.0 for s in segments)

    est = client.post("/api/v1/mission/eva-estimate", json={**body, "payload_kg": 10})
    assert est.status_code == 200
    data = est.json()
    assert math.fsum(s["energy_kcal"]["value"] for s in data["segments"]) == pytest.approx(
        data["totals"]["energy_kcal"]["value"]
    )
    assert data["route"]["geometry"]["coordinates"] == [list(p) for p in nav.json()["features"][0]["geometry"]["coordinates"]]
