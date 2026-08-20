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
import asyncio

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
    Attraction(
        content_id="GG-005",
        name="행리단길 맛집거리",
        address="경기도 수원시 팔달구 행궁동 일대",
        latitude=37.2820,
        longitude=127.0135,
        category="음식점",
        image_url="https://picsum.photos/seed/haengri/400/300",
        accessibility=AccessibilityFeatures(
            has_ramp=True, has_elevator=False, has_accessible_restroom=False,
            has_wheelchair_rental=False, has_stroller_accessible_path=True, has_rest_area=False,
        ),
        congestion_forecast=[
            CongestionForecast(date="2026-08-22", hour=12, congestion_level="high"),
            CongestionForecast(date="2026-08-22", hour=15, congestion_level="low"),
        ],
        related_attraction_ids=["GG-001"],
        nearby_medical_info=None,
    ),
]

# TourAPI의 contentTypeId 기준 카테고리 (분류체계코드보다 안정적으로 데이터가 채워져 있음)
# 12=관광지, 14=문화시설, 15=축제/공연/행사, 25=여행코스, 28=레포츠, 32=숙박, 38=쇼핑, 39=음식점
_CONTENT_TYPE_LABELS: dict[int, str] = {
    12: "관광지",
    14: "문화시설",
    15: "축제/공연/행사",
    25: "여행코스",
    28: "레포츠",
    32: "숙박",
    38: "쇼핑",
    39: "음식점",
}

# 코스에 기본으로 섞어서 조회할 카테고리 (관광지 + 맛집 + 문화시설 + 레포츠 + 숙박)
_DEFAULT_CONTENT_TYPE_IDS: list[int] = [12, 39, 14, 28, 32]


