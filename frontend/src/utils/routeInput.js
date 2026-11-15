/**
 * Route input snapshot and fingerprint (handoff §14.2).
 *
 * A route result is valid only for the exact inputs that produced it. The
 * fingerprint is a deterministic string of every route-affecting input; the
 * interface compares the fingerprint stored with a result against the
 * fingerprint of the current inputs to decide whether the result is current.
 */

export function createRouteSnapshot({ start, goal, strategyId }) {
  return Object.freeze({
    start: Object.freeze({ x: start.x, y: start.y }),
    goal: Object.freeze({ x: goal.x, y: goal.y }),
    strategyId,
  });
}

export function routeFingerprint({ start, goal, strategyId }) {
  if (!start || !goal || !strategyId) return null;
  return JSON.stringify([start.x, start.y, goal.x, goal.y, strategyId]);
}

/** Fingerprint of the two points only — used by the three-mode comparison. */
export function pointsFingerprint({ start, goal }) {
  if (!start || !goal) return null;
  return JSON.stringify([start.x, start.y, goal.x, goal.y]);
}
