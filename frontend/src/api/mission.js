import { ApiError, requestJson } from "./client";

/**
 * EVA consumables — POST /api/v1/mission/consumables
 *
 * Verified contract (backend/app/schemas/mission.py):
 *   request   distance_km (> 0), average_raw_terrain_cost (>= 0),
 *             average_slope_percent, payload_kg (>= 0)
 *   200       estimated_duration_hours, estimated_oxygen_liters,
 *             oxygen_percent_of_suit_capacity, average_metabolic_rate_kcal_hr,
 *             slope_penalty_kcal_hr, payload_penalty_kcal_hr,
 *             safety_margin_hours, assumptions{...}
 *
 * All values are computed by the backend model. The frontend only sends the
 * route metrics it received plus the user's two planning assumptions.
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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

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
