from fastapi import APIRouter, HTTPException, status

from app.schemas.route import RouteRequest, GeoJSONResponse
from app.services.navigation_service import (
    RouteInputError,
    RouteNotFound,
    TerrainUnavailable,
    WeatherRequired,
    plan_route,
)


router = APIRouter()


@router.post(
    "/navigate",
    response_model=GeoJSONResponse,
    response_model_exclude_unset=True,
    status_code=status.HTTP_200_OK,
)
def navigate(request: RouteRequest):
    """Weather-aware route between two Mars map coordinates.

    Request and response keep their earlier fields. Added:

    * request: optional ``sol``, ``start_time`` (LMST) and ``include_profile``;
    * response properties: corrected ``optimization_cost`` (the A* objective),
      ``weather_status``, ``weather_time``, ``weather_time_difference_s``,
      ``confidence``, ``weather``, ``cost_model``, ``route_profile_summary``,
      and ``profile`` only when ``include_profile`` is true.

    Status codes: 400 invalid input (outside raster, blocked cell, same cell,
    bad time), 404 no route, 422 schema errors or W_t required by the
    configuration but unavailable, 503 DEM unavailable.
    """
    try:
        planned = plan_route(
            start_xy=request.start,
            goal_xy=request.goal,
            mode=request.mode,
            sol=request.sol,
            start_time=request.start_time,
        )
    except RouteInputError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RouteNotFound as error:
        raise HTTPException(status_code=404, detail=str(error))
    except WeatherRequired as error:
        raise HTTPException(status_code=422, detail=str(error))
    except TerrainUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error))

    result = planned.result
    selection = planned.selection
    record = selection.record

    properties = {
        "mode": result["mode"],
        "distance_km": round(result["distance_km"], 3),
        "raw_terrain_cost": round(result["raw_terrain_cost"], 2),
        "average_raw_terrain_cost": round(
            result["average_raw_terrain_cost"], 4
        ),
        "optimization_cost": round(
            result["optimization_cost"], 2
        ),
        "average_optimization_cost": round(
            result["average_optimization_cost"], 4
        ),
        "weather_status": selection.status,
        "weather_time": (
            {"sol": record.sol, "lmst": record.lmst, "ltst": record.ltst, "sclk": record.sclk}
            if record is not None
            else None
        ),
        "weather_time_difference_s": selection.time_difference_s,
        "confidence": planned.confidence,
        "weather": selection.to_dict(),
        "cost_model": planned.cost_model,
        "route_profile_summary": planned.profile["summary"],
    }

    if request.include_profile:
        properties["profile"] = planned.profile

    feature = {
        "type": "Feature",
        "properties": properties,
        "geometry": {
            "type": "LineString",
            "coordinates": planned.coordinates,
        },
    }

    return {
        "type": "FeatureCollection",
        "features": [feature],
    }
