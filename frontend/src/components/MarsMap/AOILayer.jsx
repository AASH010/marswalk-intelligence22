import { Rectangle } from "react-leaflet";

import { MARS_MAP } from "../../utils/mapConfig";
import { extentToLatLngBounds } from "../../utils/mapAdapter";
import { MAP_COLORS } from "./mapStyle";

const AOI_BOUNDS = extentToLatLngBounds(MARS_MAP.bounds);

/**
 * Area-of-interest boundary: dashed Navigation Blue outline with a restrained
 * fill (handoff §4.10). It is not interactive, so it never intercepts clicks
 * meant for the map, the route or a science target.
 */
function AOILayer({ opacity = 1 }) {
  return (
    <Rectangle
      bounds={AOI_BOUNDS}
      interactive={false}
      pathOptions={{
        color: MAP_COLORS.aoi,
        weight: 2,
        opacity,
        dashArray: "8 6",
        fillColor: MAP_COLORS.aoi,
        fillOpacity: 0.04 * opacity,
      }}
    />
  );
}

export default AOILayer;
