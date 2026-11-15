import { ArrowRight, BrainCircuit, Database, Filter, Gauge, ShieldCheck, Sigma } from "lucide-react";

import InlineMessage from "../ui/InlineMessage";
import Skeleton from "../ui/Skeleton";

const STEPS = [
  { icon: Database, title: "MEDA data", text: "Hourly air and ground temperature (TIRS), pressure and radiation from Perseverance at Jezero." },
  { icon: Filter, title: "Quality control", text: "Removes sun-heated sensor spikes using the shape of each sol, then a 21-sol same-hour check." },
  { icon: Sigma, title: "Features", text: "Recent same-hour history, yesterday's smoothed anomaly, trend, dust and pressure signals, season." },
  { icon: BrainCircuit, title: "Models", text: "Ridge + LightGBM per lead time correct the 7-sol baseline; blend weights chosen walk-forward." },
  { icon: Gauge, title: "Uncertainty", text: "Real out-of-sample errors by lead and hour give the 50/80/90% bands and joint probabilities." },
  { icon: ShieldCheck, title: "EVA decision", text: "Daylight + P(air and ground limits met) → GO / Caution / No-Go, then windows for the route." },
];

const LABELS = { air_temp_k: "Air temperature", ground_temp_k: "Ground temperature" };

function FeatureBars({ items, color }) {
  const max = Math.max(...items.map((i) => i.gain_share));
  return (
    <ul className="mw-featbars">
      {items.slice(0, 10).map((item) => (
        <li key={item.feature}>
          <span className="mw-featbars__name mw-mono">{item.feature}</span>
          <span className="mw-featbars__bar">
            <span style={{ width: `${(item.gain_share / max) * 100}%`, background: color }} />
          </span>
          <span className="mw-featbars__value mw-mono">{(item.gain_share * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

function MethodTab({ report, error, status }) {
  if (error) return <InlineMessage tone="warning" title="The evaluation report is unavailable.">{error}</InlineMessage>;
  if (!report) return <Skeleton height={300} />;
  const { data, method } = report;
  const qc = data.qc;

  return (
    <div className="mw-dash__content">
      <section className="mw-pipeline" aria-label="Forecast pipeline">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="mw-pipeline__step">
              <span className="mw-pipeline__icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
              {i < STEPS.length - 1 && <ArrowRight className="mw-pipeline__arrow" size={16} aria-hidden="true" />}
            </div>
          );
        })}
      </section>

      <div className="mw-dash__charts">
        <section className="mw-card">
          <header className="mw-card__head">
            <h3>Data</h3>
          </header>
          <dl className="mw-facts">
            <div>
              <dt>Source</dt>
              <dd>{data.source}</dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>{data.site}</dd>
            </div>
            <div>
              <dt>Sols</dt>
              <dd className="mw-mono">
                {data.first_sol}–{data.last_sol} ({data.observed_hours.toLocaleString("en-US")} observed hours)
              </dd>
            </div>
            <div>
              <dt>Quality control</dt>
              <dd className="mw-mono">
                {qc.stage_a_air} sun-heated air hours · {qc.stage_b_air_temp_k_targets} air + {qc.stage_b_ground_temp_k_targets} ground temporal outliers
              </dd>
            </div>
            {Object.entries(data.splits).map(([name, split]) => (
              <div key={name}>
                <dt>{name.replace("_", " ")}</dt>
                <dd className="mw-mono">
                  Sols {split.sol_from}–{split.sol_to} · Ls {split.ls_from}° → {split.ls_to}°
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mw-card">
          <header className="mw-card__head">
            <h3>Method</h3>
          </header>
          <dl className="mw-facts">
            <div>
              <dt>Task</dt>
              <dd>{method.task}</dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd>{method.baseline}</dd>
            </div>
            <div>
              <dt>Models</dt>
              <dd>{method.models}</dd>
            </div>
            <div>
              <dt>Uncertainty</dt>
              <dd>{method.uncertainty}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{method.validation}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>
                {status?.model_engine ?? "—"} · {method.features} features · trained {report.generated_at?.slice(0, 10)}
              </dd>
            </div>
          </dl>
        </section>

        {Object.entries(report.feature_importance).map(([target, items]) => (
          <section key={target} className="mw-card">
            <header className="mw-card__head">
              <h3>What drives the {LABELS[target].toLowerCase()} forecast</h3>
              <span className="mw-card__meta">LightGBM gain share, weighted by its blend weight</span>
            </header>
            <FeatureBars items={items} color={target === "air_temp_k" ? "var(--mw-cyan)" : "var(--mw-violet)"} />
          </section>
        ))}

        <section className="mw-card">
          <header className="mw-card__head">
            <h3>Blend chosen per lead time</h3>
            <span className="mw-card__meta">Share of each correction added to the baseline</span>
          </header>
          <div className="mw-dash__table-wrap mw-scroll">
            <table className="mw-table mw-table--dense">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Air: ridge / GBM</th>
                  <th>Ground: ridge / GBM</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7].map((lead) => {
                  const a = method.choice.air_temp_k[String(lead)];
                  const g = method.choice.ground_temp_k[String(lead)];
                  return (
                    <tr key={lead}>
                      <th>+{lead} sol</th>
                      <td>
                        {a.w_ridge.toFixed(1)} / {a.w_gbm.toFixed(1)}
                      </td>
                      <td>
                        {g.w_ridge.toFixed(1)} / {g.w_gbm.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mw-card">
          <header className="mw-card__head">
            <h3>Limitations</h3>
          </header>
          <ul className="mw-bullets">
            <li>One Mars year of data: the test season (northern winter → spring) was not seen during training, so long-lead air forecasts stay close to the baseline.</li>
            <li>Only temperatures are forecast. MEDA's wind sensor was damaged and dust opacity (RDS) is not used, so dust enters only through radiation and pressure signals.</li>
            <li>Probabilities come from past errors; middle-range probabilities rest on few hours and should be read as approximate.</li>
            <li>Planning limits are placeholders until the team sets real suit and operations values.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export default MethodTab;
