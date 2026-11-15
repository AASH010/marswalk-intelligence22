from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio

from app.core.routing.cost_function import slope_cost
from app.core.terrain.hazard import create_blocked_mask

PROJECT_ROOT = Path(__file__).resolve().parents[4]

DEM_PATH = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "jezero"
    / "terrain"
    / "jezero_aoi_ctx_dem_20m.tif"
)

MAX_WALKABLE_SLOPE = 20.0


def compute_terrain(dem_path: Path) -> dict:
    """Read the DEM and derive slope, terrain cost and the blocked mask.

    This is the original per-request computation, unchanged. It is called
    once per process through load_terrain().
    """
    with rasterio.open(dem_path) as src:
        dem = src.read(1)
        resolution = src.res[0]
        nodata = src.nodata
        transform = src.transform

    valid_mask = np.isfinite(dem)

    if nodata is not None:
        valid_mask &= dem != nodata

    dem = dem.astype(float)
    dem[~valid_mask] = np.nan

    dy, dx = np.gradient(
        dem,
        resolution,
        resolution,
    )

    slope_radians = np.arctan(
        np.hypot(dx, dy)
    )

    slope_degrees = np.degrees(slope_radians)

    valid_slopes = slope_degrees[np.isfinite(slope_degrees)]

    reference_slope = float(
        np.percentile(valid_slopes, 95)
    )

    terrain_cost = slope_cost(
        slope_degrees,
        reference_slope,
    )

    blocked_mask = create_blocked_mask(
        slope_degrees,
        MAX_WALKABLE_SLOPE,
    )

    blocked_mask |= ~valid_mask

    terrain_cost[~valid_mask] = np.inf

    return {
        "dem": dem,
        "slope": slope_degrees,
        "terrain_cost": terrain_cost,
        "blocked_mask": blocked_mask,
        "resolution": resolution,
        "reference_slope": reference_slope,
        "transform": transform,
    }


@lru_cache(maxsize=2)
def _load_terrain_cached(dem_path: str) -> dict:
    terrain = compute_terrain(Path(dem_path))

    # The cached arrays are shared by every request. Make them read-only so
    # that a caller that tries to modify them in place fails loudly instead
    # of corrupting the terrain for later requests.
    for key in ("dem", "slope", "terrain_cost", "blocked_mask"):
        terrain[key].setflags(write=False)

    return terrain


def load_terrain(dem_path: Path | None = None) -> dict:
    """Terrain for the processed Jezero DEM, computed once per process.

    Same keys and values as before the cache was added. The arrays are
    read-only; copy them before changing anything. A missing file raises on
    every call (failures are not cached).
    """
    path = Path(dem_path) if dem_path is not None else DEM_PATH
    return _load_terrain_cached(str(path.resolve()))


def clear_terrain_cache() -> None:
    _load_terrain_cached.cache_clear()


def grid_to_map(row, col, transform):
    x, y = rasterio.transform.xy(
        transform,
        row,
        col,
        offset="center"
    )

    return float(x), float(y)
