"""Train, evaluate and export the MEDA surface-weather forecast model.

Reads   data/weather/meda/meda_hourly_*.csv   (hourly MEDA means, Jezero crater)
Writes  backend/app/ml/weather/artifacts/
          model.json, gbm_air.txt, gbm_gnd.txt   the forecast models
          residuals.npz                            out-of-sample errors (uncertainty)
          report.json                              evaluation shown in the dashboard

Protocol
  * Forecast issued at the end of sol t for every hour of sols t+1 .. t+7.
  * Time-based split: model selection on sols 200-519, test on sols 520-700.
  * Walk-forward: every 60 sols the models are refit on targets observed
    before the block and predict the block, as they would be used in a mission.
    Selection spans several seasons (Ls ~95-280) so the chosen blend does not
    depend on one season's behaviour.
  * Hyperparameters, ridge strength and blend weights are chosen on the
    selection sols only; the test sols are predicted once with the frozen choices.

Run from the repository root:  python scripts/train_weather_model.py
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import lightgbm as lgb  # noqa: E402

from app.ml.weather.features import (  # noqa: E402
    FIRST_SOL,
    MAX_LEAD_SOLS,
    TARGETS,
    build_issue_features,
    file_list,
    lead_feature_names,
    lead_rows,
    load_hourly,
    mars_ls,
    prepare_grids,
    ridge_design,
    solar_elevation_deg,
)
from app.ml.weather.model import QUANTILE_LEVELS, ResidualPool, WeatherModel, fit_ridge  # noqa: E402

DATA_DIR = ROOT / "data" / "weather" / "meda"
OUT_DIR = ROOT / "backend" / "app" / "ml" / "weather" / "artifacts"

SEED = 42
TRAIN_END, VAL_END = 400, 520  # TRAIN_END: sols used to estimate the QC curvature reference
SELECT_START = 200  # model selection is walk-forward over sols 200-519 (Ls ~95-280), several seasons
CHUNK = 60
LEADS = list(range(1, MAX_LEAD_SOLS + 1))
ALPHAS = [100.0, 1000.0, 10000.0, 100000.0]
LEAVES = [15, 31]
ITERS = [200, 400, 700, 1000]
DEFAULT_LIMITS = {"air_min_k": 205.0, "ground_min_k": 210.0, "go_confidence": 0.8, "caution_confidence": 0.5}

np.random.seed(SEED)
t0 = time.time()


def log(message: str) -> None:
    print(f"[{time.time() - t0:6.0f}s] {message}", flush=True)


# ================================================================ 1. data
hourly = load_hourly(file_list(DATA_DIR))
grids, normal_bump = prepare_grids(hourly, train_end=TRAIN_END)
feats = build_issue_features(grids.inputs, grids.partial, grids.ls)
issue_names = list(feats)
columns = lead_feature_names(issue_names)
sols, n = grids.sols, len(grids.sols)
log(f"sols {sols[0]}-{grids.last_observed_sol} | features {len(columns)} | QC {grids.qc_counts}")

# ================================================================ 2. stacked (issue, lead, hour) dataset
blocks, meta = [], []
for i in range(8, n - 1):  # issue sol sols[i]-1 needs a week of history
    issue_sol = int(sols[i] - 1)
    for lead in LEADS:
        j = i + lead - 1  # row of the target sol
        if j > n - 2:  # the last row is the unobserved forecast sol
            break
        blocks.append(lead_rows(feats, issue_names, grids.partial, sols, i, lead))
        meta.append((issue_sol, issue_sol + lead, lead, j))
X = np.vstack(blocks)
issue = np.repeat([m[0] for m in meta], 24)
target_sol = np.repeat([m[1] for m in meta], 24)
lead = np.repeat([m[2] for m in meta], 24)
hour = np.tile(np.arange(24), len(meta))
Y = {v: np.concatenate([grids.targets[v][m[3]] for m in meta]) for v in TARGETS}
col = {c: k for k, c in enumerate(columns)}
BASE = {v: X[:, col[f"{t}_mean7"]] for v, t in TARGETS.items()}
log(f"stacked rows {len(X):,} ({len(meta)} issue-lead pairs)")


def gbm_params(leaves: int, n_estimators: int) -> dict:
    return dict(objective="l1", num_leaves=leaves, learning_rate=0.02, n_estimators=n_estimators, min_child_samples=80,
                subsample=0.8, subsample_freq=1, colsample_bytree=0.6, reg_lambda=10.0, random_state=SEED, verbose=-1,
                deterministic=True, force_row_wise=True)


def usable(mask: np.ndarray, target: str) -> np.ndarray:
    return mask & np.isfinite(Y[target]) & np.isfinite(BASE[target])


def ridge_matrix(rows: np.ndarray, target: str):
    return ridge_design(X[rows], columns, TARGETS[target])


# ================================================================ 3. walk-forward
def fit_gbm(rows: np.ndarray, target: str, leaves: int, iterations: int):
    model = lgb.LGBMRegressor(**gbm_params(leaves, iterations))
    return model.fit(X[rows], Y[target][rows] - BASE[target][rows])


def fit_ridge_rows(rows: np.ndarray, target: str, alpha: float):
    design, names = ridge_matrix(rows, target)
    return fit_ridge(design, Y[target][rows] - BASE[target][rows], names, alpha)


def walk_forward(start: int, end: int, grid: dict, score_until: int) -> pd.DataFrame:
    """Out-of-sample predictions for issue sols t with start <= t+1 < end.

    ``grid`` maps target -> lead -> {"gbm": [(leaves, [iterations...])], "alpha": [...]}.
    Each candidate's prediction is stored in its own column.
    """
    out = []
    for c0 in range(start, end, CHUNK):
        c1 = min(c0 + CHUNK, end)
        rows_pred = np.flatnonzero((issue + 1 >= c0) & (issue + 1 < c1) & (target_sol < score_until))
        frame = pd.DataFrame({"issue": issue[rows_pred], "target_sol": target_sol[rows_pred], "lead": lead[rows_pred], "hour": hour[rows_pred]})
        for target in TARGETS:
            frame[target] = Y[target][rows_pred]
            frame[f"{target}_base"] = BASE[target][rows_pred]
            train_all = np.flatnonzero(usable(target_sol < c0, target))
            for k in LEADS:
                tr = train_all[lead[train_all] == k]
                sel = lead[rows_pred] == k
                rp = rows_pred[sel]
                if rp.size == 0:
                    continue
                for leaves, iteration_list in grid[target][k]["gbm"]:
                    model = fit_gbm(tr, target, leaves, max(iteration_list))
                    for it in iteration_list:
                        frame.loc[sel, f"{target}_gbm_l{leaves}_n{it}"] = BASE[target][rp] + model.predict(X[rp], num_iteration=it)
                design_pred, _ = ridge_matrix(rp, target)
                for alpha in grid[target][k]["alpha"]:
                    frame.loc[sel, f"{target}_ridge_a{int(alpha)}"] = BASE[target][rp] + fit_ridge_rows(tr, target, alpha).predict_residual(design_pred)
        log(f"  block {c0}-{c1 - 1}: {len(rows_pred):,} rows")
        out.append(frame)
    return pd.concat(out, ignore_index=True)


def mae(a, b) -> float:
    ok = np.isfinite(a) & np.isfinite(b)
    return float(np.mean(np.abs(a[ok] - b[ok]))) if ok.any() else float("nan")


log("validation walk-forward (hyperparameter search)")
search = {t: {k: {"gbm": [(l, ITERS) for l in LEAVES], "alpha": ALPHAS} for k in LEADS} for t in TARGETS}
val = walk_forward(SELECT_START, VAL_END, search, score_until=VAL_END)

WEIGHT_GRID = [(a, g) for a in np.round(np.arange(0, 1.01, 0.1), 2) for g in np.round(np.arange(0, 1.01, 0.1), 2) if a + g <= 1.0 + 1e-9]
choice = {}
for target in TARGETS:
    choice[target] = {}
    for k in LEADS:
        f = val[val.lead == k]
        y, base = f[target].to_numpy(), f[f"{target}_base"].to_numpy()
        best_gbm = min([c for c in f.columns if c.startswith(f"{target}_gbm_")], key=lambda c: mae(y, f[c].to_numpy()))
        best_ridge = min([c for c in f.columns if c.startswith(f"{target}_ridge_")], key=lambda c: mae(y, f[c].to_numpy()))
        r, g = f[best_ridge].to_numpy() - base, f[best_gbm].to_numpy() - base
        wr, wg = min(WEIGHT_GRID, key=lambda w: mae(y, base + w[0] * r + w[1] * g))
        choice[target][k] = {
            "gbm_leaves": int(best_gbm.split("_l")[1].split("_")[0]),
            "gbm_iterations": int(best_gbm.split("_n")[1]),
            "ridge_alpha": float(best_ridge.split("_a")[1]),
            "w_ridge": float(wr),
            "w_gbm": float(wg),
            "val_mae": {"blend": mae(y, base + wr * r + wg * g), "ridge": mae(y, base + r), "gbm": mae(y, base + g), "baseline": mae(y, base)},
        }
        c = choice[target][k]
        log(f"{target} lead {k}: gbm l{c['gbm_leaves']} n{c['gbm_iterations']} | alpha {c['ridge_alpha']:.0f} | "
            f"w_ridge {wr} w_gbm {wg} | val MAE blend {c['val_mae']['blend']:.3f} vs baseline {c['val_mae']['baseline']:.3f}")


def blend_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the chosen ridge / gbm / blended forecast columns."""
    for target in TARGETS:
        for name in ("ridge", "gbm", "fc"):
            frame[f"{target}_{name}"] = np.nan
        for k in LEADS:
            c = choice[target][k]
            sel = (frame.lead == k).to_numpy()
            base = frame.loc[sel, f"{target}_base"].to_numpy()
            r = frame.loc[sel, f"{target}_ridge_a{int(c['ridge_alpha'])}"].to_numpy()
            g = frame.loc[sel, f"{target}_gbm_l{c['gbm_leaves']}_n{c['gbm_iterations']}"].to_numpy()
            frame.loc[sel, f"{target}_ridge"] = r
            frame.loc[sel, f"{target}_gbm"] = g
            frame.loc[sel, f"{target}_fc"] = base + c["w_ridge"] * (r - base) + c["w_gbm"] * (g - base)
    return frame


