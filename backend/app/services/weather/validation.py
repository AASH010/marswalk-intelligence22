"""Validation of EXISTING outputs only. It never reads raw MEDA data and never re-runs the pipeline.

Fatal errors (exit 4): missing/incomplete manifest, missing file, bad checksum or row count, schema mismatch,
missing Sol coverage, inconsistent units, W_t outside [0, 1], non-monotonic time per variable, unreadable file.
Warnings do not change the exit code.
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import SCHEMA_VERSION
from . import storage as S

log = logging.getLogger(__name__)

MANIFEST_REQUIRED_KEYS = [
    "schema_version", "package_version", "run", "config", "inputs", "coverage", "variables", "normalization",
    "spatial", "outputs", "known_limitations",
]
RUN_REQUIRED_KEYS = ["run_id"]
STATUSES = {"valid", "invalid", "missing", "suspect", "unverified"}
BATCH = 500_000


def _norm_type(t) -> str:
    """Type text for schema comparison. List element names ('item' vs 'element') are not significant."""
    if pa.types.is_list(t):
        inner = getattr(t, "value_type", None) or getattr(t, "value", None)
        return f"list<{_norm_type(inner)}>"
    return str(t)


class Report:
    def __init__(self):
        self.errors, self.warnings, self.checks = [], [], []

    def ok(self, name):
        self.checks.append({"check": name, "result": "ok"})

    def error(self, name, msg):
        self.errors.append({"check": name, "message": msg})
        self.checks.append({"check": name, "result": "error"})
        log.error("validation error [%s]: %s", name, msg)

    def warn(self, name, msg):
        self.warnings.append({"check": name, "message": msg})
        log.warning("validation warning [%s]: %s", name, msg)

    def to_dict(self):
        return {"passed": not self.errors, "errors": self.errors, "warnings": self.warnings, "checks": self.checks}


def _batches(path: Path, columns):
    pf = pq.ParquetFile(str(path))
    for b in pf.iter_batches(batch_size=BATCH, columns=columns):
        yield b.to_pandas()


def validate_outputs(out_dir) -> Report:
    out_dir = Path(out_dir)
    rep = Report()
    mpath = out_dir / S.MANIFEST_FILE
    if not mpath.is_file():
        rep.error("manifest_present", "manifest.json is missing")
        return rep
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        rep.error("manifest_readable", f"manifest.json unreadable: {exc}")
        return rep

    # 1. manifest completeness
    missing = [k for k in MANIFEST_REQUIRED_KEYS if k not in manifest]
    if missing:
        rep.error("manifest_complete", f"missing manifest keys: {missing}")
    else:
        rep.ok("manifest_complete")
    if manifest.get("schema_version") != SCHEMA_VERSION:
        rep.error("schema_version", f"manifest schema_version {manifest.get('schema_version')!r} != supported {SCHEMA_VERSION!r}")
    for k in RUN_REQUIRED_KEYS:
        if k not in (manifest.get("run") or {}):
            rep.error("manifest_complete", f"manifest.run.{k} missing")
    sp = manifest.get("spatial") or {}
    if sp.get("status") != "unavailable" or sp.get("reason") != "missing_spice_kernels":
        rep.error("spatial_status", "manifest.spatial must record status=unavailable, reason=missing_spice_kernels")
    else:
        rep.ok("spatial_status")
    if not (manifest.get("config") or {}).get("sha256") or not (manifest.get("inputs") or {}):
        rep.error("manifest_complete", "config hash or inputs missing")
    if not (manifest.get("normalization") or {}).get("components"):
        rep.error("manifest_complete", "normalization constants missing")
    if missing:
        return rep

    # 2. files present, checksums, row counts
    listed = {o["file"]: o for o in manifest["outputs"]}
    for need in S.DATA_OUTPUTS:
        if need not in listed:
            rep.error("outputs_listed", f"{need} is not listed in the manifest")
    for name, o in sorted(listed.items()):
        p = out_dir / name
        if not p.is_file():
            rep.error("file_present", f"{name} is missing")
            continue
        got = S.sha256_file(p)
        if got != o.get("sha256"):
            rep.error("checksum", f"{name}: sha256 {got} != manifest {o.get('sha256')}")
        if name.endswith(".parquet"):
            try:
                n = pq.ParquetFile(str(p)).metadata.num_rows
            except Exception as exc:  # unreadable parquet
                rep.error("readable", f"{name}: cannot read parquet metadata: {exc}")
                continue
            if n != o.get("rows"):
                rep.error("row_count", f"{name}: {n} rows != manifest {o.get('rows')}")
    for extra in sorted(p.name for p in out_dir.iterdir() if p.is_file()):
        if extra not in listed and extra != S.MANIFEST_FILE:
            rep.warn("unlisted_file", f"{extra} is in the output directory but not in the manifest")
    if rep.errors:
        # structural problems: remaining checks need intact files
        if any(e["check"] in ("file_present", "readable") for e in rep.errors):
            return rep

    # 3. variables.json
    try:
        variables = json.loads((out_dir / S.VARIABLES_FILE).read_text(encoding="utf-8"))
        vdefs = {v["name"]: v for v in variables["variables"]}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        rep.error("variables_readable", f"variables.json unreadable or malformed: {exc}")
        return rep
    try:
        json.loads((out_dir / S.QA_JSON_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        rep.error("readable", f"qa_report.json unreadable: {exc}")

    # 4. schema types
    for fname in (S.OBS_FILE, S.WT_FILE):
        try:
            got = pq.ParquetFile(str(out_dir / fname)).schema_arrow
        except Exception as exc:
            rep.error("readable", f"{fname}: {exc}")
            continue
        exp = S.expected_schema(fname)
        got_map = {f.name: _norm_type(f.type) for f in got}
        exp_map = {f.name: _norm_type(f.type) for f in exp}
        if list(got_map) != list(exp_map):
            rep.error("schema", f"{fname}: columns {list(got_map)} != expected {list(exp_map)}")
        else:
            bad = {k: (got_map[k], exp_map[k]) for k in exp_map if got_map[k] != exp_map[k]}
            if bad:
                rep.error("schema", f"{fname}: type mismatch (got, expected): {bad}")
            else:
                rep.ok(f"schema:{fname}")
    if any(e["check"] == "schema" for e in rep.errors):
        return rep

    # 5. observations: readability, nulls, units, status values, time monotonicity, sort order, Sol coverage
    obs_cols = ["sol", "sclk", "variable", "unit", "original_unit", "source_row", "quality_status", "source_channel",
                "source_product", "source_file", "provenance"]
    seen_units, seen_ounits, seen_sols, last_sclk = {}, {}, set(), {}
    prev_key = None
    n_rows = 0
    try:
        for df in _batches(out_dir / S.OBS_FILE, S.OBS_SCHEMA.names):
            n_rows += len(df)
            for c in S.OBS_REQUIRED_NON_NULL:
                if df[c].isna().any():
                    rep.error("nulls", f"observations.{c} contains nulls")
            badstat = set(df["quality_status"].dropna().unique()) - STATUSES
            if badstat:
                rep.error("quality_status", f"observations has unknown quality_status values {sorted(badstat)}")
            seen_sols.update(int(s) for s in df["sol"].unique())
            for v, g in df.groupby("variable", sort=False):
                seen_units.setdefault(v, set()).update(g["unit"].unique())
                seen_ounits.setdefault(v, set()).update(g["original_unit"].dropna().unique())
                s = g["sclk"].dropna().to_numpy()
                if len(s) == 0:
                    continue
                if (np.diff(s) < 0).any() or (v in last_sclk and s[0] < last_sclk[v]):
                    rep.error("time_monotonic", f"observations: sclk decreases within variable {v}")
                if (np.diff(s) == 0).any() or (v in last_sclk and s[0] == last_sclk[v]):
                    rep.warn("duplicate_time", f"observations: repeated sclk within variable {v}")
                last_sclk[v] = s[-1]
            # global deterministic order (sol, sclk, variable, source_row)
            key = df[["sol", "sclk", "variable", "source_row"]]
            order_ok = key.sort_values(["sol", "sclk", "variable", "source_row"], kind="mergesort", na_position="last").index.equals(key.index)
            if not order_ok:
                rep.error("sort_order", "observations are not sorted by (sol, sclk, variable, source_row)")
            if prev_key is not None and len(df):
                first = (int(df["sol"].iloc[0]),)
                if first[0] < prev_key:
                    rep.error("sort_order", "observations Sol order decreases between row groups")
            if len(df):
                prev_key = int(df["sol"].iloc[-1])
    except Exception as exc:
        rep.error("readable", f"observations.parquet could not be read completely: {exc}")
        return rep
    rep.ok("observations_readable")

    for v, units in sorted(seen_units.items()):
        if v not in vdefs:
            rep.error("variables_defined", f"variable {v} in observations is not defined in variables.json")
            continue
        d = vdefs[v]
        if d.get("verification", {}).get("status") != "verified":
            rep.error("variables_verified", f"variable {v} appears in observations but is not verified in variables.json")
        if units != {d["canonical_unit"]}:
            rep.error("unit_consistency", f"variable {v}: units {sorted(units)} != canonical {d['canonical_unit']}")
        if len(seen_ounits.get(v, ())) > 1:
            rep.error("unit_consistency", f"variable {v}: more than one original_unit {sorted(seen_ounits[v])}")
    for v in manifest["variables"]:
        if v not in seen_units:
            rep.warn("variable_without_rows", f"manifest variable {v} has no rows in observations")
    if not any(e["check"] == "unit_consistency" for e in rep.errors):
        rep.ok("unit_consistency")

    req = set(manifest["coverage"].get("sols_requested", []))
    found = set(manifest["coverage"].get("sols_with_data", []))
    if not req:
        rep.error("sol_coverage", "manifest.coverage.sols_requested empty")
    absent = sorted(req - seen_sols)
    if absent:
        rep.error("sol_coverage", f"Sols requested but absent from observations: {absent}")
    if seen_sols - req:
        rep.error("sol_coverage", f"observations contain Sols not in the manifest request: {sorted(seen_sols - req)}")
    if found != seen_sols:
        rep.error("sol_coverage", f"manifest sols_with_data {sorted(found)} != observed {sorted(seen_sols)}")
    if not any(e["check"] == "sol_coverage" for e in rep.errors):
        rep.ok("sol_coverage")

    # 6. W_t
    comps = {c["name"] for c in manifest["normalization"]["components"]}
    wt_rows, wt_sols, wt_last = 0, set(), None
    try:
        for df in _batches(out_dir / S.WT_FILE, S.WT_SCHEMA.names):
            wt_rows += len(df)
            for c in S.WT_REQUIRED_NON_NULL:
                if df[c].isna().any():
                    rep.error("nulls", f"weather_intensity.{c} contains nulls")
            w = df["w_t"].to_numpy(dtype="float64")
            if len(w) and (not np.isfinite(w).all() or (w < 0).any() or (w > 1).any()):
                rep.error("w_t_range", f"w_t outside [0, 1] or non-finite (min={np.nanmin(w):.6g}, max={np.nanmax(w):.6g})")
            if set(df["quality_status"].unique()) - STATUSES:
                rep.error("quality_status", "weather_intensity has unknown quality_status values")
            if set(df["observation_type"].unique()) - {"observed"}:
                rep.error("observation_type", "weather_intensity has observation_type other than 'observed'")
            used = {x for lst in df["components_used"] for x in lst}
            if used - comps:
                rep.error("w_t_components", f"components_used contains names not in manifest: {sorted(used - comps)}")
            wt_sols.update(int(s) for s in df["sol"].unique())
            for sol, g in df.groupby("sol", sort=False):
                s = g["sclk"].to_numpy()
                if (np.diff(s) <= 0).any() or (wt_last is not None and wt_last[0] == sol and s[0] <= wt_last[1]):
                    rep.error("time_monotonic", f"weather_intensity: sclk not strictly increasing within Sol {sol}")
                wt_last = (sol, s[-1])
    except Exception as exc:
        rep.error("readable", f"weather_intensity.parquet could not be read completely: {exc}")
        return rep
    if wt_sols - seen_sols:
        rep.error("sol_coverage", f"weather_intensity has Sols absent from observations: {sorted(wt_sols - seen_sols)}")
    if wt_rows == 0:
        rep.warn("w_t_empty", "weather_intensity.parquet has no rows")
    if not any(e["check"] in ("w_t_range", "w_t_components", "time_monotonic") for e in rep.errors):
        rep.ok("w_t_checks")

    # 7. manifest normalization constants are written and self-consistent
    for c in manifest["normalization"]["components"]:
        if not c["norm_max"] > c["norm_min"] or c["weight"] <= 0:
            rep.error("normalization_constants", f"component {c['name']}: invalid constants")
    return rep
