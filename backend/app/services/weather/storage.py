"""Deterministic writers/readers for the output files (parquet, JSON, Markdown)."""

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

OBS_FILE = "observations.parquet"
WT_FILE = "weather_intensity.parquet"
VARIABLES_FILE = "variables.json"
MANIFEST_FILE = "manifest.json"
QA_JSON_FILE = "qa_report.json"
QA_MD_FILE = "qa_report.md"
DATA_OUTPUTS = (OBS_FILE, WT_FILE, VARIABLES_FILE, QA_JSON_FILE, QA_MD_FILE)  # everything except the manifest

OBS_SCHEMA = pa.schema([
    pa.field("sol", pa.int32()),
    pa.field("sclk", pa.float64()),
    pa.field("lmst", pa.string()),
    pa.field("ltst", pa.string()),
    pa.field("utc", pa.string()),
    pa.field("variable", pa.string()),
    pa.field("value", pa.float64()),
    pa.field("unit", pa.string()),
    pa.field("original_value", pa.string()),
    pa.field("original_unit", pa.string()),
    pa.field("source_channel", pa.string()),
    pa.field("source_product", pa.string()),
    pa.field("processing_level", pa.string()),
    pa.field("source_file", pa.string()),
    pa.field("source_row", pa.int64()),
    pa.field("quality_status", pa.string()),
    pa.field("quality_code", pa.string()),
    pa.field("uncertainty", pa.float64()),
    pa.field("uncertainty_unit", pa.string()),
    pa.field("provenance", pa.string()),
])

WT_SCHEMA = pa.schema([
    pa.field("sol", pa.int32()),
    pa.field("sclk", pa.float64()),
    pa.field("lmst", pa.string()),
    pa.field("ltst", pa.string()),
    pa.field("utc", pa.string()),
    pa.field("w_t", pa.float64()),
    pa.field("components_used", pa.list_(pa.string())),
    pa.field("components_missing", pa.list_(pa.string())),
    pa.field("source_record_ids", pa.list_(pa.string())),
    pa.field("quality_status", pa.string()),
    pa.field("observation_type", pa.string()),
])


def expected_schema(file_name: str):
    return {OBS_FILE: OBS_SCHEMA, WT_FILE: WT_SCHEMA}[file_name]


def _table(df: pd.DataFrame, schema) -> pa.Table:
    arrays = [pa.array(df[f.name].to_numpy(dtype=object) if pa.types.is_string(f.type) or pa.types.is_list(f.type)
                       else df[f.name].to_numpy(), type=f.type, from_pandas=True) for f in schema]
    return pa.Table.from_arrays(arrays, schema=schema).replace_schema_metadata(None)


class ParquetSink:
    """Writes one row group per call (we write one per Sol, already sorted); no pandas metadata, no timestamps."""

    def __init__(self, path: Path, schema):
        self.path, self.schema, self.rows = Path(path), schema, 0
        self._writer = None

    def __enter__(self):
        self._writer = pq.ParquetWriter(str(self.path), self.schema, compression="zstd")
        return self

    def write(self, df: pd.DataFrame):
        if len(df):
            self._writer.write_table(_table(df, self.schema))
            self.rows += len(df)

    def __exit__(self, *exc):
        self._writer.close()
        return False


def read_parquet(path: Path) -> pd.DataFrame:
    return pq.read_table(str(path)).to_pandas()


