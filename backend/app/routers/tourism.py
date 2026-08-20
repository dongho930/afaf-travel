from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import Attraction, RegionOption, UserType
from app.services.sigungu_codes import list_signgu_by_area
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/tourism", tags=["tourism"])


@router.get("/regions", response_model=list[RegionOption])
async def list_regions(province: str = Query(default="경기도")):
    """
    지역 선택 UI용 시/군/구 목록 (예: 경기도 → 수원시 팔달구, 성남시 분당구, ...).
    반환되는 code를 /api/courses/recommend 등의 sigungu_cd 파라미터로 그대로 넘기면 됩니다.
    """
    rows = list_signgu_by_area(province)
    return [RegionOption(code=code, name=name) for code, name in rows]


@router.get("/attractions", response_model=list[Attraction])
async def list_attractions(
    region: str = Query(default="경기도"),
    user_type: UserType = Query(default=UserType.GENERAL),
    limit: int = Query(default=20, le=50),
    sigungu_cd: int | None = Query(default=None, description="특정 시/군/구로 좁혀서 조회 (선택)"),
):
    """무장애 필터링이 적용된 관광지 목록"""
    return await tour_api_client.search_accessible_attractions(
        region, user_type.value, limit, sigungu_cd
    )


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
