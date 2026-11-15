/**
 * Post-route science proximity analysis (existing V7 behaviour).
 *
 * Measurement definition: straight-line distance, in the Mars projected plane,
 * from a science target to the nearest vertex of the returned route geometry.
 * Route vertices are grid-cell centres (20 m spacing). This is a geometric
 * measurement on returned data. It never alters the A* cost or the route.
 */

export const PROXIMITY_RADIUS_M = 500;

function distanceToRoute(target, coordinates) {
  let best = Infinity;
  for (const [x, y] of coordinates) {
    const dx = x - target.x;
    const dy = y - target.y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function analyzeScienceAlongRoute(route, targets = [], radiusMeters = PROXIMITY_RADIUS_M) {
  if (!route?.coordinates?.length) return { nearby: [], nearest: null, distances: new Map() };

  const distances = new Map();
  const nearby = [];

  for (const target of targets) {
    const routeDistanceM = distanceToRoute(target, route.coordinates);
    distances.set(target.id, routeDistanceM);
    if (routeDistanceM <= radiusMeters) nearby.push({ ...target, routeDistanceM });
  }

  nearby.sort((a, b) => a.routeDistanceM - b.routeDistanceM);
  return { nearby, nearest: nearby[0] || null, distances };
}
