/**
 * Builds 2D map overlays (Slope, Elevation) from the terrain heightmap that
 * the backend already serves at GET /api/v1/terrain/heightmap.
 *
 * Only values present in the payload are drawn. Units come from the payload
 * (`elevation_units`, `slope_units`). No classification is implied: the ramp
 * is a continuous display stretch and its limits are reported in the legend.
 */

/** Colour ramps as [position, r, g, b, alpha]. Hues are design-token colours. */
export const RAMPS = {
  elevation: [
    [0.0, 27, 41, 53, 0.92], // Elevated #1B2935
    [0.25, 86, 137, 199, 0.92], // Navigation Blue #5689C7
    [0.5, 85, 201, 154, 0.92], // Success Green #55C99A
    [0.75, 244, 184, 96, 0.92], // Warning Yellow #F4B860
    [1.0, 232, 240, 245, 0.95], // Primary Text #E8F0F5
  ],
  slope: [
    [0.0, 112, 169, 216, 0.08], // Information Blue #70A9D8, nearly clear
    [0.35, 112, 169, 216, 0.7],
    [0.7, 244, 184, 96, 0.9], // Warning Yellow #F4B860
    [1.0, 240, 113, 120, 1.0], // Critical Red #F07178
  ],
};

export function rampToCssGradient(ramp) {
  const stops = ramp.map(
    ([t, r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.35)}) ${Math.round(t * 100)}%`
  );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function sampleRamp(ramp, t, out) {
  if (t <= 0) {
    const s = ramp[0];
    out[0] = s[1]; out[1] = s[2]; out[2] = s[3]; out[3] = s[4];
    return;
  }
  for (let i = 1; i < ramp.length; i++) {
    const hi = ramp[i];
    if (t <= hi[0]) {
      const lo = ramp[i - 1];
      const k = (t - lo[0]) / (hi[0] - lo[0]);
      out[0] = lo[1] + (hi[1] - lo[1]) * k;
      out[1] = lo[2] + (hi[2] - lo[2]) * k;
      out[2] = lo[3] + (hi[3] - lo[3]) * k;
      out[3] = lo[4] + (hi[4] - lo[4]) * k;
      return;
    }
  }
  const s = ramp[ramp.length - 1];
  out[0] = s[1]; out[1] = s[2]; out[2] = s[3]; out[3] = s[4];
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

/** Extent covered by the sampled grid, derived from the affine transform. */
function sampledExtent(heightmap) {
  const [a, , c, , e, f] = heightmap.transform;
  const cols = heightmap.col_indices;
  const rows = heightmap.row_indices;

  const xFirst = a * (cols[0] + 0.5) + c;
  const xLast = a * (cols[cols.length - 1] + 0.5) + c;
  const yFirst = e * (rows[0] + 0.5) + f;
  const yLast = e * (rows[rows.length - 1] + 0.5) + f;

  const stepX = cols.length > 1 ? (xLast - xFirst) / (cols.length - 1) : a;
  const stepY = rows.length > 1 ? (yFirst - yLast) / (rows.length - 1) : -e;

  return {
    minX: Math.min(xFirst, xLast) - Math.abs(stepX) / 2,
    maxX: Math.max(xFirst, xLast) + Math.abs(stepX) / 2,
    minY: Math.min(yFirst, yLast) - Math.abs(stepY) / 2,
    maxY: Math.max(yFirst, yLast) + Math.abs(stepY) / 2,
  };
}

const FIELDS = {
  elevation: { key: "elevation_m", unitsKey: "elevation_units", lowPercentile: 2, highPercentile: 98 },
  slope: { key: "slope_deg", unitsKey: "slope_units", lowPercentile: null, highPercentile: 98 },
};

/**
 * @param {object} heightmap payload of GET /api/v1/terrain/heightmap
 * @param {"elevation"|"slope"} kind
 * @returns {{url, extent, min, max, displayMin, displayMax, units, width, height, sourceWidth, sourceHeight}|null}
 */
export function buildRasterOverlay(heightmap, kind) {
  const field = FIELDS[kind];
  const grid = heightmap?.[field.key];
  const mask = heightmap?.valid_mask;
  const width = heightmap?.width;
  const height = heightmap?.height;

  if (!Array.isArray(grid) || !Array.isArray(mask) || !width || !height) return null;
  if (!Array.isArray(heightmap.transform) || heightmap.transform.length < 6) return null;

  const values = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const value = grid[row]?.[col];
      if (mask[row]?.[col] && Number.isFinite(value)) values.push(value);
    }
  }
  if (!values.length) return null;

  const sorted = Float64Array.from(values).sort();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const displayMin = field.lowPercentile == null ? 0 : percentile(sorted, field.lowPercentile);
  let displayMax = percentile(sorted, field.highPercentile);
  if (!(displayMax > displayMin)) displayMax = max > displayMin ? max : displayMin + 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const image = context.createImageData(width, height);
  const ramp = RAMPS[kind];
  const rgba = [0, 0, 0, 0];
  const span = displayMax - displayMin;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const value = grid[row]?.[col];
      const offset = (row * width + col) * 4;
      if (!mask[row]?.[col] || !Number.isFinite(value)) {
        image.data[offset + 3] = 0; // no-data stays transparent
        continue;
      }
      const t = Math.min(1, Math.max(0, (value - displayMin) / span));
      sampleRamp(ramp, t, rgba);
      image.data[offset] = rgba[0];
      image.data[offset + 1] = rgba[1];
      image.data[offset + 2] = rgba[2];
      image.data[offset + 3] = Math.round(rgba[3] * 255);
    }
  }
  context.putImageData(image, 0, 0);

  return {
    url: canvas.toDataURL("image/png"),
    extent: sampledExtent(heightmap),
    min,
    max,
    displayMin,
    displayMax,
    units: typeof heightmap[field.unitsKey] === "string" ? heightmap[field.unitsKey] : null,
    width,
    height,
    sourceWidth: heightmap.source_width ?? null,
    sourceHeight: heightmap.source_height ?? null,
  };
}
