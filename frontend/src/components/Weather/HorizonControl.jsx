import { useEffect, useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { HORIZON_PRESETS, fmtSolHour, presetFor } from "../../utils/weather";
import { MAX_HORIZON_HOURS } from "../../api/weather";

/**
 * Forecast range: quick presets plus a custom "from / to" range in hours
 * counted from now (the mission clock), up to 7 sols ahead.
 */
function HorizonControl({ start, end, hours = null, onChange, compact = false }) {
  const [custom, setCustom] = useState(() => presetFor(start, end) === null);
  const [draft, setDraft] = useState({ start, end });
  const id = useId();

  useEffect(() => setDraft({ start, end }), [start, end]);

  // Commit slider moves after a short pause so dragging does not flood the service.
  useEffect(() => {
    if (draft.start === start && draft.end === end) return undefined;
    const timer = setTimeout(() => onChange(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, start, end, onChange]);

  const active = presetFor(start, end);

  // The range actually forecast (it can be shorter than asked when it runs into the end of the 7-sol reach).
  const settled = draft.start === start && draft.end === end;
  const rangeLabel =
    settled && hours?.length
      ? `${fmtSolHour(hours[0])} → ${fmtSolHour(hours[hours.length - 1])} (${hours.length} h${hours.length < end - start ? ", end of the forecast reach" : ""})`
      : `now +${draft.start} h → now +${draft.end} h`;

  return (
    <div className={`mw-horizon ${compact ? "mw-horizon--compact" : ""}`} data-tour="weather-horizon">
      <div className="mw-horizon__presets" role="radiogroup" aria-label="Forecast range">
        {HORIZON_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={active === preset.id && !custom}
            className="mw-chip"
            onClick={() => {
              setCustom(false);
              onChange({ start: preset.start, end: preset.end });
            }}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom || active === null} className="mw-chip" onClick={() => setCustom(true)}>
          <SlidersHorizontal size={13} aria-hidden="true" />
          Custom
        </button>
      </div>

      {(custom || active === null) && (
        <div className="mw-horizon__custom">
          <label htmlFor={`${id}-from`} className="mw-horizon__label">
            <span>From</span>
            <span className="mw-mono">+{draft.start} h</span>
          </label>
          <input
            id={`${id}-from`}
            type="range"
            className="mw-range"
            min={0}
            max={MAX_HORIZON_HOURS - 1}
            value={draft.start}
            onChange={(event) => {
              const value = Number(event.target.value);
              setDraft((current) => ({ start: Math.min(value, current.end - 1), end: current.end }));
            }}
          />
          <label htmlFor={`${id}-to`} className="mw-horizon__label">
            <span>To</span>
            <span className="mw-mono">+{draft.end} h</span>
          </label>
          <input
            id={`${id}-to`}
            type="range"
            className="mw-range"
            min={1}
            max={MAX_HORIZON_HOURS}
            value={draft.end}
            onChange={(event) => {
              const value = Number(event.target.value);
              setDraft((current) => ({ start: current.start, end: Math.max(value, current.start + 1) }));
            }}
          />
        </div>
      )}
      <p className="mw-horizon__range mw-mono">{rangeLabel}</p>
    </div>
  );
}

export default HorizonControl;