def write_json(path: Path, obj) -> None:
    """Sorted keys, 2-space indent, UTF-8, trailing newline: byte-stable for equal content."""
    Path(path).write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def render_qa_markdown(qa: dict) -> str:
    L = []
    L.append("# MEDA weather pipeline - QA report\n")
    L.append(f"- Config hash: `{qa['config_hash']}`")
    L.append(f"- Sols requested: {qa['sols_requested'][0]}-{qa['sols_requested'][-1]} ({len(qa['sols_requested'])} Sols)")
    L.append(f"- Products used: {len(qa['product_inventory'])}; failures: {len(qa['failures'])}; warnings: {len(qa['warnings'])}")
    L.append(f"- Spatial: **{qa['spatial']['status']}** ({qa['spatial']['reason']}); UTC: **{qa['utc']['status']}** ({qa['utc']['reason']})\n")

    L.append("## Coverage (records per product type per Sol)\n")
    types = sorted({t for row in qa["coverage"].values() for t in row})
    L.append("| Sol | " + " | ".join(types) + " |")
    L.append("|---|" + "---|" * len(types))
    for sol in sorted(qa["coverage"], key=int):
        row = qa["coverage"][sol]
        L.append(f"| {sol} | " + " | ".join(str(row.get(t, 0)) for t in types) + " |")

    L.append("\n## Product inventory\n")
    L.append("| Product ID | Sol | Type | Level | Version | Records | Label MD5 | Row count |")
    L.append("|---|---|---|---|---|---|---|---|")
    for p in qa["product_inventory"]:
        L.append(f"| {p['product_id']} | {p['sol']} | {p['product_type']} | {p['processing_level']} | {p['version_id']} | "
                 f"{p['records_in_file']} | {'ok' if p['md5_matches_label'] else 'MISMATCH'} | {'ok' if p['row_count_matches_label'] else 'MISMATCH'} |")

    L.append("\n## Unverified or excluded channels\n")
    L.append("| Product type | Channel | Status | Reasons | Non-empty / records |")
    L.append("|---|---|---|---|---|")
    for c in qa["unverified_channels"]:
        L.append(f"| {c['product_type']} | {c['channel']} | {c['status']} | {', '.join(c['reasons'])} | {c['non_empty']} / {c['records']} |")

    L.append("\n## Records by quality status (all Sols)\n")
    L.append("| Variable | valid | suspect | unverified | invalid | missing |")
    L.append("|---|---|---|---|---|---|")
    for var, d in sorted(qa["status_totals_by_variable"].items()):
        L.append(f"| {var} | " + " | ".join(str(d.get(s, 0)) for s in ("valid", "suspect", "unverified", "invalid", "missing")) + " |")

    L.append("\n## Rule effects\n")
    L.append("| Code | Variable | Flagged | Removed from W_t |")
    L.append("|---|---|---|---|")
    for r in qa["rule_effects"]:
        L.append(f"| {r['code']} | {r['variable']} | {r['flagged']} | {r['removed_from_w_t']} |")

    L.append("\n## W_t coverage\n")
    L.append("| Sol | Candidate timestamps | W_t rows | Complete | Partial | No valid component |")
    L.append("|---|---|---|---|---|---|")
    for w in qa["w_t_coverage"]["per_sol"]:
        L.append(f"| {w['sol']} | {w['candidate_timestamps']} | {w['emitted']} | {w['complete']} | {w['partial']} | {w['no_valid_component']} |")
    tot = qa["w_t_coverage"]["totals"]
    L.append(f"\nTotals: {tot['emitted']} rows, {tot['complete']} complete, {tot['partial']} partial. "
             f"Component usage: " + ", ".join(f"{k}={v}" for k, v in sorted(tot["component_used"].items())))

    L.append("\n## Warnings\n")
    L.extend([f"- {w}" for w in qa["warnings"]] or ["- none"])
    L.append("\n## Failures\n")
    L.extend([f"- {f}" for f in qa["failures"]] or ["- none"])
    return "\n".join(L) + "\n"

# Columns that must never be null (enforced by the validation command, not by the parquet schema).
OBS_REQUIRED_NON_NULL = ["sol", "variable", "unit", "source_channel", "source_product", "source_file", "source_row",
                         "quality_status", "provenance"]
WT_REQUIRED_NON_NULL = ["sol", "sclk", "w_t", "components_used", "components_missing", "source_record_ids",
                        "quality_status", "observation_type"]
