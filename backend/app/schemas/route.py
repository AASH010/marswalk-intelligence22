from typing import Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

START_TIME_PATTERN = r"^\d{1,2}:\d{2}(:\d{2}(\.\d{1,6})?)?$"


class RouteRequest(BaseModel):
    start: Tuple[float, float] = Field(
        ..., description="Start Mars coordinates [x, y]"
    )
    goal: Tuple[float, float] = Field(
        ..., description="Goal Mars coordinates [x, y]"
    )
    mode: Literal["fastest", "balanced", "conservative"] = "balanced"
    sol: Optional[int] = Field(
        default=None,
        ge=0,
        description="Sol of the walk (LMST sol). Default: latest sol in the Task 1 weather output.",
    )
    start_time: Optional[str] = Field(
        default=None,
        pattern=START_TIME_PATTERN,
        description="Start time, LMST 'HH:MM[:SS[.fff]]'. Default: 12:00:00.",
    )
    include_profile: bool = Field(
        default=False,
        description="Return the full per-segment Route Profile.",
    )


# ============================================================
# Weather selection
# ============================================================


class WeatherTime(BaseModel):
    sol: int
    lmst: str
    ltst: str
    sclk: float


class WeatherRecordOut(WeatherTime):
    w_t: float
    quality_status: str
    components_used: List[str]


class WeatherSelectionOut(BaseModel):
    status: Literal["applied", "unavailable", "disabled"]
    reason: Optional[str] = None
    requested_sol: Optional[int] = None
    requested_time: Optional[str] = None
    defaults_used: List[str] = []
    time_basis: str
    window_s: Optional[float] = None
    accepted_quality: List[str] = []
    selection_method: Optional[Literal["exact_match", "nearest_within_window"]] = None
    time_difference_s: Optional[float] = None
    time_difference_unit: str
    w_t: Optional[float] = Field(None, description="W_t used in the cost; null when weather is not applied")
    w_t_tag: Optional[str] = None
    regional: bool = True
    record: Optional[WeatherRecordOut] = None
    source: Optional[Dict] = None
    warnings: List[str] = []


# ============================================================
# Route profile
# ============================================================


class RequestedTime(BaseModel):
    sol: Optional[int] = None
    lmst: Optional[str] = None


class RouteProfileSummary(BaseModel):
    segment_method: str
    segment_count: int
    start_cell: List[int]
    goal_cell: List[int]
    total_distance_m: float
    mean_slope_deg: Optional[float] = None
    mean_slope_method: str
    max_slope_deg: Optional[float] = None
    mean_slope_percent: Optional[float] = None
    max_slope_percent: Optional[float] = None
    max_uphill_grade_percent: Optional[float] = None
    max_downhill_grade_percent: Optional[float] = None
    elevation_gain_m: float
    elevation_loss_m: float
    mode: str
    mode_id: str
    optimization_objective: float
    objective_from_segments: float
    weather_status: str
    w_t: Optional[float] = None
    weather_time: Optional[WeatherTime] = None
    requested_time: Optional[RequestedTime] = None


class ProfileSegment(BaseModel):
    index: int
    from_cell: List[int]
    to_cell: List[int]
    from_xy: List[float]
    to_xy: List[float]
    distance_m: float
    elevation_from_m: float
    elevation_to_m: float
    grade_percent: float
    slope_deg: float
    slope_percent: float
    terrain_cost: float
    terrain_part: float
    slope_weight: float
    weather_factor: float
    weather_penalty: float
    cell_cost: float
    objective_contribution: float
    w_t: Optional[float] = None
    weather_status: str


class RouteProfile(BaseModel):
    summary: RouteProfileSummary
    segments: List[ProfileSegment]
    field_tags: Dict[str, str]
    field_units: Dict[str, str]


class CostModel(BaseModel):
    formula: str
    terrain_weight: float
    beta: float
    beta_tag: str
    penalty_coefficient: float
    penalty_tag: str
    reference_slope_deg: float
    reference_slope_tag: str
    weather_hard_constraints: str
    max_walkable_slope_deg: float
    w_t_scope: str
    validated: bool


# ============================================================
# GeoJSON response
# ============================================================


class RouteProperties(BaseModel):
    mode: str
    distance_km: float
    raw_terrain_cost: float
    average_raw_terrain_cost: float
    optimization_cost: float = Field(
        ..., description="A* objective: sum of move length (m) x destination cell cost; start cell excluded"
    )
    average_optimization_cost: float = Field(
        ..., description="optimization_cost / route length (m)"
    )
    weather_status: Literal["applied", "unavailable", "disabled"]
    weather_time: Optional[WeatherTime] = None
    weather_time_difference_s: Optional[float] = None
    confidence: Literal["high", "reduced", "invalid"]
    weather: WeatherSelectionOut
    cost_model: CostModel
    route_profile_summary: RouteProfileSummary
    profile: Optional[RouteProfile] = None


class GeoJSONGeometry(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: List[Tuple[float, float]]


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    properties: RouteProperties
    geometry: GeoJSONGeometry


class GeoJSONResponse(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: List[GeoJSONFeature]
