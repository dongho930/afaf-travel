from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import AccessibilitySummary, Attraction, RegionOption, UserType
from app.services.sigungu_codes import list_signgu_by_area
from app.services.supabase_service import get_cached_accessibility_stats, save_accessibility_stats
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


@router.get("/accessibility-summary", response_model=AccessibilitySummary)
async def accessibility_summary(region: str = Query(default="경기도")):
    """
    '접근성' 탭/홈 화면 통계용 요약 정보.
    매번 다시 계산하지 않고, 미리 계산해서 저장해둔(캐시된) 고정 값을 읽어서
    돌려줍니다 — 그래야 요청할 때마다 숫자가 들쭉날쭉하지 않고 일정합니다.
    아직 한 번도 계산한 적이 없으면(캐시 없음) 그 자리에서 한 번 계산해 저장하고
    돌려줍니다 (최초 1회만 오래 걸립니다 — 전수조사라 수 분 소요될 수 있어요).
    """
    cached = await get_cached_accessibility_stats(region)
    if cached:
        return AccessibilitySummary(**cached)

    data = await tour_api_client.get_accessibility_summary(region)
    await save_accessibility_stats(region, data)
    return AccessibilitySummary(**data)


@router.get("/accessibility-summary/refresh", response_model=AccessibilitySummary)
async def refresh_accessibility_summary(region: str = Query(default="경기도")):
    """
    접근성 통계를 다시 계산해서 캐시를 갱신합니다. 전수조사 방식이라 수천 건을
    다 조회하느라 몇 분 정도 걸릴 수 있어요 — 응답이 바로 안 와도 정상입니다.
    필요할 때(예: 하루 한 번)
    수동으로 호출해주세요 — 자동으로는 갱신되지 않습니다.
    """
    data = await tour_api_client.get_accessibility_summary(region)
    await save_accessibility_stats(region, data)
    return AccessibilitySummary(**data)
