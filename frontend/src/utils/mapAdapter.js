/**
 * Map adapter — the only place that converts between Mars projected
 * coordinates and Leaflet's LatLng objects.
 *
 * Under MarsCRS (utils/marsCRS.js) Leaflet's [lat, lng] is [Mars Y, Mars X].
 * Everything outside this module works with plain { x, y } in metres.
 */

/** Leaflet LatLng -> Mars projected point. */
export function latLngToMars(latlng) {
  return { x: latlng.lng, y: latlng.lat };
}

/** Mars projected point -> Leaflet [lat, lng] tuple. */
export function marsToLatLng(point) {
  return [point.y, point.x];
}

/** GeoJSON-style [x, y] pair -> Leaflet [lat, lng] tuple. */
export function xyToLatLng([x, y]) {
  return [y, x];
}

/** { minX, minY, maxX, maxY } -> Leaflet bounds [[south, west], [north, east]]. */
export function extentToLatLngBounds(extent) {
  return [
    [extent.minY, extent.minX],
    [extent.maxY, extent.maxX],
  ];
}
