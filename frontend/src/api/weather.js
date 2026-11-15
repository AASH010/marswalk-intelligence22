import { ApiError, requestJson } from "./client";

/**
 * Surface weather and EVA windows — /api/v1/weather/*
 *
 * Contract (backend/app/api/weather.py, backend/app/schemas/weather.py):
 *   GET /status     model availability, issue-sol range, default planning limits
 *   GET /current    observed conditions for one sol (optionally only up to an LTST hour)
 *   GET /forecast   hourly air / ground forecast with uncertainty bands, P(GO),
 *                   status, GO windows and the best departure for route_hours
 *   GET /report     out-of-sample evaluation shown in the forecast dashboard
 *
 * Temperatures are in kelvin. Hours are local true solar time (LTST).
 */

export const MAX_HORIZON_HOURS = 168;

function isObject(value) {
  return value && typeof value === "object";
}

export async function getWeatherStatus({ signal } = {}) {
  const data = await requestJson("/api/v1/weather/status", { signal, timeoutMs: 15000 });
  if (!isObject(data) || typeof data.available !== "boolean") {
    throw new ApiError("contract", "Weather status response is malformed.");
  }
  return data;
}

export async function getCurrentWeather(sol, { hour = null, signal } = {}) {
  const params = new URLSearchParams();
  if (sol != null) params.set("sol", String(sol));
  if (hour != null) params.set("hour", String(hour));
  const query = params.size ? `?${params}` : "";
  const data = await requestJson(`/api/v1/weather/current${query}`, { signal, timeoutMs: 20000 });
  if (!isObject(data) || !Number.isInteger(data.sol) || !Array.isArray(data.series)) {
    throw new ApiError("contract", "Current conditions response is malformed.");
  }
  return data;
}

/**
 * @param {{issueSol?: number|null, startHour: number, endHour: number, routeHours?: number|null, limits?: object}} params
 */
export async function getForecast({ issueSol = null, startHour = 0, endHour = 48, routeHours = null, limits = {} }, { signal } = {}) {
  const query = new URLSearchParams({ start_hour: String(startHour), end_hour: String(endHour) });
  if (issueSol != null) query.set("issue_sol", String(issueSol));
  if (routeHours != null && Number.isFinite(routeHours) && routeHours > 0) query.set("route_hours", routeHours.toFixed(2));
  for (const [key, value] of Object.entries(limits || {})) {
    if (value != null && Number.isFinite(value)) query.set(key, String(value));
  }
  const data = await requestJson(`/api/v1/weather/forecast?${query}`, { signal, timeoutMs: 30000 });
  if (!isObject(data) || !Array.isArray(data.hours) || !Array.isArray(data.windows)) {
    throw new ApiError("contract", "Forecast response is malformed.");
  }
  return data;
}

export async function getWeatherReport({ signal } = {}) {
  const data = await requestJson("/api/v1/weather/report", { signal, timeoutMs: 30000 });
  if (!isObject(data?.report) || !isObject(data.report.metrics)) {
    throw new ApiError("contract", "Evaluation report is malformed.");
  }
  return data.report;
}