val = blend_columns(val)

log("test walk-forward (frozen configuration)")
frozen = {t: {k: {"gbm": [(choice[t][k]["gbm_leaves"], [choice[t][k]["gbm_iterations"]])], "alpha": [choice[t][k]["ridge_alpha"]]}
              for k in LEADS} for t in TARGETS}
test = blend_columns(walk_forward(VAL_END, int(sols[-1]), frozen, score_until=int(sols[-1])))

# extra simple baselines from the issue-time features
lookup = pd.DataFrame({"issue": issue, "lead": lead, "hour": hour})
for target, tag in TARGETS.items():
    lookup[f"{target}_ewm2"] = X[:, col[f"{tag}_ewm2"]]
    lookup[f"{target}_last"] = X[:, col[f"{tag}_lag1"]]
lookup = lookup.drop_duplicates(["issue", "lead", "hour"])
val = val.merge(lookup, on=["issue", "lead", "hour"], how="left")
test = test.merge(lookup, on=["issue", "lead", "hour"], how="left")

# ================================================================ 4. final models on every labelled row
log("final models on all labelled sols")
final_gbm, final_ridge, gain = {}, {}, {}
for target in TARGETS:
    final_gbm[target], final_ridge[target] = {}, {}
    total_gain = pd.Series(0.0, index=columns)
    train = np.flatnonzero(usable(np.ones(len(X), bool), target))
    for k in LEADS:
        c = choice[target][k]
        tr = train[lead[train] == k]
        booster = fit_gbm(tr, target, c["gbm_leaves"], c["gbm_iterations"]).booster_
        final_gbm[target][k] = booster
        imp = pd.Series(booster.feature_importance("gain"), index=columns)
        total_gain += c["w_gbm"] * imp / max(imp.sum(), 1e-12)
        final_ridge[target][k] = fit_ridge_rows(tr, target, c["ridge_alpha"])
    gain[target] = (total_gain / max(total_gain.sum(), 1e-12)).sort_values(ascending=False)

