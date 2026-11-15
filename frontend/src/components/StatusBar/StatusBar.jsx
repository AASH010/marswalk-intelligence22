import { useSyncExternalStore } from "react";

import { cursorStore } from "../../utils/cursorStore";
import { formatCoordinate } from "../../utils/coordinates";
import { formatFixed } from "../../utils/format";
import { MARS_CRS_INFO, MARS_MAP } from "../../utils/mapConfig";
import { ROUTE_STATUS } from "../../utils/routeStatus";

/** Live pointer position in Mars projected metres (handoff §13.2). */
function CursorReadout() {
  const position = useSyncExternalStore(cursorStore.subscribe, cursorStore.get, () => null);

  return (
    <span className="mw-statusbar__item mw-statusbar__item--cursor">
      <span className="mw-statusbar__key">Cursor</span>
      {position ? (
        <span className="mw-mono">
          X {formatCoordinate(position.x)} · Y {formatCoordinate(position.y)}
        </span>
      ) : (
        <span className="mw-statusbar__idle">Move over the map</span>
      )}
    </span>
  );
}

/**
 * Status bar: the fixed properties of the dataset and the live cursor
 * position. Route distance is shown only while the displayed result matches
 * the current inputs.
 */
function StatusBar({ routeStatus, routeResult, scienceCount, viewMode }) {
  const current = routeStatus === ROUTE_STATUS.CALCULATED;
  const distance = current ? formatFixed(routeResult?.metrics?.distance_km, 2) : null;

  return (
    <footer className="mw-statusbar">
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">CRS</span>
        <span className="mw-mono">{MARS_CRS_INFO.id}</span>
      </span>
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">Grid</span>
        <span className="mw-mono">
          {MARS_MAP.grid.rows} × {MARS_MAP.grid.cols} at {MARS_MAP.grid.resolution} m
        </span>
      </span>
      {viewMode === "2d" && <CursorReadout />}
      <span className="mw-statusbar__spacer" />
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">Route</span>
        {distance ? (
          <span className="mw-mono">{distance} km</span>
        ) : (
          <span className="mw-statusbar__idle">{routeStatus === ROUTE_STATUS.OUTDATED ? "Outdated" : "None"}</span>
        )}
      </span>
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">Science</span>
        <span className="mw-mono">{scienceCount}</span>
      </span>
    </footer>
  );
}

export default StatusBar;
