import { Clock, Gauge, Mountain, Ruler, Sparkles } from "lucide-react";

import InlineMessage from "../ui/InlineMessage";
import Metric from "../ui/Metric";
import { formatFixed, formatInteger, formatRequestId, formatTime } from "../../utils/format";
import { ROUTE_STATUS, describeRouteState } from "../../utils/routeStatus";
import { ROUTE_STRATEGIES } from "../../api/routes";

const TERRAIN_COST_HELP =
  "Terrain cost is the traversal multiplier the route service assigns to each cell from its slope: 1.0 is the minimum, 2.0 the maximum. It is unitless.";
const OPTIMIZATION_HELP =
  "Optimization cost is the same traversal cost after the selected strategy's terrain weight has been applied. It is the quantity the search minimises, and it is unitless.";

/**
 * Mission Summary and Route Metrics (handoff §4.5).
 *
 * Only metrics present in the response are printed. A metric the service did
 * not return reads "Not provided" and is never estimated here. When the
 * inputs have changed, every value is marked as belonging to the previous
 * inputs rather than to what is on screen now.
 */
function RouteSummary({ status, result, error, isSubmitting }) {
  const state = describeRouteState({ status, hasStart: true, hasGoal: true, error });
  const stale = status === ROUTE_STATUS.OUTDATED;
  const metrics = result?.metrics;
  const metricState = isSubmitting ? "loading" : undefined;
  const strategy = ROUTE_STRATEGIES.find((item) => item.id === result?.snapshot?.strategyId);

  return (
    <div className="mw-stack">
      <InlineMessage tone={state.tone} compact live={false}>
        {state.title}
        {state.text ? ` ${state.text}` : ""}
      </InlineMessage>

      {result && (
        <>
          <dl className="mw-summary-meta">
            <div>
              <dt>Strategy</dt>
              <dd>{result.mode || strategy?.label || "Not provided"}</dd>
            </div>
            <div>
              <dt>Calculated</dt>
              <dd className="mw-mono">{formatTime(result.completedAt) ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Request</dt>
              <dd className="mw-mono">{formatRequestId(result.requestId) ?? "Not provided"}</dd>
            </div>
          </dl>

          <div className="mw-metric-grid">
            <Metric
              layout="card"
              icon={<Ruler size={14} aria-hidden="true" />}
              label="Distance"
              value={formatFixed(metrics.distance_km, 2)}
              unit="km"
              state={metricState}
              stale={stale}
            />
            <Metric
              layout="card"
              icon={<Mountain size={14} aria-hidden="true" />}
              label="Terrain cost"
              value={formatFixed(metrics.average_raw_terrain_cost, 3)}
              state={metricState}
              stale={stale}
              help={TERRAIN_COST_HELP}
              note="Mean along route"
            />
            <Metric
              layout="card"
              icon={<Gauge size={14} aria-hidden="true" />}
              label="Optimization"
              value={formatFixed(metrics.average_optimization_cost, 3)}
              state={metricState}
              stale={stale}
              help={OPTIMIZATION_HELP}
              note="Mean along route"
            />
            <Metric
              layout="card"
              icon={<Sparkles size={14} aria-hidden="true" />}
              label="Route points"
              value={formatInteger(result.coordinates.length)}
              state={metricState}
              stale={stale}
              note={`${result.coordinates.length ? "20 m grid cells" : ""}`}
            />
          </div>

          <div className="mw-metric-list">
            <Metric
              label="Accumulated terrain cost"
              value={formatFixed(metrics.raw_terrain_cost, 2)}
              state={metricState}
              stale={stale}
              help={TERRAIN_COST_HELP}
            />
            <Metric
              label="Accumulated optimization cost"
              value={formatFixed(metrics.optimization_cost, 2)}
              state={metricState}
              stale={stale}
              help={OPTIMIZATION_HELP}
            />
          </div>

          <p className="mw-helper">
            <Clock size={11} aria-hidden="true" /> Values are the ones returned for the inputs listed above. Metrics the service does
            not return are shown as not provided.
          </p>
        </>
      )}
    </div>
  );
}

export default RouteSummary;
