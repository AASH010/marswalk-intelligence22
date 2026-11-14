import { Atom, ChevronRight, LocateFixed } from "lucide-react";

import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";
import { formatDistanceM } from "../../utils/format";
import { PROXIMITY_RADIUS_M } from "../../utils/scienceProximity";

function TargetRow({ target, distanceM, selected, onSelect }) {
  const distance = formatDistanceM(distanceM);
  return (
    <li>
      <button
        type="button"
        className={`mw-target-row ${selected ? "is-selected" : ""}`}
        aria-current={selected || undefined}
        onClick={() => onSelect(target)}
      >
        <span className="mw-target-row__dot" aria-hidden="true" />
        <span className="mw-target-row__name">{target.name || target.id}</span>
        {distance && (
          <span className="mw-target-row__distance mw-mono">
            {distance.value} {distance.unit}
          </span>
        )}
        <ChevronRight size={14} aria-hidden="true" className="mw-target-row__chevron" />
      </button>
    </li>
  );
}

/**
 * Science targets (handoff §5.9).
 *
 * Target selection is independent of the route inputs: selecting a target
 * highlights its marker and fills the inspector, and never changes Start,
 * Goal or strategy.
 */
function ScienceSection({ targets, loading, error, onRetry, proximity, hasRoute, routeStale, selectedId, onSelect, onLocate }) {
  if (loading) {
    return (
      <div className="mw-stack">
        <Skeleton height={16} />
        <Skeleton height={16} width="70%" />
      </div>
    );
  }

  if (error) {
    return (
      <InlineMessage tone="warning" title="Science targets are unavailable.">
        {error}
        <div className="mw-message__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </InlineMessage>
    );
  }

  if (!targets.length) {
    return <EmptyState icon={<Atom size={16} aria-hidden="true" />}>No science target records were returned for this area.</EmptyState>;
  }

  const nearby = proximity?.nearby || [];

  return (
    <div className="mw-stack">
      <div className="mw-row mw-row--between">
        <span className="mw-note">
          {targets.length} target{targets.length === 1 ? "" : "s"} in the AOI
        </span>
        <Button variant="tertiary" size="sm" icon={<LocateFixed size={13} aria-hidden="true" />} onClick={onLocate}>
          Fit AOI
        </Button>
      </div>

      {hasRoute ? (
        <>
          <div className="mw-row mw-row--between">
            <span className="mw-section-title">Route-adjacent targets</span>
            <span className="mw-mono mw-helper">within {PROXIMITY_RADIUS_M} m</span>
          </div>

          {routeStale && (
            <InlineMessage tone="warning" compact live={false}>
              Measured against the previous route. Recalculate to update these distances.
            </InlineMessage>
          )}

          {nearby.length ? (
            <ul className="mw-target-list">
              {nearby.slice(0, 8).map((target) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  distanceM={target.routeDistanceM}
                  selected={target.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Atom size={16} aria-hidden="true" />}>
              No science targets fall within {PROXIMITY_RADIUS_M} m of this route.
            </EmptyState>
          )}

          <p className="mw-helper">
            Distance is measured in a straight line, in the Mars projected plane, from the target to the nearest route vertex. It is a
            post-route analysis and does not affect the route search.
          </p>
        </>
      ) : (
        <EmptyState icon={<Atom size={16} aria-hidden="true" />}>
          Select a science target on the map to inspect its available details. Plan a route to list route-adjacent targets.
        </EmptyState>
      )}
    </div>
  );
}

export default ScienceSection;
