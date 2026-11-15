import { useMemo, useState } from "react";

import { AxisBottom, AxisLeft, ChartTooltip, Legend, linePath, linearScale, niceExtent, niceTicks, useElementWidth } from "./chartKit";

const M = { top: 18, right: 18, bottom: 40, left: 52 };

/**
 * Multi-series line chart over a numeric x axis with a shared hover readout.
 * series: [{ name, color, points: [{x, y}], dashed, band: [{x, lo, hi}] }]
 */
export function LineChart({ series, height = 240, xLabel, yLabel, xFormat = (v) => v, yFormat = (v) => v, title, yInclude = [], xTicks }) {
  const [ref, width] = useElementWidth(520);
  const [hoverX, setHoverX] = useState(null);
  const model = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => [...s.points.map((p) => p.y), ...(s.band || []).flatMap((b) => [b.lo, b.hi])]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = niceExtent(ys, { include: yInclude, pad: 0.08 });
    const x = linearScale([x0, x1], [M.left, width - M.right]);
    const y = linearScale([y0, y1], [height - M.bottom, M.top]);
    return { x, y, xs: [...new Set(xs)].sort((a, b) => a - b), yTicks: niceTicks(y0, y1, 5), xTicks: xTicks || niceTicks(x0, x1, Math.min(10, Math.round(width / 70))) };
  }, [series, width, height, yInclude, xTicks]);

  const nearest = hoverX == null ? null : model.xs.reduce((best, v) => (Math.abs(v - hoverX) < Math.abs(best - hoverX) ? v : best), model.xs[0]);

  return (
    <figure className="mw-chart" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={width} height={height} role="img" aria-label={title || "Line chart"}>
        <AxisLeft scale={model.y} ticks={model.yTicks} x={M.left} width={width - M.left - M.right} format={yFormat} label={yLabel} />
        <AxisBottom scale={model.x} ticks={model.xTicks} y={height - M.bottom} format={xFormat} label={xLabel} />
        {series.map((s) =>
          s.band ? (
            <path
              key={`${s.name}-band`}
              d={`M${s.band.map((b) => `${model.x(b.x)},${model.y(b.hi)}`).join("L")}L${[...s.band].reverse().map((b) => `${model.x(b.x)},${model.y(b.lo)}`).join("L")}Z`}
              fill={s.color}
              opacity={0.14}
            />
          ) : null
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path d={linePath(s.points.map((p) => [model.x(p.x), model.y(p.y)]))} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} />
            {s.markers !== false &&
              s.points.length <= 24 &&
              s.points.map((p) => <circle key={p.x} cx={model.x(p.x)} cy={model.y(p.y)} r={3.2} fill={s.color} className="mw-chart__marker" />)}
          </g>
        ))}
        {nearest != null && <line x1={model.x(nearest)} x2={model.x(nearest)} y1={M.top} y2={height - M.bottom} className="mw-chart__crosshair" />}
        <rect
          x={M.left}
          y={M.top}
          width={Math.max(0, width - M.left - M.right)}
          height={height - M.top - M.bottom}
          fill="transparent"
          onMouseMove={(e) => setHoverX(model.x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left + M.left))}
          onMouseLeave={() => setHoverX(null)}
        />
      </svg>
      {nearest != null && (
        <ChartTooltip x={model.x(nearest)} y={M.top} containerWidth={width}>
          <strong>{xFormat(nearest)}</strong>
          <dl>
            {series.map((s) => {
              const point = s.points.find((p) => p.x === nearest);
              return point ? (
                <div key={s.name} className="mw-chart__tooltip-row">
                  <dt>
                    <span className="mw-chart__swatch" style={{ background: s.color }} />
                    {s.name}
                  </dt>
                  <dd>{yFormat(point.y)}</dd>
                </div>
              ) : null;
            })}
          </dl>
        </ChartTooltip>
      )}
      <Legend items={series.map((s) => ({ label: s.name, color: s.color, kind: s.dashed ? "dash" : "line" }))} />
    </figure>
  );
}

