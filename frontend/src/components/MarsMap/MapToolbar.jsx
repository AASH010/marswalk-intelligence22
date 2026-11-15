import { useEffect, useRef, useState } from "react";
import L from "leaflet";
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
  const toolbarRef = useRef(null);

  // The toolbar floats over the map: keep its clicks, double-clicks and wheel
  // events away from Leaflet so they can never trigger a pointer-anchored zoom.
  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
  }, []);

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

  // Button zoom is always anchored on the centre of the visible map, in whole
  // steps, whatever the pointer or a previous wheel zoom did. Pointer-anchored
  // zoom stays available with the scroll wheel and double-click.
  const zoomBy = (delta) => {
    if (!map) return;
    map.stop();
    const size = map.getSize();
    const center = map.containerPointToLatLng(L.point(size.x / 2, size.y / 2));
    const target = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), (delta > 0 ? Math.floor(map.getZoom() + 1e-6) : Math.ceil(map.getZoom() - 1e-6)) + delta));
    map.setView(center, target, { animate: !prefersReducedMotion() });
  };

  return (
    <div ref={toolbarRef} className="mw-map-toolbar" role="toolbar" aria-label="Map controls" aria-orientation="vertical" data-tour="map-toolbar">
      <div className="mw-map-toolbar__group">
        <IconButton variant="map" label="Zoom in" tooltipPlacement="left" disabled={!ready || atMax} onClick={() => zoomBy(1)}>
          <Plus size={18} aria-hidden="true" />
        </IconButton>
        <IconButton variant="map" label="Zoom out" tooltipPlacement="left" disabled={!ready || atMin} onClick={() => zoomBy(-1)}>
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
