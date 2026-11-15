import { useEffect } from "react";
import L from "leaflet";
import { useMap, useMapEvents } from "react-leaflet";

import { CTX_EXTENT, MARS_MAP, NAV_PADDING_M } from "../../utils/mapConfig";
import { extentToLatLngBounds, latLngToMars, marsToLatLng, xyToLatLng } from "../../utils/mapAdapter";
import { cursorStore } from "../../utils/cursorStore";

export const AOI_BOUNDS = extentToLatLngBounds(MARS_MAP.bounds);

/** Pan limit: the AOI plus the same margin on every side, never past the CTX mosaic. */
export const NAV_BOUNDS = extentToLatLngBounds({
  minX: Math.max(CTX_EXTENT.minX, MARS_MAP.bounds.minX - NAV_PADDING_M),
  maxX: Math.min(CTX_EXTENT.maxX, MARS_MAP.bounds.maxX + NAV_PADDING_M),
  minY: Math.max(CTX_EXTENT.minY, MARS_MAP.bounds.minY - NAV_PADDING_M),
  maxY: Math.min(CTX_EXTENT.maxY, MARS_MAP.bounds.maxY + NAV_PADDING_M),
});

/** Smallest zoom at which the navigable area still fills the view, so the user cannot zoom out into empty space. */
function syncMinZoom(map) {
  const size = map.getSize();
  if (size.x <= 0 || size.y <= 0) return;
  const minZoom = map.getBoundsZoom(L.latLngBounds(NAV_BOUNDS), true);
  map.setMinZoom(minZoom);
  if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Forwards map clicks as Mars projected points. */
export function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (event) => onMapClick?.(latLngToMars(event.latlng)) });
  return null;
}

/**
 * Initial viewport. Navigation is limited to the AOI plus an equal margin on
 * every side (see NAV_BOUNDS), and the view opens on the operational AOI where
 * routing and science data exist.
 */
export function InitialView({ onReady }) {
  const map = useMap();
  useEffect(() => {
    syncMinZoom(map);
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
          syncMinZoom(map);
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
