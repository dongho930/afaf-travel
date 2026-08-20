"""
한국관광공사 OpenAPI 클라이언트

실제 서비스키가 발급되면 .env 의 TOUR_API_KEY 를 채우고 USE_MOCK_DATA=false 로 설정하세요.
공공데이터포털의 다음 API들을 사용합니다:
  - 국문 관광 정보 서비스 (지역기반 관광정보조회) — KorWithService2
  - 무장애 여행 정보 서비스 — KorWithService2
  - 관광지별 연관 관광지 정보 — TarRlteTarService1 (관광지명 + 지역/시군구코드 기반 조회)
  - 관광지 집중률 방문자 추이 예측 정보 — TatsCnctrRateService (관광지명 + 지역/시군구코드 기반 조회)
  - 의료관광정보

관광지별 연관 관광지 정보 / 관광지 집중률 API는 contentId가 아니라 '관광지명 +
시도코드(areaCd) + 시군구코드(signguCd)' 조합으로 조회하는 구조입니다. 이 백엔드의
Attraction은 contentId를 기본 키로 쓰기 때문에, 먼저 detailCommon2로 관광지명/주소를
얻고 app.services.sigungu_codes.find_area_signgu()로 주소를 시군구코드로 변환한 뒤
호출합니다.

키가 없는 개발 초기 단계에서도 프론트/백엔드 개발을 막지 않도록,
USE_MOCK_DATA=true (기본값) 일 때는 경기도 지역 목업 데이터를 반환합니다.
"""
import asyncio
import datetime

import httpx

from app.config import get_settings
from app.models.schemas import AccessibilityFeatures, Attraction, CongestionForecast
from app.services.sigungu_codes import find_area_signgu, signgu_name

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

