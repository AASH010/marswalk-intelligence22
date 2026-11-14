import { useEffect, useState } from "react";

import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import InlineMessage from "../ui/InlineMessage";
import Metric from "../ui/Metric";
import ProvenanceRow from "../ui/ProvenanceRow";
import { TextField } from "../ui/Field";
import { formatFixed, formatInteger } from "../../utils/format";

/**
 * EVA resources (handoff §4.8).
 *
 * Every value comes from the mission consumables service. The two inputs are
 * planning assumptions the user supplies; the frontend performs no estimate
 * of its own and labels these as model outputs, not operational limits.
 */
const ASSUMPTION_ROWS = [
  ["base_walking_speed_ms", "Base walking speed", "m/s"],
  ["suit_capacity_hours", "Suit capacity", "h"],
  ["base_system_mass_kg", "Suit + crew mass", "kg"],
  ["payload_mass_kg", "Payload mass", "kg"],
  ["kcal_per_liter_o2", "kcal per litre O₂", ""],
  ["mars_gravity_m_s2", "Mars gravity", "m/s²"],
  ["muscular_efficiency", "Muscular efficiency", ""],
];

function EvaSection({ eva, loading, error, inputs, onInputsChange, hasRoute, routeStale }) {
  const [draft, setDraft] = useState({ payloadKg: String(inputs.payloadKg), averageSlopePercent: String(inputs.averageSlopePercent) });
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    setDraft({ payloadKg: String(inputs.payloadKg), averageSlopePercent: String(inputs.averageSlopePercent) });
  }, [inputs.payloadKg, inputs.averageSlopePercent]);

  if (!hasRoute) {
    return <EmptyState>EVA resource information is not available until a route has been calculated.</EmptyState>;
  }

  const commit = (key, value) => {
    const text = value.trim();
    const parsed = Number(text);
    if (text === "" || !Number.isFinite(parsed) || parsed < 0) {
      setFieldErrors((current) => ({ ...current, [key]: "Enter a number of 0 or more." }));
      return;
    }
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    if (parsed !== inputs[key]) onInputsChange({ ...inputs, [key]: parsed });
  };

  const state = loading ? "loading" : undefined;

  return (
    <div className="mw-stack">
      {routeStale && (
        <InlineMessage tone="warning" compact live={false}>
          Calculated from the previous route. Recalculate the route to update these values.
        </InlineMessage>
      )}

      {!error && eva?.oxygen_percent_of_suit_capacity != null && eva.oxygen_percent_of_suit_capacity > 100 && (
        <InlineMessage tone="warning" compact live={false}>
          The model reports a duration of {formatFixed(eva.estimated_duration_hours, 2)} h against a suit capacity of{" "}
          {formatFixed(eva.assumptions?.suit_capacity_hours, 1) ?? "—"} h, so this estimate exceeds the capacity it was given.
        </InlineMessage>
      )}

      {error ? (
        <InlineMessage tone="warning" title="EVA resource information is not available for this route.">
          {error}
        </InlineMessage>
      ) : (
        <div className="mw-metric-list">
          <Metric
            label="Duration"
            value={formatFixed(eva?.estimated_duration_hours, 2)}
            unit="h"
            state={state}
            stale={routeStale}
          />
          <Metric
            label="O₂ estimate"
            value={formatInteger(eva?.estimated_oxygen_liters)}
            unit="L"
            state={state}
            stale={routeStale}
          />
          <Metric
            label="Capacity used"
            value={formatFixed(eva?.oxygen_percent_of_suit_capacity, 1)}
            unit="%"
            state={state}
            stale={routeStale}
          />
          <Metric label="Safety margin" value={formatFixed(eva?.safety_margin_hours, 2)} unit="h" state={state} stale={routeStale} />
          <Metric
            label="Metabolic rate"
            value={formatFixed(eva?.average_metabolic_rate_kcal_hr, 1)}
            unit="kcal/h"
            state={state}
            stale={routeStale}
          />
          <Metric
            label="Slope penalty"
            value={formatFixed(eva?.slope_penalty_kcal_hr, 1)}
            unit="kcal/h"
            state={state}
            stale={routeStale}
          />
          <Metric
            label="Payload penalty"
            value={formatFixed(eva?.payload_penalty_kcal_hr, 1)}
            unit="kcal/h"
            state={state}
            stale={routeStale}
          />
        </div>
      )}

      <section>
        <h4 className="mw-section-title">Planning assumptions</h4>
        <div className="mw-manual__pair">
          <TextField
            label="Payload"
            inputMode="decimal"
            suffix="kg"
            value={draft.payloadKg}
            error={fieldErrors.payloadKg}
            onChange={(value) => setDraft((current) => ({ ...current, payloadKg: value }))}
            onBlur={(event) => commit("payloadKg", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <TextField
            label="Average slope"
            inputMode="decimal"
            suffix="%"
            value={draft.averageSlopePercent}
            error={fieldErrors.averageSlopePercent}
            onChange={(value) => setDraft((current) => ({ ...current, averageSlopePercent: value }))}
            onBlur={(event) => commit("averageSlopePercent", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <p className="mw-helper">
          These two values are sent to the consumables model with the route distance and terrain cost. They are user assumptions, not
          measurements from the route.
        </p>
      </section>

      {eva?.assumptions && (
        <section>
          <h4 className="mw-section-title">Model parameters</h4>
          <dl className="mw-provenance">
            {ASSUMPTION_ROWS.map(([key, label, unit]) => {
              const value = eva.assumptions[key];
              return (
                <ProvenanceRow
                  key={key}
                  label={label}
                  value={typeof value === "number" ? `${value}${unit ? ` ${unit}` : ""}` : null}
                />
              );
            })}
          </dl>
          {eva.assumptions.disclaimer && <p className="mw-helper">{eva.assumptions.disclaimer}</p>}
          <p className="mw-helper">Planning-model outputs only. These values are not operational flight limits.</p>
        </section>
      )}
    </div>
  );
}

export default EvaSection;
