"""CLI entry point and orchestration.

    python -m app.services.weather.pipeline process --raw-dir RAW --out-dir OUT --sols 230-239 [--config CFG]
    python -m app.services.weather.pipeline validate --out-dir OUT

Exit codes: 0 success, 2 bad config/args, 3 missing/malformed input, 4 validation failure (1: unexpected error).
"""

import argparse
import hashlib
import json
import logging
import platform
import sys
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import SCHEMA_VERSION, ExitCode, InputError, WeatherError, __version__
from . import config as C
from . import discovery as D
from . import normalization as N
from . import parsers as P
from . import quality as Q
from . import storage as S
from . import temporal as T
from . import validation as V
from . import weather_intensity as W

log = logging.getLogger("app.services.weather")

KNOWN_LIMITATIONS = [
    "No spatial products: SPICE kernels are unavailable, so there is no rover-position to map-coordinate transform, "
    "no spatial observations and no spatial weather field (spatial.status = unavailable, reason = missing_spice_kernels). "
    "No coordinates are invented and no EPSG code is assigned; the project CRS reference is "
    "data/processed/jezero/map_metadata.json (custom equirectangular Mars sphere), for future use only.",
    "UTC is null in every row: the labels give only product-level start/stop UTC and a verified per-record SCLK-to-UTC "
    "conversion needs SPICE kernels. SCLK, LMST and LTST are preserved exactly as written.",
    "W_t is a regional, time-indexed index, not a validated physical quantity. Weights and the fixed normalization "
    "min/max are design constants in the config (not derived from the data) and need owner sign-off; the air "
    "temperature component is inverted (colder air gives a higher component value), matching the EVA weather "
    "limits where low temperature is the hazard.",
    "W_t rows are built only from records that share exactly the same SCLK; rows with some components missing are "
    "emitted with quality_status 'suspect' and the missing components listed. There is no interpolation or gap filling.",
    "Label flags are evaluated only on records that carry a value: in Sols 230-239 the WS algorithm-state flag is 0 exactly where "
    "the wind value is empty, so those records are 'missing' (precedence) and the flag rule never fires on a usable value.",
    "Quality status uses label-defined flags only. The label defines what each flag value means but not its severity; "
    "mapping a flag value to 'suspect' is a configured policy (see variables.json validity_rules).",
    "Uncertainty is carried only when the uncertainty channel's own unit is stated in the label; most MEDA uncertainty "
    "fields have no unit in the label (and several are entirely empty), so 'uncertainty' is largely null.",
    "Humidity channels (RHS) have no unit in the label and are excluded as unverified. TIRS, RDS, RHS and ENG "
    "channels are not in the default variable catalogue (not needed for W_t) and are inventoried only.",
    "BAROCAP1_PRESSURE is defined in the label as a different transducer type depending on the TRANSDUCER field; "
    "wind direction has no stated reference frame in the label; both are used exactly as the label defines them.",
    "Header/label name disagreements (WS algorithm-state flags, RHS field 13) are resolved only by explicit, "
    "configured aliases; anything else unresolved is unverified.",
]


# ----------------------------------------------------------------------------- helpers
def _channel_stats(df: pd.DataFrame, label, headers) -> dict:
    out = {}
    fields = {f.number: f for f in label.fields}
    for i, h in enumerate(headers, start=1):
        col = df[h].str.strip()
        empty = int((col == "").sum())
        f = fields.get(i)
        nonnum, mn, mx = 0, None, None
        if f is not None and f.data_type in ("ASCII_Real", "ASCII_Integer"):
            num = pd.to_numeric(col.where(col != ""), errors="coerce")
            nonnum = int((num.isna() & (col != "")).sum())
            if num.notna().any():
                mn, mx = float(num.min()), float(num.max())
        out[h] = {"records": len(df), "empty": empty, "non_numeric": nonnum, "min": mn, "max": mx}
    return out


def _integrity(product, label, data_bytes, df, strict, qa) -> bool:
    problems = []
    md5 = hashlib.md5(data_bytes).hexdigest()
    md5_ok = (label.md5 or "").lower() == md5
    if not md5_ok:
        problems.append(f"MD5 of data file {md5} != label {label.md5}")
    rows_ok = label.table_records == len(df)
    if not rows_ok:
        problems.append(f"{len(df)} data rows != label records {label.table_records}")
    if len(df.columns) != len(label.fields):
        problems.append(f"{len(df.columns)} CSV columns != {len(label.fields)} label fields")
    if label.file_name and label.file_name.lower() != Path(product.data.rel.split("!/")[-1]).name.lower():
        problems.append(f"label file_name {label.file_name} != data file name")
    for s in (label.start_sol, label.stop_sol):
        if s is not None and s != product.sol:
            problems.append(f"label sol {s} != filename sol {product.sol}")
    if problems:
        for pr in problems:
            qa.failures.append(f"{product.product_id}: {pr}")
        if strict:
            raise InputError(f"{product.product_id}: " + "; ".join(problems))
        return False
    return True


