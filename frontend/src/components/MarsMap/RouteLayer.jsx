import { useMemo } from "react";
import { Polyline, Tooltip } from "react-leaflet";

import { latLngToMars, xyToLatLng } from "../../utils/mapAdapter";
import { MAP_COLORS } from "./mapStyle";

/**
 * Route geometry exactly as returned by the route service.
 *  - current result  -> solid Mission Cyan line
 *  - outdated result -> dashed Warning Yellow line, visibly de-emphasised,
 *                       so it cannot be mistaken for the current route
 * A dark casing keeps the line readable over any base layer.
 */
function RouteLayer({ route, stale = false, onSelect }) {
  const positions = useMemo(() => (route?.coordinates?.length ? route.coordinates.map(xyToLatLng) : null), [route]);

  if (!positions || positions.length < 2) return null;

  return (
    <>
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{ color: MAP_COLORS.casing, weight: stale ? 6 : 8, opacity: stale ? 0.45 : 0.7, lineCap: "round", lineJoin: "round" }}
      />
      <Polyline
        positions={positions}
        bubblingMouseEvents={false}
        pathOptions={{
          color: stale ? MAP_COLORS.routeStale : MAP_COLORS.route,
          weight: stale ? 3 : 4,
          opacity: stale ? 0.85 : 1,
          dashArray: stale ? "2 9" : null,
          lineCap: "round",
          lineJoin: "round",
        }}
        eventHandlers={{ click: (event) => onSelect?.(latLngToMars(event.latlng)) }}
      >
        <Tooltip sticky>{stale ? "Outdated route — inputs have changed" : "Calculated terrain route"}</Tooltip>
      </Polyline>
    </>
  );
}

export default RouteLayer;