# 관광지별 연관 관광지 정보 / 관광지 집중률 예측 정보는 국문관광정보서비스(B551011)
# 산하의 별도 서비스 ID를 씁니다 (Base URL은 settings.tour_api_base_url과 동일 도메인).
_TAR_RLTE_TAR_BASE = "http://apis.data.go.kr/B551011/TarRlteTarService1"
_TATS_CNCTR_RATE_BASE = "http://apis.data.go.kr/B551011/TatsCnctrRateService"


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

    async def _get_basic_info(self, client: httpx.AsyncClient, content_id: str) -> dict | None:
        """
        contentId만으로는 관광지명/주소를 모르기 때문에, 연관관광지·집중률 API 호출 전에
        detailCommon2(공통정보조회)로 title/addr1/addr2를 먼저 가져옵니다.
        """
        try:
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService2/detailCommon2",
                params=self._common_params(
                    {"contentId": content_id, "defaultYN": "Y", "addrinfoYN": "Y"}
                ),
            )
            resp.raise_for_status()
            items = self._extract_items(resp.json())
            return items[0] if items else None
        except Exception:
            return None

    async def _resolve_attraction_by_name(
        self, client: httpx.AsyncClient, name: str
    ) -> Attraction | None:
        """
        연관관광지 API는 이름만 알려주고 좌표/이미지가 없으므로, 이름으로 다시
        키워드검색(searchKeyword2)을 해서 지도에 표시 가능한 완전한 Attraction으로 보강합니다.
        """
        try:
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService2/searchKeyword2",
                params=self._common_params({"keyword": name, "numOfRows": 1, "pageNo": 1}),
            )
            resp.raise_for_status()
            items = self._extract_items(resp.json())
            if not items:
                return None
            item = items[0]
            content_type_id = int(item.get("contenttypeid") or 12)
            return self._map_item_to_attraction(item, content_type_id)
        except Exception:
            return None
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
        self,
        client: httpx.AsyncClient,
        ldong_regn_cd: str,
        content_type_id: int,
        num_of_rows: int,
    ) -> list[Attraction]:
        try:
            params = {
                "lDongRegnCd": ldong_regn_cd,
                "contentTypeId": content_type_id,
                "numOfRows": num_of_rows,
                "pageNo": 1,
            }
            resp = await client.get(
                f"{settings.tour_api_base_url}/KorWithService2/areaBasedList2",
                params=self._common_params(params),
            )
            resp.raise_for_status()
            raw_items = self._extract_items(resp.json())
            return [self._map_item_to_attraction(item, content_type_id) for item in raw_items]
        except Exception:
            # 특정 카테고리 조회가 실패해도 다른 카테고리 결과는 살립니다.
            return []

    async def search_accessible_attractions(
        self, region: str, user_type: str, limit: int = 20, sigungu_cd: int | None = None
    ) -> list[Attraction]:
        """
        무장애 여행 정보 기준으로 1차 필터링된 관광지 목록 조회.

        sigungu_cd(법정동 시군구코드)를 지정하면 해당 시/군/구로 좁혀서 반환합니다
        (예: 수원시 팔달구 = 41115). 지정하지 않으면 시/도 전체를 대상으로 합니다.

        참고: 이 무장애 서비스(KorWithService2)는 lDongSignguCd(시군구) 파라미터를
        API 단에서 지원하지 않아(테스트 결과 항상 0건) 시/도 전체로 넉넉하게 조회한
        뒤, 각 관광지의 address 문자열에 해당 시/군/구명이 포함되는지로 직접 걸러냅니다.
        """
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

        target_signgu_nm = signgu_name(sigungu_cd) if sigungu_cd is not None else None
        # 시/군/구로 걸러낼 예정이면, 걸러지고 남는 양이 부족하지 않도록 시/도 전체를
        # 훨씬 넉넉하게(약 6배) 받아옵니다.
        fetch_limit = limit * 6 if target_signgu_nm else limit

        # 카테고리(lclsSystm1)가 아니라 contentTypeId 기준으로 여러 카테고리를 동시에 조회해서
        # 숙박에만 치우치지 않고 관광지/음식점/문화시설/레포츠가 골고루 섞이도록 합니다.
        per_type_rows = max(6, fetch_limit // len(_DEFAULT_CONTENT_TYPE_IDS))
        async with httpx.AsyncClient(timeout=15) as client:
            results_per_type = await asyncio.gather(
                *(
                    self._fetch_by_content_type(client, ldong_regn_cd, content_type_id, per_type_rows)
                    for content_type_id in _DEFAULT_CONTENT_TYPE_IDS
                )
            )
            # 카테고리별로 순차로 이어붙이면 뒤쪽 카테고리가 마지막 limit 자르기에서
            # 통째로 잘려나갈 수 있어, 라운드로빈으로 각 카테고리를 골고루 섞습니다.
            attractions: list[Attraction] = []
            seen_ids: set[str] = set()
            max_group_len = max((len(g) for g in results_per_type), default=0)
            for i in range(max_group_len):
                for group in results_per_type:
                    if i < len(group):
                        a = group[i]
                        if a.content_id and a.content_id not in seen_ids:
                            seen_ids.add(a.content_id)
                            attractions.append(a)

            if target_signgu_nm:
                # 주소 문자열에 시군구명(예: '수원시 팔달구')의 각 단어가 모두 포함되는 것만 남깁니다.
                tokens = target_signgu_nm.split()
                filtered = [a for a in attractions if all(t in a.address for t in tokens)]
                # 필터링 결과가 너무 적으면(예: 데이터 자체가 희소한 소도시) 빈 결과보다는
                # 원래 후보라도 보여주는 게 낫습니다.
                attractions = filtered if filtered else attractions

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
        """
        한국관광공사_관광지별 연관 관광지 정보 (TarRlteTarService1 / searchKeyword1)

        이 API는 contentId가 아니라 '관광지명 + areaCd + signguCd'로 조회합니다.
        1) detailCommon2로 이 관광지의 이름/주소를 가져오고
        2) 주소로 areaCd/signguCd를 역으로 찾은 뒤
        3) 관광지명으로 연관관광지 목록(이름 + 카테고리 + 순위)을 조회하고
        4) 상위 몇 개만 다시 이름으로 검색해서 좌표가 있는 완전한 Attraction으로 만듭니다.
        """
        if self.use_mock:
            base = next((a for a in _MOCK_ATTRACTIONS if a.content_id == content_id), None)
            if not base:
                return []
            return [a for a in _MOCK_ATTRACTIONS if a.content_id in base.related_attraction_ids]

        async with httpx.AsyncClient(timeout=15) as client:
            basic = await self._get_basic_info(client, content_id)
            if not basic:
                return []
            name = basic.get("title", "")
            address = " ".join(filter(None, [basic.get("addr1", ""), basic.get("addr2", "")]))
            area_signgu = find_area_signgu(address)
            if not name or not area_signgu:
                return []
            area_cd, signgu_cd = area_signgu

            try:
                resp = await client.get(
                    f"{_TAR_RLTE_TAR_BASE}/searchKeyword1",
                    params=self._common_params(
                        {
                            "baseYm": datetime.date.today().strftime("%Y%m"),
                            "areaCd": area_cd,
                            "signguCd": signgu_cd,
                            "keyword": name,
                            "numOfRows": 10,
                            "pageNo": 1,
                        }
                    ),
                )
                resp.raise_for_status()
                related_items = self._extract_items(resp.json())
            except Exception:
                return []

            # rlteRank(연관순위) 기준 상위 5개만 좌표 보강 (매 건마다 추가 API 호출이 발생하므로 제한)
            related_items = sorted(
                related_items, key=lambda i: int(i.get("rlteRank") or 999)
            )[:5]

            resolved = await asyncio.gather(
                *(
                    self._resolve_attraction_by_name(client, item.get("rlteTatsNm", ""))
                    for item in related_items
                    if item.get("rlteTatsNm")
                )
            )
            return [a for a in resolved if a is not None]

    async def get_congestion_forecast(self, content_id: str) -> list[CongestionForecast]:
        """
        한국관광공사_관광지 집중률 방문자 추이 예측 정보 (TatsCnctrRateService / tatsCnctrRatedList)

        관광지별 향후 최대 30일치 '집중률(cnctrRate, 0~100 %)'을 일 단위로 제공합니다.
        시간(hour) 단위 데이터는 없어서, 기존 스키마(CongestionForecast.hour)를 맞추기
        위해 정오(12시)로 고정하고 집중률 % 구간을 low/medium/high로 변환합니다.
        """
        if self.use_mock:
            base = next((a for a in _MOCK_ATTRACTIONS if a.content_id == content_id), None)
            return base.congestion_forecast if base else []

        async with httpx.AsyncClient(timeout=15) as client:
            basic = await self._get_basic_info(client, content_id)
            if not basic:
                return []
            name = basic.get("title", "")
            address = " ".join(filter(None, [basic.get("addr1", ""), basic.get("addr2", "")]))
            area_signgu = find_area_signgu(address)
            if not name or not area_signgu:
                return []
            area_cd, signgu_cd = area_signgu

            try:
                resp = await client.get(
                    f"{_TATS_CNCTR_RATE_BASE}/tatsCnctrRatedList",
                    params=self._common_params(
                        {
                            "areaCd": area_cd,
                            "signguCd": signgu_cd,
                            "tAtsNm": name,
                            "numOfRows": 30,
                            "pageNo": 1,
                        }
                    ),
                )
                resp.raise_for_status()
                items = self._extract_items(resp.json())
            except Exception:
                return []

            forecasts: list[CongestionForecast] = []
            for item in items:
                base_ymd = str(item.get("baseYmd") or "")
                if len(base_ymd) != 8:
                    continue
                date_str = f"{base_ymd[:4]}-{base_ymd[4:6]}-{base_ymd[6:8]}"
                try:
                    rate = float(item.get("cnctrRate") or 0)
                except (TypeError, ValueError):
                    continue
                if rate >= 66:
                    level = "high"
                elif rate >= 34:
                    level = "medium"
                else:
                    level = "low"
                forecasts.append(CongestionForecast(date=date_str, hour=12, congestion_level=level))
            return forecasts


tour_api_client = TourApiClient()
