import { API_BASE, ApiError, requestJson } from "./client";

/**
 * Terrain — GET /api/v1/terrain/heightmap, GET /api/v1/terrain/texture
 * and the CTX tile pyramid at /tiles/ctx/{z}/{x}/{y}.png.
 *
 * Verified contract (backend/app/api/terrain.py): the heightmap payload
 * carries crs, coordinate_units, elevation_units, slope_units, width, height,
 * source_width, source_height, resolution_m, bounds_m, transform,
 * row_indices, col_indices, elevation_m, slope_deg and valid_mask.
 */

export const CTX_TILE_URL = `${API_BASE}/tiles/ctx/{z}/{x}/{y}.png`;
export const TERRAIN_TEXTURE_URL = `${API_BASE}/api/v1/terrain/texture?v=2`;
// Full DEM resolution (500 x 500 at 20 m): every route cell is a terrain
// vertex, so the 3D route and the 2D overlays use the exact elevation samples.
export const HEIGHTMAP_MAX_DIMENSION = 500;

const REQUIRED_FIELDS = ["elevation_m", "slope_deg", "valid_mask", "row_indices", "col_indices", "transform"];

function validateHeightmap(payload) {
  if (!payload || typeof payload !== "object" || REQUIRED_FIELDS.some((field) => !Array.isArray(payload[field]))) {
    throw new ApiError("contract", "Terrain API response is missing required fields.");
  }
  if (!Number.isInteger(payload.width) || !Number.isInteger(payload.height)) {
    throw new ApiError("contract", "Terrain API response has invalid dimensions.");
  }
  return payload;
}

let heightmapPromise = null;

/**
 * Loads the heightmap once and shares it between the 3D view and the 2D
 * Slope / Elevation overlays. A failed load is not cached, so it can be retried.
 */
export function getHeightmap() {
  if (!heightmapPromise) {
    heightmapPromise = requestJson(`/api/v1/terrain/heightmap?max_dimension=${HEIGHTMAP_MAX_DIMENSION}`, {
      timeoutMs: 60000,
    })
      .then(validateHeightmap)
      .catch((error) => {
        heightmapPromise = null;
        throw error;
      });
  }
  return heightmapPromise;
}
