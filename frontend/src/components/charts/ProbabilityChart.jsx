import { useMemo } from "react";

import { AxisBottom, AxisLeft, ChartTooltip, Legend, hourTicks, linearScale, useElementWidth } from "./chartKit";
import { STATUS_META, fmtHour, fmtPct } from "../../utils/weather";

const MARGIN = { top: 22, right: 18, bottom: 38, left: 48 };
const STATUS_COLOR = { GO: "var(--mw-success)", CAUTION: "var(--mw-warning)", NO_GO: "var(--mw-critical)" };

/**
 * Hourly probability that the planning limits are met, coloured by the
 * resulting status, with the GO and Caution confidence thresholds.
 */
function ProbabilityChart({ hours, limits, height = 200, highlight = null, hoverOffset = null, onHover, title }) {
  const [ref, width] = useElementWidth(640);

  const model = useMemo(() => {
    if (!hours?.length) return null;
    const start = hours[0].offset_hours;
    const end = hours[hours.length - 1].offset_hours + 1;
    const x = linearScale([start, end], [MARGIN.left, width - MARGIN.right]);
    const y = linearScale([0, 1], [height - MARGIN.bottom, MARGIN.top]);
    return {
      start,
      end,
      x,
      y,
      slot: x(start + 1) - x(start),
      xTicks: hourTicks(start, end, width),
      sols: hours.filter((h) => h.hour === 0 && h.offset_hours > start).map((h) => ({ offset: h.offset_hours, sol: h.sol })),
    };
  }, [hours, width, height]);

  if (!model) return <div ref={ref} className="mw-chart mw-chart--empty" />;

  const hovered = hoverOffset != null ? hours.find((h) => h.offset_hours === hoverOffset) : null;
  const firstSol = hours[0].sol - Math.floor(hours[0].offset_hours / 24);
  const gap = model.slot > 6 ? 1.5 : model.slot > 3 ? 0.75 : 0;

  return (
    <figure className="mw-chart" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={width} height={height} role="img" aria-label="Hourly probability that the EVA limits are met">
        <AxisLeft scale={model.y} ticks={[0, 0.25, 0.5, 0.75, 1]} x={MARGIN.left} width={width - MARGIN.left - MARGIN.right} format={(v) => `${v * 100}%`} />
        <AxisBottom scale={model.x} ticks={model.xTicks} y={height - MARGIN.bottom} format={(t) => fmtHour(((t % 24) + 24) % 24)} />
        {model.sols.map((s) => (
          <g key={s.offset}>
            <line x1={model.x(s.offset)} x2={model.x(s.offset)} y1={MARGIN.top - 6} y2={height - MARGIN.bottom} className="mw-chart__sol-line" />
            <text x={model.x(s.offset) + 4} y={MARGIN.top - 8} className="mw-chart__sol-label">
              Sol {s.sol}
            </text>
          </g>
        ))}
        <text x={MARGIN.left + 4} y={MARGIN.top - 8} className="mw-chart__sol-label">
          Sol {firstSol + Math.floor(model.start / 24)}
        </text>
        {highlight && (
          <rect
            x={model.x(Math.max(model.start, highlight.start))}
            y={MARGIN.top}
            width={Math.max(0, model.x(Math.min(model.end, highlight.end)) - model.x(Math.max(model.start, highlight.start)))}
            height={height - MARGIN.top - MARGIN.bottom}
            className="mw-chart__highlight"
          />
        )}
        {hours.map((h) => {
          const p = Number.isFinite(h.p_go) ? h.p_go : 0;
          const top = model.y(Math.max(p, 0.012));
          return (
            <rect
              key={h.offset_hours}
              x={model.x(h.offset_hours) + gap / 2}
              y={top}
              width={Math.max(0.5, model.slot - gap)}
              height={Math.max(0, model.y(0) - top)}
              rx={model.slot > 8 ? 2 : 0}
              fill={STATUS_COLOR[h.status]}
              opacity={hoverOffset == null || hoverOffset === h.offset_hours ? 0.92 : 0.45}
            />
          );
        })}
        {limits && (
          <>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={model.y(limits.go_confidence)} y2={model.y(limits.go_confidence)} className="mw-chart__limit mw-chart__limit--go" />
            <text x={width - MARGIN.right - 4} y={model.y(limits.go_confidence) - 5} textAnchor="end" className="mw-chart__limit-label">
              GO ≥ {fmtPct(limits.go_confidence)}
            </text>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={model.y(limits.caution_confidence)} y2={model.y(limits.caution_confidence)} className="mw-chart__limit" />
            <text x={width - MARGIN.right - 4} y={model.y(limits.caution_confidence) - 5} textAnchor="end" className="mw-chart__limit-label">
              Caution ≥ {fmtPct(limits.caution_confidence)}
            </text>
          </>
        )}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(0, width - MARGIN.left - MARGIN.right)}
          height={height - MARGIN.top - MARGIN.bottom}
          fill="transparent"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const offset = Math.floor(model.x.invert(event.clientX - rect.left + MARGIN.left));
            onHover?.(Math.min(model.end - 1, Math.max(model.start, offset)));
          }}
          onMouseLeave={() => onHover?.(null)}
        />
      </svg>
      {hovered && (
        <ChartTooltip x={model.x(hovered.offset_hours + 0.5)} y={MARGIN.top + 4} containerWidth={width}>
          <strong>
            Sol {hovered.sol} · {fmtHour(hovered.hour)} LTST
          </strong>
          <dl>
            <dt>Status</dt>
            <dd className={`mw-tone--${STATUS_META[hovered.status].tone}`}>{STATUS_META[hovered.status].label}</dd>
            <dt>P(limits met)</dt>
            <dd>{fmtPct(hovered.p_go)}</dd>
            <dt>P(air ok)</dt>
            <dd>{fmtPct(hovered.p_air_ok)}</dd>
            <dt>P(ground ok)</dt>
            <dd>{fmtPct(hovered.p_ground_ok)}</dd>
            <dt>Sun elevation</dt>
            <dd>{hovered.solar_elevation_deg?.toFixed(0)}°</dd>
          </dl>
          <p>{hovered.reason}</p>
        </ChartTooltip>
      )}
      <Legend
        items={[
          { label: "GO", color: STATUS_COLOR.GO, kind: "box" },
          { label: "Caution", color: STATUS_COLOR.CAUTION, kind: "box" },
          { label: "No-Go", color: STATUS_COLOR.NO_GO, kind: "box" },
        ]}
      />
    </figure>
  );
}

export default ProbabilityChart;