/** Grouped bar chart. categories: string[]; series: [{ name, color, values }] */
export function BarChart({ categories, series, height = 240, yLabel, yFormat = (v) => v, title, xLabel, yInclude = [0] }) {
  const [ref, width] = useElementWidth(520);
  const [hover, setHover] = useState(null);
  const values = series.flatMap((s) => s.values);
  const [y0, y1] = niceExtent(values, { include: yInclude, pad: 0.08 });
  const y = linearScale([Math.min(0, y0), y1], [height - M.bottom, M.top]);
  const band = (width - M.left - M.right) / categories.length;
  const inner = Math.min(band * 0.78, 18 * series.length + 8);
  const barWidth = Math.max(2, inner / series.length - 2);
  const showEvery = Math.ceil(categories.length / Math.max(1, Math.floor((width - M.left - M.right) / 34)));

  return (
    <figure className="mw-chart" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={width} height={height} role="img" aria-label={title || "Bar chart"} onMouseLeave={() => setHover(null)}>
        <AxisLeft scale={y} ticks={niceTicks(Math.min(0, y0), y1, 5)} x={M.left} width={width - M.left - M.right} format={yFormat} label={yLabel} />
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} className="mw-chart__baseline" />
        {categories.map((cat, i) => {
          const cx = M.left + band * i + band / 2;
          return (
            <g key={cat} onMouseEnter={() => setHover(i)}>
              <rect x={M.left + band * i} y={M.top} width={band} height={height - M.top - M.bottom} fill="transparent" />
              {series.map((s, j) => {
                const v = s.values[i];
                if (!Number.isFinite(v)) return null;
                const x = cx - inner / 2 + j * (barWidth + 2) + 1;
                const top = Math.min(y(v), y(0));
                return (
                  <rect key={s.name} x={x} y={top} width={barWidth} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={2} fill={s.color} opacity={hover == null || hover === i ? 0.95 : 0.45} />
                );
              })}
              {i % showEvery === 0 && (
                <text x={cx} y={height - M.bottom + 16} textAnchor="middle" className="mw-chart__tick">
                  {cat}
                </text>
              )}
            </g>
          );
        })}
        {xLabel && (
          <text x={width - M.right} y={height - M.bottom + 32} textAnchor="end" className="mw-chart__axis-label">
            {xLabel}
          </text>
        )}
      </svg>
      {hover != null && (
        <ChartTooltip x={M.left + band * hover + band / 2} y={M.top} containerWidth={width}>
          <strong>{categories[hover]}</strong>
          <dl>
            {series.map((s) => (
              <div key={s.name} className="mw-chart__tooltip-row">
                <dt>
                  <span className="mw-chart__swatch" style={{ background: s.color }} />
                  {s.name}
                </dt>
                <dd>{Number.isFinite(s.values[hover]) ? yFormat(s.values[hover]) : "—"}</dd>
              </div>
            ))}
          </dl>
        </ChartTooltip>
      )}
      <Legend items={series.map((s) => ({ label: s.name, color: s.color, kind: "box" }))} />
    </figure>
  );
}

