import math
import shutil

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.weather_service import ARTIFACT_DIR, DATA_DIR, WeatherService

client = TestClient(app)
QUANTILE_KEYS = ["q05", "q10", "q25", "q75", "q90", "q95"]


def test_status_reports_model_and_range():
    body = client.get("/api/v1/weather/status").json()
    assert body["available"] is True
    assert body["first_issue_sol"] < body["latest_issue_sol"]
    assert body["max_horizon_hours"] == 168
    assert body["default_limits"]["placeholder"] is True


def test_current_conditions_latest_sol():
    response = client.get("/api/v1/weather/current")
    assert response.status_code == 200
    body = response.json()
    assert body["sol"] == client.get("/api/v1/weather/status").json()["latest_observed_sol"]
    assert 0 <= body["ls_deg"] < 360
    assert body["sunrise_ltst"] < 12 < body["sunset_ltst"]
    assert len(body["series"]) == 72
    assert body["today"]["hours_observed"] > 0


def test_forecast_default_shape_and_consistency():
    body = client.get("/api/v1/weather/forecast").json()
    hours = body["hours"]
    assert len(hours) == 48
    assert [h["offset_hours"] for h in hours] == list(range(48))
    assert hours[0]["sol"] == body["issue_sol"] + 1 and hours[0]["hour"] == 0
    for h in hours:
        assert h["status"] in {"GO", "CAUTION", "NO_GO"}
        assert 0.0 <= h["p_go"] <= 1.0
        if not h["daylight"]:
            assert h["status"] == "NO_GO" and h["p_go"] == 0.0
        for key in ("air", "ground"):
            quantiles = [h[key][q] for q in QUANTILE_KEYS]
            assert all(a <= b + 1e-9 for a, b in zip(quantiles, quantiles[1:]))
            assert h[key]["q05"] <= h[key]["forecast"] <= h[key]["q95"]
    limits = body["limits"]
    for h in hours:
        if h["status"] == "GO":
            assert h["p_go"] >= limits["go_confidence"]


def test_forecast_horizon_window():
    body = client.get("/api/v1/weather/forecast", params={"start_hour": 24, "end_hour": 72}).json()
    assert [h["offset_hours"] for h in body["hours"]] == list(range(24, 72))
    assert {h["lead_sols"] for h in body["hours"]} == {2, 3}


def test_forecast_full_week():
    body = client.get("/api/v1/weather/forecast", params={"end_hour": 168}).json()
    assert len(body["hours"]) == 168
    assert body["hours"][-1]["lead_sols"] == 7


def test_route_departure_fits_inside_go_hours():
    body = client.get("/api/v1/weather/forecast", params={"end_hour": 72, "route_hours": 3.2}).json()
    departure = body["recommended_departure"]
    assert departure is not None
    assert departure["hours_needed"] == 4
    by_offset = {h["offset_hours"]: h for h in body["hours"]}
    window = [by_offset[o] for o in range(departure["start"]["offset_hours"], departure["end"]["offset_hours"])]
    assert len(window) == 4 and all(h["status"] == "GO" for h in window)
    assert math.isclose(departure["min_p_go"], min(h["p_go"] for h in window), abs_tol=1e-3)


def test_stricter_limits_never_add_go_hours():
    loose = client.get("/api/v1/weather/forecast", params={"end_hour": 72}).json()
    strict = client.get("/api/v1/weather/forecast", params={"end_hour": 72, "air_min_k": 225}).json()
    assert sum(h["status"] == "GO" for h in strict["hours"]) <= sum(h["status"] == "GO" for h in loose["hours"])
    for a, b in zip(loose["hours"], strict["hours"]):
        assert b["p_go"] <= a["p_go"] + 1e-9


def test_replay_has_actuals_and_verification():
    body = client.get("/api/v1/weather/forecast", params={"issue_sol": 600, "end_hour": 48}).json()
    assert body["is_replay"] is True
    assert body["verification"]["hours_scored"] > 30
    assert any(h["air"]["actual"] is not None for h in body["hours"])


