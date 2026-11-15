"""Channel verification, unit conversion and canonical observation building.

A channel is `verified` only when the PDS4 label itself supports its identity: a label field exists at the
same position with the same name (or an explicit, configured alias), its unit is stated and recognised (for
physical quantities), its description is present and unambiguous, and -- for channels bound to a canonical
variable -- the label unit and description agree with the variable definition. File names are never evidence.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from . import UnitError
from . import quality as Q
from . import temporal as T

OBS_COLUMNS = [
    "sol", "sclk", "lmst", "ltst", "utc", "variable", "value", "unit", "original_value", "original_unit",
    "source_channel", "source_product", "processing_level", "source_file", "source_row", "quality_status",
    "quality_code", "uncertainty", "uncertainty_unit", "provenance",
]

# --------------------------------------------------------------------------- units
# canonical = scale * x + offset.  Only these documented formulas are ever applied.


@dataclass(frozen=True)
class Affine:
    scale: float
    offset: float
    formula: str


_UNIT_TABLE = {
    ("K", "K"): Affine(1.0, 0.0, "identity"),
    ("degC", "K"): Affine(1.0, 273.15, "K = degC + 273.15"),
    ("degF", "K"): Affine(5.0 / 9.0, 273.15 - 160.0 / 9.0, "K = (degF - 32) * 5/9 + 273.15"),
    ("Pa", "Pa"): Affine(1.0, 0.0, "identity"),
    ("hPa", "Pa"): Affine(100.0, 0.0, "Pa = hPa * 100"),
    ("mbar", "Pa"): Affine(100.0, 0.0, "Pa = mbar * 100"),
    ("kPa", "Pa"): Affine(1000.0, 0.0, "Pa = kPa * 1000"),
    ("m/s", "m/s"): Affine(1.0, 0.0, "identity"),
    ("km/h", "m/s"): Affine(1.0 / 3.6, 0.0, "m/s = (km/h) / 3.6"),
    ("deg", "deg"): Affine(1.0, 0.0, "identity"),
    ("rad", "deg"): Affine(180.0 / np.pi, 0.0, "deg = rad * 180/pi"),
}


def has_conversion(src: str, dst: str) -> bool:
    return (src, dst) in _UNIT_TABLE


def conversion(src: str, dst: str) -> Affine:
    try:
        return _UNIT_TABLE[(src, dst)]
    except KeyError:
        raise UnitError(f"no documented conversion from '{src}' to '{dst}'")


def convert(values, src: str, dst: str):
    a = conversion(src, dst)
    if a.scale == 1.0 and a.offset == 0.0:
        return np.asarray(values, dtype="float64") + 0.0  # identity: values untouched
    return a.scale * np.asarray(values, dtype="float64") + a.offset


def convert_back(values, src: str, dst: str):
    """Inverse of convert(): canonical `dst` values back to the original `src` unit."""
    a = conversion(src, dst)
    if a.scale == 1.0 and a.offset == 0.0:
        return np.asarray(values, dtype="float64") + 0.0
    return (np.asarray(values, dtype="float64") - a.offset) / a.scale


def convert_uncertainty(values, src: str, dst: str):
    """Uncertainties are differences: scale only, no offset."""
    a = conversion(src, dst)
    if a.scale == 1.0:
        return np.asarray(values, dtype="float64") + 0.0
    return a.scale * np.asarray(values, dtype="float64")


def unit_symbol(label_unit: Optional[str], cfg) -> Optional[str]:
    if not label_unit:
        return None
    return {k.lower(): v for k, v in cfg.label_unit_symbols.items()}.get(label_unit.strip().lower())


def check_config_units(cfg) -> None:
    """Fail early (ConfigError) if a variable's label unit cannot be converted to its canonical unit."""
    from . import ConfigError

    for v in cfg.variables:
        sym = unit_symbol(v.label_unit, cfg)
        if sym is None:
            raise ConfigError(f"variable {v.name}: label_unit '{v.label_unit}' not in label_unit_symbols")
        if not has_conversion(sym, v.canonical_unit):
            raise ConfigError(f"variable {v.name}: no documented conversion {sym} -> {v.canonical_unit}")


def record_id(source_product: str, source_row: int, source_channel: str) -> str:
    return f"{source_product}:{int(source_row)}:{source_channel}"


