from typing import Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.route import (
    START_TIME_PATTERN,
    CostModel,
    GeoJSONGeometry,
    RouteProfileSummary,
    WeatherSelectionOut,
)


# ============================================================
# Legacy POST /api/v1/mission/consumables (deprecated, unchanged)
# ============================================================


class ConsumablesRequest(BaseModel):
    distance_km: float = Field(
        ..., gt=0, description="Total route distance in kilometers"
    )
    average_raw_terrain_cost: float = Field(
        ..., ge=0, description="Average terrain cost multiplier from route response"
    )
    average_slope_percent: Optional[float] = Field(
        default=0.0, description="Average route slope percentage"
    )
    payload_kg: Optional[float] = Field(
        default=0.0, ge=0, description="Carried equipment or sample payload in kg"
    )
    base_walking_speed_ms: Optional[float] = Field(
        default=0.35, gt=0, description="Base EVA walking speed in meters per second"
    )
    suit_capacity_hours: Optional[float] = Field(
        default=8.5, gt=0, description="Maximum EMU suit capacity in hours"
    )


class ConsumablesAssumptions(BaseModel):
    base_walking_speed_ms: float
    kcal_per_liter_o2: float
    suit_capacity_hours: float
    min_metabolic_rate_kcal_hr: float
    max_metabolic_rate_kcal_hr: float
    mars_gravity_m_s2: float
    base_system_mass_kg: float
    payload_mass_kg: float
    muscular_efficiency: float
    disclaimer: str


class ConsumablesResponse(BaseModel):
    estimated_duration_hours: float
    estimated_oxygen_liters: float
    # Legacy name kept for the deprecated endpoint only. The value is the
    # walking time as a percentage of suit time, not an oxygen fraction; the
    # new endpoint reports it as suit_time_fraction_percent.
    oxygen_percent_of_suit_capacity: float
    average_metabolic_rate_kcal_hr: float
    slope_penalty_kcal_hr: float
    payload_penalty_kcal_hr: float
    safety_margin_hours: float
    assumptions: ConsumablesAssumptions


# ============================================================
# POST /api/v1/mission/eva-estimate (route-based, segment model)
# ============================================================

ValueTag = Literal["measured", "calculated", "modeled", "assumed"]


class EvaEstimateRequest(BaseModel):
    """The server runs the route itself. Profiles, slopes, distances or
    terrain costs from the client are not accepted (unknown fields -> 400)."""

    model_config = ConfigDict(extra="forbid")

    start: Tuple[float, float] = Field(..., description="Start Mars coordinates [x, y]")
    goal: Tuple[float, float] = Field(..., description="Goal Mars coordinates [x, y]")
    mode: Literal["fastest", "balanced", "conservative"] = "balanced"
    sol: Optional[int] = Field(default=None, ge=0, description="LMST sol; default from config")
    start_time: Optional[str] = Field(
        default=None, pattern=START_TIME_PATTERN, description="LMST 'HH:MM[:SS[.fff]]'; default from config"
    )
    payload_kg: float = Field(default=0.0, ge=0, le=500, description="Carried payload (kg)")
    base_walking_speed_ms: Optional[float] = Field(
        default=None, gt=0, le=3, description="v0 (m/s); default from config (0.75 m/s)"
    )
    suit_capacity_hours: Optional[float] = Field(
        default=None, gt=0, le=24, description="Suit time capacity (h); default from config"
    )


class TaggedValue(BaseModel):
    value: Optional[float] = None
    unit: str
    tag: ValueTag


class EvaSegment(BaseModel):
    index: int
    from_cell: List[int]
    to_cell: List[int]
    distance_m: TaggedValue
    slope_percent: TaggedValue
    grade_percent: TaggedValue
    terrain_part: TaggedValue
    terrain_cost: TaggedValue
    weather_factor: TaggedValue
    w_t: Optional[TaggedValue] = None
    weather_status: str
    speed_ms: TaggedValue
    duration_s: TaggedValue
    metabolic_rate_w: TaggedValue
    metabolic_rate_kcal_hr: TaggedValue
    weather_energy_w: TaggedValue
    energy_kcal: TaggedValue
    oxygen_l: TaggedValue


class EvaTotals(BaseModel):
    duration_s: TaggedValue
    duration_hours: TaggedValue
    energy_kcal: TaggedValue
    oxygen_liters: TaggedValue
    average_metabolic_rate_kcal_hr: TaggedValue = Field(
        ..., description="Unclamped: total energy / total duration"
    )
    reported_metabolic_rate_kcal_hr: TaggedValue = Field(
        ..., description="Clamped to the configured bounds; equals the unclamped value unless metabolic_rate_clamped"
    )
    metabolic_rate_clamped: bool
    suit_time_fraction_percent: TaggedValue = Field(
        ..., description="Walking time as a percentage of suit time capacity (time, not oxygen)"
    )
    suit_time_margin_hours: TaggedValue
    weather_energy_kcal: TaggedValue


class ModelParameter(BaseModel):
    name: str
    value: Union[float, str]
    unit: str
    tag: ValueTag
    source: str


class EvaRoute(BaseModel):
    mode: str
    mode_id: str
    distance_km: float
    optimization_cost: float
    average_optimization_cost: float
    geometry: GeoJSONGeometry


class EvaEstimateResponse(BaseModel):
    route: EvaRoute
    weather_status: Literal["applied", "unavailable", "disabled"]
    confidence: Literal["high", "reduced", "invalid"]
    weather: WeatherSelectionOut
    cost_model: CostModel
    route_profile_summary: RouteProfileSummary
    totals: EvaTotals
    segments: List[EvaSegment]
    parameters: List[ModelParameter]
    model: Dict[str, str]
    warnings: List[str]