@pytest.mark.parametrize(
    "params",
    [
        {"issue_sol": 5},
        {"issue_sol": 10_000},
        {"start_hour": 30, "end_hour": 20},
        {"go_confidence": 0.4, "caution_confidence": 0.6},
    ],
)
def test_invalid_requests_are_rejected(params):
    assert client.get("/api/v1/weather/forecast", params=params).status_code == 400


def test_out_of_range_query_values_fail_validation():
    assert client.get("/api/v1/weather/forecast", params={"end_hour": 500}).status_code == 422


def test_report_is_served():
    report = client.get("/api/v1/weather/report").json()["report"]
    assert set(report["metrics"]) == {"air_temp_k", "ground_temp_k"}
    assert len(report["metrics"]["air_temp_k"]) == 7


def test_forecast_uses_no_future_observations(tmp_path):
    """Changing every observation after the issue sol must not change the forecast."""
    issue_sol = 450
    reference = WeatherService()._predict(issue_sol)

    for path in sorted(DATA_DIR.glob("meda_hourly_*.csv")):
        frame = pd.read_csv(path)
        later = frame.sol > issue_sol
        for column in ("air_temp_k", "ground_temp_k", "pressure_pa", "up_sw_wm2", "down_lw_wm2", "up_lw_wm2"):
            if column in frame:
                frame.loc[later, column] = frame.loc[later, column] + 37.0
        frame.to_csv(tmp_path / path.name, index=False)

    altered = WeatherService(data_dir=tmp_path, artifact_dir=ARTIFACT_DIR)._predict(issue_sol)
    for target in reference:
        assert np.allclose(reference[target]["forecast"], altered[target]["forecast"], equal_nan=True)
    shutil.rmtree(tmp_path, ignore_errors=True)


# ---------------------------------------------------------------- data files
def _service_from(tmp_path, frame, name="meda_hourly_test.csv"):
    from app.services.weather_service import WeatherService

    frame.to_csv(tmp_path / name, index=False)
    return WeatherService(data_dir=tmp_path)


def test_forty_sol_file_gives_the_same_forecast(tmp_path):
    from app.ml.weather.features import file_list, load_hourly
    from app.services.weather_service import DATA_DIR, WeatherService

    full = load_hourly(file_list(DATA_DIR))
    last = int(full.sol.max())
    short = _service_from(tmp_path, full[full.sol > last - 40])
    reference = WeatherService().forecast(issue_sol=last, start_hour=0, end_hour=48)
    trimmed = short.forecast(issue_sol=last, start_hour=0, end_hour=48)
    assert [h["air"]["forecast"] for h in trimmed["hours"]] == [h["air"]["forecast"] for h in reference["hours"]]
    assert short.latest_issue_sol == last
    assert short.first_issue_sol > last - 40


def test_newer_file_extends_the_history(tmp_path):
    from app.ml.weather.features import file_list, load_hourly
    from app.services.weather_service import DATA_DIR

    full = load_hourly(file_list(DATA_DIR))
    last = int(full.sol.max())
    base = full[(full.sol > last - 40) & (full.sol <= last - 3)]
    newer = full[full.sol > last - 3].copy()
    base.to_csv(tmp_path / "meda_hourly_a.csv", index=False)
    service = _service_from(tmp_path, newer, "meda_hourly_b.csv")
    assert service.latest_issue_sol == last


def test_missing_column_is_reported(tmp_path):
    import pytest
    from app.ml.weather.features import file_list, load_hourly
    from app.services.weather_service import DATA_DIR, WeatherUnavailable

    full = load_hourly(file_list(DATA_DIR))
    with pytest.raises(WeatherUnavailable, match="missing column"):
        _service_from(tmp_path, full[full.sol > 660].drop(columns=["n_rows"]))


def test_current_at_an_hour_does_not_use_later_measurements():
    full = client.get("/api/v1/weather/current", params={"sol": 650}).json()
    early = client.get("/api/v1/weather/current", params={"sol": 650, "hour": 6}).json()
    assert early["hour"] is not None and early["hour"] <= 6
    assert early["today"]["hours_observed"] <= 7 < full["today"]["hours_observed"]
    assert early["series"][-1]["hour"] <= 6
    assert early["today"]["air_max_k"] <= full["today"]["air_max_k"]
    assert client.get("/api/v1/weather/current", params={"hour": 24}).status_code == 422
