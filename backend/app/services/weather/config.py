"""Pipeline configuration (pydantic).

Everything that is a *decision* rather than a fact about the data lives here: which channels
become canonical variables, which label flags downgrade quality, W_t components, weights and the
fixed normalization constants. Nothing in this file is derived from the data on a given run.
"""

import hashlib
import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from . import ConfigError

QUALITY_STATUSES = ("valid", "invalid", "missing", "suspect", "unverified")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SentinelConfig(_Strict):
    # Raw CSV tokens (after strip) treated as "no measurement". "" is the empty field.
    missing_tokens: list[str] = Field(default_factory=lambda: [""])
    # Numeric sentinel values (none are present in Sols 230-239; kept so a new release is handled).
    numeric_sentinels: list[float] = Field(default_factory=list)


class HeaderAlias(_Strict):
    """Explicit, auditable resolution of a CSV-header vs PDS4-label name disagreement."""

    product_type: str
    field_number: int
    header: str
    label_name: str
    note: str = ""


class QualityRule(_Strict):
    """A label-defined flag that downgrades the quality of specific variables."""

    id: str
    product_type: str
    flag_channel: str  # label field name
    equals: float  # flag value that triggers the rule
    status: Literal["invalid", "suspect"]
    code: str
    applies_to: list[str]  # canonical variable names
    label_basis: str  # what the label says about the flag


class VariableDef(_Strict):
    name: str
    description: str
    product_type: str
    channel: str  # label field name
    label_unit: str  # unit text the label must state for this channel
    canonical_unit: str
    evidence_patterns: list[str] = Field(default_factory=list)  # regexes the label description must match
    uncertainty_channel: Optional[str] = None


class ComponentDef(_Strict):
    name: str
    variable: str
    weight: float
    norm_min: float
    norm_max: float
    invert: bool = False
    rationale: str = ""

    @field_validator("weight")
    @classmethod
    def _weight_positive(cls, v):
        if not v > 0:
            raise ValueError("weight must be > 0")
        return v

    @model_validator(mode="after")
    def _range(self):
        if not self.norm_max > self.norm_min:
            raise ValueError("norm_max must be > norm_min")
        return self


class WeatherIntensityConfig(_Strict):
    method: Literal["weighted_mean_clipped_minmax"] = "weighted_mean_clipped_minmax"
    min_components: int = 1
    components: list[ComponentDef]


class Config(_Strict):
    schema_version: str = "1.0"
    strict_inputs: bool = True
    sentinels: SentinelConfig = Field(default_factory=SentinelConfig)
    label_unit_symbols: dict[str, str]
    header_aliases: list[HeaderAlias] = Field(default_factory=list)
    quality_rules: list[QualityRule] = Field(default_factory=list)
    variables: list[VariableDef]
    weather_intensity: WeatherIntensityConfig

    @model_validator(mode="after")
    def _cross_checks(self):
        names = [v.name for v in self.variables]
        if not names:
            raise ValueError("at least one variable is required")
        if len(set(names)) != len(names):
            raise ValueError("duplicate variable names")
        keys = [(v.product_type, v.channel) for v in self.variables]
        if len(set(keys)) != len(keys):
            raise ValueError("two variables bind the same (product_type, channel)")
        rule_ids = [r.id for r in self.quality_rules]
        if len(set(rule_ids)) != len(rule_ids):
            raise ValueError("duplicate quality rule ids")
        for r in self.quality_rules:
            for vn in r.applies_to:
                if vn not in names:
                    raise ValueError(f"rule {r.id} applies to unknown variable {vn}")
        comps = self.weather_intensity.components
        if not comps:
            raise ValueError("weather_intensity needs at least one component")
        if len({c.name for c in comps}) != len(comps):
            raise ValueError("duplicate component names")
        if len({c.variable for c in comps}) != len(comps):
            raise ValueError("two components bind the same variable")
        for c in comps:
            if c.variable not in names:
                raise ValueError(f"component {c.name} uses unknown variable {c.variable}")
        if not 1 <= self.weather_intensity.min_components <= len(comps):
            raise ValueError("min_components must be between 1 and the number of components")
        return self


def default_config_path() -> Path:
    return Path(__file__).with_name("default_config.json")


def load_config(path: Optional[Path] = None) -> Config:
    p = Path(path) if path else default_config_path()
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"config file not found: {p.name}")
    except (OSError, ValueError) as exc:
        raise ConfigError(f"config file unreadable or not valid JSON ({p.name}): {exc}")
    try:
        return Config.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(f"invalid config ({p.name}): {exc}")
    except ValueError as exc:  # validators raising ValueError outside pydantic wrapping
        raise ConfigError(f"invalid config ({p.name}): {exc}")


def canonical_config_json(cfg: Config) -> str:
    return json.dumps(cfg.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def config_hash(cfg: Config) -> str:
    """SHA-256 of the validated config in canonical form (independent of file formatting)."""
    return hashlib.sha256(canonical_config_json(cfg).encode("utf-8")).hexdigest()
