import { useState } from "react";

import { STATUS_META, fmtHour, fmtK, fmtPct } from "../../utils/weather";

/**
 * One cell per forecast hour, coloured by EVA status, with sol boundaries,
 * the recommended departure bracketed, and a tooltip with the reason.
 */
function StatusStrip({ hours, highlight = null, hoverOffset = null, onHover, compact = false, actual = false }) {
  const [localHover, setLocalHover] = useState(null);
  if (!hours?.length) return null;
  const hover = hoverOffset ?? localHover;
  const hovered = hover != null ? hours.find((h) => h.offset_hours === hover) : null;
  const setHover = (offset) => {
    setLocalHover(offset);
    onHover?.(offset);
  };
  const start = hours[0].offset_hours;
  const total = hours.length;

  return (
    <div className={`mw-strip ${compact ? "mw-strip--compact" : ""}`} onMouseLeave={() => setHover(null)}>
      <div className="mw-strip__labels" aria-hidden="true">
        {hours
          .filter((h) => h.hour === 0 || h.offset_hours === start)
          .map((h) => (
            <span key={h.offset_hours} style={{ left: `${((h.offset_hours - start) / total) * 100}%` }}>
              Sol {h.sol}
            </span>
          ))}
      </div>
      <div className="mw-strip__track" role="list" aria-label="EVA status by hour">
        {hours.map((h) => (
          <span
            key={h.offset_hours}
            role="listitem"
            aria-label={`Sol ${h.sol} ${fmtHour(h.hour)}: ${STATUS_META[h.status].label}, ${fmtPct(h.p_go)} confidence`}
            className={`mw-strip__cell mw-strip__cell--${h.status.toLowerCase()} ${h.hour === 0 && h.offset_hours !== start ? "is-sol-start" : ""} ${hover === h.offset_hours ? "is-hover" : ""}`}
            onMouseEnter={() => setHover(h.offset_hours)}
          />
        ))}
        {highlight && highlight.end > start && (
          <span
            className="mw-strip__window"
            style={{
              left: `${((Math.max(start, highlight.start) - start) / total) * 100}%`,
              width: `${((Math.min(start + total, highlight.end) - Math.max(start, highlight.start)) / total) * 100}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      {actual && (
        <div className="mw-strip__track mw-strip__track--actual" aria-label="Observed outcome by hour">
          {hours.map((h) => (
            <span
              key={h.offset_hours}
              className={`mw-strip__cell mw-strip__cell--${h.actual_status === "GO" ? "go" : h.actual_status ? "no_go" : "none"}`}
              onMouseEnter={() => setHover(h.offset_hours)}
            />
          ))}
        </div>
      )}
      <div className="mw-strip__readout" aria-live="polite">
        {hovered ? (
          <>
            <span className={`mw-strip__dot mw-strip__dot--${hovered.status.toLowerCase()}`} aria-hidden="true" />
            <strong>
              Sol {hovered.sol} · {fmtHour(hovered.hour)}
            </strong>
            <span>{STATUS_META[hovered.status].label}</span>
            <span className="mw-mono">{fmtPct(hovered.p_go)}</span>
            {!compact && <span className="mw-mono">air {fmtK(hovered.air.forecast, 0)} K · ground {fmtK(hovered.ground.forecast, 0)} K</span>}
            {hovered.actual_status && <span>observed {hovered.actual_status === "GO" ? "GO" : "not GO"}</span>}
          </>
        ) : (
          <span className="mw-strip__hint">Hover the timeline for the hourly status and reason.</span>
        )}
      </div>
      {hovered && !compact && <p className="mw-strip__reason">{hovered.reason}</p>}
    </div>
  );
}

export default StatusStrip;
