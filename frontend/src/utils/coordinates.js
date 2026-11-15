import { MARS_MAP } from "./mapConfig";

/**
 * Routing extent. The route service only accepts points that fall on the
 * 500 × 500 terrain raster, which is the operational AOI.
 */
export const ROUTING_EXTENT = MARS_MAP.bounds;

/** Decimal places kept for committed coordinates (centimetres). */
export const COORDINATE_DECIMALS = 2;

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function roundCoordinate(value) {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(COORDINATE_DECIMALS) : "—";
}

/**
 * Parse one draft coordinate field.
 * Returns { ok: true, value } or { ok: false, code } where code is
 * "required" or "format". Nothing is coerced or clamped.
 */
export function parseCoordinate(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: false, code: "required" };
  if (!NUMBER_PATTERN.test(text)) return { ok: false, code: "format" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, code: "format" };
  return { ok: true, value };
}

/**
 * Check a point against the routing extent.
 * The raster covers minX <= x < maxX and minY < y <= maxY (cell-aligned),
 * matching how the backend maps coordinates to grid cells.
 */
export function validatePointExtent(point, extent = ROUTING_EXTENT) {
  const xInside = point.x >= extent.minX && point.x < extent.maxX;
  const yInside = point.y > extent.minY && point.y <= extent.maxY;
  return { ok: xInside && yInside, xInside, yInside };
}

export function isValidPoint(point) {
  return (
    Boolean(point) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    validatePointExtent(point).ok
  );
}

export function describeExtent(extent = ROUTING_EXTENT) {
  return {
    x: `${extent.minX} to ${extent.maxX}`,
    y: `${extent.minY} to ${extent.maxY}`,
  };
}
