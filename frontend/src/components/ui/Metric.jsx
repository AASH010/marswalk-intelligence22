import Skeleton from "./Skeleton";
import Tooltip from "./Tooltip";
import { CircleHelp } from "lucide-react";

export const NOT_PROVIDED = "Not provided by the current calculation.";

/**
 * Metric row / card (handoff §4.5).
 * state: "value" | "loading" | "unavailable"
 * A value is only printed when the caller passes one. Otherwise the metric
 * reads "Not provided" — it is never estimated here.
 */
function Metric({
  icon = null,
  label,
  value = null,
  unit = null,
  state,
  help = null,
  note = null,
  stale = false,
  layout = "row",
  unavailableLabel = "Not provided",
}) {
  const resolved = state || (value === null || value === undefined ? "unavailable" : "value");

  return (
    <div className={`mw-metric mw-metric--${layout} ${stale ? "is-stale" : ""}`}>
      <div className="mw-metric__label">
        {icon && <span className="mw-metric__icon">{icon}</span>}
        <span>{label}</span>
        {help && (
          <Tooltip label={help} placement="top">
            <button type="button" className="mw-help" aria-label={`${label}: ${help}`}>
              <CircleHelp size={13} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mw-metric__value">
        {resolved === "loading" && <Skeleton width={64} height={14} />}
        {resolved === "unavailable" && (
          <span className="mw-metric__unavailable" title={NOT_PROVIDED}>
            {unavailableLabel}
          </span>
        )}
        {resolved === "value" && (
          <>
            <span className="mw-metric__number">{value}</span>
            {unit && <span className="mw-metric__unit">{unit}</span>}
          </>
        )}
      </div>
      {note && <div className="mw-metric__note">{note}</div>}
    </div>
  );
}

export default Metric;