class TourApiClient:
    def __init__(self) -> None:
        self.use_mock = settings.use_mock_data or not settings.tour_api_key

    def _common_params(self, extra: dict) -> dict:
        return {
            "serviceKey": settings.tour_api_key,
            "MobileOS": "ETC",
            "MobileApp": "AccessibleTravelPlanner",
            "_type": "json",
            **extra,
        }

    @staticmethod
    def _extract_items(payload: dict) -> list[dict]:
        """TourAPI 표준 응답(response.header/body) 구조에서 item 목록만 뽑아냅니다."""
        try:
            body = payload["response"]["body"]
        except (KeyError, TypeError):
            return []
        result_code = payload["response"].get("header", {}).get("resultCode")
        if result_code not in (None, "0000", "00"):
            msg = payload["response"].get("header", {}).get("resultMsg")
            raise RuntimeError(f"TourAPI 오류 응답 (code={result_code}): {msg}")
        items = body.get("items")
        if not items:
            return []
        item = items.get("item", [])
        # 결과가 1건이면 dict로, 여러 건이면 list로 오는 TourAPI 특성 보정
        return item if isinstance(item, list) else [item]

    @staticmethod
    def _map_item_to_attraction(item: dict, content_type_id: int) -> Attraction:
        """areaBasedList2 응답 필드(contentid, title, addr1, mapx/mapy 등)를 Attraction으로 매핑"""
        category = _CONTENT_TYPE_LABELS.get(content_type_id, str(content_type_id))

        return Attraction(
            content_id=str(item.get("contentid", "")),
            name=item.get("title", ""),
            address=" ".join(filter(None, [item.get("addr1", ""), item.get("addr2", "")])).strip(),
            # TourAPI는 mapx=경도(longitude), mapy=위도(latitude) 순서이므로 주의
            longitude=float(item.get("mapx") or 0),
            latitude=float(item.get("mapy") or 0),
            category=category,
            image_url=item.get("firstimage") or item.get("firstimage2") or None,
            # 무장애(편의시설) 세부 정보는 별도 엔드포인트에서 채워집니다. 아래 _fetch_accessibility 참고.
            accessibility=AccessibilityFeatures(),
        )

    async def _fetch_accessibility(self, client: httpx.AsyncClient, content_id: str) -> AccessibilityFeatures:
        """
        'detailWithTour2'(무장애정보조회) 오퍼레이션으로 편의시설 상세를 조회합니다.
        실제 확인된 응답 필드: route(이동로/경사로 설명), wheelchair(휠체어 대여/접근),
        elevator, restroom, stroller(유모차), lactationroom/babysparechair(가족 편의) 등
        모두 boolean이 아닌 '설명 텍스트' 필드라, 텍스트가 비어있지 않으면 해당 편의시설이
        있는 것으로 간주합니다.
        """
        try:
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService2/detailWithTour2",
                params=self._common_params({"contentId": content_id}),
            )
            resp.raise_for_status()
            items = self._extract_items(resp.json())
            if not items:
                return AccessibilityFeatures()
            d = items[0]

            def has_text(key: str) -> bool:
                return bool((d.get(key) or "").strip())

            return AccessibilityFeatures(
                has_ramp=has_text("route"),
                has_elevator=has_text("elevator"),
                has_accessible_restroom=has_text("restroom"),
                has_wheelchair_rental=has_text("wheelchair"),
                has_stroller_accessible_path=has_text("stroller"),
                has_rest_area=has_text("lactationroom") or has_text("babysparechair"),
            )
        except Exception:
            # API 오류가 나도 전체 요청이 죽지 않게 안전하게 빈 값 처리
            return AccessibilityFeatures()

    async def _fetch_by_content_type(
        self, client: httpx.AsyncClient, ldong_regn_cd: str, content_type_id: int, num_of_rows: int
    ) -> list[Attraction]:
        try:
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService2/areaBasedList2",
                params=self._common_params(
                    {
                        "lDongRegnCd": ldong_regn_cd,
                        "contentTypeId": content_type_id,
                        "numOfRows": num_of_rows,
                        "pageNo": 1,
                    }
                ),
            )
            resp.raise_for_status()
            raw_items = self._extract_items(resp.json())
            return [self._map_item_to_attraction(item, content_type_id) for item in raw_items]
        except Exception:
            # 특정 카테고리 조회가 실패해도 다른 카테고리 결과는 살립니다.
            return []

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

        # 실제 API 연동 (법정동 시도 코드 기준 — 경기도=41, 서울=11)
        ldong_regn_map = {"경기도": "41", "서울": "11"}
        ldong_regn_cd = ldong_regn_map.get(region, "41")

        # 카테고리(lclsSystm1)가 아니라 contentTypeId 기준으로 여러 카테고리를 동시에 조회해서
        # 숙박에만 치우치지 않고 관광지/음식점/문화시설/레포츠가 골고루 섞이도록 합니다.
        per_type_rows = max(5, limit // len(_DEFAULT_CONTENT_TYPE_IDS))
        async with httpx.AsyncClient(timeout=15) as client:
            results_per_type = await asyncio.gather(
                *(
                    self._fetch_by_content_type(client, ldong_regn_cd, content_type_id, per_type_rows)
                    for content_type_id in _DEFAULT_CONTENT_TYPE_IDS
                )
            )
            attractions: list[Attraction] = []
            seen_ids: set[str] = set()
            for group in results_per_type:
                for a in group:
                    if a.content_id and a.content_id not in seen_ids:
                        seen_ids.add(a.content_id)
                        attractions.append(a)

            # 각 관광지의 편의시설 상세 정보를 채웁니다 (동시에 여러 건 조회).
            accessibility_list = await asyncio.gather(
                *(self._fetch_accessibility(client, a.content_id) for a in attractions)
            )
            for attraction, accessibility in zip(attractions, accessibility_list):
                attraction.accessibility = accessibility

        results = attractions
        if user_type == "wheelchair":
            results = [a for a in results if a.accessibility.has_ramp] or attractions
        elif user_type == "stroller":
            results = [a for a in results if a.accessibility.has_stroller_accessible_path] or attractions
        elif user_type in ("senior", "pregnant"):
            results = [a for a in results if a.accessibility.has_rest_area] or attractions
        return results[:limit]

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
