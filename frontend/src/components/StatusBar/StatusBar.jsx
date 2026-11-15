import { useSyncExternalStore } from "react";

import { cursorStore } from "../../utils/cursorStore";
import { formatCoordinate } from "../../utils/coordinates";
import { formatFixed } from "../../utils/format";
import { MARS_CRS_INFO, MARS_MAP } from "../../utils/mapConfig";
import { ROUTE_STATUS } from "../../utils/routeStatus";
import { formatClock, splitClock } from "../../utils/missionClock";
import { selectMinuteBucket, useClockValue } from "../../hooks/useMissionClock";

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

/** Mission clock and the conditions it points at: measured while there is data, otherwise the model estimate. */
function WeatherReadout({ clock, latestSol, current, estimate }) {
  useClockValue(clock, selectMinuteBucket);
  const state = clock.get();
  if (!state.ready) return null;
  const { sol } = splitClock(state.t);
  const measured = sol <= latestSol;
  const useEstimate = (!measured || (current?.air_temp_k == null && current?.ground_temp_k == null)) && Boolean(estimate);
  const air = useEstimate ? estimate.air.forecast : current?.air_temp_k;
  const ground = useEstimate ? estimate.ground.forecast : current?.ground_temp_k;
  const k = (value) => (Number.isFinite(value) ? value.toFixed(0) : "—");
  return (
    <span
      className="mw-statusbar__item"
      title={useEstimate ? "After the last measurement: model estimate for this hour" : "MEDA measurement at the clock time"}
    >
      <span className="mw-statusbar__key">Mars</span>
      <span className="mw-mono">
        Sol {sol} · {formatClock(state.t)} · Air {k(air)} K · Ground {k(ground)} K{useEstimate ? " (est.)" : ""}
      </span>
    </span>
  );
}

/**
 * Status bar: the fixed properties of the dataset and the live cursor
 * position. Route distance is shown only while the displayed result matches
 * the current inputs.
 */
function StatusBar({ routeStatus, routeResult, scienceCount, viewMode, departure = null, nextWindow = null, weatherNow = null, weatherEstimate = null, clock = null, latestSol = null }) {
  const current = routeStatus === ROUTE_STATUS.CALCULATED;
  const distance = current ? formatFixed(routeResult?.metrics?.distance_km, 2) : null;

  return (
    <footer className="mw-statusbar" data-tour="statusbar">
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
      {clock && latestSol != null && <WeatherReadout clock={clock} latestSol={latestSol} current={weatherNow} estimate={weatherEstimate} />}
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">Route</span>
        {distance ? (
          <span className="mw-mono">{distance} km</span>
        ) : (
          <span className="mw-statusbar__idle">{routeStatus === ROUTE_STATUS.OUTDATED ? "Outdated" : "None"}</span>
        )}
      </span>
      <span className="mw-statusbar__item">
        <span className="mw-statusbar__key">EVA</span>
        {departure ? (
          <span className="mw-mono">
            depart Sol {departure.start.sol} {String(departure.start.hour).padStart(2, "0")}:00
          </span>
        ) : nextWindow ? (
          <span className="mw-mono">
            GO from Sol {nextWindow.start.sol} {String(nextWindow.start.hour).padStart(2, "0")}:00
          </span>
        ) : (
          <span className="mw-statusbar__idle">No window</span>
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
