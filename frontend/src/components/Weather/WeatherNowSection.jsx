import { ArrowDownRight, ArrowUpRight, Gauge, Sun, Sunrise, Thermometer } from "lucide-react";

import Button from "../ui/Button";
import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";
import { Sparkline } from "../charts/StatCharts";
import { fmtC, fmtHour, fmtK, fmtLtst } from "../../utils/weather";

function Delta({ now, before, unit = "K" }) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const diff = now - before;
  const Icon = diff >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`mw-delta ${diff >= 0 ? "is-up" : "is-down"}`} title="Change of the daily maximum since the previous sol">
      <Icon size={12} aria-hidden="true" />
      {Math.abs(diff).toFixed(1)} {unit}
    </span>
  );
}

/**
 * Surface conditions at Jezero for the mission clock's "now".
 *   - On a sol with data: what MEDA measured up to the clock hour.
 *   - After the last data: the model's estimate for this hour (with its 80 %
 *     range), next to the last measured sols for context.
 */
function WeatherNowSection({ current, loading, error, onRetry, measured, clockSol, estimate }) {
  if (error) {
    return (
      <InlineMessage tone="warning" title="Surface weather is unavailable.">
        {error}
        <div className="mw-message__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </InlineMessage>
    );
  }
  if (loading && !current) {
    return (
      <div className="mw-stack">
        <Skeleton width="100%" height={64} />
        <Skeleton width="100%" height={40} />
      </div>
    );
  }
  if (!current) return null;

  // No measurement yet at the clock hour of a measured sol: fall back to the estimate.
  const useEstimate = (!measured || (current.air_temp_k == null && current.ground_temp_k == null)) && Boolean(estimate);
  const airValue = useEstimate ? estimate.air.forecast : current.air_temp_k;
  const groundValue = useEstimate ? estimate.ground.forecast : current.ground_temp_k;
  const ls = useEstimate ? estimate.ls_deg : current.ls_deg;
  const sunElevation = useEstimate ? estimate.solar_elevation_deg : current.solar_elevation_deg;
  const range = (distribution) => `${fmtK(distribution.q10, 0)}–${fmtK(distribution.q90, 0)} K`;
  const air = current.series.map((p) => p.air_temp_k);
  const ground = current.series.map((p) => p.ground_temp_k);

  return (
    <div className="mw-now" data-tour="weather-now">
      <div className="mw-now__chips">
        <span className="mw-chip mw-chip--static">Sol {clockSol ?? current.sol}</span>
        <span className="mw-chip mw-chip--static">Ls {ls.toFixed(1)}°</span>
        <span className="mw-chip mw-chip--static">{current.season}</span>
        {useEstimate && <span className="mw-chip mw-chip--static mw-chip--warning">Model estimate</span>}
      </div>

      <div className="mw-now__readouts">
        <div className="mw-now__readout">
          <span className="mw-now__label">
            <Thermometer size={13} aria-hidden="true" /> Air
          </span>
          <span className="mw-now__value mw-mono">
            {fmtK(airValue, 1)}
            <small>K</small>
          </span>
          <span className="mw-now__sub mw-mono">{fmtC(airValue)} °C</span>
        </div>
        <div className="mw-now__readout">
          <span className="mw-now__label">
            <Thermometer size={13} aria-hidden="true" /> Ground
          </span>
          <span className="mw-now__value mw-mono mw-now__value--ground">
            {fmtK(groundValue, 1)}
            <small>K</small>
          </span>
          <span className="mw-now__sub mw-mono">{fmtC(groundValue)} °C</span>
        </div>
      </div>

      <div className="mw-now__trend">
        <div>
          <span className="mw-now__trend-label">
            <i className="mw-now__key mw-now__key--air" /> Air · {useEstimate && !measured ? "last measured" : "last 3 sols"}
          </span>
          <Sparkline values={air} width={136} height={30} color="var(--mw-cyan)" label="Air temperature over the last three sols" />
        </div>
        <div>
          <span className="mw-now__trend-label">
            <i className="mw-now__key mw-now__key--ground" /> Ground
          </span>
          <Sparkline values={ground} width={136} height={30} color="var(--mw-violet)" label="Ground temperature over the last three sols" />
        </div>
      </div>

      <dl className="mw-now__grid">
        <div>
          <dt>{useEstimate ? "Air, 80% range" : "Air today"}</dt>
          <dd className="mw-mono">
            {useEstimate ? (
              range(estimate.air)
            ) : (
              <>
                {fmtK(current.today?.air_min_k, 0)}–{fmtK(current.today?.air_max_k, 0)} K{" "}
                <Delta now={current.today?.air_max_k} before={current.previous?.air_max_k} />
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{useEstimate ? "Ground, 80% range" : "Ground today"}</dt>
          <dd className="mw-mono">
            {useEstimate ? range(estimate.ground) : `${fmtK(current.today?.ground_min_k, 0)}–${fmtK(current.today?.ground_max_k, 0)} K`}
          </dd>
        </div>
        <div>
          <dt>
            <Gauge size={12} aria-hidden="true" /> Pressure
          </dt>
          <dd className="mw-mono">{!useEstimate && current.pressure_pa != null ? `${current.pressure_pa.toFixed(0)} Pa` : "—"}</dd>
        </div>
        <div>
          <dt>
            <Sunrise size={12} aria-hidden="true" /> Daylight
          </dt>
          <dd className="mw-mono">
            {fmtLtst(current.sunrise_ltst)}–{fmtLtst(current.sunset_ltst)}
          </dd>
        </div>
        <div>
          <dt>
            <Sun size={12} aria-hidden="true" /> Sun now
          </dt>
          <dd className="mw-mono">{sunElevation != null ? `${sunElevation.toFixed(0)}°` : "—"}</dd>
        </div>
        <div>
          <dt>{useEstimate ? "Measured hours" : "Hours so far"}</dt>
          <dd className="mw-mono">{useEstimate ? "none" : `${current.today?.hours_observed ?? 0} measured`}</dd>
        </div>
      </dl>

      <p className="mw-helper">
        {useEstimate
          ? `No measurement exists for this time. These are the model's forecast values for this hour; the trend is the last measured sols (up to Sol ${current.sol}).`
          : `Latest reading Sol ${current.sol} · ${current.hour != null ? fmtHour(current.hour) : "—"} LTST, MEDA (Perseverance).${
              current.flagged_hours > 0 ? ` ${current.flagged_hours} hourly value${current.flagged_hours > 1 ? "s" : ""} removed by quality control.` : ""
            }`}
      </p>
    </div>
  );
}

export default WeatherNowSection;