# --------------------------------------------------------------------------- verification
@dataclass
class ChannelVerification:
    product_type: str
    header: str
    field_number: Optional[int]
    label_name: Optional[str]
    label_unit: Optional[str]
    unit_symbol: Optional[str]
    data_type: str
    description: str
    role: str  # time | data | uncertainty | flag | other
    status: str  # verified | unverified
    reasons: list = field(default_factory=list)
    alias_applied: bool = False
    variable: Optional[str] = None  # canonical variable this channel feeds, if any

    def to_dict(self):
        return {
            "product_type": self.product_type, "channel": self.header, "label_name": self.label_name,
            "field_number": self.field_number, "label_unit": self.label_unit, "unit_symbol": self.unit_symbol,
            "data_type": self.data_type, "label_description": self.description, "role": self.role,
            "status": self.status, "reasons": list(self.reasons), "alias_applied": self.alias_applied,
            "canonical_variable": self.variable,
        }


class Verification:
    def __init__(self, items: list, warnings: list):
        self.items = items
        self.warnings = warnings
        self._by_label = {}
        for it in items:
            if it.label_name is None:
                continue
            cur = self._by_label.get(it.label_name)
            if cur is None or (it.header == it.label_name and cur.header != cur.label_name):
                self._by_label[it.label_name] = it

    def get(self, label_name: str) -> Optional[ChannelVerification]:
        return self._by_label.get(label_name)

    def verified(self, label_name: str) -> bool:
        it = self.get(label_name)
        return bool(it and it.status == "verified")


_TIME_NAMES = ("SCLK", "LMST", "LTST")


def _role(name: str, data_type: str) -> str:
    if name in _TIME_NAMES:
        return "time"
    if name.upper().endswith("_UNCERTAINTY"):
        return "uncertainty"
    if data_type == "ASCII_Integer":
        return "flag"
    if data_type == "ASCII_Real":
        return "data"
    return "other"


def verify_channels(product_type: str, label, headers: list, cfg) -> Verification:
    fields = {f.number: f for f in label.fields}
    warnings = []
    aliases = {(a.field_number, a.header): a.label_name for a in cfg.header_aliases if a.product_type == product_type}
    desc_count = {}
    name_count = {}
    for f in label.fields:
        desc_count[f.description] = desc_count.get(f.description, 0) + 1
        name_count[f.name] = name_count.get(f.name, 0) + 1
    for n, c in name_count.items():
        if c > 1:
            warnings.append(f"{product_type}: label repeats field name {n} ({c}x); resolved by field position")
    catalog = {v.channel: v for v in cfg.variables if v.product_type == product_type}
    unc_owner = {v.uncertainty_channel: v for v in cfg.variables if v.product_type == product_type and v.uncertainty_channel}

    items = []
    for idx, header in enumerate(headers, start=1):
        f = fields.get(idx)
        if f is None:
            items.append(ChannelVerification(product_type, header, None, None, None, None, "", "", "other",
                                             "unverified", ["no_label_field_at_position"]))
            continue
        reasons = []
        alias_applied = False
        if header != f.name:
            if aliases.get((idx, header)) == f.name:
                alias_applied = True
                warnings.append(f"{product_type}: header '{header}' resolved to label field '{f.name}' by configured alias")
            else:
                reasons.append("header_label_name_mismatch")
        role = _role(f.name, f.data_type)
        sym = unit_symbol(f.unit, cfg)
        if not f.description:
            reasons.append("label_description_missing")
        elif re.search(r"not\s+implemented", f.description, re.I):
            reasons.append("label_states_not_implemented")
        if desc_count.get(f.description, 0) > 1 and f.description:
            reasons.append("ambiguous_label_description_shared_with_other_field")
        if f.unit and sym is None and (f.name in catalog or f.name in unc_owner):
            reasons.append(f"unit_not_recognised:{f.unit}")  # only matters where a conversion is needed
        if f.name == "SCLK" and (f.unit or "").lower() != "second":
            reasons.append("sclk_unit_not_second")
        if f.data_type == "ASCII_Real" and role in ("data", "uncertainty") and not f.unit:
            reasons.append("missing_unit_in_label")
        var = catalog.get(f.name)
        owner = unc_owner.get(f.name)
        if var is not None:
            if (f.unit or "").lower() != var.label_unit.lower():
                reasons.append(f"catalog_unit_mismatch:label={f.unit};expected={var.label_unit}")
            for pat in var.evidence_patterns:
                if not re.search(pat, f.description, re.I):
                    reasons.append(f"catalog_evidence_missing:{pat}")
        if owner is not None and sym is not None and not has_conversion(sym, owner.canonical_unit):
            reasons.append(f"uncertainty_unit_incompatible:{sym}->{owner.canonical_unit}")
        items.append(ChannelVerification(
            product_type, header, idx, f.name, f.unit, sym, f.data_type, f.description, role,
            "verified" if not reasons else "unverified", reasons, alias_applied,
            var.name if var is not None else None,
        ))
    return Verification(items, warnings)


