/** Formatting and presentation helpers for the weather features. */

export const KELVIN_OFFSET = 273.15;

export const STATUS_META = {
  GO: { label: "GO", tone: "success", description: "Conditions met with high confidence" },
  CAUTION: { label: "Caution", tone: "warning", description: "Conditions likely met, but the uncertainty crosses a limit" },
  NO_GO: { label: "No-Go", tone: "critical", description: "Night, or conditions unlikely to be met" },
};

export const HORIZON_PRESETS = [
  { id: "24", label: "24 h", start: 0, end: 24 },
  { id: "48", label: "48 h", start: 0, end: 48 },
  { id: "72", label: "3 sols", start: 0, end: 72 },
  { id: "168", label: "7 sols", start: 0, end: 168 },
];

export function toCelsius(kelvin) {
  return typeof kelvin === "number" && Number.isFinite(kelvin) ? kelvin - KELVIN_OFFSET : null;
}

export function fmtK(value, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function fmtC(kelvin, digits = 0) {
  const c = toCelsius(kelvin);
  return c == null ? "—" : `${c > 0 ? "+" : ""}${c.toFixed(digits)}`;
}

export function fmtPct(p, digits = 0) {
  return typeof p === "number" && Number.isFinite(p) ? `${(p * 100).toFixed(digits)}%` : "—";
}

export function fmtHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "Sol 701 · 09:00" */
export function fmtSolHour(point) {
  if (!point) return "—";
  return `Sol ${point.sol} · ${fmtHour(point.hour)}`;
}

/** "Sol 701 · 10:00 → 14:00", or with both sols when the range crosses midnight. */
export function fmtSolRange(start, end) {
  if (!start || !end) return "—";
  if (start.sol === end.sol || (end.hour === 0 && end.sol === start.sol + 1)) {
    return `Sol ${start.sol} · ${fmtHour(start.hour)} → ${end.hour === 0 ? "24:00" : fmtHour(end.hour)}`;
  }
  return `${fmtSolHour(start)} → ${fmtSolHour(end)}`;
}

/** Decimal LTST hours to hh:mm. */
export function fmtLtst(hours) {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return "—";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function presetFor(start, end) {
  return HORIZON_PRESETS.find((preset) => preset.start === start && preset.end === end)?.id ?? null;
}

/** Hour-level summary used by both the inspector and the dashboard. */
export function summarizeHours(hours = []) {
  const counts = { GO: 0, CAUTION: 0, NO_GO: 0 };
  let airMin = Infinity;
  let airMax = -Infinity;
  let groundMax = -Infinity;
  for (const hour of hours) {
    counts[hour.status] = (counts[hour.status] || 0) + 1;
    const a = hour.air?.forecast;
    const g = hour.ground?.forecast;
    if (Number.isFinite(a)) {
      airMin = Math.min(airMin, a);
      airMax = Math.max(airMax, a);
    }
    if (Number.isFinite(g)) groundMax = Math.max(groundMax, g);
  }
  const daylight = hours.filter((h) => h.daylight);
  const meanConfidence = daylight.length ? daylight.reduce((sum, h) => sum + (h.p_go || 0), 0) / daylight.length : null;
  return {
    counts,
    airMin: Number.isFinite(airMin) ? airMin : null,
    airMax: Number.isFinite(airMax) ? airMax : null,
    groundMax: Number.isFinite(groundMax) ? groundMax : null,
    meanConfidence,
  };
}

export const LIMIT_FIELDS = [
  { key: "air_min_k", label: "Min. air temperature", unit: "K", step: 1, min: 150, max: 300 },
  { key: "ground_min_k", label: "Min. ground temperature", unit: "K", step: 1, min: 150, max: 320 },
  { key: "go_confidence", label: "Confidence for GO", unit: "", step: 0.05, min: 0.5, max: 0.99, percent: true },
  { key: "caution_confidence", label: "Confidence for Caution", unit: "", step: 0.05, min: 0.1, max: 0.95, percent: true },
];
