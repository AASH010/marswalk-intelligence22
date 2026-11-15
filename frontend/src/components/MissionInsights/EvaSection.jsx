import { useEffect, useState } from "react";

import EmptyState from "../ui/EmptyState";
import InlineMessage from "../ui/InlineMessage";
import Metric from "../ui/Metric";
import ProvenanceRow from "../ui/ProvenanceRow";
import StatusBadge from "../ui/StatusBadge";
import { TextField } from "../ui/Field";
import { formatFixed, formatInteger } from "../../utils/format";

/**
 * EVA resources (handoff §4.8), from POST /api/v1/mission/eva-estimate.
 *
 * The server plans the route itself and evaluates every segment: distance,
 * slope, grade and terrain all come from the route, never from the user.
 * The only user input is the carried payload. Each value carries a tag
 * (measured / calculated / modeled / assumed), shown next to it.
 */
const TAG_LABELS = {
  measured: "Measured",
  calculated: "Calculated",
  modeled: "Modeled",
  assumed: "Assumed",
};

const PARAMETER_LABELS = {
  base_walking_speed_ms: "Base walking speed",
  payload_kg: "Payload",
  suit_capacity_hours: "Suit capacity",
  k_t: "Terrain slowdown k_t",
  k_s: "Slope slowdown k_s",
  body_mass_kg: "Body mass",
  suit_mass_kg: "Suit mass",
  terrain_factor_eta: "Terrain factor η",
  pandolf_coefficients: "Pandolf coefficients",
  mars_gravity_m_s2: "Mars gravity",
  earth_gravity_m_s2: "Earth gravity",
  gravity_scale: "Gravity scale",
  kcal_per_hour_per_watt: "kcal/h per watt",
  kcal_per_liter_o2: "kcal per litre O₂",
  min_metabolic_rate_kcal_hr: "Min. reported rate",
  max_metabolic_rate_kcal_hr: "Max. reported rate",
  weather_energy_coefficient: "Weather energy term",
};

const WEATHER_BADGES = {
  applied: { status: "calculated", label: "Weather applied" },
  unavailable: { status: "unavailable", label: "Weather unavailable" },
  disabled: { status: "unavailable", label: "Weather off" },
};

const CONFIDENCE_LABELS = {
  high: "High: weather and terrain both applied",
  reduced: "Reduced: route planned without weather",
  invalid: "Invalid: the route could not be evaluated",
};

function tagNote(entry) {
  return entry?.tag ? TAG_LABELS[entry.tag] || entry.tag : null;
}

function formatParameter(param) {
  if (typeof param.value === "number") {
    const value = Number.isInteger(param.value) ? param.value : Number(param.value.toPrecision(4));
    return `${value}${param.unit && param.unit !== "1" ? ` ${param.unit}` : ""}`;
  }
  return typeof param.value === "string" ? param.value : null;
}

function EvaSection({ eva, loading, error, inputs, onInputsChange, hasRoute, routeStale }) {
  const [draft, setDraft] = useState(String(inputs.payloadKg));
  const [fieldError, setFieldError] = useState(null);

  useEffect(() => {
    setDraft(String(inputs.payloadKg));
  }, [inputs.payloadKg]);

  if (!hasRoute) {
    return <EmptyState>EVA resource information is not available until a route has been calculated.</EmptyState>;
  }

  const commit = (value) => {
    const text = value.trim();
    const parsed = Number(text);
    if (text === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > 500) {
      setFieldError("Enter a payload between 0 and 500 kg.");
      return;
    }
    setFieldError(null);
    if (parsed !== inputs.payloadKg) onInputsChange({ ...inputs, payloadKg: parsed });
  };

  const state = loading ? "loading" : undefined;
  const totals = eva?.totals;
  const weatherBadge = WEATHER_BADGES[eva?.weatherStatus];
  const clamped = totals?.metabolic_rate_clamped === true;

  return (
    <div className="mw-stack">
      {routeStale && (
        <InlineMessage tone="warning" compact live={false}>
          Calculated from the previous route. Recalculate the route to update these values.
        </InlineMessage>
      )}

      {error ? (
        <InlineMessage tone="warning" title="EVA resource information is not available for this route.">
          {error}
        </InlineMessage>
      ) : (
        <>
          {eva && !loading && (
            <div className="mw-stack">
              {weatherBadge && (
                <div>
                  <StatusBadge status={weatherBadge.status} label={weatherBadge.label} />
                </div>
              )}
              {eva.confidence && (
                <p className="mw-helper">Confidence: {CONFIDENCE_LABELS[eva.confidence] || eva.confidence}</p>
              )}
            </div>
          )}

          {!loading &&
            eva?.warnings?.map((warning) => (
              <InlineMessage key={warning} tone="warning" compact live={false}>
                {warning}
              </InlineMessage>
            ))}

          <div className="mw-metric-list">
            <Metric
              label="Duration"
              value={formatFixed(totals?.duration_hours?.value, 2)}
              unit="h"
              note={tagNote(totals?.duration_hours)}
              state={state}
              stale={routeStale}
            />
            <Metric
              label="Suit time used"
              value={formatFixed(totals?.suit_time_fraction_percent?.value, 1)}
              unit="%"
              note={tagNote(totals?.suit_time_fraction_percent)}
              help="Walking time as a share of suit time capacity. This is time, not oxygen."
              state={state}
              stale={routeStale}
            />
            <Metric
              label="Suit time margin"
              value={formatFixed(totals?.suit_time_margin_hours?.value, 2)}
              unit="h"
              note={tagNote(totals?.suit_time_margin_hours)}
              state={state}
              stale={routeStale}
            />
            <Metric
              label="O₂ estimate"
              value={formatInteger(totals?.oxygen_liters?.value)}
              unit="L"
              note={tagNote(totals?.oxygen_liters)}
              state={state}
              stale={routeStale}
            />
            <Metric
              label="Energy"
              value={formatInteger(totals?.energy_kcal?.value)}
              unit="kcal"
              note={tagNote(totals?.energy_kcal)}
              state={state}
              stale={routeStale}
            />
            <Metric
              label="Metabolic rate"
              value={formatFixed(totals?.average_metabolic_rate_kcal_hr?.value, 1)}
              unit="kcal/h"
              note={
                clamped
                  ? `Outside the configured range; reported as ${formatFixed(totals?.reported_metabolic_rate_kcal_hr?.value, 1)} kcal/h`
                  : tagNote(totals?.average_metabolic_rate_kcal_hr)
              }
              state={state}
              stale={routeStale}
            />
          </div>
        </>
      )}

      <section>
        <h4 className="mw-section-title">Planning input</h4>
        <TextField
          label="Payload"
          inputMode="decimal"
          suffix="kg"
          value={draft}
          error={fieldError}
          onChange={setDraft}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <p className="mw-helper">
          Payload is the only value you set. Distance, slope, grade and terrain are taken from the planned route on the server, segment by
          segment.
        </p>
      </section>

      {eva?.parameters?.length > 0 && (
        <section>
          <h4 className="mw-section-title">Model parameters</h4>
          <dl className="mw-provenance">
            {eva.parameters.map((param) => (
              <ProvenanceRow
                key={param.name}
                label={PARAMETER_LABELS[param.name] || param.name}
                value={formatParameter(param)}
                detail={`${TAG_LABELS[param.tag] || param.tag} · ${param.source}`}
              />
            ))}
          </dl>
          {eva.model?.validation && <p className="mw-helper">{eva.model.validation}</p>}
        </section>
      )}
    </div>
  );
}

export default EvaSection;
