from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import Attraction, UserType
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/tourism", tags=["tourism"])


@router.get("/attractions", response_model=list[Attraction])
async def list_attractions(
    region: str = Query(default="경기도"),
    user_type: UserType = Query(default=UserType.GENERAL),
    limit: int = Query(default=20, le=50),
):
    """무장애 필터링이 적용된 관광지 목록"""
    return await tour_api_client.search_accessible_attractions(region, user_type.value, limit)


@router.get("/attractions/{content_id}/related", response_model=list[Attraction])
async def related_attractions(content_id: str):
    results = await tour_api_client.get_related_attractions(content_id)
    if not results:
        return []
    return results


@router.get("/attractions/{content_id}/congestion")
async def congestion_forecast(content_id: str):
    forecast = await tour_api_client.get_congestion_forecast(content_id)
    if forecast is None:
        raise HTTPException(status_code=404, detail="관광지를 찾을 수 없습니다.")
    return forecast
