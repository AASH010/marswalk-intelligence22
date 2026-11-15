"""Shared fixtures: small synthetic DEM and Task 1 W_t file, cache resets.

The real DEM is used only by tests marked ``slow``; they run with
``pytest --run-slow``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import rasterio
from affine import Affine

from app.core import eva_config
from app.core.terrain import geotiff
from app.services import weather_intensity_service

# Same origin and cell size as the Jezero AOI grid.
ORIGIN_X = 4_350_000.0
ORIGIN_Y = 1_100_000.0
CELL = 20.0


def pytest_addoption(parser):
    parser.addoption("--run-slow", action="store_true", default=False, help="run tests that use the real DEM")


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: uses the real processed DEM (run with --run-slow)")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--run-slow"):
        return
    skip = pytest.mark.skip(reason="real-DEM integration test; run with --run-slow")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)


def cell_center(row: int, col: int) -> list[float]:
    return [ORIGIN_X + (col + 0.5) * CELL, ORIGIN_Y - (row + 0.5) * CELL]


def write_dem(path: Path, dem: np.ndarray, nodata: float | None = -9999.0) -> Path:
    profile = {
        "driver": "GTiff",
        "width": dem.shape[1],
        "height": dem.shape[0],
        "count": 1,
        "dtype": "float32",
        "transform": Affine(CELL, 0.0, ORIGIN_X, 0.0, -CELL, ORIGIN_Y),
        "nodata": nodata,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(dem.astype(np.float32), 1)
    return path


def ridge_dem(rows: int = 30, cols: int = 30) -> np.ndarray:
    """Flat plain with a steep-sided, walkable ridge across the middle columns.

    Columns 13-16 rise and fall with about 12 deg flanks (below the 20 deg
    block); rows 24-29 are flat, so a detour around the ridge exists.
    """
    dem = np.zeros((rows, cols), dtype=float)
    profile = np.array([0, 4.2, 8.4, 4.2, 0])  # metres over 20 m cells
    for offset, height in enumerate(profile):
        dem[:24, 12 + offset] = height
    return dem


def write_weather(path: Path, rows: list[dict]) -> Path:
    columns = {
        "sol": pa.array([r["sol"] for r in rows], pa.int32()),
        "sclk": pa.array([float(r.get("sclk", i)) for i, r in enumerate(rows)], pa.float64()),
        "lmst": pa.array([r["lmst"] for r in rows], pa.string()),
        "ltst": pa.array([r.get("ltst", "0000 00:00:00") for r in rows], pa.string()),
        "utc": pa.array([None] * len(rows), pa.string()),
        "w_t": pa.array([r["w_t"] for r in rows], pa.float64()),
        "components_used": pa.array(
            [r.get("components_used", ["air_temperature", "wind_speed_boom1", "wind_speed_boom2"]) for r in rows],
            pa.list_(pa.string()),
        ),
        "components_missing": pa.array([[] for _ in rows], pa.list_(pa.string())),
        "source_record_ids": pa.array([["synthetic"] for _ in rows], pa.list_(pa.string())),
        "quality_status": pa.array([r.get("quality_status", "valid") for r in rows], pa.string()),
        "observation_type": pa.array(["observed"] * len(rows), pa.string()),
    }
    pq.write_table(pa.table(columns), path)
    return path


def lmst(sol: int, text: str) -> str:
    return f"{sol:05d}M{text}"


DEFAULT_WEATHER_ROWS = [
    {"sol": 300, "lmst": lmst(300, "09:00:00.000"), "w_t": 0.20},
    {"sol": 300, "lmst": lmst(300, "12:00:00.000"), "w_t": 0.80},
    {"sol": 300, "lmst": lmst(300, "12:10:00.500"), "w_t": 0.30, "quality_status": "suspect",
     "components_used": ["air_temperature"]},
    {"sol": 300, "lmst": lmst(300, "15:00:00.000"), "w_t": 0.50},
    {"sol": 301, "lmst": lmst(301, "12:00:00.000"), "w_t": 0.60},
]


@pytest.fixture(autouse=True)
def reset_caches():
    """Every test starts from default settings and empty caches."""
    eva_config.set_settings(None)
    geotiff.clear_terrain_cache()
    weather_intensity_service.clear_weather_cache()
    yield
    eva_config.set_settings(None)
    geotiff.clear_terrain_cache()
    weather_intensity_service.clear_weather_cache()


@pytest.fixture
def weather_file(tmp_path) -> Path:
    return write_weather(tmp_path / "weather_intensity.parquet", DEFAULT_WEATHER_ROWS)


@pytest.fixture
def synthetic_env(tmp_path, monkeypatch, weather_file):
    """Point the API at a synthetic DEM and W_t file. Returns a settings factory."""
    dem_path = write_dem(tmp_path / "dem.tif", ridge_dem())
    monkeypatch.setattr(geotiff, "DEM_PATH", dem_path)

    def configure(**cost_overrides):
        time_cfg = eva_config.WeatherTimeConfig(path=weather_file, default_sol=300)
        cost_cfg = eva_config.WeatherCostConfig(**cost_overrides)
        settings = eva_config.EvaWeatherSettings(cost=cost_cfg, time=time_cfg)
        eva_config.set_settings(settings)
        return settings

    configure()
    return configure
