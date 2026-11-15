import { useLayoutEffect, useRef, useState } from "react";

/**
 * Minimal chart toolkit (SVG, no dependencies).
 * Scales, nice ticks, a width-tracking hook, axes and a hover tooltip.
 * Colours always come from the design tokens (CSS variables).
 */

export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  const scale = (value) => r0 + ((value - d0) / span) * (r1 - r0);
  scale.invert = (pixel) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  return scale;
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => raw <= s) ?? 10 * power;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Ticks on round LTST hours (every 3, 6, 12 or 24 h) that fit the width. */
export function hourTicks(start, end, width) {
  const span = end - start;
  const room = Math.max(2, Math.floor(width / 70));
  const step = [3, 6, 12, 24, 48].find((s) => span / s <= room) ?? 48;
  const ticks = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  return ticks;
}

/** Pads a [min, max] extent and rounds it outward to tick steps. */
export function niceExtent(values, { pad = 0.06, include = [] } = {}) {
  const finite = [...values, ...include].filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  return [min - span * pad, max + span * pad];
}

export function useElementWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const next = Math.max(120, Math.floor(element.getBoundingClientRect().width));
      setWidth((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Builds an SVG path through consecutive finite points; gaps start a new segment. */
export function linePath(points) {
  let d = "";
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed band between two series (upper then reversed lower), split at gaps. */
export function bandPath(points) {
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.every((v) => Number.isFinite(v))) current.push(p);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments
    .map((segment) => {
      const upper = segment.map(([x, , hi]) => `${x.toFixed(1)},${hi.toFixed(1)}`);
      const lower = segment.map(([x, lo]) => `${x.toFixed(1)},${lo.toFixed(1)}`).reverse();
      return `M${upper.join("L")}L${lower.join("L")}Z`;
    })
    .join("");
}

export function AxisLeft({ scale, ticks, x, width, format = (v) => v, label }) {
  return (
    <g className="mw-chart__axis mw-chart__axis--y">
      {ticks.map((tick) => (
        <g key={tick} transform={`translate(0,${scale(tick)})`}>
          <line x1={x} x2={x + width} className="mw-chart__grid" />
          <text x={x - 8} dy="0.32em" textAnchor="end" className="mw-chart__tick">
            {format(tick)}
          </text>
        </g>
      ))}
      {label && (
        <text x={x - 8} y={scale(scale.domain[1]) - 12} textAnchor="start" className="mw-chart__axis-label">
          {label}
        </text>
      )}
    </g>
  );
}

export function AxisBottom({ scale, ticks, y, format = (v) => v, label, x0 }) {
  return (
    <g className="mw-chart__axis mw-chart__axis--x">
      <line x1={scale.range[0]} x2={scale.range[1]} y1={y} y2={y} className="mw-chart__baseline" />
      {ticks.map((tick) => (
        <text key={tick} x={scale(tick)} y={y + 16} textAnchor="middle" className="mw-chart__tick">
          {format(tick)}
        </text>
      ))}
      {label && (
        <text x={x0 ?? scale.range[1]} y={y + 32} textAnchor="end" className="mw-chart__axis-label">
          {label}
        </text>
      )}
    </g>
  );
}

/** Tooltip positioned inside the chart container, flipped to stay visible. */
export function ChartTooltip({ x, y, containerWidth, children }) {
  if (x == null) return null;
  const left = x > containerWidth * 0.62;
  return (
    <div
      className="mw-chart__tooltip"
      role="presentation"
      style={left ? { right: containerWidth - x + 14, top: y } : { left: x + 14, top: y }}
    >
      {children}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <ul className="mw-chart__legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`mw-chart__key mw-chart__key--${item.kind || "line"}`} style={{ "--key": item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
