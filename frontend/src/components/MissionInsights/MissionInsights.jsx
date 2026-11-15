import { Atom, Backpack, CalendarClock, ClipboardList, Clock, CloudSun, Database, Scale, Target } from "lucide-react";

import Accordion from "../ui/Accordion";
import EvaSection from "./EvaSection";
import ProvenanceSection from "./ProvenanceSection";
import RouteComparison from "./RouteComparison";
import RouteSummary from "./RouteSummary";
import ScienceSection from "./ScienceSection";
import TargetDetails from "./TargetDetails";
import StatusBadge from "../ui/StatusBadge";
import WeatherNowSection from "../Weather/WeatherNowSection";
import MissionClock from "../Weather/MissionClock";
import EvaForecastSection from "../Weather/EvaForecastSection";
import { ROUTE_STATUS } from "../../utils/routeStatus";

/**
 * Mission Inspector (right panel, handoff §3.1).
 * Each section reflects the current result and states plainly when a value
 * is unavailable, outdated or not provided by the system.
 */
function MissionInsights({
  routeStatus,
  routeResult,
  routeError,
  isSubmitting,
  strategyId,
  comparison,
  comparisonLoading,
  canCompare,
  onCompare,
  onSelectStrategy,
  scienceTargets,
  scienceLoading,
  scienceError,
  onRetryScience,
  proximity,
  selectedTarget,
  onSelectTarget,
  onFitAoi,
  eva,
  evaLoading,
  evaError,
  evaInputs,
  onEvaInputsChange,
  weather,
}) {
  const stale = routeStatus === ROUTE_STATUS.OUTDATED;
  const hasRoute = Boolean(routeResult);
  const selectedDistance = selectedTarget ? proximity?.distances?.get(selectedTarget.id) ?? null : null;

  return (
    <div className="mw-inspector">
      <Accordion
        title="Mission summary"
        icon={<ClipboardList size={15} aria-hidden="true" />}
        meta={<StatusBadge status={routeStatus} />}
        defaultOpen
      >
        <RouteSummary status={routeStatus} result={routeResult} error={routeError} isSubmitting={isSubmitting} />
      </Accordion>

      {weather && (
        <>
          {weather.clock && weather.latestSol != null && (
            <Accordion
              title="Mission clock"
              icon={<Clock size={15} aria-hidden="true" />}
              meta={weather.clockSol != null ? <span className="mw-mono">Sol {weather.clockSol}</span> : null}
              defaultOpen
            >
              <MissionClock
                clock={weather.clock}
                latestSol={weather.latestSol}
                firstSol={weather.firstClockSol}
                now={weather.nowHour}
                nowLoading={weather.nowLoading}
                onGoLive={weather.onGoLive}
              />
            </Accordion>
          )}

          <Accordion
            title="Surface weather now"
            icon={<CloudSun size={15} aria-hidden="true" />}
            meta={weather.current ? <span className="mw-mono">{weather.measured ? "Measured" : "Estimate"}</span> : null}
            defaultOpen
          >
            <WeatherNowSection
              current={weather.current}
              loading={weather.currentLoading}
              error={weather.currentError}
              onRetry={weather.onRetry}
              measured={weather.measured}
              clockSol={weather.clockSol}
              estimate={weather.nowHour}
            />
          </Accordion>

          <Accordion
            title="EVA weather window"
            icon={<CalendarClock size={15} aria-hidden="true" />}
            meta={
              weather.forecast?.recommended_departure ? (
                <StatusBadge status="calculated" label="Window found" />
              ) : weather.route?.state === "current" && weather.forecast ? (
                <StatusBadge status="outdated" label="No window" />
              ) : null
            }
            defaultOpen
          >
            <EvaForecastSection
              forecast={weather.forecast}
              loading={weather.forecastLoading}
              error={weather.forecastError}
              onRetry={weather.onRetry}
              horizon={weather.horizon}
              onHorizonChange={weather.onHorizonChange}
              issueSol={weather.issueSol}
              route={weather.route}
              onOpenDashboard={weather.onOpenDashboard}
              onFitHorizon={weather.onFitHorizon}
            />
          </Accordion>
        </>
      )}

      <Accordion title="Strategy comparison" icon={<Scale size={15} aria-hidden="true" />} defaultOpen={false}>
        <RouteComparison
          comparison={comparison}
          activeStrategyId={strategyId}
          loading={comparisonLoading}
          disabled={!canCompare}
          onCompare={onCompare}
          onSelect={onSelectStrategy}
        />
      </Accordion>

      <Accordion
        title="Science targets"
        icon={<Atom size={15} aria-hidden="true" />}
        meta={scienceTargets.length ? <span className="mw-mono">{scienceTargets.length}</span> : null}
        defaultOpen
      >
        <ScienceSection
          targets={scienceTargets}
          loading={scienceLoading}
          error={scienceError}
          onRetry={onRetryScience}
          proximity={proximity}
          hasRoute={hasRoute}
          routeStale={stale}
          selectedId={selectedTarget?.id}
          onSelect={onSelectTarget}
          onLocate={onFitAoi}
        />
      </Accordion>

      <Accordion
        title="Selected target"
        icon={<Target size={15} aria-hidden="true" />}
        meta={selectedTarget ? <span className="mw-mono">{selectedTarget.id}</span> : null}
        defaultOpen
      >
        {selectedTarget ? (
          <TargetDetails target={selectedTarget} routeDistanceM={selectedDistance} routeStale={stale} />
        ) : (
          <div className="mw-empty">
            <p className="mw-empty__text">Select a science target on the map to inspect its available details.</p>
          </div>
        )}
      </Accordion>

      <Accordion title="EVA resources" icon={<Backpack size={15} aria-hidden="true" />} defaultOpen={false}>
        <EvaSection
          eva={eva}
          loading={evaLoading}
          error={evaError}
          inputs={evaInputs}
          onInputsChange={onEvaInputsChange}
          hasRoute={hasRoute}
          routeStale={stale}
        />
      </Accordion>

      <Accordion title="Provenance" icon={<Database size={15} aria-hidden="true" />} defaultOpen={false}>
        <ProvenanceSection result={routeResult} />
      </Accordion>
    </div>
  );
}

export default MissionInsights;
