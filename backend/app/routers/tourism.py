import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import AccessibilitySummary, Attraction, NearbyAttraction, RegionOption, UserType
from app.services.sigungu_codes import list_signgu_by_area
from app.services.supabase_service import get_cached_accessibility_stats, save_accessibility_stats
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/tourism", tags=["tourism"])


def _is_regression(existing: dict | None, data: dict) -> bool:
    """
    이번에 새로 계산한 data가 기존 캐시(existing)보다 '더 안 좋은 미완성 결과'인지 판단합니다.

    일일 트래픽 예산(tour_api_daily_fetch_budget)이나 연속 429 때문에 이번 실행이
    중간에 멈추면(debug.accessibility_fetch.deferred_no_budget > 0), 아직 못 채운
    후보들은 전부 '접근성 없음(False)'으로 잡혀서 wheelchair_count 등이 실제보다
    낮게 나옵니다. 이런 미완성 결과가 예전의 더 정확했던 값을 덮어써버리면 화면에
    보이는 숫자가 갑자기 0 같은 값으로 퇴보하니, 그 경우엔 저장하지 않습니다.
    """
    if not existing:
        return False
    deferred = data.get("debug", {}).get("accessibility_fetch", {}).get("deferred_no_budget", 0)
    if deferred <= 0:
        return False
    return data.get("wheelchair_count", 0) < existing.get("wheelchair_count", 0)


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
    limit: int = Query(default=20, le=1500),
    offset: int = Query(default=0, ge=0, description="이미 받아온 개수만큼 건너뛰고 그 다음부터 조회 (페이지네이션)"),
    sigungu_cd: int | None = Query(default=None, description="특정 시/군/구로 좁혀서 조회 (선택)"),
    include_overview: bool = Query(
        default=True,
        description="False면 소개문 채우기를 건너뜁니다. 목록을 빨리 받고 소개문은 "
        "/attractions/overviews로 화면에 보이는 만큼만 따로 채우고 싶을 때 씁니다.",
    ),
):
    """무장애 필터링이 적용된 관광지 목록"""
    # search_accessible_attractions 내부에 각 단계별(편의시설/혼잡도/평점) 타임아웃이
    # 있지만, 혹시 모를 다른 지점에서 멈추더라도 화면이 무한 로딩에 빠지지 않도록
    # 전체 요청에도 상한선을 둡니다. 시간 안에 못 끝나면 빈 목록보다는 명확한
    # 에러를 주는 게 낫습니다 — 앱에서 "잠시 후 다시 시도해주세요"로 안내할 수 있게.
    try:
        return await asyncio.wait_for(
            tour_api_client.search_accessible_attractions(
                region, user_type.value, limit, sigungu_cd, include_overview, offset
            ),
            timeout=25.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="관광지 목록을 불러오는 데 시간이 너무 오래 걸렸어요. 잠시 후 다시 시도해주세요.")


@router.get("/attractions/overviews")
async def attraction_overviews(content_ids: str = Query(..., description="쉼표로 구분된 content_id 목록")):
    """
    주어진 content_id들의 소개문만 따로 조회합니다. 홈 화면에서 '더보기'로 새로
    나타나는 6개처럼, 한 번에 몇 개만 소개문이 필요할 때 씁니다 (전체 목록을
    include_overview=false로 빠르게 받은 뒤, 실제 화면에 보이는 만큼만 이걸로 채움).
    """
    ids = [c.strip() for c in content_ids.split(",") if c.strip()]
    return await tour_api_client.get_overviews_for_ids(ids)


@router.get("/attractions/extra-info")
async def attraction_extra_info(
    content_ids: str = Query(..., description="쉼표로 구분된 content_id 목록"),
    categories: str = Query(..., description="content_ids와 같은 순서로 대응하는 카테고리 목록(쉼표 구분)"),
):
    """
    주어진 content_id들의 카테고리별 부가 정보(이용시간/요금 등)만 따로 조회합니다.
    홈 화면 카드의 소개문 아래에, 화면에 실제로 보이는 만큼만(더보기 단위로) 채울 때 씁니다
    (전체 목록을 한 번에 채우려다 시간제한에 걸리는 문제를 /attractions/overviews와
    같은 방식으로 피합니다). content_ids와 categories는 개수와 순서가 일치해야 합니다.
    """
    ids = [c.strip() for c in content_ids.split(",") if c.strip()]
    cats = [c.strip() for c in categories.split(",") if c.strip()]
    if len(ids) != len(cats):
        raise HTTPException(status_code=400, detail="content_ids와 categories의 개수가 일치해야 합니다.")
    return await tour_api_client.get_extra_info_for_ids(list(zip(ids, cats)))


@router.get("/attractions/{content_id}/related", response_model=list[Attraction])
async def related_attractions(content_id: str):
    results = await tour_api_client.get_related_attractions(content_id)
    if not results:
        return []
    return results


