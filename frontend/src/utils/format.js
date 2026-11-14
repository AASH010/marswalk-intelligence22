/** Formatting helpers. They never invent a value: a missing input yields null. */

export function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatFixed(value, digits = 2) {
  return isNumber(value) ? value.toFixed(digits) : null;
}

export function formatInteger(value) {
  return isNumber(value) ? Math.round(value).toLocaleString("en-US") : null;
}

/**
 * Metres rendered at a readable scale: below one kilometre the value is kept
 * in metres rather than rounded to "0.00 km".
 */
export function formatDistanceM(meters) {
  if (!isNumber(meters)) return null;
  if (meters < 1000) return { value: meters < 10 ? meters.toFixed(1) : String(Math.round(meters)), unit: "m" };
  return { value: (meters / 1000).toFixed(2), unit: "km" };
}

export function formatTime(timestamp) {
  if (!isNumber(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRequestId(id) {
  return isNumber(id) ? `REQ-${String(id).padStart(4, "0")}` : null;
}
