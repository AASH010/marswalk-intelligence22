from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PlanningLimits(BaseModel):
    air_min_k: float = Field(..., description="Lowest acceptable air temperature for a GO hour (K)")
    ground_min_k: float = Field(..., description="Lowest acceptable ground temperature for a GO hour (K)")
    go_confidence: float = Field(..., description="P(conditions met) needed for GO")
    caution_confidence: float = Field(..., description="P(conditions met) needed for CAUTION")
    min_sun_elevation_deg: float = Field(..., description="Sun elevation above which an hour counts as daylight")
    placeholder: bool = Field(True, description="True while the limits are planning placeholders, not suit specifications")


class WeatherStatus(BaseModel):
    available: bool
    message: Optional[str] = None
    site: str
    latest_observed_sol: Optional[int] = None
    first_issue_sol: Optional[int] = None
    latest_issue_sol: Optional[int] = None
    max_horizon_hours: int
    model_trained_at: Optional[str] = None
    model_engine: Optional[str] = None
    default_limits: Optional[PlanningLimits] = None


class Distribution(BaseModel):
    forecast: Optional[float] = Field(None, description="Point forecast (K)")
    baseline: Optional[float] = Field(None, description="Same-hour mean of the 7 sols before the issue sol (K)")
    q05: Optional[float] = None
    q10: Optional[float] = None
    q25: Optional[float] = None
    q75: Optional[float] = None
    q90: Optional[float] = None
    q95: Optional[float] = None
    actual: Optional[float] = Field(None, description="Observed value, only for sols that have already happened")


class ForecastHour(BaseModel):
    offset_hours: int = Field(..., description="Hours after the start of the first forecast sol")
    sol: int
    hour: int = Field(..., description="Local true solar time hour (0-23)")
    lead_sols: int
    ls_deg: float
    solar_elevation_deg: float
    daylight: bool
    air: Distribution
    ground: Distribution
    p_air_ok: Optional[float] = None
    p_ground_ok: Optional[float] = None
    p_go: Optional[float] = Field(None, description="P(air and ground limits both met); 0 at night")
    status: Literal["GO", "CAUTION", "NO_GO"]
    reason: str
    actual_status: Optional[Literal["GO", "NOT_GO"]] = None


class WindowPoint(BaseModel):
    offset_hours: int
    sol: int
    hour: int


class EvaWindow(BaseModel):
    start: WindowPoint
    end: WindowPoint = Field(..., description="First hour after the window")
    length_hours: int
    min_p_go: float
    mean_p_go: float
    fits_route: Optional[bool] = None


class Departure(BaseModel):
    start: WindowPoint
    end: WindowPoint
    hours_needed: int
    min_p_go: float
    mean_p_go: float


class Verification(BaseModel):
    hours_scored: int
    mae_air_model: Optional[float] = None
    mae_air_baseline: Optional[float] = None
    mae_ground_model: Optional[float] = None
    mae_ground_baseline: Optional[float] = None
    status_agreement: Optional[float] = None


class ForecastResponse(BaseModel):
    issue_sol: int
    issued_after: WindowPoint
    is_replay: bool = Field(..., description="True when the forecast sols already have observations")
    start_offset_hours: int
    end_offset_hours: int
    limits: PlanningLimits
    route_hours: Optional[float] = None
    hours: List[ForecastHour]
    windows: List[EvaWindow]
    recommended_departure: Optional[Departure] = None
    summary: List[str]
    verification: Optional[Verification] = None
    model_engine: str


class SeriesPoint(BaseModel):
    sol: int
    hour: int
    air_temp_k: Optional[float] = None
    ground_temp_k: Optional[float] = None
    pressure_pa: Optional[float] = None


class DailyStats(BaseModel):
    sol: int
    air_min_k: Optional[float] = None
    air_max_k: Optional[float] = None
    air_mean_k: Optional[float] = None
    ground_min_k: Optional[float] = None
    ground_max_k: Optional[float] = None
    pressure_mean_pa: Optional[float] = None
    hours_observed: int


class CurrentConditions(BaseModel):
    sol: int
    hour: Optional[int] = Field(None, description="Latest observed LTST hour in this sol")
    ls_deg: float
    season: str
    sunrise_ltst: float
    sunset_ltst: float
    solar_elevation_deg: Optional[float] = None
    air_temp_k: Optional[float] = None
    ground_temp_k: Optional[float] = None
    pressure_pa: Optional[float] = None
    downward_lw_wm2: Optional[float] = None
    today: DailyStats
    previous: Optional[DailyStats] = None
    series: List[SeriesPoint]
    source: str
    flagged_hours: int = Field(..., description="Hours removed by quality control in this sol")


class WeatherReport(BaseModel):
    report: Dict