def _setup_logging(level: str):
    logging.basicConfig(stream=sys.stderr, level=getattr(logging, level.upper()), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# ----------------------------------------------------------------------------- process
def process(raw_dir, out_dir, sols, config_path=None) -> int:
    started = datetime.now(timezone.utc)
    cfg = C.load_config(config_path)
    N.check_config_units(cfg)
    chash = C.config_hash(cfg)
    sols = sorted(set(sols))
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stale = out_dir / S.MANIFEST_FILE
    if stale.exists():
        stale.unlink()  # a crashed run must not leave a manifest that vouches for half-written files

    log.info("discovering products in %s for sols %s..%s", Path(raw_dir).name, sols[0], sols[-1])
    disc = D.discover(raw_dir, sols, strict=cfg.strict_inputs)
    qa = Q.QAAccumulator()
    for w in disc.warnings:
        qa.warn(w)
    for f in disc.failures:
        qa.failures.append(f"{f['failure']} sol={f['sol']} product={f['product_id']} {f['detail']}")

    comp_vars = {c.variable for c in cfg.weather_intensity.components}
    catalog_types = {v.product_type for v in cfg.variables}
    inventory, chan_agg, file_hashes = [], {}, []
    wt_stats, sol_time = [], {}
    sols_with_data = []

    obs_path, wt_path = out_dir / S.OBS_FILE, out_dir / S.WT_FILE
    with S.ParquetSink(obs_path, S.OBS_SCHEMA) as obs_sink, S.ParquetSink(wt_path, S.WT_SCHEMA) as wt_sink:
        for sol in sorted({p.sol for p in disc.products}):
            frames = []
            for prod in [p for p in disc.products if p.sol == sol]:
                log.info("sol %s: %s", sol, prod.product_id)
                label_bytes, data_bytes = prod.label.read_bytes(), prod.data.read_bytes()
                file_hashes += [(prod.label.rel, D.sha256_bytes(label_bytes)), (prod.data.rel, D.sha256_bytes(data_bytes))]
                label = P.parse_label(label_bytes, prod.label.rel)
                df = P.read_table(data_bytes, prod.data.rel)
                ok = _integrity(prod, label, data_bytes, df, cfg.strict_inputs, qa)
                headers = list(df.columns)
                verification = N.verify_channels(prod.product_type, label, headers, cfg)
                for w in verification.warnings:
                    qa.warn(w)
                stats = _channel_stats(df, label, headers)
                for it in verification.items:
                    a = chan_agg.setdefault((prod.product_type, it.header), {"items": [], "records": 0, "empty": 0, "nonnum": 0, "min": None, "max": None})
                    a["items"].append(it)
                    s = stats[it.header]
                    a["records"] += s["records"]; a["empty"] += s["empty"]; a["nonnum"] += s["non_numeric"]
                    if s["min"] is not None:
                        a["min"] = s["min"] if a["min"] is None else min(a["min"], s["min"])
                        a["max"] = s["max"] if a["max"] is None else max(a["max"], s["max"])
                time_fields = [n for n in ("SCLK", "LMST", "LTST") if verification.get(n)]
                inventory.append({
                    "product_id": prod.product_id, "sol": sol, "product_type": prod.product_type, "title": label.title,
                    "logical_identifier": label.logical_identifier, "version_id": label.version_id,
                    "processing_level": label.processing_level, "instrument": label.instrument,
                    "label_source": prod.label.rel, "data_source": prod.data.rel,
                    "records_in_file": len(df), "records_in_label": label.table_records,
                    "md5_matches_label": (label.md5 or "").lower() == hashlib.md5(data_bytes).hexdigest(),
                    "row_count_matches_label": label.table_records == len(df),
                    "sha256_data": D.sha256_bytes(data_bytes), "sha256_label": D.sha256_bytes(label_bytes),
                    "label_start_utc": label.start_time, "label_stop_utc": label.stop_time,
                    "label_sclk_start": label.sclk_start, "label_sclk_stop": label.sclk_stop,
                    "time_fields": time_fields,
                    "channels": [{"channel": it.header, "unit": it.label_unit, "role": it.role,
                                  "empty": stats[it.header]["empty"], "non_numeric": stats[it.header]["non_numeric"],
                                  "status": it.status} for it in verification.items],
                    "sentinel_handling": {"missing_tokens": cfg.sentinels.missing_tokens, "numeric_sentinels": cfg.sentinels.numeric_sentinels,
                                          "tokens_found_non_numeric": int(sum(s["non_numeric"] for s in stats.values()))},
                    "quality_fields": [it.header for it in verification.items if it.role == "flag" or it.role == "uncertainty"],
                })
                if ok and prod.product_type in catalog_types:
                    o = N.build_observations(df=df, product=prod, label=label, verification=verification, cfg=cfg, qa=qa, component_vars=comp_vars)
                    if len(o):
                        frames.append(o)
                del df, data_bytes, label_bytes
            if not frames:
                continue
            obs = pd.concat(frames, ignore_index=True)
            obs = obs.sort_values(["sol", "sclk", "variable", "source_row"], kind="mergesort", na_position="last").reset_index(drop=True)
            obs_sink.write(obs)
            sols_with_data.append(sol)
            sc = obs["sclk"].dropna()
            sol_time[sol] = {"sclk_min": float(sc.min()), "sclk_max": float(sc.max()), "observation_rows": int(len(obs))}
            wt, st = W.compute_w_t(obs, cfg, sol)
            if st["lmst_conflicts"]:
                qa.warn(f"sol {sol}: {st['lmst_conflicts']} W_t timestamp(s) where contributing records disagree on LMST")
            if st["duplicate_sclk_dropped"]:
                qa.warn(f"sol {sol}: {st['duplicate_sclk_dropped']} duplicate-SCLK records ignored for W_t (first by source_row kept)")
            wt_sink.write(wt)
            wt_stats.append(st)
            del obs, frames, wt

    # ---- channel table / variables.json
    channel_table, unverified = [], []
    used_as = defaultdict(list)
    for v in cfg.variables:
        used_as[(v.product_type, v.channel)].append(f"value:{v.name}")
        if v.uncertainty_channel:
            used_as[(v.product_type, v.uncertainty_channel)].append(f"uncertainty:{v.name}")
    for r in cfg.quality_rules:
        used_as[(r.product_type, r.flag_channel)].append(f"quality_flag:{r.id}")
    for (ptype, header), a in sorted(chan_agg.items()):
        items = a["items"]
        verified = all(i.status == "verified" for i in items)
        reasons = sorted({r for i in items for r in i.reasons})
        base = items[0].to_dict()
        usage = sorted(set(used_as.get((ptype, base["label_name"] or header), [])))
        rec = dict(base, status="verified" if verified else "unverified", reasons=reasons,
                   alias_applied=any(i.alias_applied for i in items), products=len(items),
                   records=a["records"], non_empty=a["records"] - a["empty"], non_numeric=a["nonnum"], min=a["min"], max=a["max"],
                   used_as=usage,
                   excluded_reason=("unverified" if not verified else (None if usage else "not_in_variable_catalogue")))
        channel_table.append(rec)
        if not verified:
            unverified.append(rec)
    ch_by = {(c["product_type"], c["label_name"]): c for c in channel_table}

    variables_json = {
        "schema_version": SCHEMA_VERSION,
        "quality_status_values": {
            "valid": "no missing/invalid condition and no label flag degrades it",
            "suspect": "a label-defined flag (configured rule) says measurement conditions were degraded",
            "unverified": "quality could not be assessed because a flag channel it depends on is unverified",
            "invalid": "value is not a finite number or the record has no usable SCLK",
            "missing": "value cell empty or equal to a configured sentinel",
        },
        "missing_value_handling": {"missing_tokens": cfg.sentinels.missing_tokens, "numeric_sentinels": cfg.sentinels.numeric_sentinels,
                                   "note": "Sols 230-239 contain only empty fields as missing markers; no numeric sentinels were found."},
        "builtin_quality_codes": Q.BUILTIN_CODES,
        "time_fields": {"sclk": "seconds, exact as written in source (no partition)", "lmst": "verbatim string", "ltst": "verbatim string",
                        "utc": T.UTC_STATUS},
        "variables": [],
        "weather_intensity": {
            "definition": "weighted mean of fixed-range min-max normalised, [0,1]-clipped components at identical SCLK; valid observations only",
            "method": cfg.weather_intensity.method, "min_components": cfg.weather_intensity.min_components,
            "components": [c.model_dump(mode="json") for c in cfg.weather_intensity.components],
        },
    }
    for v in sorted(cfg.variables, key=lambda x: x.name):
        ch = ch_by.get((v.product_type, v.channel))
        unc = ch_by.get((v.product_type, v.uncertainty_channel)) if v.uncertainty_channel else None
        sym = N.unit_symbol(v.label_unit, cfg)
        variables_json["variables"].append({
            "name": v.name, "description": v.description, "canonical_unit": v.canonical_unit,
            "original_channels": [{"product_type": v.product_type, "channel": v.channel, "label_unit": v.label_unit, "unit_symbol": sym}],
            "unit_conversion": {"from": sym, "to": v.canonical_unit, "formula": N.conversion(sym, v.canonical_unit).formula},
            "validity_rules": [{"id": r.id, "flag_channel": r.flag_channel, "equals": r.equals, "status": r.status, "code": r.code, "label_basis": r.label_basis}
                               for r in cfg.quality_rules if v.name in r.applies_to],
            "verification": {"status": ch["status"] if ch else "not_found", "reasons": ch["reasons"] if ch else ["channel_not_in_any_label"],
                             "label_field_number": ch["field_number"] if ch else None, "label_description": ch["label_description"] if ch else None,
                             "evidence_patterns": v.evidence_patterns},
            "uncertainty": None if not v.uncertainty_channel else {
                "channel": v.uncertainty_channel, "status": unc["status"] if unc else "not_found",
                "reasons": unc["reasons"] if unc else ["channel_not_in_any_label"],
                "unit": v.canonical_unit if unc and unc["status"] == "verified" else None},
        })

    # ---- QA report
    status_by_sol = defaultdict(lambda: defaultdict(dict))
    totals = defaultdict(Counter)
    for (sol, var, st), n in sorted(qa.status_counts.items()):
        status_by_sol[str(sol)][var][st] = n
        totals[var][st] += n
    rule_effects = []
    for code in sorted(qa.rule_flagged):
        for var in sorted(qa.rule_flagged[code]):
            rule_effects.append({"code": code, "variable": var, "flagged": qa.rule_flagged[code][var],
                                 "removed_from_w_t": qa.rule_removed_from_w_t[code].get(var, 0)})
    coverage = defaultdict(dict)
    for p in inventory:
        coverage[str(p["sol"])][p["product_type"]] = p["records_in_file"]
    wt_tot = {"emitted": sum(s["emitted"] for s in wt_stats), "complete": sum(s["complete"] for s in wt_stats),
              "partial": sum(s["partial"] for s in wt_stats), "candidate_timestamps": sum(s["candidate_timestamps"] for s in wt_stats),
              "no_valid_component": sum(s["no_valid_component"] for s in wt_stats),
              "component_used": {c.name: sum(s["component_used"][c.name] for s in wt_stats) for c in cfg.weather_intensity.components}}
    for c in cfg.weather_intensity.components:
        vdef = next(x for x in variables_json["variables"] if x["name"] == c.variable)
        if vdef["verification"]["status"] != "verified":
            qa.warn(f"W_t component {c.name} ({c.variable}) is not verified; it is never used")
        elif wt_tot["component_used"][c.name] == 0:
            qa.warn(f"W_t component {c.name} contributed to no W_t row")
    if wt_tot["partial"]:
        qa.warn(f"{wt_tot['partial']} of {wt_tot['emitted']} W_t rows use only a subset of components (quality_status=suspect)")
    for s in sols:
        if s not in sols_with_data:
            qa.failures.append(f"no observations produced for sol {s}")
    versions = sorted({(p["product_type"], p["version_id"]) for p in inventory})
    qa_json = {
        "config_hash": chash, "sols_requested": sols, "sols_with_data": sols_with_data,
        "spatial": {"status": "unavailable", "reason": "missing_spice_kernels"}, "utc": T.UTC_STATUS,
        "product_inventory": inventory, "superseded_products": disc.superseded, "coverage": dict(coverage),
        "coverage_products_per_sol": {str(s): sum(1 for p in inventory if p["sol"] == s) for s in sols},
        "channel_verification": channel_table, "unverified_channels": unverified,
        "counts_by_sol_variable_status": {k: {v: dict(d) for v, d in x.items()} for k, x in status_by_sol.items()},
        "status_totals_by_variable": {v: dict(c) for v, c in sorted(totals.items())},
        "rule_effects": rule_effects, "builtin_codes": Q.BUILTIN_CODES,
        "w_t_coverage": {"per_sol": wt_stats, "totals": wt_tot},
        "product_versions_used": [list(v) for v in versions],
        "warnings": sorted(qa.warnings), "failures": sorted(qa.failures),
    }
    S.write_json(out_dir / S.VARIABLES_FILE, variables_json)
    S.write_json(out_dir / S.QA_JSON_FILE, qa_json)
    (out_dir / S.QA_MD_FILE).write_text(S.render_qa_markdown(qa_json), encoding="utf-8")

    # ---- manifest (written last)
    tree = hashlib.sha256("\n".join(f"{rel}\t{h}" for rel, h in sorted(set(file_hashes))).encode()).hexdigest()
    outputs = []
    for name in S.DATA_OUTPUTS:
        p = out_dir / name
        rows = {S.OBS_FILE: obs_sink.rows, S.WT_FILE: wt_sink.rows}.get(name)
        outputs.append({"file": name, "rows": rows, "sha256": S.sha256_file(p), "bytes": p.stat().st_size})
    finished = datetime.now(timezone.utc)
    manifest = {
        "schema_version": SCHEMA_VERSION, "package_version": __version__,
        "run": {"run_id": uuid.uuid4().hex, "started_utc": started.isoformat(), "finished_utc": finished.isoformat(),
                "python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__,
                "pyarrow": __import__("pyarrow").__version__},
        "config": {"sha256": chash, "strict_inputs": cfg.strict_inputs},
        "inputs": {"archives": disc.archives, "plain_product_files": disc.n_plain_files,
                   "product_files_tree_sha256": tree, "product_files_hashed": len(set(file_hashes)),
                   "note": "tree hash = sha256 over sorted 'relative path<TAB>sha256' lines of all label and data files read"},
        "coverage": {"sols_requested": sols, "sols_with_data": sols_with_data, "per_sol": {str(k): v for k, v in sorted(sol_time.items())},
                     "products_used": len(inventory),
                     "time": {"sclk_min": min((v["sclk_min"] for v in sol_time.values()), default=None),
                              "sclk_max": max((v["sclk_max"] for v in sol_time.values()), default=None), "utc": T.UTC_STATUS}},
        "variables": sorted(v.name for v in cfg.variables),
        "normalization": {"method": cfg.weather_intensity.method, "clip": [0.0, 1.0], "min_components": cfg.weather_intensity.min_components,
                          "constants_source": "fixed in config; never recomputed from data",
                          "components": [c.model_dump(mode="json") for c in sorted(cfg.weather_intensity.components, key=lambda c: c.name)]},
        "spatial": {"status": "unavailable", "reason": "missing_spice_kernels",
                    "crs_reference": "data/processed/jezero/map_metadata.json (for future use only; no EPSG assigned)"},
        "outputs": outputs,
        "warnings_count": len(qa_json["warnings"]), "failures_count": len(qa_json["failures"]),
        "known_limitations": KNOWN_LIMITATIONS,
    }
    S.write_json(out_dir / S.MANIFEST_FILE, manifest)
    log.info("done: %d observation rows, %d W_t rows, %d warnings, %d failures", obs_sink.rows, wt_sink.rows, len(qa_json["warnings"]), len(qa_json["failures"]))
    return ExitCode.OK


# ----------------------------------------------------------------------------- CLI
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m app.services.weather.pipeline", description="MEDA weather pipeline")
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("process", help="raw MEDA products -> versioned outputs")
    p.add_argument("--raw-dir", required=True, type=Path, help="directory with extracted sol_* folders and/or .zip archives")
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--sols", required=True, help="e.g. 230-239 or 230,232,235-236")
    p.add_argument("--config", type=Path, default=None, help="config JSON (default: packaged default_config.json)")
    v = sub.add_parser("validate", help="check existing outputs only")
    v.add_argument("--out-dir", required=True, type=Path)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)  # argparse exits with 2 on bad args
    _setup_logging(args.log_level)
    try:
        if args.command == "process":
            return process(args.raw_dir, args.out_dir, D.parse_sols(args.sols), args.config)
        if not args.out_dir.is_dir():
            raise InputError(f"output directory does not exist: {args.out_dir.name}")
        rep = V.validate_outputs(args.out_dir)
        print(json.dumps(rep.to_dict(), indent=2, sort_keys=True))
        return ExitCode.VALIDATION_FAILED if rep.errors else ExitCode.OK
    except WeatherError as exc:
        log.error("%s", exc)
        return exc.exit_code
    except Exception:  # noqa: BLE001 - last-resort handler so the exit code is defined
        log.exception("unexpected error")
        return ExitCode.UNEXPECTED


if __name__ == "__main__":
    sys.exit(main())
