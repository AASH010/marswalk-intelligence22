/**
 * Route interaction states (handoff §09 and §14.4) and the user-facing copy
 * for each (Appendix B, §10.3 error-message pattern).
 */

export const ROUTE_STATUS = {
  IDLE: "idle",
  READY: "ready",
  CALCULATING: "calculating",
  CALCULATED: "calculated",
  OUTDATED: "outdated",
  FAILED: "failed",
  UNAVAILABLE: "unavailable",
};

const SERVICE_ERROR_KINDS = new Set(["unavailable", "contract"]);

/**
 * The displayed status is always derived from the stored result, the stored
 * error and the *current* inputs — a result is "Calculated" only while its
 * fingerprint equals the fingerprint of the inputs on screen.
 */
export function deriveRouteStatus({ isSubmitting, result, error, currentFingerprint, hasStart, hasGoal }) {
  if (isSubmitting) return ROUTE_STATUS.CALCULATING;
  if (error && error.fingerprint === currentFingerprint) {
    return SERVICE_ERROR_KINDS.has(error.kind) ? ROUTE_STATUS.UNAVAILABLE : ROUTE_STATUS.FAILED;
  }
  if (result) {
    return result.fingerprint === currentFingerprint ? ROUTE_STATUS.CALCULATED : ROUTE_STATUS.OUTDATED;
  }
  if (hasStart && hasGoal) return ROUTE_STATUS.READY;
  return ROUTE_STATUS.IDLE;
}

const POINT_NAME = { start: "Start Point", goal: "Goal Point" };

function describeError(error) {
  const point = POINT_NAME[error.point] || "selected point";
  switch (error.kind) {
    case "no_route":
      return {
        tone: "critical",
        title: "No valid route was returned for the selected inputs.",
        text: "Your Start Point and Goal Point are unchanged. Move a point or choose another strategy, then plan again.",
      };
    case "outside_extent":
      return {
        tone: "critical",
        title: `The ${point} is outside the supported terrain extent.`,
        text: "Your selected points have been preserved. Choose a location inside the AOI boundary.",
      };
    case "not_traversable":
      return {
        tone: "critical",
        title: `The ${point} is on terrain the route planner cannot traverse.`,
        text: "Your selected points have been preserved. Move the point to nearby terrain, then plan again.",
      };
    case "validation":
      return {
        tone: "critical",
        title: "The route request was not accepted.",
        text: error.detail
          ? `${error.detail} Your selected points have been preserved.`
          : "Your selected points have been preserved. Check the inputs, then plan again.",
      };
    case "contract":
      return {
        tone: "critical",
        title: "The route result is unavailable.",
        text: "The service returned a result that could not be validated, so nothing was drawn. Your selected points have been preserved.",
      };
    default:
      return {
        tone: "critical",
        title: "Route planning is temporarily unavailable.",
        text: "Your selected points have been preserved. Check that the route service is running, then try again.",
      };
  }
}

/** Message shown under the primary action and in the Mission Summary. */
export function describeRouteState({ status, hasStart, hasGoal, error }) {
  switch (status) {
    case ROUTE_STATUS.CALCULATING:
      return { tone: "info", title: "Calculating route…", text: null };
    case ROUTE_STATUS.CALCULATED:
      return { tone: "success", title: "Route calculation completed.", text: null };
    case ROUTE_STATUS.OUTDATED:
      return { tone: "warning", title: "Inputs changed. Recalculate to update this route.", text: null };
    case ROUTE_STATUS.FAILED:
    case ROUTE_STATUS.UNAVAILABLE:
      return describeError(error || { kind: "unavailable" });
    case ROUTE_STATUS.READY:
      return { tone: "info", title: "Ready to calculate a terrain-aware route.", text: null };
    default:
      if (!hasStart) return { tone: "info", title: "Select a Start Point to continue.", text: null };
      if (!hasGoal) return { tone: "info", title: "Select a Goal Point to continue.", text: null };
      return { tone: "info", title: "Ready to calculate a terrain-aware route.", text: null };
  }
}

/** Short label for the status badge when a failure has a more specific name. */
export function badgeLabelFor(status, error) {
  if (status === ROUTE_STATUS.FAILED && error?.kind === "no_route") return "No route";
  return undefined;
}
