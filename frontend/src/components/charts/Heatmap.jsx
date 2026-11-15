import { useState } from "react";

import { STATUS_META, fmtHour, fmtK, fmtPct } from "../../utils/weather";

/**
 * Sol × hour grid of P(limits met). Night cells are hatched. Each cell's
 * text label carries the value so colour is never the only cue.
 */
function Heatmap({ hours, onSelect, selected }) {
  const [hover, setHover] = useState(null);
  if (!hours?.length) return null;
  const sols = [...new Set(hours.map((h) => h.sol))];
  const bySolHour = new Map(hours.map((h) => [`${h.sol}-${h.hour}`, h]));
  const hovered = hover ? bySolHour.get(hover) : null;

  return (
    <div className="mw-heatmap" onMouseLeave={() => setHover(null)}>
      <div className="mw-heatmap__grid" style={{ gridTemplateColumns: `64px repeat(24, minmax(0, 1fr))` }} role="table" aria-label="Probability that limits are met, by sol and hour">
        <span className="mw-heatmap__corner" role="columnheader">
          LTST
        </span>
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="mw-heatmap__col" role="columnheader">
            {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
          </span>
        ))}
        {sols.map((sol) => (
          <div key={sol} className="mw-heatmap__row" role="row" style={{ display: "contents" }}>
            <span className="mw-heatmap__rowhead" role="rowheader">
              Sol {sol}
            </span>
            {Array.from({ length: 24 }, (_, hour) => {
              const h = bySolHour.get(`${sol}-${hour}`);
              if (!h) return <span key={hour} className="mw-heatmap__cell mw-heatmap__cell--empty" role="cell" />;
              const p = Number.isFinite(h.p_go) ? h.p_go : 0;
              const key = `${sol}-${hour}`;
              return (
                <button
                  type="button"
                  key={hour}
                  role="cell"
                  className={`mw-heatmap__cell ${h.daylight ? "" : "is-night"} ${selected === h.offset_hours ? "is-selected" : ""} mw-heatmap__cell--${h.status.toLowerCase()}`}
                  style={h.daylight ? { "--p": p } : undefined}
                  aria-label={`Sol ${sol} ${fmtHour(hour)}: ${h.daylight ? fmtPct(p) : "night"}`}
                  onMouseEnter={() => setHover(key)}
                  onFocus={() => setHover(key)}
                  onClick={() => onSelect?.(h.offset_hours)}
                >
                  {h.daylight && p >= 0.995 ? "" : h.daylight ? Math.round(p * 100) : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mw-heatmap__foot">
        <div className="mw-heatmap__scale" aria-hidden="true">
          <span>0%</span>
          <span className="mw-heatmap__ramp" />
          <span>100%</span>
          <span className="mw-heatmap__night-key" />
          <span>Night</span>
        </div>
        <div className="mw-heatmap__readout" aria-live="polite">
          {hovered ? (
            <>
              <strong>
                Sol {hovered.sol} · {fmtHour(hovered.hour)}
              </strong>{" "}
              {STATUS_META[hovered.status].label} · {fmtPct(hovered.p_go)} · air {fmtK(hovered.air.forecast, 0)} K · ground{" "}
              {fmtK(hovered.ground.forecast, 0)} K
            </>
          ) : (
            "Cells show the probability (%) that both temperature limits are met. Blank daylight cells are ≥ 99.5%."
          )}
        </div>
      </div>
    </div>
  );
}

export default Heatmap;