model = WeatherModel(
    feature_names=columns,
    ridge=final_ridge,
    gbm=final_gbm,
    weights={t: {k: {"ridge": choice[t][k]["w_ridge"], "gbm": choice[t][k]["w_gbm"]} for k in LEADS} for t in TARGETS},
    meta={
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_through_sol": int(grids.last_observed_sol),
        "normal_bump": [None if not np.isfinite(v) else float(v) for v in normal_bump],
        "lightgbm_version": lgb.__version__,
        "issue_feature_names": issue_names,
        "default_limits": DEFAULT_LIMITS,
        "splits": {"select_start": SELECT_START, "test_start": VAL_END, "chunk_sols": CHUNK},
    },
)
OUT_DIR.mkdir(parents=True, exist_ok=True)
for old_file in OUT_DIR.glob("gbm_*.txt"):
    old_file.unlink()
model.save(OUT_DIR)

# residual pools: validation only (to score the test honestly) and validation + test (deployed)
def pool_from(frame: pd.DataFrame) -> ResidualPool:
    return ResidualPool(
        frame.lead.to_numpy(),
        frame.hour.to_numpy(),
        (frame["air_temp_k"] - frame["air_temp_k_fc"]).to_numpy(),
        (frame["ground_temp_k"] - frame["ground_temp_k_fc"]).to_numpy(),
    )


