from typing import Callable

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.core.eva_config import get_settings
from app.core.science.consumables import calculate_eva_consumables
from app.core.science.eva_model import (
    MODEL_DESCRIPTION,
    EvaInputs,
    estimate_consumables,
    model_parameters,
)
from app.schemas.mission import (
    ConsumablesRequest,
    ConsumablesResponse,
    EvaEstimateRequest,
    EvaEstimateResponse,
)
from app.services.navigation_service import (
    RouteInputError,
    RouteNotFound,
    TerrainUnavailable,
    WeatherRequired,
    plan_route,
)


class BadRequestOnValidationRoute(APIRoute):
    """Report request-schema errors as HTTP 400 on this route.

    /eva-estimate reserves 422 for "weather required but unavailable", so
    malformed input (including a client-supplied profile or slope, which the
    schema forbids) is answered with 400 and the validation details.
    """

    def get_route_handler(self) -> Callable:
        handler = super().get_route_handler()

        async def route_handler(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": jsonable_errors(error)},
                )

        return route_handler


def jsonable_errors(error: RequestValidationError) -> list:
    errors = []
    for item in error.errors():
        errors.append({key: (str(value) if key == "ctx" else value) for key, value in item.items() if key != "input"})
    return errors


router = APIRouter(prefix="/api/v1/mission", tags=["Mission Planning"])
eva_router = APIRouter(
    prefix="/api/v1/mission",
    tags=["Mission Planning"],
    route_class=BadRequestOnValidationRoute,
)


@router.post(
    "/consumables",
    response_model=ConsumablesResponse,
    status_code=status.HTTP_200_OK,
    deprecated=True,
)
def estimate_mission_consumables(request: ConsumablesRequest):
    """DEPRECATED: use POST /api/v1/mission/eva-estimate.

    Calculates estimated duration, oxygen usage, and safety margins for an EVA mission
    given route distance, terrain roughness, slope, and payload weight.

    Kept unchanged for existing clients. It trusts client-supplied distance,
    terrain cost and slope, and its ``oxygen_percent_of_suit_capacity`` is a
    percentage of suit TIME (the new endpoint names it
    ``suit_time_fraction_percent``).
    """
    try:
        return calculate_eva_consumables(request)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while calculating mission consumables.",
        )


@eva_router.post(
    "/eva-estimate",
    response_model=EvaEstimateResponse,
    status_code=status.HTTP_200_OK,
)
def estimate_eva(request: EvaEstimateRequest):
    """EVA walking duration and consumables for the route the server plans.

    The server runs the same pipeline as /navigate (weather selection, A*,
    Route Profile) and evaluates the segment model on that profile. Every
    value carries a unit and a tag (measured / calculated / modeled /
    assumed).

    Status codes: 400 invalid input, 404 no route, 422 W_t required by the
    configuration but unavailable, 503 DEM unavailable.
    """
    settings = get_settings()

    try:
        planned = plan_route(
            start_xy=request.start,
            goal_xy=request.goal,
            mode=request.mode,
            sol=request.sol,
            start_time=request.start_time,
            settings=settings,
        )
    except RouteInputError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RouteNotFound as error:
        raise HTTPException(status_code=404, detail=str(error))
    except WeatherRequired as error:
        raise HTTPException(status_code=422, detail=str(error))
    except TerrainUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error))

    eva_config = settings.eva
    inputs = EvaInputs(
        payload_kg=request.payload_kg,
        base_walking_speed_ms=(
            request.base_walking_speed_ms
            if request.base_walking_speed_ms is not None
            else eva_config.default_base_walking_speed_ms
        ),
        suit_capacity_hours=(
            request.suit_capacity_hours
            if request.suit_capacity_hours is not None
            else eva_config.default_suit_capacity_hours
        ),
    )

    estimate = estimate_consumables(
        planned.profile["segments"],
        inputs,
        eva_config,
        w_t=planned.selection.w_t,
    )

    warnings = list(planned.selection.warnings) + list(estimate["warnings"])
    if planned.selection.status != "applied":
        warnings.insert(
            0,
            f"Weather not applied ({planned.selection.status}): {planned.selection.reason} "
            "The route was planned with F = 1 and P = 0.",
        )

    confidence = planned.confidence if estimate["finite"] else "invalid"
    result = planned.result

    return {
        "route": {
            "mode": result["mode"],
            "mode_id": result["mode_id"],
            "distance_km": result["distance_km"],
            "optimization_cost": result["optimization_cost"],
            "average_optimization_cost": result["average_optimization_cost"],
            "geometry": {"type": "LineString", "coordinates": planned.coordinates},
        },
        "weather_status": planned.selection.status,
        "confidence": confidence,
        "weather": planned.selection.to_dict(),
        "cost_model": planned.cost_model,
        "route_profile_summary": planned.profile["summary"],
        "totals": estimate["totals"],
        "segments": estimate["segments"],
        "parameters": model_parameters(inputs, eva_config),
        "model": MODEL_DESCRIPTION,
        "warnings": warnings,
    }
