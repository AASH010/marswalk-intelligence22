"""W_t time selection from the Task 1 output."""

import pytest

from app.core.eva_config import WeatherCostConfig, WeatherTimeConfig
from app.services.weather_intensity_service import (
    get_weather_store,
    parse_start_time,
    select_weather,
)
from tests.conftest import lmst, write_weather


def select(weather_file, sol, start_time, **time_overrides):
    time_cfg = WeatherTimeConfig(path=weather_file, **time_overrides)
    return select_weather(sol, start_time, time_cfg, WeatherCostConfig())


def test_exact_match_is_reported_as_exact(weather_file):
    selection = select(weather_file, 300, "12:00:00")
    assert selection.status == "applied"
    assert selection.selection_method == "exact_match"
    assert selection.time_difference_s == 0.0
    assert selection.w_t == pytest.approx(0.80)
    assert selection.record.lmst == lmst(300, "12:00:00.000")


def test_nearest_record_is_not_reported_as_exact(weather_file):
    selection = select(weather_file, 300, "12:20:00")
    assert selection.status == "applied"
    assert selection.selection_method == "nearest_within_window"
    # The suspect record at 12:10:00.5 is closer but not accepted.
    assert selection.record.lmst == lmst(300, "12:00:00.000")
    assert selection.time_difference_s == pytest.approx(1200.0)


def test_outside_window_turns_weather_off_with_reason(weather_file):
    selection = select(weather_file, 300, "10:30:00", window_s=600)
    assert selection.status == "unavailable"
    assert selection.w_t is None  # never 0
    assert selection.record is None
    assert "within 600 s" in selection.reason


def test_window_never_crosses_into_another_sol(weather_file):
    # 23:59 on sol 300 is 1 s from nothing; sol 301 at 12:00 must not be used.
    selection = select(weather_file, 300, "23:59:59", window_s=100_000)
    assert selection.record.sol == 300


def test_unknown_sol_is_unavailable(weather_file):
    selection = select(weather_file, 999, "12:00")
    assert selection.status == "unavailable"
    assert "Sol 999" in selection.reason


def test_suspect_records_used_only_when_accepted(weather_file):
    selection = select(weather_file, 300, "12:10:00.5", accepted_quality=("valid", "suspect"))
    assert selection.record.quality_status == "suspect"
    assert selection.selection_method == "exact_match"


def test_defaults_come_from_config(weather_file):
    selection = select(weather_file, None, None)
    assert set(selection.defaults_used) == {"sol", "start_time"}
    assert selection.requested_sol == 301  # latest sol in the file
    assert selection.requested_time == "12:00:00"

    selection = select(weather_file, None, None, default_sol=300, default_start_time="09:00")
    assert selection.record.lmst == lmst(300, "09:00:00.000")


def test_missing_file_is_unavailable(tmp_path):
    selection = select(tmp_path / "missing.parquet", 300, "12:00")
    assert selection.status == "unavailable"
    assert "not found" in selection.reason


def test_beta_zero_reports_disabled(weather_file):
    selection = select_weather(300, "12:00", WeatherTimeConfig(path=weather_file), WeatherCostConfig(beta=0.0))
    assert selection.status == "disabled"
    assert selection.w_t is None
    assert selection.record is not None


def test_rows_with_missing_or_out_of_range_w_t_are_excluded(tmp_path):
    path = write_weather(
        tmp_path / "w.parquet",
        [
            {"sol": 5, "lmst": lmst(5, "10:00:00.000"), "w_t": float("nan")},
            {"sol": 5, "lmst": lmst(5, "10:00:01.000"), "w_t": 1.5},
            {"sol": 5, "lmst": lmst(5, "10:30:00.000"), "w_t": 0.4},
        ],
    )
    selection = select(path, 5, "10:00:00")
    assert selection.record.lmst == lmst(5, "10:30:00.000")
    assert get_weather_store(path).rows_excluded == 2


def test_per_sol_index_is_cached(weather_file):
    store = get_weather_store(weather_file)
    select(weather_file, 300, "09:00")
    first = store.sol_index(300, ("valid",))
    select(weather_file, 300, "15:00")
    assert store.sol_index(300, ("valid",)) is first
    assert list(store._sol_cache) == [(300, ("valid",))]
    assert get_weather_store(weather_file) is store


@pytest.mark.parametrize("text, seconds", [("00:00", 0.0), ("7:05", 25500.0), ("12:00:30.25", 43230.25)])
def test_parse_start_time(text, seconds):
    assert parse_start_time(text) == pytest.approx(seconds)


@pytest.mark.parametrize("text", ["24:00", "12:60", "12:00:60", "noon", "", "1200"])
def test_parse_start_time_rejects_bad_values(text):
    with pytest.raises(ValueError):
        parse_start_time(text)


def write_manifest(folder, invert_air: bool):
    import json

    manifest = {
        "run": {"run_id": "synthetic"},
        "normalization": {
            "method": "weighted_mean_clipped_minmax",
            "components": [
                {"name": "air_temperature", "variable": "air_temperature_ats1", "weight": 0.5, "invert": invert_air},
                {"name": "wind_speed_boom1", "variable": "wind_speed_horizontal_boom1", "weight": 0.5, "invert": False},
            ],
        },
    }
    (folder / "manifest.json").write_text(json.dumps(manifest))


def test_warns_when_warmer_air_raises_w_t(weather_file):
    write_manifest(weather_file.parent, invert_air=False)
    selection = select(weather_file, 300, "12:00")
    assert len(selection.warnings) == 1 and "invert = true" in selection.warnings[0]
    directions = {c["name"]: c["direction"] for c in selection.source["components"]}
    assert directions["air_temperature"] == "higher value -> higher W_t"


def test_no_direction_warning_when_air_temperature_is_inverted(weather_file):
    write_manifest(weather_file.parent, invert_air=True)
    selection = select(weather_file, 300, "12:00")
    assert selection.warnings == []
    assert selection.source["components"][0]["direction"] == "higher value -> lower W_t"
