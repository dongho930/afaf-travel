"""
한국관광공사 OpenAPI 클라이언트

실제 서비스키가 발급되면 .env 의 TOUR_API_KEY 를 채우고 USE_MOCK_DATA=false 로 설정하세요.
공공데이터포털의 다음 API들을 사용합니다:
  - 국문 관광 정보 서비스 (지역기반 관광정보조회)
  - 무장애 여행 정보 서비스
  - 관광지별 연관 관광지 정보
  - 관광지 집중률 방문자 추이 예측 정보
  - 의료관광정보

키가 없는 개발 초기 단계에서도 프론트/백엔드 개발을 막지 않도록,
USE_MOCK_DATA=true (기본값) 일 때는 경기도 지역 목업 데이터를 반환합니다.
"""
import httpx

from app.config import get_settings
from app.models.schemas import AccessibilityFeatures, Attraction, CongestionForecast

settings = get_settings()

# ---- 경기도 목업 데이터 (실 API 연동 전 개발/데모용) ----
_MOCK_ATTRACTIONS: list[Attraction] = [
    Attraction(
        content_id="GG-001",
        name="수원화성",
        address="경기도 수원시 팔달구 정조로 825",
        latitude=37.2836,
        longitude=127.0170,
        category="역사/문화",
        image_url="https://picsum.photos/seed/suwon/400/300",
        accessibility=AccessibilityFeatures(
            has_ramp=True, has_elevator=False, has_accessible_restroom=True,
            has_wheelchair_rental=True, has_stroller_accessible_path=True, has_rest_area=True,
        ),
        congestion_forecast=[
            CongestionForecast(date="2026-08-22", hour=10, congestion_level="low"),
            CongestionForecast(date="2026-08-22", hour=14, congestion_level="high"),
        ],
        related_attraction_ids=["GG-002"],
        nearby_medical_info="수원화성 인근 약국 3곳, 종합병원 1곳 (도보 15분)",
    ),
    Attraction(
        content_id="GG-002",
        name="광교호수공원",
        address="경기도 수원시 영통구 광교호수공원로 100",
        latitude=37.2860,
        longitude=127.0550,
        category="자연/공원",
        image_url="https://picsum.photos/seed/gwanggyo/400/300",
        accessibility=AccessibilityFeatures(
            has_ramp=True, has_elevator=False, has_accessible_restroom=True,
            has_wheelchair_rental=False, has_stroller_accessible_path=True, has_rest_area=True,
        ),
        congestion_forecast=[
            CongestionForecast(date="2026-08-22", hour=9, congestion_level="low"),
            CongestionForecast(date="2026-08-22", hour=17, congestion_level="medium"),
        ],
        related_attraction_ids=["GG-001"],
        nearby_medical_info=None,
    ),
    Attraction(
        content_id="GG-003",
        name="에버랜드",
        address="경기도 용인시 처인구 포곡읍 에버랜드로 199",
        latitude=37.2941,
        longitude=127.2026,
        category="테마파크",
        image_url="https://picsum.photos/seed/everland/400/300",
        accessibility=AccessibilityFeatures(
            has_ramp=True, has_elevator=True, has_accessible_restroom=True,
            has_wheelchair_rental=True, has_stroller_accessible_path=True, has_rest_area=True,
        ),
        congestion_forecast=[
            CongestionForecast(date="2026-08-22", hour=11, congestion_level="high"),
            CongestionForecast(date="2026-08-22", hour=16, congestion_level="medium"),
        ],
        related_attraction_ids=[],
        nearby_medical_info="에버랜드 내 응급의료센터 운영",
    ),
    Attraction(
        content_id="GG-004",
        name="한국민속촌",
        address="경기도 용인시 기흥구 민속촌로 90",
        latitude=37.2537,
        longitude=127.1228,
        category="역사/문화",
        image_url="https://picsum.photos/seed/folk/400/300",
        accessibility=AccessibilityFeatures(
            has_ramp=False, has_elevator=False, has_accessible_restroom=True,
            has_wheelchair_rental=True, has_stroller_accessible_path=False, has_rest_area=True,
        ),
        congestion_forecast=[
            CongestionForecast(date="2026-08-22", hour=13, congestion_level="medium"),
        ],
        related_attraction_ids=[],
        nearby_medical_info=None,
    ),
]


class TourApiClient:
    def __init__(self) -> None:
        self.use_mock = settings.use_mock_data or not settings.tour_api_key

    async def search_accessible_attractions(
        self, region: str, user_type: str, limit: int = 20
    ) -> list[Attraction]:
        """무장애 여행 정보 기준으로 1차 필터링된 관광지 목록 조회"""
        if self.use_mock:
            results = list(_MOCK_ATTRACTIONS)
            if user_type == "wheelchair":
                results = [a for a in results if a.accessibility.has_ramp]
            elif user_type == "stroller":
                results = [a for a in results if a.accessibility.has_stroller_accessible_path]
            elif user_type in ("senior", "pregnant"):
                results = [a for a in results if a.accessibility.has_rest_area]
            return results[:limit]

        # 실제 API 연동 (서비스키 발급 후 사용)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService1/areaBasedList1",
                params={
                    "serviceKey": settings.tour_api_key,
                    "MobileOS": "ETC",
                    "MobileApp": "AccessibleTravelPlanner",
                    "areaCode": "31",  # 경기도
                    "_type": "json",
                    "numOfRows": limit,
                },
            )
            resp.raise_for_status()
            # TODO: 실제 응답 스키마에 맞춰 Attraction으로 매핑
            return list(_MOCK_ATTRACTIONS)[:limit]

    async def get_related_attractions(self, content_id: str) -> list[Attraction]:
        if self.use_mock:
            base = next((a for a in _MOCK_ATTRACTIONS if a.content_id == content_id), None)
            if not base:
                return []
            return [a for a in _MOCK_ATTRACTIONS if a.content_id in base.related_attraction_ids]
        # TODO: 실제 "관광지별 연관 관광지 정보" API 연동
        return []

    async def get_congestion_forecast(self, content_id: str) -> list[CongestionForecast]:
        if self.use_mock:
            base = next((a for a in _MOCK_ATTRACTIONS if a.content_id == content_id), None)
            return base.congestion_forecast if base else []
        # TODO: 실제 "관광지 집중률 방문자 추이 예측 정보" API 연동
        return []


tour_api_client = TourApiClient()
