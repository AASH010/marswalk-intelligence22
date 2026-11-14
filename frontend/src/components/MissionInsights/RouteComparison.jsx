import { useState } from "react";
import { Scale } from "lucide-react";

import Button from "../ui/Button";
import InlineMessage from "../ui/InlineMessage";
import { ROUTE_STRATEGIES } from "../../api/routes";
import { formatFixed } from "../../utils/format";

/**
 * Compares the three supported strategies for the current Start / Goal pair.
 * Each row is a real response from the route service; a strategy that
 * returned no route is reported as such rather than left blank.
 */
function RouteComparison({ comparison, activeStrategyId, onCompare, onSelect, loading, disabled }) {
  const [expanded, setExpanded] = useState(false);
  const entries = comparison?.entries || {};
  const available = ROUTE_STRATEGIES.filter((strategy) => entries[strategy.id]);

  return (
    <div className="mw-stack">
      <p className="mw-note">
        Runs the same Start and Goal through each supported strategy. Science opportunities and EVA estimates stay independent of the
        route search.
      </p>

      <Button
        variant="secondary"
        size="sm"
        block
        icon={<Scale size={14} aria-hidden="true" />}
        loading={loading}
        loadingLabel="Comparing strategies…"
        disabled={disabled}
        onClick={onCompare}
      >
        {available.length ? "Refresh comparison" : "Compare strategies"}
      </Button>

      {comparison?.stale && !loading && (
        <InlineMessage tone="warning" compact>
          Inputs changed since this comparison. Run it again to compare the current points.
        </InlineMessage>
      )}

      {available.length > 0 && (
        <>
          <table className="mw-table">
            <caption className="mw-visually-hidden">Route metrics by strategy</caption>
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col">Distance</th>
                <th scope="col">Terrain</th>
              </tr>
            </thead>
            <tbody>
              {ROUTE_STRATEGIES.map((strategy) => {
                const entry = entries[strategy.id];
                if (!entry) return null;
                const active = strategy.id === activeStrategyId;
                return (
                  <tr key={strategy.id} className={active ? "is-active" : ""}>
                    <th scope="row">
                      <button type="button" className="mw-table__link" onClick={() => onSelect?.(strategy.id)}>
                        {strategy.label}
                        {active && <span className="mw-visually-hidden"> (selected)</span>}
                      </button>
                    </th>
                    {entry.status === "ok" ? (
                      <>
                        <td className="mw-mono">{formatFixed(entry.result.metrics.distance_km, 2) ?? "—"} km</td>
                        <td className="mw-mono">{formatFixed(entry.result.metrics.average_raw_terrain_cost, 3) ?? "—"}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="mw-table__note">
                        {entry.message}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Button variant="tertiary" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide strategy definitions" : "Show strategy definitions"}
          </Button>

          {expanded && (
            <dl className="mw-definitions">
              {ROUTE_STRATEGIES.map((strategy) => (
                <div key={strategy.id}>
                  <dt>{strategy.label}</dt>
                  <dd>
                    Terrain weight {strategy.terrainWeight} applied to the terrain cost before the search, as defined by the route
                    service.
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  );
}

export default RouteComparison;
