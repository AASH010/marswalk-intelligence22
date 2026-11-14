import { useEffect } from "react";
import L from "leaflet";
import { useMap, useMapEvents } from "react-leaflet";

import { CTX_EXTENT, MARS_MAP } from "../../utils/mapConfig";
import { extentToLatLngBounds, latLngToMars, marsToLatLng, xyToLatLng } from "../../utils/mapAdapter";
import { cursorStore } from "../../utils/cursorStore";

export const CTX_BOUNDS = extentToLatLngBounds(CTX_EXTENT);
export const AOI_BOUNDS = extentToLatLngBounds(MARS_MAP.bounds);

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Forwards map clicks as Mars projected points. */
export function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (event) => onMapClick?.(latLngToMars(event.latlng)) });
  return null;
}

/**
 * Initial viewport. The whole CTX mosaic stays reachable (it sets the minimum
 * zoom, as before), and the view opens on the operational AOI where routing
 * and science data exist.
 */
export function InitialView({ onReady }) {
  const map = useMap();
  useEffect(() => {
    map.setMinZoom(map.getBoundsZoom(L.latLngBounds(CTX_BOUNDS), false));
    map.fitBounds(AOI_BOUNDS, { padding: [40, 40], animate: false });
    onReady?.();
    // Run once per map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

/**
 * Keeps Leaflet in sync with its container (handoff §3.4, §6.4). Whenever a
 * side panel opens, closes or animates, the container size changes; Leaflet
 * is told to re-measure so tiles, overlays, markers and click-to-coordinate
 * conversion stay aligned. The map centre is preserved and no data is reloaded.
 */
export function MapResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          map.invalidateSize({ animate: false });
        }
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

/** Publishes the pointer position in Mars projected metres for the status bar. */
export function CursorTracker() {
  const map = useMap();
  useEffect(() => {
    let frame = 0;
    let latest = null;
    const flush = () => {
      frame = 0;
      cursorStore.set(latest);
    };
    const onMove = (event) => {
      latest = latLngToMars(event.latlng);
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onOut = () => {
      latest = null;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    return () => {
      cancelAnimationFrame(frame);
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
      cursorStore.set(null);
    };
  }, [map]);
  return null;
}

/**
 * Moves the viewport on request (Fit AOI, Locate Start / Goal, show a target,
 * show the route). It only changes the view; it never changes map data.
 */
export function FocusController({ request }) {
  const map = useMap();
  useEffect(() => {
    if (!request) return;
    const animate = !prefersReducedMotion();

    if (request.type === "aoi") {
      map.fitBounds(AOI_BOUNDS, { padding: [40, 40], animate });
    } else if (request.type === "point" && request.point) {
      map.panTo(marsToLatLng(request.point), { animate });
    } else if (request.type === "target" && request.point) {
      const latlng = L.latLng(marsToLatLng(request.point));
      if (!map.getBounds().pad(-0.1).contains(latlng)) map.panTo(latlng, { animate });
    } else if (request.type === "route" && request.coordinates?.length) {
      const bounds = L.latLngBounds(request.coordinates.map(xyToLatLng));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 6, animate });
    }
  }, [map, request]);
  return null;
}

export default MapClickHandler;
