import { ApiError, requestJson } from "./client";

/**
 * EVA estimate — POST /api/v1/mission/eva-estimate
 *
 * Verified contract (backend/app/schemas/mission.py, EvaEstimateRequest /
 * EvaEstimateResponse):
 *   request   start [x, y], goal [x, y], mode, sol?, start_time? (LMST
 *             "HH:MM[:SS]"), payload_kg, base_walking_speed_ms?,
 *             suit_capacity_hours?
 *             Unknown fields are rejected (400): the server builds the route
 *             profile itself, so no distance, slope or terrain cost is sent.
 *   200       route, weather_status, confidence, weather, cost_model,
 *             route_profile_summary, totals{...}, segments[...],
 *             parameters[...], model{...}, warnings[...]
 *             Every numeric value is { value, unit, tag } with tag one of
 *             measured / calculated / modeled / assumed.
 *   400 invalid input, 404 no route, 422 weather required but unavailable,
 *   503 DEM unavailable.
 */

export const EVA_TOTAL_KEYS = [
  "duration_hours",
  "energy_kcal",
  "oxygen_liters",
  "average_metabolic_rate_kcal_hr",
  "reported_metabolic_rate_kcal_hr",
  "suit_time_fraction_percent",
  "suit_time_margin_hours",
  "weather_energy_kcal",
];

const VALUE_TAGS = new Set(["measured", "calculated", "modeled", "assumed"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function readTagged(entry) {
  if (!entry || typeof entry !== "object" || !VALUE_TAGS.has(entry.tag)) return null;
  return {
    value: isFiniteNumber(entry.value) ? entry.value : null,
    unit: typeof entry.unit === "string" ? entry.unit : "",
    tag: entry.tag,
  };
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(isFiniteNumber);
}

export async function estimateEva(
  { start, goal, mode, sol, startTime, payloadKg, baseWalkingSpeedMs, suitCapacityHours },
  { signal } = {}
) {
  if (!isPoint(start) || !isPoint(goal)) {
    throw new ApiError("validation", "Start and goal must be [x, y] map coordinates.");
  }

  const body = { start, goal, mode, payload_kg: payloadKg ?? 0 };
  if (sol != null) body.sol = sol;
  if (startTime) body.start_time = startTime;
  if (baseWalkingSpeedMs != null) body.base_walking_speed_ms = baseWalkingSpeedMs;
  if (suitCapacityHours != null) body.suit_capacity_hours = suitCapacityHours;

  // The server plans the route again (A*), so allow the same time as /navigate.
  const data = await requestJson("/api/v1/mission/eva-estimate", { method: "POST", body, signal, timeoutMs: 120000 });

  if (!data || typeof data !== "object" || !data.totals || typeof data.totals !== "object") {
    throw new ApiError("contract", "EVA estimate response is not in the documented shape.");
  }

  const totals = Object.fromEntries(EVA_TOTAL_KEYS.map((key) => [key, readTagged(data.totals[key])]));
  if (EVA_TOTAL_KEYS.every((key) => totals[key] === null || totals[key].value === null)) {
    throw new ApiError("contract", "EVA estimate response contains no supported values.");
  }

  return {
    totals: { ...totals, metabolic_rate_clamped: data.totals.metabolic_rate_clamped === true },
    weatherStatus: typeof data.weather_status === "string" ? data.weather_status : null,
    confidence: typeof data.confidence === "string" ? data.confidence : null,
    weather: data.weather && typeof data.weather === "object" ? data.weather : null,
    profileSummary: data.route_profile_summary && typeof data.route_profile_summary === "object" ? data.route_profile_summary : null,
    segments: Array.isArray(data.segments) ? data.segments : [],
    parameters: Array.isArray(data.parameters) ? data.parameters : [],
    model: data.model && typeof data.model === "object" ? data.model : null,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((item) => typeof item === "string") : [],
  };
}

/**
 * DEPRECATED — POST /api/v1/mission/consumables
 *
 * No longer used by the interface (the EVA panel calls estimateEva()). Kept
 * for other clients only. It trusts client-side route metrics and a
 * user-entered slope, and its oxygen_percent_of_suit_capacity is a share of
 * suit TIME (named suit_time_fraction_percent in the new endpoint).
 */
export const CONSUMABLE_VALUE_KEYS = [
  "estimated_duration_hours",
  "estimated_oxygen_liters",
  "oxygen_percent_of_suit_capacity",
  "average_metabolic_rate_kcal_hr",
  "slope_penalty_kcal_hr",
  "payload_penalty_kcal_hr",
  "safety_margin_hours",
];

export async function estimateConsumables(
  { distanceKm, averageRawTerrainCost, averageSlopePercent, payloadKg },
  { signal } = {}
) {
  const data = await requestJson("/api/v1/mission/consumables", {
    method: "POST",
    body: {
      distance_km: distanceKm,
      average_raw_terrain_cost: averageRawTerrainCost,
      average_slope_percent: averageSlopePercent,
      payload_kg: payloadKg,
    },
    signal,
  });

  if (!data || typeof data !== "object") {
    throw new ApiError("contract", "Consumables response is not an object.");
  }

  const values = Object.fromEntries(
    CONSUMABLE_VALUE_KEYS.map((key) => [key, isFiniteNumber(data[key]) ? data[key] : null])
  );

  if (CONSUMABLE_VALUE_KEYS.every((key) => values[key] === null)) {
    throw new ApiError("contract", "Consumables response contains no supported values.");
  }

  return {
    ...values,
    assumptions: data.assumptions && typeof data.assumptions === "object" ? data.assumptions : null,
  };
}