@router.get("/attractions/{content_id}/nearby", response_model=list[NearbyAttraction])
async def nearby_attractions(
    content_id: str,
    radius_km: float = Query(default=2.0, le=20.0, description="검색 반경(km), 최대 20km"),
):
    """관광지 상세 페이지 '근처 가볼 만한 곳' — 반경(기본 2km) 안의 결과를 개수 제한 없이 거리순으로."""
    return await tour_api_client.get_nearby_attractions(content_id, radius_km)


@router.get("/attractions/{content_id}", response_model=Attraction)
async def attraction_detail(content_id: str):
    """
    관광지 상세 페이지용 단건 조회. 주소/집중률/이점 태그/소개문을 한 번에
    채워서 반환합니다 (리뷰는 /api/reviews/{content_id}에서 별도 조회).
    """
    result = await tour_api_client.get_attraction_detail(content_id)
    if result is None:
        raise HTTPException(status_code=404, detail="관광지를 찾을 수 없습니다.")
    return result


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
    # debug는 이번 계산 과정을 들여다보기 위한 진단용 필드라 캐시 테이블에는 저장하지
    # 않습니다 (accessibility_stats 테이블에 debug 컬럼이 없으면 저장이 실패할 수 있음).
    await save_accessibility_stats(region, {k: v for k, v in data.items() if k != "debug"})
    return AccessibilitySummary(**data)


@router.get("/accessibility-summary/refresh", response_model=AccessibilitySummary)
async def refresh_accessibility_summary(region: str = Query(default="경기도")):
    """
    접근성 통계를 다시 계산해서 캐시를 갱신합니다. 전수조사 방식이라 수천 건을
    다 조회하느라 몇 분 정도 걸릴 수 있어요 — 응답이 바로 안 와도 정상입니다.
    필요할 때(예: 하루 한 번)
    수동으로 호출해주세요 — 자동으로는 갱신되지 않습니다.

    일일 트래픽 예산/레이트리밋 때문에 이번 실행이 중간에 멈춰서(아직 못 채운
    후보가 남아서) 기존에 저장된 값보다 더 안 좋은 결과가 나온 경우엔, 화면에
    보이는 숫자가 갑자기 퇴보하지 않도록 캐시를 덮어쓰지 않습니다 — 응답에는
    이번에 새로 계산한 값(과 debug)을 그대로 돌려드리니 진행 상황 확인용으로 쓰시면 됩니다.
    """
    existing = await get_cached_accessibility_stats(region)
    data = await tour_api_client.get_accessibility_summary(region)
    if _is_regression(existing, data):
        logger_msg_data = data.get("debug", {}).get("accessibility_fetch", {})
        print(
            f"[tourism] 이번 계산이 미완성 상태(deferred={logger_msg_data.get('deferred_no_budget')})라 "
            f"기존 캐시(wheelchair_count={existing.get('wheelchair_count')})를 유지하고 저장은 건너뜁니다."
        )
    else:
        await save_accessibility_stats(region, {k: v for k, v in data.items() if k != "debug"})
    return AccessibilitySummary(**data)


@router.get("/congestion-cache/refresh")
async def refresh_congestion_cache(region: str = Query(default="경기도")):
    """
    관광지 집중률(≈인기도) 캐시를 시/군/구 단위로 갱신합니다. 시/군/구 하나당
    호출 1번으로 그 안의 관광지 여러 개를 한 번에 받아오기 때문에(경기도 기준
    약 44개 시/군/구), 무장애 정보 전수조사보다 훨씬 빨리 끝납니다 — 보통 한
    번의 호출로 전체가 다 채워지고, 예산(congestion_api_daily_fetch_budget)에
    걸리거나 레이트리밋을 만나면 남은 시/군/구는 다음 호출로 넘어갑니다.

    이 캐시가 채워져 있으면 /api/tourism/attractions(홈 화면 '인기 여행지' 등)가
    캐시된 집중률 순으로 정렬해서 보여줍니다. 캐시가 비어있는 시/군/구는 그냥
    기존 순서(카테고리 라운드로빈)로 표시되니, 이 엔드포인트를 안 불러도 앱이
    깨지진 않습니다 — 다만 정렬이 실제 인기도를 반영하지 못할 뿐입니다.
    """
    return await tour_api_client.refresh_congestion_cache(region)


@router.get("/overview-cache/refresh")
async def refresh_overview_cache(region: str = Query(default="경기도")):
    """
    홈 화면 '인기 여행지'용 소개문을 미리 캐시에 채워둡니다. 하루 한 번 정도
    호출해두면, 실제 사용자가 홈 화면을 열 때는 접속하자마자 바로 소개문이
    보입니다 (매번 실시간으로 조회하면 시간제한 때문에 일부만 뜰 수 있음).
    """
    return await tour_api_client.refresh_overview_cache(region)