pool_val = pool_from(val)
pool_all = pool_from(pd.concat([val, test], ignore_index=True))
pool_all.save(OUT_DIR / "residuals.npz")
base_pool_val = ResidualPool(
    val.lead.to_numpy(), val.hour.to_numpy(),
    (val["air_temp_k"] - val["air_temp_k_base"]).to_numpy(), (val["ground_temp_k"] - val["ground_temp_k_base"]).to_numpy(),
)

# parity check: the exported artifacts reproduce the in-memory final model
reloaded = WeatherModel.load(OUT_DIR)
for target in TARGETS:
    for k in LEADS:
        rows_k = np.flatnonzero(lead == k)[:240]
        base = BASE[target][rows_k]
        b_ridge = base + final_ridge[target][k].predict_residual(ridge_matrix(rows_k, target)[0])
        b_gbm = base + final_gbm[target][k].predict(X[rows_k])
        c = choice[target][k]
        expected = base + c["w_ridge"] * (b_ridge - base) + c["w_gbm"] * (b_gbm - base)
        assert np.allclose(reloaded.predict(X[rows_k], target, k)["forecast"], expected, atol=1e-6, equal_nan=True), "artifact parity failed"
log("artifacts saved and reload parity verified")

# ================================================================ 5. evaluation on the test sols
log("evaluation")
rng = np.random.default_rng(SEED)
report_metrics, by_hour, rolling, scatter, hist, boot = {}, {}, {}, {}, {}, {}
coverage = {}

