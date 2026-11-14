import { ImageOverlay } from "react-leaflet";

import { CRISM_OVERLAY_URL } from "../../api/science";
import { MARS_MAP } from "../../utils/mapConfig";
import { extentToLatLngBounds } from "../../utils/mapAdapter";

/**
 * CRISM dual-band overlay (scripts/build_crism_overlay.py). The image is
 * built on the 500 × 500 AOI grid, so it is placed on the AOI extent.
 */
const CRISM_BOUNDS = extentToLatLngBounds(MARS_MAP.bounds);

function ScienceRasterLayer({ enabled = false, opacity = 0.6 }) {
  if (!enabled) return null;

  return (
    <ImageOverlay
      url={CRISM_OVERLAY_URL}
      bounds={CRISM_BOUNDS}
      opacity={opacity}
      zIndex={3}
      alt="CRISM D2300 and BD1900_2 spectral signal overlay"
      interactive={false}
      className="mw-raster-image"
    />
  );
}

export default ScienceRasterLayer;
