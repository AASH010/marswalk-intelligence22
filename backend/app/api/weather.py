from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.weather import CurrentConditions, ForecastResponse, WeatherReport, WeatherStatus
from app.services.weather_service import MAX_HORIZON_HOURS, SITE, WeatherUnavailable, get_weather_service

router = APIRouter(prefix="/api/v1/weather", tags=["Weather"])


def _service():
    try:
        return get_weather_service()
    except WeatherUnavailable as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))


@router.get("/status", response_model=WeatherStatus)
def weather_status():
    """Whether the forecast model is loaded, and the sols it can be issued for."""
    try:
        return get_weather_service().status()
    except WeatherUnavailable as error:
        return {"available": False, "message": str(error), "site": SITE, "max_horizon_hours": MAX_HORIZON_HOURS}


@router.get("/current", response_model=CurrentConditions)
def current_conditions(
    sol: Optional[int] = Query(default=None, description="Sol to describe (default: latest observed)"),
    hour: Optional[int] = Query(default=None, ge=0, le=23, description="Only use measurements up to this LTST hour of the sol (default: the whole sol)"),
):
    """Observed surface conditions for one sol, with the two sols before it."""
    try:
        return _service().current(sol, hour)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))


@router.get("/forecast", response_model=ForecastResponse)
def weather_forecast(
    issue_sol: Optional[int] = Query(default=None, description="Forecast issued at the end of this sol (default: latest observed sol)"),
    start_hour: int = Query(default=0, ge=0, lt=MAX_HORIZON_HOURS, description="First hour, counted from 00:00 LTST of the next sol"),
    end_hour: int = Query(default=48, gt=0, le=MAX_HORIZON_HOURS, description="End of the range (exclusive), same origin"),
    route_hours: Optional[float] = Query(default=None, gt=0, le=MAX_HORIZON_HOURS, description="EVA duration to fit into a window"),
    air_min_k: Optional[float] = Query(default=None, gt=100, lt=320),
    ground_min_k: Optional[float] = Query(default=None, gt=100, lt=340),
    go_confidence: Optional[float] = Query(default=None, gt=0, le=1),
    caution_confidence: Optional[float] = Query(default=None, gt=0, le=1),
    min_sun_elevation_deg: Optional[float] = Query(default=None, ge=-10, le=45),
):
    """Hourly air and ground temperature forecast, uncertainty bands, GO probability and EVA windows."""
    limits = {
        key: value
        for key, value in {
            "air_min_k": air_min_k,
            "ground_min_k": ground_min_k,
            "go_confidence": go_confidence,
            "caution_confidence": caution_confidence,
            "min_sun_elevation_deg": min_sun_elevation_deg,
        }.items()
        if value is not None
    }
    try:
        return _service().forecast(issue_sol, start_hour, end_hour, limits, route_hours)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))


@router.get("/report", response_model=WeatherReport)
def evaluation_report():
    """Out-of-sample evaluation of the model (shown in the forecast dashboard)."""
    service = _service()
    if service.report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No evaluation report is available.")
    return {"report": service.report}
