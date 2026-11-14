import { ApiError, requestJson } from "./client";
import { MARS_MAP } from "../utils/mapConfig";

/**
 * Route planning — POST /api/v1/navigate
 *
 * Verified contract (backend/app/api/route.py, backend/app/schemas/route.py):
 *   request   { start: [x, y], goal: [x, y], mode }
 *   200       GeoJSON FeatureCollection, one LineString feature, properties:
 *             mode, distance_km, raw_terrain_cost, average_raw_terrain_cost,
 *             optimization_cost, average_optimization_cost
 *   400       { detail } — point outside the terrain raster, or on a blocked cell
 *   404       { detail: "No valid route found." }
 *   422       request validation error
 * The call is synchronous: the response is the finished route.
 */

/**
 * Strategy identifiers accepted by the backend (`mode` literal in
 * backend/app/schemas/route.py). `terrainWeight` mirrors
 * backend/app/core/routing/route_modes.py and is shown as-is; the interface
 * does not describe the strategies beyond what the backend defines.
 */
export const ROUTE_STRATEGIES = [
  { id: "fastest", label: "Fastest", terrainWeight: 0.2 },
  { id: "balanced", label: "Balanced", terrainWeight: 1.0 },
  { id: "conservative", label: "Conservative", terrainWeight: 2.0 },
];

export const DEFAULT_STRATEGY_ID = "balanced";

export function isSupportedStrategy(id) {
  return ROUTE_STRATEGIES.some((strategy) => strategy.id === id);
}

export const ROUTE_METRIC_KEYS = [
  "distance_km",
  "raw_terrain_cost",
  "average_raw_terrain_cost",
  "optimization_cost",
  "average_optimization_cost",
];

/**
 * kind:
 *   no_route         backend searched and found no valid route
 *   outside_extent   a point is outside the terrain raster   (point: "start" | "goal")
 *   not_traversable  a point sits on a blocked / no-data cell (point: "start" | "goal")
 *   validation       backend rejected the request for another reason
 *   unavailable      service could not be reached or failed
 *   contract         response did not match the documented schema
 *   aborted          cancelled by the user
 */
export class RouteError extends Error {
  constructor(kind, message, { point = null, detail = null, cause = null } = {}) {
    super(message);
    this.name = "RouteError";
    this.kind = kind;
    this.point = point;
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

const EXTENT_TOLERANCE_M = MARS_MAP.grid.resolution;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate the response before anything is rendered (handoff §15.3).
 * Geometry must be a LineString of finite [x, y] pairs inside the routing
 * extent. Metrics are optional: a missing or non-numeric metric becomes null
 * and is shown as "Not provided". It is never estimated.
 */
export function validateRouteResponse(data) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new RouteError("contract", "Route response is not a GeoJSON FeatureCollection.");
  }
  const feature = data.features[0];
  if (!feature || feature.type !== "Feature") {
    throw new RouteError("contract", "Route response contains no route feature.");
  }
  const geometry = feature.geometry;
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new RouteError("contract", "Route geometry is missing or is not a LineString.");
  }

  const { minX, maxX, minY, maxY } = MARS_MAP.bounds;
  const coordinates = geometry.coordinates.map((pair) => {
    const x = Array.isArray(pair) ? pair[0] : NaN;
    const y = Array.isArray(pair) ? pair[1] : NaN;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      throw new RouteError("contract", "Route geometry contains a non-finite coordinate.");
    }
    if (
      x < minX - EXTENT_TOLERANCE_M ||
      x > maxX + EXTENT_TOLERANCE_M ||
      y < minY - EXTENT_TOLERANCE_M ||
      y > maxY + EXTENT_TOLERANCE_M
    ) {
      throw new RouteError("contract", "Route geometry lies outside the supported map extent.");
    }
    return [x, y];
  });

  const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const metrics = Object.fromEntries(
    ROUTE_METRIC_KEYS.map((key) => [key, isFiniteNumber(properties[key]) ? properties[key] : null])
  );

  return {
    mode: typeof properties.mode === "string" ? properties.mode : null,
    coordinates,
    metrics,
    geojson: data,
  };
}

function toRouteError(error) {
  if (error instanceof RouteError) return error;
  if (!(error instanceof ApiError)) {
    return new RouteError("contract", "The route response could not be processed.", { cause: error });
  }

  const detail = error.detail || "";

  if (error.kind === "aborted") return new RouteError("aborted", "Route calculation cancelled.", { cause: error });

  if (error.kind === "not_found" && /no valid route/i.test(detail)) {
    return new RouteError("no_route", detail, { detail, cause: error });
  }

  if (error.kind === "validation") {
    const outside = /^(start|goal)\b.*outside/i.exec(detail);
    if (outside) {
      return new RouteError("outside_extent", detail, { point: outside[1].toLowerCase(), detail, cause: error });
    }
    const blocked = /^(start|goal)\b.*not traversable/i.exec(detail);
    if (blocked) {
      return new RouteError("not_traversable", detail, { point: blocked[1].toLowerCase(), detail, cause: error });
    }
    return new RouteError("validation", detail || "The route request was rejected.", { detail, cause: error });
  }

  if (error.kind === "contract") {
    return new RouteError("contract", error.message, { cause: error });
  }

  return new RouteError("unavailable", error.message, { detail, cause: error });
}

/**
 * @param {{start: {x, y}, goal: {x, y}, strategyId: string}} snapshot
 * @param {{signal?: AbortSignal}} options
 */
export async function planRoute(snapshot, { signal } = {}) {
  try {
    const data = await requestJson("/api/v1/navigate", {
      method: "POST",
      body: {
        start: [snapshot.start.x, snapshot.start.y],
        goal: [snapshot.goal.x, snapshot.goal.y],
        mode: snapshot.strategyId,
      },
      signal,
      timeoutMs: 120000,
    });
    return validateRouteResponse(data);
  } catch (error) {
    const routeError = toRouteError(error);
    if (routeError.kind === "contract" || routeError.kind === "unavailable") {
      console.error("[route] request failed:", error);
    }
    throw routeError;
  }
}