for target, tag in TARGETS.items():
    report_metrics[target], coverage[target], boot[target] = [], [], []
    for k in LEADS:
        f = test[(test.lead == k) & test[target].notna()]
        y = f[target].to_numpy()
        row = {"lead": k, "n": int(len(f))}
        for name, column in [("model", f"{target}_fc"), ("ridge", f"{target}_ridge"), ("gbm", f"{target}_gbm"),
                             ("baseline_mean7", f"{target}_base"), ("baseline_ewm2", f"{target}_ewm2"), ("baseline_last_sol", f"{target}_last")]:
            p = f[column].to_numpy()
            ok = np.isfinite(p)
            e = y[ok] - p[ok]
            row[name] = {"mae": float(np.abs(e).mean()), "rmse": float(np.sqrt((e ** 2).mean())), "bias": float(e.mean())}
        row["skill_vs_mean7_pct"] = 100 * (1 - row["model"]["mae"] / row["baseline_mean7"]["mae"])
        best_simple = min(("baseline_mean7", "baseline_ewm2", "baseline_last_sol"), key=lambda kk: row[kk]["mae"])
        row["best_simple_baseline"] = best_simple
        row["skill_vs_best_baseline_pct"] = 100 * (1 - row["model"]["mae"] / row[best_simple]["mae"])
        anomaly = y - f[f"{target}_base"].to_numpy()
        err = y - f[f"{target}_fc"].to_numpy()
        row["anomaly_r2"] = float(1 - np.sum(err ** 2) / np.sum((anomaly - anomaly.mean()) ** 2))
        report_metrics[target].append(row)

        # bands from the validation errors only
        q = np.array([pool_val.quantiles(target, k, h) for h in range(24)])
        lo80, hi80 = q[f.hour, 1], q[f.hour, 5]
        lo90, hi90 = q[f.hour, 0], q[f.hour, 6]
        fc = f[f"{target}_fc"].to_numpy()
        coverage[target].append({
            "lead": k,
            "coverage80": float(np.mean((y >= fc + lo80) & (y <= fc + hi80))),
            "coverage90": float(np.mean((y >= fc + lo90) & (y <= fc + hi90))),
            "coverage50": float(np.mean((y >= fc + q[f.hour, 2]) & (y <= fc + q[f.hour, 4]))),
            "width80": float(np.mean(hi80 - lo80)),
            "width90": float(np.mean(hi90 - lo90)),
        })

        # bootstrap over issue sols: MAE reduction vs mean7
        g = f.assign(em=np.abs(err), eb=np.abs(anomaly)).groupby("issue")[["em", "eb"]].agg(["sum", "count"])
        sm, sb, cnt = g[("em", "sum")].to_numpy(), g[("eb", "sum")].to_numpy(), g[("em", "count")].to_numpy()
        draws = []
        for _ in range(1000):
            s = rng.integers(0, len(cnt), len(cnt))
            draws.append(sb[s].sum() / cnt[s].sum() - sm[s].sum() / cnt[s].sum())
        draws = np.array(draws)
        boot[target].append({"lead": k, "reduction_k": float(sb.sum() / cnt.sum() - sm.sum() / cnt.sum()),
                             "ci_low": float(np.quantile(draws, 0.025)), "ci_high": float(np.quantile(draws, 0.975)),
                             "p_not_better": float(np.mean(draws <= 0)),
                             "sols_won_pct": float(100 * np.mean(g[("em", "sum")] < g[("eb", "sum")]))})

    f1 = test[(test.lead == 1) & test[target].notna()]
    eh = f1.assign(m=(f1[target] - f1[f"{target}_fc"]).abs(), b=(f1[target] - f1[f"{target}_base"]).abs()).groupby("hour")[["m", "b"]].mean()
    by_hour[target] = [{"hour": int(h), "model": float(r.m), "baseline": float(r.b)} for h, r in eh.iterrows()]
    daily = f1.assign(m=(f1[target] - f1[f"{target}_fc"]).abs(), b=(f1[target] - f1[f"{target}_base"]).abs()).groupby("target_sol")[["m", "b"]].mean()
    roll = daily.rolling(15, min_periods=5).mean()
    rolling[target] = [{"sol": int(s), "ls": float(mars_ls(s)), "model": float(r.m), "baseline": float(r.b)} for s, r in roll.dropna().iterrows()]
    pick = f1.sample(min(1500, len(f1)), random_state=SEED)
    scatter[target] = [[round(float(a), 2), round(float(b), 2), round(float(c), 2)] for a, b, c in
                       zip(pick[target], pick[f"{target}_fc"], pick[f"{target}_base"])]
    hist[target] = {}
    for k in (1, 3, 7):
        e = (test[target] - test[f"{target}_fc"])[(test.lead == k)].dropna().to_numpy()
        counts, edges = np.histogram(np.clip(e, -8, 8), bins=32, range=(-8, 8))
        hist[target][str(k)] = {"counts": counts.tolist(), "edges": edges.round(2).tolist()}

# ---------------------------------------------------------------- probabilities and decisions
A, G = DEFAULT_LIMITS["air_min_k"], DEFAULT_LIMITS["ground_min_k"]
pairs = test[test["air_temp_k"].notna() & test["ground_temp_k"].notna()].copy()
pairs["sun"] = solar_elevation_deg(mars_ls(pairs.target_sol.to_numpy()), pairs.hour.to_numpy() + 0.5)
pairs = pairs[pairs.sun > 0]
outcome = ((pairs["air_temp_k"] >= A) & (pairs["ground_temp_k"] >= G)).to_numpy()


