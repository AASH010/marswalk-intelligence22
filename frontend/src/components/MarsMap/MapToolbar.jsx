import { useEffect, useState } from "react";
import { Layers, Minus, Plus, Scan } from "lucide-react";

import IconButton from "../ui/IconButton";
import { AOI_BOUNDS } from "./MapControls";

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Map controls (handoff §11.3): Zoom in, Zoom out, Fit AOI and the legend
 * toggle. Every control is a labelled, keyboard-operable button.
 */
function MapToolbar({ map, legendOpen, onLegendToggle }) {
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    if (!map) return undefined;
    const update = () => setZoom(map.getZoom());
    update();
    map.on("zoomend", update);
    return () => map.off("zoomend", update);
  }, [map]);

  const ready = Boolean(map);
  const atMax = ready && zoom !== null && zoom >= map.getMaxZoom();
  const atMin = ready && zoom !== null && zoom <= map.getMinZoom();

  return (
    <div className="mw-map-toolbar" role="toolbar" aria-label="Map controls" aria-orientation="vertical">
      <div className="mw-map-toolbar__group">
        <IconButton variant="map" label="Zoom in" tooltipPlacement="left" disabled={!ready || atMax} onClick={() => map.zoomIn()}>
          <Plus size={18} aria-hidden="true" />
        </IconButton>
        <IconButton variant="map" label="Zoom out" tooltipPlacement="left" disabled={!ready || atMin} onClick={() => map.zoomOut()}>
          <Minus size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <IconButton
        variant="map"
        label="Fit AOI"
        tooltipPlacement="left"
        disabled={!ready}
        onClick={() => map.fitBounds(AOI_BOUNDS, { padding: [40, 40], animate: !prefersReducedMotion() })}
      >
        <Scan size={18} aria-hidden="true" />
      </IconButton>
      <IconButton
        variant="map"
        label={legendOpen ? "Hide map legend" : "Show map legend"}
        tooltipPlacement="left"
        pressed={legendOpen}
        onClick={onLegendToggle}
      >
        <Layers size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export default MapToolbar;
