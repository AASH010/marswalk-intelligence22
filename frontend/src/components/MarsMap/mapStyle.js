/**
 * Colours for map vectors. Leaflet path options cannot read CSS custom
 * properties reliably, so the design-token values are mirrored here once.
 * Keep in sync with src/styles/tokens.css.
 */
export const MAP_COLORS = {
  route: "#55D6E8", // Mission Cyan — calculated route
  routeStale: "#F4B860", // Warning Yellow — outdated route
  start: "#55C99A", // Success Green — Start Point
  goal: "#F07178", // Critical Red — Goal Point
  science: "#A78BFA", // Scientific Violet — science targets
  aoi: "#5689C7", // Navigation Blue — AOI boundary
  casing: "#080E14", // Deep Space — contrast casing under lines
  highlight: "#E8F0F5", // Primary Text — selected feature outline
};

/** Leaflet pane names and stacking order (handoff §11.4). */
export const PANES = {
  raster: { name: "mw-raster", zIndex: 250 }, // above base imagery (200)
  aoi: { name: "mw-aoi", zIndex: 410 },
  route: { name: "mw-route", zIndex: 420 },
  science: { name: "mw-science", zIndex: 430 },
  // Start / Goal markers use Leaflet's marker pane (600).
};