def probabilities(frame: pd.DataFrame, pool: ResidualPool, suffix: str) -> np.ndarray:
    out = np.empty(len(frame))
    for idx, (k, h, fa, fg) in enumerate(zip(frame.lead, frame.hour, frame[f"air_temp_k{suffix}"], frame[f"ground_temp_k{suffix}"])):
        ra, rg = pool.joint(k, h)
        out[idx] = np.mean((fa + ra >= A) & (fg + rg >= G)) if ra.size else np.nan
    return out


pairs["p_model"] = probabilities(pairs, pool_val, "_fc")
pairs["p_base"] = probabilities(pairs, base_pool_val, "_base")
pairs["outcome"] = outcome.astype(float)

reliability, brier, decisions = {}, [], []
edges = np.linspace(0, 1, 11)
for name in ("p_model", "p_base"):
    p = pairs[name].to_numpy()
    b = np.clip(np.digitize(p, edges[1:-1]), 0, 9)
    reliability[name] = [{"bin_low": float(edges[i]), "bin_high": float(edges[i + 1]), "mean_p": float(p[b == i].mean()),
                          "observed": float(outcome[b == i].mean()), "n": int((b == i).sum())} for i in range(10) if (b == i).any()]
base_rate = pairs.groupby(["lead", "hour"]).outcome.transform("mean")  # in-sample climatology (generous reference)
for k in LEADS:
    s = pairs.lead == k
    o = pairs.outcome[s].to_numpy()
    entry = {"lead": k, "n": int(s.sum()), "observed_go_rate": float(o.mean())}
    for name in ("p_model", "p_base"):
        p = pairs[name][s].to_numpy()
        entry[f"brier_{name[2:]}"] = float(np.mean((p - o) ** 2))
        go = p >= DEFAULT_LIMITS["go_confidence"]
        entry[f"false_go_pct_{name[2:]}"] = float(100 * np.sum(go & (o == 0)) / max(go.sum(), 1))
        entry[f"missed_go_pct_{name[2:]}"] = float(100 * np.sum(~go & (o == 1)) / max((o == 1).sum(), 1))
        entry[f"go_hours_{name[2:]}"] = int(go.sum())
    brier.append(entry)
cm = {}
for name in ("p_model", "p_base"):
    p = pairs[name].to_numpy()
    pred = np.where(p >= DEFAULT_LIMITS["go_confidence"], "GO", np.where(p >= DEFAULT_LIMITS["caution_confidence"], "CAUTION", "NO_GO"))
    act = np.where(outcome, "GO", "NOT_GO")
    cm[name[2:]] = {f"{a}|{b}": int(np.sum((act == a) & (pred == b))) for a in ("GO", "NOT_GO") for b in ("GO", "CAUTION", "NO_GO")}

# ---------------------------------------------------------------- calibration of the full predictive distribution
# PIT: where each observation falls inside its forecast distribution (uniform when calibrated),
# and reliability of P(T >= threshold) over a grid of thresholds.
pit, threshold_reliability = {}, {}
for target in TARGETS:
    f = test[test[target].notna() & test[f"{target}_fc"].notna()]
    values = np.empty(len(f))
    probs, outcomes = [], []
    grid = np.arange(185, 286, 5) if target == "air_temp_k" else np.arange(180, 301, 5)
    for (k, h), g in f.groupby(["lead", "hour"]):
        res = np.sort(pool_val.marginal(target, k, h))
        idx = f.index.get_indexer(g.index)
        err = (g[target] - g[f"{target}_fc"]).to_numpy()
        values[idx] = np.searchsorted(res, err, side="right") / max(res.size, 1)
        fc = g[f"{target}_fc"].to_numpy()[:, None, None]
        p_exceed = (fc + res[None, :, None] >= grid[None, None, :]).mean(1) if res.size else np.full((len(g), len(grid)), np.nan)
        probs.append(p_exceed.ravel())
        outcomes.append((g[target].to_numpy()[:, None] >= grid[None, :]).ravel())
    pit[target] = {}
    for k in (1, 4, 7):
        sel = (f.lead == k).to_numpy()
        counts, _ = np.histogram(values[sel], bins=10, range=(0, 1))
        pit[target][str(k)] = (counts / max(counts.sum(), 1)).round(4).tolist()
    probs, outcomes = np.concatenate(probs), np.concatenate(outcomes)
    keep = (probs > 0.02) & (probs < 0.98)  # thresholds far from the forecast are trivially right
    p, o = probs[keep], outcomes[keep]
    b = np.clip((p * 10).astype(int), 0, 9)
    threshold_reliability[target] = [{"bin_low": i / 10, "bin_high": (i + 1) / 10, "mean_p": float(p[b == i].mean()),
                                      "observed": float(o[b == i].mean()), "n": int((b == i).sum())} for i in range(10) if (b == i).any()]

