import { useState } from "react";
import { Keyboard, Play, RefreshCw, Route as RouteIcon, Trash2, X } from "lucide-react";

import Accordion from "../ui/Accordion";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import InlineMessage from "../ui/InlineMessage";
import StatusBadge from "../ui/StatusBadge";
import StrategySelector from "./StrategySelector";
import PointSummary from "./PointSummary";
import ManualCoordinates from "./ManualCoordinates";
import { ROUTE_STATUS, describeRouteState } from "../../utils/routeStatus";

/**
 * Route Configuration (left sidebar, handoff §3.1).
 * Holds the strategy, the Start / Goal points, manual coordinate entry and
 * the primary action. The action is only enabled when every prerequisite is
 * met, and it cannot be submitted twice while a request is in flight.
 */
function MissionPanel({
  start,
  goal,
  activeTool,
  onActivateTool,
  onLocate,
  strategyId,
  onStrategyChange,
  draft,
  onDraftChange,
  onApplyCoordinates,
  routeStatus,
  routeError,
  canPlan,
  isSubmitting,
  serviceOffline,
  onPlan,
  onCancel,
  onClearConfiguration,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const state = describeRouteState({ status: routeStatus, hasStart: Boolean(start), hasGoal: Boolean(goal), error: routeError });
  const outdated = routeStatus === ROUTE_STATUS.OUTDATED;

  let disabledReason = null;
  if (!start) disabledReason = "Select a Start Point to continue.";
  else if (!goal) disabledReason = "Select a Goal Point to continue.";
  else if (serviceOffline) disabledReason = "The route service is not reachable.";

  return (
    <section className="mw-panel-section" aria-labelledby="mw-route-config">
      <div className="mw-panel-section__head">
        <h2 className="mw-panel-section__title" id="mw-route-config">
          <RouteIcon size={15} aria-hidden="true" />
          Route configuration
        </h2>
        <StatusBadge status={routeStatus} />
      </div>

      <div className="mw-panel-section__body">
        <StrategySelector value={strategyId} onChange={onStrategyChange} disabled={isSubmitting} />

        <PointSummary start={start} goal={goal} activeTool={activeTool} onActivateTool={onActivateTool} onLocate={onLocate} />

        {activeTool !== "explore" && (
          <InlineMessage tone="info" compact>
            Click a location on the map to set the {activeTool === "set-start" ? "Start Point" : "Goal Point"}.
          </InlineMessage>
        )}

        <div className="mw-plan">
          <Button
            variant="primary"
            block
            icon={outdated ? <RefreshCw size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            loading={isSubmitting}
            loadingLabel="Calculating route…"
            disabled={!canPlan}
            title={disabledReason || undefined}
            onClick={onPlan}
          >
            {outdated ? "Recalculate route" : "Plan terrain route"}
          </Button>

          {isSubmitting && (
            <>
              <div className="mw-progress" role="progressbar" aria-label="Calculating route" aria-valuetext="In progress">
                <span className="mw-progress__bar" />
              </div>
              <Button variant="tertiary" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={onCancel}>
                Cancel calculation
              </Button>
            </>
          )}

          {!isSubmitting && (
            <InlineMessage tone={state.tone} compact>
              {state.title}
              {state.text ? ` ${state.text}` : ""}
            </InlineMessage>
          )}

          {(start || goal) && !isSubmitting && (
            <Button
              variant="destructive"
              size="sm"
              block
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => setConfirmClear(true)}
            >
              Clear configuration
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmClear}
        title="Clear the route configuration?"
        confirmLabel="Clear configuration"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          onClearConfiguration();
        }}
      >
        This removes the Start Point, the Goal Point and any calculated route from the map. Map layers and the selected strategy are
        not affected.
      </Dialog>

      <Accordion
        title="Manual coordinates"
        icon={<Keyboard size={15} aria-hidden="true" />}
        defaultOpen={false}
        className="mw-accordion--nested"
      >
        <ManualCoordinates
          draft={draft}
          onDraftChange={onDraftChange}
          onApply={onApplyCoordinates}
          hasPoint={Boolean(draft.pointType === "start" ? start : goal)}
        />
      </Accordion>
    </section>
  );
}

export default MissionPanel;