/** Reliability diagram: forecast probability vs observed frequency. */
export function ReliabilityChart({ series, height = 280, title }) {
  const [ref, width] = useElementWidth(400);
  const size = Math.min(width, height + 60);
  const x = linearScale([0, 1], [M.left, size - M.right]);
  const y = linearScale([0, 1], [height - M.bottom, M.top]);
  const [hover, setHover] = useState(null);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const pct = (v) => `${Math.round(v * 100)}%`;
  return (
    <figure className="mw-chart mw-chart--square" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={size} height={height} role="img" aria-label={title || "Reliability diagram"}>
        <AxisLeft scale={y} ticks={ticks} x={M.left} width={size - M.left - M.right} format={pct} label="Observed" />
        <AxisBottom scale={x} ticks={ticks} y={height - M.bottom} format={pct} label="Forecast probability" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="mw-chart__diagonal" />
        {series.map((s) => (
          <g key={s.name}>
            <path d={linePath(s.points.map((p) => [x(p.mean_p), y(p.observed)]))} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} />
            {s.points.map((p, i) => (
              <circle
                key={i}
                cx={x(p.mean_p)}
                cy={y(p.observed)}
                r={Math.max(3, Math.min(9, Math.sqrt(p.n) / 3))}
                fill={s.color}
                className="mw-chart__marker"
                onMouseEnter={() => setHover({ ...p, name: s.name, cx: x(p.mean_p), cy: y(p.observed) })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        ))}
      </svg>
      {hover && (
        <ChartTooltip x={hover.cx} y={hover.cy - 10} containerWidth={size}>
          <strong>{hover.name}</strong>
          <dl>
            <dt>Forecast</dt>
            <dd>{pct(hover.mean_p)}</dd>
            <dt>Observed</dt>
            <dd>{pct(hover.observed)}</dd>
            <dt>Cases</dt>
            <dd>{hover.n.toLocaleString("en-US")}</dd>
          </dl>
        </ChartTooltip>
      )}
      <Legend items={[...series.map((s) => ({ label: s.name, color: s.color, kind: s.dashed ? "dash" : "line" })), { label: "Perfect calibration", color: "var(--mw-text-secondary)", kind: "dash" }]} />
    </figure>
  );
}

/** Forecast vs observed scatter with the 1:1 line. points: [[actual, forecast]] */
export function ScatterChart({ points, height = 300, color = "var(--mw-cyan)", title, xLabel = "Observed (K)", yLabel = "Forecast (K)" }) {
  const [ref, width] = useElementWidth(400);
  const size = Math.min(width, height + 80);
  const all = points.flatMap(([a, f]) => [a, f]);
  const [d0, d1] = niceExtent(all, { pad: 0.04 });
  const x = linearScale([d0, d1], [M.left, size - M.right]);
  const y = linearScale([d0, d1], [height - M.bottom, M.top]);
  const ticks = niceTicks(d0, d1, 5);
  return (
    <figure className="mw-chart mw-chart--square" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={size} height={height} role="img" aria-label={title || "Forecast versus observed"}>
        <AxisLeft scale={y} ticks={ticks} x={M.left} width={size - M.left - M.right} format={(v) => v.toFixed(0)} label={yLabel} />
        <AxisBottom scale={x} ticks={ticks} y={height - M.bottom} format={(v) => v.toFixed(0)} label={xLabel} />
        {points.map(([a, f], i) => (
          <circle key={i} cx={x(a)} cy={y(f)} r={1.8} fill={color} opacity={0.35} />
        ))}
        <line x1={x(d0)} y1={y(d0)} x2={x(d1)} y2={y(d1)} className="mw-chart__diagonal mw-chart__diagonal--strong" />
      </svg>
    </figure>
  );
}

/** Histogram. bins: number[]; labels for the x range; optional reference value. */
export function Histogram({ values, edges, height = 200, color = "var(--mw-cyan)", reference = null, title, xLabel, yFormat = (v) => v }) {
  const [ref, width] = useElementWidth(400);
  const x = linearScale([edges[0], edges[edges.length - 1]], [M.left, width - M.right]);
  const max = Math.max(...values, reference ?? 0) * 1.12 || 1;
  const y = linearScale([0, max], [height - M.bottom, M.top]);
  return (
    <figure className="mw-chart" ref={ref}>
      {title && <figcaption className="mw-chart__title">{title}</figcaption>}
      <svg width={width} height={height} role="img" aria-label={title || "Histogram"}>
        <AxisLeft scale={y} ticks={niceTicks(0, max, 4)} x={M.left} width={width - M.left - M.right} format={yFormat} />
        <AxisBottom scale={x} ticks={niceTicks(edges[0], edges[edges.length - 1], 6)} y={height - M.bottom} label={xLabel} format={(v) => (Math.abs(v) < 1e-9 ? "0" : v)} />
        {values.map((v, i) => (
          <rect key={i} x={x(edges[i]) + 1} y={y(v)} width={Math.max(1, x(edges[i + 1]) - x(edges[i]) - 2)} height={Math.max(0, y(0) - y(v))} rx={1.5} fill={color} opacity={0.8} />
        ))}
        {reference != null && <line x1={M.left} x2={width - M.right} y1={y(reference)} y2={y(reference)} className="mw-chart__limit" />}
      </svg>
    </figure>
  );
}

/** Small inline trend line. */
export function Sparkline({ values, width = 120, height = 32, color = "var(--mw-cyan)", label }) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;
  const x = linearScale([0, values.length - 1], [1, width - 1]);
  const y = linearScale([Math.min(...finite), Math.max(...finite)], [height - 2, 2]);
  return (
    <svg className="mw-sparkline" width={width} height={height} role="img" aria-label={label}>
      <path d={linePath(values.map((v, i) => [x(i), Number.isFinite(v) ? y(v) : NaN]))} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export { Legend };
