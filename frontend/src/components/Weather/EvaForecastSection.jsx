import { CalendarClock, ExternalLink, Footprints, TriangleAlert } from "lucide-react";

import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";
import StatusStrip from "../charts/StatusStrip";
import HorizonControl from "./HorizonControl";
import { fmtPct, fmtSolRange, summarizeHours } from "../../utils/weather";

/**
 * EVA weather forecast in the Mission Inspector: forecast range counted from
 * the mission clock's now, hourly status timeline, and — once a route is calculated — the best departure
 * that fits the route's estimated duration into a GO window.
 */
function EvaForecastSection({
  forecast,
  loading,
  error,
  onRetry,
  horizon,
  onHorizonChange,
  issueSol,
  route,
  onOpenDashboard,
  onFitHorizon,
}) {
  const summary = summarizeHours(forecast?.hours);
  const departure = forecast?.recommended_departure;
  const firstWindow = forecast?.windows?.[0];
  const highlight = departure ? { start: departure.start.offset_hours, end: departure.end.offset_hours } : null;

  return (
    <div className="mw-stack" data-tour="weather-forecast">
      <HorizonControl start={horizon.start} end={horizon.end} hours={forecast?.hours} onChange={onHorizonChange} compact />

      {error ? (
        <InlineMessage tone="warning" title="The forecast is unavailable.">
          {error}
          <div className="mw-message__action">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineMessage>
      ) : !forecast ? (
        <Skeleton width="100%" height={72} />
      ) : (
        <>
          <div className={`mw-eva-counts ${loading ? "is-loading" : ""}`} aria-live="polite">
            <span className="mw-eva-count mw-eva-count--go">
              <strong className="mw-mono">{summary.counts.GO}</strong> h GO
            </span>
            <span className="mw-eva-count mw-eva-count--caution">
              <strong className="mw-mono">{summary.counts.CAUTION}</strong> h Caution
            </span>
            <span className="mw-eva-count mw-eva-count--nogo">
              <strong className="mw-mono">{summary.counts.NO_GO}</strong> h No-Go
            </span>
          </div>

          <StatusStrip hours={forecast.hours} highlight={highlight} compact />

          {route.state === "none" && (
            <EmptyState icon={<Footprints size={15} aria-hidden="true" />}>
              Calculate a route to fit its estimated duration into a GO window.
              {firstWindow ? ` Next GO window: ${fmtSolRange(firstWindow.start, firstWindow.end)}.` : ""}
            </EmptyState>
          )}

          {route.state === "pending" && <Skeleton width="100%" height={56} />}

          {route.state === "stale" && (
            <InlineMessage tone="warning" compact live={false}>
              The route changed. Recalculate it to update the departure window.
            </InlineMessage>
          )}

          {route.state === "current" && route.hours != null && (
            <div className={`mw-departure ${departure ? "is-ok" : "is-none"}`} data-tour="weather-departure">
              <div className="mw-departure__head">
                <CalendarClock size={16} aria-hidden="true" />
                <span>
                  Route needs <strong className="mw-mono">{route.hours.toFixed(1)} h</strong>
                  {departure ? ` (${departure.hours_needed} hourly slots)` : ""}
                </span>
              </div>
              {departure ? (
                <>
                  <p className="mw-departure__time mw-mono">
                    {fmtSolRange(departure.start, departure.end)}
                  </p>
                  <p className="mw-departure__meta">
                    Lowest hourly confidence <strong className="mw-mono">{fmtPct(departure.min_p_go)}</strong> · mean{" "}
                    <span className="mw-mono">{fmtPct(departure.mean_p_go)}</span>
                  </p>
                </>
              ) : (
                <p className="mw-departure__meta">
                  <TriangleAlert size={13} aria-hidden="true" /> No GO window in this range is long enough.
                  {onFitHorizon && (
                    <Button variant="tertiary" size="sm" onClick={onFitHorizon}>
                      Search 7 sols
                    </Button>
                  )}
                </p>
              )}
            </div>
          )}

        </>
      )}

      <Button variant="secondary" block icon={<ExternalLink size={14} aria-hidden="true" />} onClick={onOpenDashboard} data-tour="weather-open-dashboard">
        Open forecast dashboard
      </Button>
      <p className="mw-helper">Limits are planning placeholders, not suit specifications. Adjust them in the dashboard.</p>
    </div>
  );
}

export default EvaForecastSection;