# ================================================================ 6. report
def split_info(lo, hi):
    return {"sol_from": int(lo), "sol_to": int(hi), "ls_from": round(float(mars_ls(lo)), 1), "ls_to": round(float(mars_ls(hi)), 1)}


report = {
    "generated_at": model.meta["trained_at"],
    "data": {
        "source": "NASA PDS, Mars 2020 MEDA calibrated TIRS + PS, hourly means (LTST)",
        "site": "Jezero crater, Perseverance (18.44 N, 77.45 E)",
        "first_sol": int(sols[0]),
        "last_sol": int(grids.last_observed_sol),
        "observed_hours": grids.qc_counts["observed_hours"],
        "qc": grids.qc_counts,
        "splits": {"initial_training": split_info(sols[0], SELECT_START - 1), "selection": split_info(SELECT_START, VAL_END - 1),
                   "test": split_info(VAL_END, grids.last_observed_sol)},
    },
    "method": {
        "task": "Issued at the end of a sol; forecasts every hour of the next 1-7 sols.",
        "baseline": "Mean of the same hour over the previous 7 sols.",
        "models": "For every lead (1-7 sols): a ridge model and a LightGBM model correct the baseline; their corrections are blended with weights that may shrink towards the baseline.",
        "uncertainty": "Split-conformal: empirical out-of-sample errors by lead and hour (paired air/ground for joint probabilities).",
        "validation": f"Walk-forward, refit every {CHUNK} sols on past data only; choices made on sols {SELECT_START}-{VAL_END - 1}, test on sols {VAL_END}-{grids.last_observed_sol}.",
        "features": len(columns),
        "choice": {t: {str(k): v for k, v in leads.items()} for t, leads in choice.items()},
    },
    "metrics": report_metrics,
    "coverage": coverage,
    "bootstrap": boot,
    "mae_by_hour_lead1": by_hour,
    "rolling_mae_lead1": rolling,
    "scatter_lead1": scatter,
    "error_histograms": hist,
    "probability": {
        "limits": DEFAULT_LIMITS,
        "reliability": reliability,
        "by_lead": brier,
        "confusion": cm,
        "note": "Daylight test hours only. Probabilities use errors from the selection sols, so the test sols are scored out of sample.",
        "pit": pit,
        "threshold_reliability": threshold_reliability,
    },
    "feature_importance": {t: [{"feature": k, "gain_share": float(v)} for k, v in s.head(15).items()] for t, s in gain.items()},
    "quantile_levels": list(QUANTILE_LEVELS),
}
(OUT_DIR / "report.json").write_text(json.dumps(report, indent=1))
log("report written")
for target in TARGETS:
    print(target)
    for r in report_metrics[target]:
        print(f"  lead {r['lead']}: model {r['model']['mae']:.3f} | mean7 {r['baseline_mean7']['mae']:.3f} | "
              f"skill {r['skill_vs_mean7_pct']:.1f}% | best simple {r['best_simple_baseline']} ({r['skill_vs_best_baseline_pct']:.1f}%)")
    for c in coverage[target]:
        print(f"  lead {c['lead']}: cov80 {c['coverage80']:.3f} cov90 {c['coverage90']:.3f} width80 {c['width80']:.2f}")
print("probability by lead:", json.dumps(brier, indent=0)[:1500])