# --------------------------------------------------------------------------- observations
def build_observations(*, df: pd.DataFrame, product, label, verification: Verification, cfg, qa, component_vars: set):
    """Canonical observation rows (one per measurement cell) for every verified catalog channel of a product."""
    sclk_v, lmst_v, ltst_v = (verification.get(n) for n in _TIME_NAMES)
    if not (sclk_v and sclk_v.status == "verified"):
        from . import InputError

        raise InputError(f"{product.product_id}: SCLK channel failed verification: {sclk_v.reasons if sclk_v else 'absent'}")
    n = len(df)
    sclk = T.parse_sclk(df[sclk_v.header])
    time_ok = np.isfinite(sclk)
    lmst = T.verbatim_or_null(df[lmst_v.header]) if lmst_v and lmst_v.status == "verified" else T.utc_column(n)
    ltst = T.verbatim_or_null(df[ltst_v.header]) if ltst_v and ltst_v.status == "verified" else T.utc_column(n)
    if lmst_v is None or lmst_v.status != "verified":
        qa.warn(f"{product.product_id}: LMST channel unverified; lmst written as null")
    if ltst_v is None or ltst_v.status != "verified":
        qa.warn(f"{product.product_id}: LTST channel unverified; ltst written as null")
    mism = T.count_lmst_sol_mismatch(lmst, product.sol)
    if mism:
        qa.warn(f"{product.product_id}: {mism} record(s) whose LMST sol prefix differs from product Sol {product.sol}")
    source_row = np.arange(n, dtype="int64") + 2  # 1-based physical line number; header is line 1
    provenance = f"{label.logical_identifier}@v{label.version_id}|{product.label.rel.split('/')[-1]}"
    utc = T.utc_column(n)

    frames = []
    for var in cfg.variables:
        if var.product_type != product.product_type:
            continue
        v = verification.get(var.channel)
        if v is None or v.status != "verified":
            continue
        flags = []
        for rule in cfg.quality_rules:
            if rule.product_type == product.product_type and var.name in rule.applies_to:
                fv = verification.get(rule.flag_channel)
                toks = df[fv.header] if fv is not None and fv.status == "verified" else None
                flags.append(Q.FlagSpec(rule.id, rule.code, rule.equals, rule.status, toks))
        tokens = df[v.header]
        values, status, codes, masks = Q.classify(tokens, cfg.sentinels, flags, time_ok)
        canon = convert(values, v.unit_symbol, var.canonical_unit)  # NaN stays NaN
        unc = np.full(n, np.nan)
        unc_unit = None
        if var.uncertainty_channel:
            uv = verification.get(var.uncertainty_channel)
            if uv is not None and uv.status == "verified":
                ut = pd.to_numeric(df[uv.header].str.strip().where(df[uv.header].str.strip() != ""), errors="coerce").to_numpy(dtype="float64")
                ut = np.where(np.isfinite(ut), ut, np.nan)
                unc = convert_uncertainty(ut, uv.unit_symbol, var.canonical_unit)
                unc_unit = var.canonical_unit
        qa.add_status(product.sol, var.name, status)
        qa.add_rule_effects(var.name, masks, var.name in component_vars)
        frames.append(pd.DataFrame({
            "sol": np.int32(product.sol),
            "sclk": sclk,
            "lmst": lmst.to_numpy(dtype=object),
            "ltst": ltst.to_numpy(dtype=object),
            "utc": utc.to_numpy(dtype=object),
            "variable": var.name,
            "value": canon,
            "unit": var.canonical_unit,
            "original_value": tokens.to_numpy(dtype=object),
            "original_unit": v.label_unit,
            "source_channel": var.channel,
            "source_product": product.product_id,
            "processing_level": label.processing_level,
            "source_file": product.data.rel,
            "source_row": source_row,
            "quality_status": status,
            "quality_code": codes,
            "uncertainty": unc,
            "uncertainty_unit": unc_unit,
            "provenance": provenance,
        }, columns=OBS_COLUMNS))
    if not frames:
        return pd.DataFrame(columns=OBS_COLUMNS)
    return pd.concat(frames, ignore_index=True)
