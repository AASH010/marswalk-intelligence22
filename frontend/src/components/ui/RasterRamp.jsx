import { RAMPS, rampToCssGradient } from "../../utils/rasterOverlay";
import { formatFixed } from "../../utils/format";

const UNIT_SYMBOL = { meters: "m", metres: "m", degrees: "°" };

function unitLabel(units) {
  if (!units) return "";
  const symbol = UNIT_SYMBOL[units] ?? units;
  return symbol === "°" ? "°" : ` ${symbol}`;
}

/**
 * Continuous colour ramp for a terrain raster, labelled with the display range
 * and the units the terrain service reported. A limit is marked with
 * ≤ or ≥ when the data extends past the displayed range.
 */
function RasterRamp({ kind, overlay }) {
  if (!overlay) return null;
  const unit = unitLabel(overlay.units);
  const digits = kind === "slope" ? 1 : 0;
  const clippedHigh = overlay.max > overlay.displayMax;
  const clippedLow = overlay.min < overlay.displayMin;
  return (
    <div className="mw-legend-ramp">
      <div className="mw-legend-ramp__bar" style={{ background: rampToCssGradient(RAMPS[kind]) }} />
      <div className="mw-legend-ramp__labels">
        <span>
          {clippedLow ? "≤ " : ""}
          {formatFixed(overlay.displayMin, digits)}
          {unit}
        </span>
        <span>
          {clippedHigh ? "≥ " : ""}
          {formatFixed(overlay.displayMax, digits)}
          {unit}
        </span>
      </div>
    </div>
  );
}

export default RasterRamp;
