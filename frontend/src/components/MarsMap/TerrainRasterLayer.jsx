import { ImageOverlay } from "react-leaflet";

import { extentToLatLngBounds } from "../../utils/mapAdapter";

/**
 * Slope / Elevation overlay rendered from the terrain heightmap served by the
 * backend (see utils/rasterOverlay.js). Nothing is drawn until real data exists.
 */
function TerrainRasterLayer({ overlay, enabled = false, opacity = 0.7, zIndex = 1, alt }) {
  if (!enabled || !overlay) return null;

  return (
    <ImageOverlay
      url={overlay.url}
      bounds={extentToLatLngBounds(overlay.extent)}
      opacity={opacity}
      zIndex={zIndex}
      alt={alt}
      interactive={false}
      className="mw-raster-image"
    />
  );
}

export default TerrainRasterLayer;
