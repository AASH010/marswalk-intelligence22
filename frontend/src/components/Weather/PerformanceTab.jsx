import { useState } from "react";

import { BarChart, Histogram, LineChart, ReliabilityChart, ScatterChart } from "../charts/StatCharts";
import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";

const TARGET_LABEL = { air_temp_k: "Air temperature", ground_temp_k: "Ground temperature" };
const TARGET_COLOR = { air_temp_k: "var(--mw-cyan)", ground_temp_k: "var(--mw-violet)" };
const BASE = "var(--mw-text-secondary)";
const k2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const pct = (v, d = 0) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");

function Kpi({ label, value, detail, tone = "default" }) {
  return (
    <div className={`mw-kpi mw-kpi--${tone}`}>
      <span className="mw-kpi__label">{label}</span>
      <span className="mw-kpi__value">{value}</span>
      {detail && <span className="mw-kpi__detail">{detail}</span>}
    </div>
  );
}

function PerformanceTab({ report, error }) {
  const [target, setTarget] = useState("air_temp_k");
  if (error) return <InlineMessage tone="warning" title="The evaluation report is unavailable.">{error}</InlineMessage>;
  if (!report) {
    return (
      <div className="mw-dash__grid">
        <Skeleton height={100} />
        <Skeleton height={260} />
      </div>
    );
  }

  const metrics = report.metrics[target];
  const lead1 = metrics[0];
  const coverage = report.coverage[target];
  const boot = report.bootstrap[target];
  const test = report.data.splits.test;
  const color = TARGET_COLOR[target];
  const prob = report.probability;
  const pit = prob.pit?.[target];

  return (
    <div className="mw-dash__content">
      <div className="mw-dash__intro">
        <p>
          Every number below is <strong>out of sample</strong>: the test sols {test.sol_from}–{test.sol_to} (Ls {test.ls_from}° → {test.ls_to}°) were
          forecast walk-forward, with the model refit every {report.method.validation.match(/every (\d+)/)?.[1] ?? 60} sols on past data only,
          and were never used to choose the model. The baseline is the same-hour mean of the 7 sols before the forecast was issued.
        </p>
        <div className="mw-segmented" role="radiogroup" aria-label="Variable">
          {Object.keys(TARGET_LABEL).map((key) => (
            <button key={key} type="button" role="radio" aria-checked={target === key} className="mw-segmented__option" onClick={() => setTarget(key)}>
              {TARGET_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <section className="mw-kpis" aria-label="Headline scores">
        <Kpi label="Next-sol error (MAE)" value={`${k2(lead1.model.mae)} K`} detail={`baseline ${k2(lead1.baseline_mean7.mae)} K`} tone="success" />
        <Kpi label="Next-sol skill vs baseline" value={pct(lead1.skill_vs_mean7_pct, 1)} detail={`95% CI of the gain ${k2(boot[0].ci_low)}–${k2(boot[0].ci_high)} K`} tone={lead1.skill_vs_mean7_pct > 0 ? "success" : "warning"} />
        <Kpi label="Sols the model wins" value={pct(boot[0].sols_won_pct)} detail="next-sol MAE lower than baseline" />
        <Kpi label="80% band coverage" value={pct(coverage[0].coverage80 * 100, 1)} detail={`target 80% · width ${coverage[0].width80.toFixed(1)} K`} />
        <Kpi label="Day-to-day variation explained" value={pct(lead1.anomaly_r2 * 100)} detail="share of departures from baseline" />
      </section>

      <div className="mw-dash__charts">
        <section className="mw-card">
          <LineChart
            title={`${TARGET_LABEL[target]}: error by lead time`}
            series={[
              { name: "Model", color, points: metrics.map((m) => ({ x: m.lead, y: m.model.mae })) },
              { name: "7-sol baseline", color: BASE, dashed: true, points: metrics.map((m) => ({ x: m.lead, y: m.baseline_mean7.mae })) },
              { name: "Last sol (persistence)", color: "var(--mw-warning)", dashed: true, points: metrics.map((m) => ({ x: m.lead, y: m.baseline_last_sol.mae })) },
            ]}
            xTicks={[1, 2, 3, 4, 5, 6, 7]}
            xFormat={(v) => `+${v} sol${v > 1 ? "s" : ""}`}
            yFormat={(v) => `${v.toFixed(2)}`}
            yLabel="MAE (K)"
            xLabel="Lead time"
          />
        </section>
        <section className="mw-card">
          <BarChart
            title="Skill over the baseline by lead (with 95% CI of the gain)"
            categories={metrics.map((m) => `+${m.lead}`)}
            series={[
              { name: "Skill vs 7-sol baseline (%)", color, values: metrics.map((m) => m.skill_vs_mean7_pct) },
              { name: "Skill vs best simple baseline (%)", color: "var(--mw-blue)", values: metrics.map((m) => m.skill_vs_best_baseline_pct) },
            ]}
            yFormat={(v) => `${v.toFixed(0)}%`}
            xLabel="Lead (sols)"
            yInclude={[0]}
          />
          <table className="mw-table mw-table--dense mw-table--ci">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Gain (K)</th>
                <th>95% CI</th>
                <th>P(no gain)</th>
              </tr>
            </thead>
            <tbody>
              {boot.map((b) => (
                <tr key={b.lead}>
                  <th>+{b.lead}</th>
                  <td className={b.ci_low > 0 ? "mw-tone--success" : ""}>{k2(b.reduction_k)}</td>
                  <td>
                    {k2(b.ci_low)} to {k2(b.ci_high)}
                  </td>
                  <td>{pct(b.p_not_better * 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="mw-card">
          <BarChart
            title="Next-sol error by hour of day"
            categories={report.mae_by_hour_lead1[target].map((r) => String(r.hour).padStart(2, "0"))}
            series={[
              { name: "Model", color, values: report.mae_by_hour_lead1[target].map((r) => r.model) },
              { name: "7-sol baseline", color: BASE, values: report.mae_by_hour_lead1[target].map((r) => r.baseline) },
            ]}
            yFormat={(v) => v.toFixed(1)}
            yLabel="MAE (K)"
            xLabel="LTST hour"
          />
        </section>
        <section className="mw-card">
          <LineChart
            title="Next-sol error through the test period (15-sol rolling)"
            series={[
              { name: "Model", color, markers: false, points: report.rolling_mae_lead1[target].map((r) => ({ x: r.sol, y: r.model })) },
              { name: "7-sol baseline", color: BASE, dashed: true, markers: false, points: report.rolling_mae_lead1[target].map((r) => ({ x: r.sol, y: r.baseline })) },
            ]}
            xFormat={(v) => `Sol ${Math.round(v)}`}
            yFormat={(v) => v.toFixed(2)}
            yLabel="MAE (K)"
          />
        </section>
        <section className="mw-card">
          <LineChart
            title="Are the uncertainty bands honest? (coverage by lead)"
            series={[
              { name: "80% band", color, points: coverage.map((c) => ({ x: c.lead, y: c.coverage80 * 100 })) },
              { name: "90% band", color: "var(--mw-blue)", points: coverage.map((c) => ({ x: c.lead, y: c.coverage90 * 100 })) },
              { name: "Target 80%", color: BASE, dashed: true, markers: false, points: coverage.map((c) => ({ x: c.lead, y: 80 })) },
              { name: "Target 90%", color: "var(--mw-text-muted)", dashed: true, markers: false, points: coverage.map((c) => ({ x: c.lead, y: 90 })) },
            ]}
            xTicks={[1, 2, 3, 4, 5, 6, 7]}
            xFormat={(v) => `+${v}`}
            yFormat={(v) => `${v.toFixed(0)}%`}
            yInclude={[60, 100]}
            yLabel="Observed inside band"
            xLabel="Lead (sols)"
          />
        </section>
        <section className="mw-card">
          <ScatterChart
            title="Next-sol forecast vs observed (sample of test hours)"
            points={report.scatter_lead1[target].map(([a, f]) => [a, f])}
            color={color}
          />
        </section>
        {pit && (
          <section className="mw-card">
            <Histogram
              title="Where observations fall in the forecast distribution (PIT, next sol)"
              values={pit["1"].map((v) => v * 100)}
              edges={[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]}
              reference={10}
              color={color}
              xLabel="Forecast quantile of the observation"
              yFormat={(v) => `${v.toFixed(0)}%`}
            />
            <p className="mw-helper">A flat histogram at the dashed 10% line means the forecast distribution is calibrated.</p>
          </section>
        )}
        {prob.threshold_reliability?.[target] && (
          <section className="mw-card">
            <ReliabilityChart
              title="Reliability of P(temperature ≥ threshold)"
              series={[{ name: TARGET_LABEL[target], color, points: prob.threshold_reliability[target] }]}
            />
          </section>
        )}
        <section className="mw-card">
          <ReliabilityChart
            title="Reliability of P(GO) at the default limits"
            series={[
              { name: "Model", color: "var(--mw-success)", points: prob.reliability.p_model },
              { name: "Baseline", color: BASE, dashed: true, points: prob.reliability.p_base },
            ]}
          />
          <p className="mw-helper">
            Daylight test hours, limits air ≥ {prob.limits.air_min_k} K and ground ≥ {prob.limits.ground_min_k} K. Bubble size shows how many hours
            fall in each bin; middle bins hold few hours, so they are noisy.
          </p>
        </section>
        <section className="mw-card">
          <LineChart
            title="Decision quality by lead (GO when P ≥ 80%)"
            series={[
              { name: "Missed GO, model (%)", color: "var(--mw-success)", points: prob.by_lead.map((b) => ({ x: b.lead, y: b.missed_go_pct_model })) },
              { name: "Missed GO, baseline (%)", color: BASE, dashed: true, points: prob.by_lead.map((b) => ({ x: b.lead, y: b.missed_go_pct_base })) },
              { name: "False GO, model (%)", color: "var(--mw-critical)", points: prob.by_lead.map((b) => ({ x: b.lead, y: b.false_go_pct_model })) },
            ]}
            xTicks={[1, 2, 3, 4, 5, 6, 7]}
            xFormat={(v) => `+${v}`}
            yFormat={(v) => `${v.toFixed(1)}%`}
            yInclude={[0]}
            xLabel="Lead (sols)"
          />
        </section>
      </div>

      <section className="mw-card">
        <header className="mw-card__head">
          <h3>All scores by lead time · {TARGET_LABEL[target]}</h3>
          <span className="mw-card__meta">MAE / RMSE / bias in K · test sols only</span>
        </header>
        <div className="mw-dash__table-wrap mw-scroll">
          <table className="mw-table mw-table--dense">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Model MAE</th>
                <th>RMSE</th>
                <th>Bias</th>
                <th>Ridge MAE</th>
                <th>GBM MAE</th>
                <th>Baseline MAE</th>
                <th>Persistence MAE</th>
                <th>Skill</th>
                <th>80% cov.</th>
                <th>90% cov.</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m, i) => (
                <tr key={m.lead}>
                  <th>+{m.lead} sol</th>
                  <td>{k2(m.model.mae)}</td>
                  <td>{k2(m.model.rmse)}</td>
                  <td>{k2(m.model.bias)}</td>
                  <td>{k2(m.ridge.mae)}</td>
                  <td>{k2(m.gbm.mae)}</td>
                  <td>{k2(m.baseline_mean7.mae)}</td>
                  <td>{k2(m.baseline_last_sol.mae)}</td>
                  <td className={m.skill_vs_mean7_pct > 0 ? "mw-tone--success" : "mw-tone--warning"}>{pct(m.skill_vs_mean7_pct, 1)}</td>
                  <td>{pct(coverage[i].coverage80 * 100, 1)}</td>
                  <td>{pct(coverage[i].coverage90 * 100, 1)}</td>
                  <td>{m.n.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default PerformanceTab;
