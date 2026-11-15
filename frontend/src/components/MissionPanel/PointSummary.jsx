import { Crosshair, LocateFixed } from "lucide-react";

import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { formatCoordinate } from "../../utils/coordinates";
import { MARS_CRS_INFO } from "../../utils/mapConfig";

/**
 * Committed Start and Goal points and the map selection tools (§5.2, §5.3).
 * Coordinates are displayed in the authoritative CRS, in metres, X then Y.
 */
function PointRow({ type, label, point, activeTool, onActivate, onLocate }) {
  const tool = `set-${type}`;
  const active = activeTool === tool;

  return (
    <div className={`mw-point mw-point--${type} ${active ? "is-active" : ""}`}>
      <div className="mw-point__head">
        <span className={`mw-point__marker mw-point__marker--${type}`} aria-hidden="true">
          {type === "start" ? "S" : "G"}
        </span>
        <span className="mw-point__label">{label}</span>
        <IconButton
          size="sm"
          label={`Locate ${label} on the map`}
          disabled={!point}
          onClick={() => onLocate(point)}
          tooltipPlacement="left"
        >
          <LocateFixed size={15} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="mw-point__coords">
        {point ? (
          <>
            <span className="mw-point__coord">
              <span>X</span>
              <strong className="mw-mono">{formatCoordinate(point.x)}</strong>
            </span>
            <span className="mw-point__coord">
              <span>Y</span>
              <strong className="mw-mono">{formatCoordinate(point.y)}</strong>
            </span>
            <span className="mw-point__units">{MARS_CRS_INFO.units}</span>
          </>
        ) : (
          <span className="mw-point__empty">Not set</span>
        )}
      </div>

      <Button
        variant={active ? "primary" : "secondary"}
        size="sm"
        block
        icon={<Crosshair size={14} aria-hidden="true" />}
        aria-pressed={active}
        onClick={() => onActivate(active ? "explore" : tool)}
      >
        {active ? "Click the map to set" : `Set ${label.toLowerCase()} on map`}
      </Button>
    </div>
  );
}

function PointSummary({ start, goal, activeTool, onActivateTool, onLocate }) {
  return (
    <div className="mw-points">
      <PointRow type="start" label="Start Point" point={start} activeTool={activeTool} onActivate={onActivateTool} onLocate={onLocate} />
      <PointRow type="goal" label="Goal Point" point={goal} activeTool={activeTool} onActivate={onActivateTool} onLocate={onLocate} />
    </div>
  );
}

export default PointSummary;
