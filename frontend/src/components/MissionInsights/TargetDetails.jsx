import { Check, X } from "lucide-react";

import Metric from "../ui/Metric";
import ProvenanceRow from "../ui/ProvenanceRow";
import EmptyState from "../ui/EmptyState";
import { formatCoordinate } from "../../utils/coordinates";
import { formatDistanceM, formatFixed } from "../../utils/format";
import { MARS_CRS_INFO } from "../../utils/mapConfig";

const RANKING_HELP =
  "Relative ranking is the mean percentile of this candidate's D2300 and BD1900_2 values among all detected candidates. It is a priority ranking, not a mineral confidence or identification probability.";

/**
 * Science target card (handoff §4.7) with its evidence and provenance.
 * Every field is printed exactly as supplied, and a field the record does
 * not carry is shown as not provided.
 */
function TargetDetails({ target, routeDistanceM, routeStale }) {
  const evidence = target.evidence || [];
  const distance = formatDistanceM(routeDistanceM);

  return (
    <div className="mw-stack">
      <header className="mw-target-head">
        <p className="mw-target-head__name">{target.name || target.id}</p>
        <span className="mw-target-head__id mw-mono">{target.id}</span>
      </header>

      <div className="mw-metric-list">
        <Metric label="Classification" value={target.target_type} />
        <Metric label="Relative ranking" value={formatFixed(target.science_value, 3)} help={RANKING_HELP} />
        <Metric label={`Location X (${MARS_CRS_INFO.units})`} value={formatCoordinate(target.x)} />
        <Metric label={`Location Y (${MARS_CRS_INFO.units})`} value={formatCoordinate(target.y)} />
        <Metric
          label="Distance to route"
          value={distance?.value ?? null}
          unit={distance?.unit ?? null}
          stale={routeStale}
          unavailableLabel="No route calculated"
          note={distance ? "Straight line to the nearest route vertex, not a traverse distance." : null}
        />
      </div>

      <section>
        <h4 className="mw-section-title">Evidence</h4>
        {evidence.length ? (
          <table className="mw-table mw-table--evidence">
            <caption className="mw-visually-hidden">Spectral evidence for this target</caption>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Value</th>
                <th scope="col">Threshold</th>
                <th scope="col">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item, index) => (
                <tr key={item.parameter || index}>
                  <th scope="row">
                    <span className="mw-evidence__parameter">
                      {item.passed_threshold === true && <Check size={12} aria-label="Passed threshold" className="mw-evidence__pass" />}
                      {item.passed_threshold === false && <X size={12} aria-label="Below threshold" className="mw-evidence__fail" />}
                      {item.parameter || "Not provided"}
                    </span>
                  </th>
                  <td className="mw-mono">{formatFixed(item.value_dn, 2) ?? "—"}</td>
                  <td className="mw-mono">{formatFixed(item.threshold_dn, 2) ?? "—"}</td>
                  <td className="mw-mono">{formatFixed(item.relative_percentile, 3) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>No evidence records are available for this target.</EmptyState>
        )}
        <p className="mw-helper">
          Values are digital numbers from the CRISM browse product. A candidate passes when both parameters meet their stored
          thresholds.
        </p>
      </section>

      <section>
        <h4 className="mw-section-title">Provenance</h4>
        <dl className="mw-provenance">
          <ProvenanceRow label="Source" value={target.source} />
          <ProvenanceRow label="Ranking" value={target.ranking_method} />
          <ProvenanceRow label="Frame" value={MARS_CRS_INFO.id} detail={MARS_CRS_INFO.axisOrder} />
          <ProvenanceRow label="Status" value="Candidate spectral signal" detail="Not a confirmed mineral identification." />
        </dl>
      </section>
    </div>
  );
}

export default TargetDetails;
