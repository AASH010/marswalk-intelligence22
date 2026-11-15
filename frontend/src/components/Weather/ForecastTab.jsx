import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, CloudSun, Gauge, ShieldCheck, Thermometer } from "lucide-react";

import FanChart from "../charts/FanChart";
import ProbabilityChart from "../charts/ProbabilityChart";
import StatusStrip from "../charts/StatusStrip";
import Heatmap from "../charts/Heatmap";
import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";
import HorizonControl from "./HorizonControl";
import LimitsEditor from "./LimitsEditor";
import { STATUS_META, fmtC, fmtHour, fmtK, fmtPct, fmtSolHour, summarizeHours } from "../../utils/weather";

function Kpi({ icon, label, value, detail, tone = "default" }) {
  return (
    <div className={`mw-kpi mw-kpi--${tone}`}>
      <span className="mw-kpi__label">
        {icon}
        {label}
      </span>
      <span className="mw-kpi__value">{value}</span>
      {detail && <span className="mw-kpi__detail">{detail}</span>}
    </div>
  );
}

function ForecastTab({ forecast, week, loading, error, horizon, onHorizonChange, issueSol, limits, defaultLimits, onLimitsChange, routeHours }) {
  const [hover, setHover] = useState(null);
  const [tableOpen, setTableOpen] = useState(false);
  const summary = useMemo(() => summarizeHours(forecast?.hours), [forecast]);

  if (error) return <InlineMessage tone="warning" title="The forecast is unavailable.">{error}</InlineMessage>;
  if (!forecast) {
    return (
      <div className="mw-dash__grid">
        <Skeleton height={120} />
        <Skeleton height={260} />
        <Skeleton height={260} />
      </div>
    );
  }

  const departure = forecast.recommended_departure;
  const nextWindow = forecast.windows[0];
  const highlight = departure ? { start: departure.start.offset_hours, end: departure.end.offset_hours } : null;
  const v = forecast.verification;

  return (
    <div className={`mw-dash__content ${loading ? "is-loading" : ""}`}>
      <section className="mw-dash__controls">
        <div className="mw-dash__control-block">
          <h3 className="mw-dash__h3">Forecast range</h3>
          <HorizonControl start={horizon.start} end={horizon.end} hours={forecast?.hours} onChange={onHorizonChange} />
        </div>
        <div className="mw-dash__control-block">
          <h3 className="mw-dash__h3">Planning limits</h3>
          <LimitsEditor limits={limits} defaults={defaultLimits} onChange={onLimitsChange} />
        </div>
      </section>

      <section className="mw-kpis" aria-label="Forecast summary" data-tour="dashboard-kpis">
        {routeHours != null ? (
          <Kpi
            icon={<CalendarClock size={14} aria-hidden="true" />}
            label={`Best departure for ${routeHours.toFixed(1)} h route`}
            value={departure ? fmtSolHour(departure.start) : "None in range"}
            detail={departure ? `back by ${fmtSolHour(departure.end)} · min ${fmtPct(departure.min_p_go)}` : "Extend the range or adjust limits"}
            tone={departure ? "success" : "warning"}
          />
        ) : (
          <Kpi
            icon={<CalendarClock size={14} aria-hidden="true" />}
            label="Next GO window"
            value={nextWindow ? fmtSolHour(nextWindow.start) : "None in range"}
            detail={nextWindow ? `${nextWindow.length_hours} h · until ${fmtSolHour(nextWindow.end)}` : "No GO hours in this range"}
            tone={nextWindow ? "success" : "warning"}
          />
        )}
        <Kpi
          icon={<ShieldCheck size={14} aria-hidden="true" />}
          label="GO hours"
          value={`${summary.counts.GO} h`}
          detail={`${summary.counts.CAUTION} h caution · ${summary.counts.NO_GO} h no-go`}
        />
        <Kpi
          icon={<Thermometer size={14} aria-hidden="true" />}
          label="Air temperature"
          value={`${fmtK(summary.airMin, 0)}–${fmtK(summary.airMax, 0)} K`}
          detail={`${fmtC(summary.airMin)} to ${fmtC(summary.airMax)} °C`}
        />
        <Kpi
          icon={<Gauge size={14} aria-hidden="true" />}
          label="Mean daylight confidence"
          value={fmtPct(summary.meanConfidence)}
          detail="P(both limits met), daylight hours"
        />
        {v && (
          <Kpi
            icon={<CloudSun size={14} aria-hidden="true" />}
            label="Replay check"
            value={`${v.mae_air_model?.toFixed(2)} K`}
            detail={`air error vs baseline ${v.mae_air_baseline?.toFixed(2)} K · ground ${v.mae_ground_model?.toFixed(2)} vs ${v.mae_ground_baseline?.toFixed(2)} K`}
            tone={v.mae_air_model <= v.mae_air_baseline ? "success" : "default"}
          />
        )}
      </section>

      <section className="mw-dash__summary" aria-label="Forecast narrative">
        {forecast.summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      <section className="mw-card" data-tour="dashboard-timeline">
        <header className="mw-card__head">
          <h3>EVA status timeline</h3>
          <span className="mw-card__meta">{forecast.is_replay ? "Top: forecast · bottom: what was observed" : "Hover for the reason of each hour"}</span>
        </header>
        <StatusStrip hours={forecast.hours} highlight={highlight} hoverOffset={hover} onHover={setHover} actual={forecast.is_replay} />
      </section>

      <div className="mw-dash__charts">
        <section className="mw-card" data-tour="dashboard-fan">
          <FanChart
            hours={forecast.hours}
            variable="air"
            title="Air temperature forecast"
            limit={{ value: limits.air_min_k, label: `Air limit ${limits.air_min_k} K` }}
            highlight={highlight}
            hoverOffset={hover}
            onHover={setHover}
          />
        </section>
        <section className="mw-card">
          <FanChart
            hours={forecast.hours}
            variable="ground"
            title="Ground temperature forecast"
            limit={{ value: limits.ground_min_k, label: `Ground limit ${limits.ground_min_k} K` }}
            highlight={highlight}
            hoverOffset={hover}
            onHover={setHover}
          />
        </section>
        <section className="mw-card mw-card--wide">
          <ProbabilityChart
            hours={forecast.hours}
            limits={limits}
            title="Probability that both limits are met"
            highlight={highlight}
            hoverOffset={hover}
            onHover={setHover}
          />
        </section>
      </div>

      <section className="mw-card" data-tour="dashboard-heatmap">
        <header className="mw-card__head">
          <h3>Seven-sol outlook</h3>
          <span className="mw-card__meta">Probability (%) that both limits are met, every hour of the next 7 sols</span>
        </header>
        {week ? <Heatmap hours={week.hours} /> : <Skeleton height={200} />}
      </section>

      <section className="mw-card">
        <button type="button" className="mw-card__toggle" aria-expanded={tableOpen} onClick={() => setTableOpen((o) => !o)}>
          <h3>Hourly values</h3>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {tableOpen && (
          <div className="mw-dash__table-wrap mw-scroll">
            <table className="mw-table mw-table--dense">
              <thead>
                <tr>
                  <th>Sol · LTST</th>
                  <th>Status</th>
                  <th>P(GO)</th>
                  <th>Air K</th>
                  <th>Air 80%</th>
                  <th>Ground K</th>
                  <th>Ground 80%</th>
                  <th>Sun</th>
                  {forecast.is_replay && <th>Observed air / ground</th>}
                </tr>
              </thead>
              <tbody>
                {forecast.hours.map((h) => (
                  <tr key={h.offset_hours}>
                    <th>
                      Sol {h.sol} · {fmtHour(h.hour)}
                    </th>
                    <td className={`mw-tone--${STATUS_META[h.status].tone}`}>{STATUS_META[h.status].label}</td>
                    <td>{fmtPct(h.p_go)}</td>
                    <td>{fmtK(h.air.forecast)}</td>
                    <td>
                      {fmtK(h.air.q10, 0)}–{fmtK(h.air.q90, 0)}
                    </td>
                    <td>{fmtK(h.ground.forecast)}</td>
                    <td>
                      {fmtK(h.ground.q10, 0)}–{fmtK(h.ground.q90, 0)}
                    </td>
                    <td>{h.solar_elevation_deg.toFixed(0)}°</td>
                    {forecast.is_replay && (
                      <td>
                        {fmtK(h.air.actual)} / {fmtK(h.ground.actual)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ForecastTab;
