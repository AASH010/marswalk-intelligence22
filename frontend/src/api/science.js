import { API_BASE, ApiError, requestJson } from "./client";

/**
 * Science targets — GET /api/v1/science/targets
 *
 * Verified contract (backend/app/api/science.py, backend/app/schemas/science.py):
 *   200  GeoJSON FeatureCollection of Point features with properties
 *        id, name, target_type, source, science_value, ranking_method,
 *        evidence[{ parameter, value_dn, threshold_dn, relative_percentile, passed_threshold }]
 *   503  { detail: "CRISM science data is unavailable." }
 *
 * `science_value` is the mean relative percentile of D2300 and BD1900_2 among
 * detected candidates. It is a relative ranking, not a mineral confidence.
 *
 * There is no mock fallback: when the service is unavailable the interface
 * shows an unavailable state instead of invented targets.
 */

/** Static CRISM overlay served by the backend (scripts/build_crism_overlay.py). */
export const CRISM_OVERLAY_URL = `${API_BASE}/science/crism/crism_dual_band_overlay.png`;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normaliseEvidence(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      parameter: typeof item.parameter === "string" ? item.parameter : null,
      value_dn: isFiniteNumber(item.value_dn) ? item.value_dn : null,
      threshold_dn: isFiniteNumber(item.threshold_dn) ? item.threshold_dn : null,
      relative_percentile: isFiniteNumber(item.relative_percentile) ? item.relative_percentile : null,
      passed_threshold: typeof item.passed_threshold === "boolean" ? item.passed_threshold : null,
    }));
}

export async function getScienceTargets({ signal } = {}) {
  const data = await requestJson("/api/v1/science/targets", { signal, timeoutMs: 60000 });

  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new ApiError("contract", "Science target response is not a GeoJSON FeatureCollection.");
  }

  const targets = [];
  const seen = new Set();
  let skipped = 0;

  for (const feature of data.features) {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    const id = properties?.id;
    const valid =
      feature?.geometry?.type === "Point" &&
      Array.isArray(coordinates) &&
      isFiniteNumber(coordinates[0]) &&
      isFiniteNumber(coordinates[1]) &&
      typeof id === "string" &&
      id !== "" &&
      !seen.has(id);

    if (!valid) {
      skipped += 1;
      continue;
    }
    seen.add(id);

    targets.push({
      id,
      name: typeof properties.name === "string" ? properties.name : null,
      target_type: typeof properties.target_type === "string" ? properties.target_type : null,
      source: typeof properties.source === "string" ? properties.source : null,
      science_value: isFiniteNumber(properties.science_value) ? properties.science_value : null,
      ranking_method: typeof properties.ranking_method === "string" ? properties.ranking_method : null,
      evidence: normaliseEvidence(properties.evidence),
      x: coordinates[0],
      y: coordinates[1],
    });
  }

  if (skipped > 0) {
    console.warn(`[science] ${skipped} malformed or duplicate target record(s) were not rendered.`);
  }

  return targets;
}
