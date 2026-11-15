import { useMemo } from "react";

import { AxisBottom, AxisLeft, ChartTooltip, Legend, hourTicks, bandPath, linePath, linearScale, niceExtent, niceTicks, useElementWidth } from "./chartKit";
import { fmtC, fmtHour, fmtK, fmtPct } from "../../utils/weather";

const MARGIN = { top: 22, right: 18, bottom: 38, left: 48 };

/**
 * Forecast fan chart for one variable: point forecast, 50 / 80 / 90 % bands
 * from out-of-sample errors, the baseline, observations (replay) and planning
 * limits. Night hours are shaded; sol boundaries are labelled.
 */
function FanChart({
  hours,
  variable = "air",
  title,
  height = 260,
  limit = null,
  showBaseline = true,
  highlight = null,
  hoverOffset = null,
  onHover,
}) {
  const [ref, width] = useElementWidth(640);
  const color = variable === "air" ? "var(--mw-cyan)" : "var(--mw-violet)";

  const model = useMemo(() => {
    if (!hours?.length) return null;
    const start = hours[0].offset_hours;
    const end = hours[hours.length - 1].offset_hours + 1;
    const values = hours.flatMap((h) => [h[variable].q05, h[variable].q95, h[variable].actual, showBaseline ? h[variable].baseline : null]);
    const [y0, y1] = niceExtent(values, { include: limit ? [limit.value] : [] });
    const x = linearScale([start, end], [MARGIN.left, width - MARGIN.right]);
    const y = linearScale([y0, y1], [height - MARGIN.bottom, MARGIN.top]);
    const at = (h, key) => [x(h.offset_hours + 0.5), y(h[variable][key])];
    return {
      start,
      end,
      x,
      y,
      yTicks: niceTicks(y0, y1, 5),
      xTicks: hourTicks(start, end, width),
      band90: bandPath(hours.map((h) => [x(h.offset_hours + 0.5), y(h[variable].q05), y(h[variable].q95)])),
      band80: bandPath(hours.map((h) => [x(h.offset_hours + 0.5), y(h[variable].q10), y(h[variable].q90)])),
      band50: bandPath(hours.map((h) => [x(h.offset_hours + 0.5), y(h[variable].q25), y(h[variable].q75)])),
      forecast: linePath(hours.map((h) => at(h, "forecast"))),
      baseline: showBaseline ? linePath(hours.map((h) => at(h, "baseline"))) : "",
      actual: hours.filter((h) => Number.isFinite(h[variable].actual)).map((h) => at(h, "actual")),
      nights: hours.filter((h) => !h.daylight).map((h) => h.offset_hours),
      sols: hours.filter((h) => h.hour === 0 && h.offset_hours > start).map((h) => ({ offset: h.offset_hours, sol: h.sol })),
    };
  }, [hours, variable, width, height, limit, showBaseline]);

  if (!model) return <div ref={ref} className="mw-chart mw-chart--empty" />;

  const hovered = hoverOffset != null ? hours.find((h) => h.offset_hours === hoverOffset) : null;
  const handleMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.floor(model.x.invert(event.clientX - rect.left + MARGIN.left));
    onHover?.(Math.min(model.end - 1, Math.max(model.start, offset)));
  };
  const firstSol = hours[0].sol - Math.floor(hours[0].offset_hours / 24);
  const hourAt = (offset) => ({ sol: firstSol + Math.floor(offset / 24), hour: ((offset % 24) + 24) % 24 });
  const slot = Math.max(1, model.x(model.start + 1) - model.x(model.start));

  return (
    <figure className="mw-chart" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={width} height={height} role="img" aria-label={`${title || variable} forecast with uncertainty bands`}>
        {model.nights.map((offset) => (
          <rect key={offset} x={model.x(offset)} y={MARGIN.top} width={slot + 0.5} height={height - MARGIN.top - MARGIN.bottom} className="mw-chart__night" />
        ))}
        <AxisLeft scale={model.y} ticks={model.yTicks} x={MARGIN.left} width={width - MARGIN.left - MARGIN.right} format={(v) => v.toFixed(0)} label="K" />
        <AxisBottom
          scale={model.x}
          ticks={model.xTicks}
          y={height - MARGIN.bottom}
          format={(t) => fmtHour(hourAt(t).hour)}
        />
        {model.sols.map((s) => (
          <g key={s.offset}>
            <line x1={model.x(s.offset)} x2={model.x(s.offset)} y1={MARGIN.top - 6} y2={height - MARGIN.bottom} className="mw-chart__sol-line" />
            <text x={model.x(s.offset) + 4} y={MARGIN.top - 8} className="mw-chart__sol-label">
              Sol {s.sol}
            </text>
          </g>
        ))}
        <text x={MARGIN.left + 4} y={MARGIN.top - 8} className="mw-chart__sol-label">
          Sol {hours[0].sol}
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
        <path d={model.band90} fill={color} opacity={0.1} />
        <path d={model.band80} fill={color} opacity={0.16} />
        <path d={model.band50} fill={color} opacity={0.26} />
        {limit && (
          <g>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={model.y(limit.value)} y2={model.y(limit.value)} className="mw-chart__limit" />
            <text x={width - MARGIN.right - 4} y={model.y(limit.value) - 5} textAnchor="end" className="mw-chart__limit-label">
              {limit.label}
            </text>
          </g>
        )}
        {model.baseline && <path d={model.baseline} className="mw-chart__baseline-line" />}
        <path d={model.forecast} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {model.actual.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={2.6} className="mw-chart__actual" />
        ))}
        {hovered && (
          <g>
            <line x1={model.x(hovered.offset_hours + 0.5)} x2={model.x(hovered.offset_hours + 0.5)} y1={MARGIN.top} y2={height - MARGIN.bottom} className="mw-chart__crosshair" />
            {Number.isFinite(hovered[variable].forecast) && (
              <circle cx={model.x(hovered.offset_hours + 0.5)} cy={model.y(hovered[variable].forecast)} r={4} fill={color} className="mw-chart__focus" />
            )}
          </g>
        )}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(0, width - MARGIN.left - MARGIN.right)}
          height={height - MARGIN.top - MARGIN.bottom}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => onHover?.(null)}
        />
      </svg>
      {hovered && (
        <ChartTooltip x={model.x(hovered.offset_hours + 0.5)} y={MARGIN.top + 4} containerWidth={width}>
          <strong>
            Sol {hovered.sol} · {fmtHour(hovered.hour)} LTST
          </strong>
          <dl>
            <dt>Forecast</dt>
            <dd>
              {fmtK(hovered[variable].forecast)} K <span>({fmtC(hovered[variable].forecast)} °C)</span>
            </dd>
            <dt>80% range</dt>
            <dd>
              {fmtK(hovered[variable].q10, 0)}–{fmtK(hovered[variable].q90, 0)} K
            </dd>
            <dt>90% range</dt>
            <dd>
              {fmtK(hovered[variable].q05, 0)}–{fmtK(hovered[variable].q95, 0)} K
            </dd>
            {showBaseline && (
              <>
                <dt>7-sol baseline</dt>
                <dd>{fmtK(hovered[variable].baseline)} K</dd>
              </>
            )}
            {Number.isFinite(hovered[variable].actual) && (
              <>
                <dt>Observed</dt>
                <dd>{fmtK(hovered[variable].actual)} K</dd>
              </>
            )}
            <dt>P(GO)</dt>
            <dd>{fmtPct(hovered.p_go)}</dd>
          </dl>
        </ChartTooltip>
      )}
      <Legend
        items={[
          { label: "Forecast", color },
          { label: "50 / 80 / 90 % range", color, kind: "band" },
          ...(showBaseline ? [{ label: "7-sol baseline", color: "var(--mw-text-secondary)", kind: "dash" }] : []),
          ...(model.actual.length ? [{ label: "Observed", color: "var(--mw-text)", kind: "dot" }] : []),
          ...(limit ? [{ label: limit.label, color: "var(--mw-warning)", kind: "dash" }] : []),
          { label: "Night", color: "var(--mw-deep-space)", kind: "night" },
        ]}
      />
    </figure>
  );
}

export default FanChart;
