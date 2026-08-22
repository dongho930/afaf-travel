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
import logging

import httpx

from app.config import get_settings
from app.models.schemas import AccessibilityFeatures, Attraction, CongestionForecast
from app.services.sigungu_codes import (
    area_code_for_signgu,
    find_area_signgu,
    list_area_signgu_by_area,
    signgu_name,
)
from app.services.supabase_service import (
    get_cached_congestion_rates,
    get_cached_congestion_signgu_cds,
    get_cached_overviews,
    get_cached_place_accessibility,
    save_congestion_rates_batch,
    save_overviews_batch,
    save_place_accessibility_batch,
)

logger = logging.getLogger(__name__)

# AccessibilityFeatures 각 항목을 사람이 읽는 한글 라벨로 바꾸는 매핑.
# 인기 여행지 카드 등에서 "이 장소가 가진 이점"을 보여줄 때 씁니다.
_BENEFIT_LABELS: list[tuple[str, str]] = [
    ("has_ramp", "경사로"),
    ("has_elevator", "엘리베이터"),
    ("has_accessible_restroom", "장애인 화장실"),
    ("has_wheelchair_rental", "휠체어 대여"),
    ("has_stroller_accessible_path", "유모차 이동 가능"),
    ("has_rest_area", "임산부/고령자 휴게공간"),
    ("has_visual_accessibility", "시각장애 편의시설"),
    ("has_hearing_accessibility", "청각장애 편의시설"),
]


def _accessibility_benefit_labels(features: AccessibilityFeatures) -> list[str]:
    return [label for field, label in _BENEFIT_LABELS if getattr(features, field, False)]

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


class _RateLimiter:
    """
    호출과 호출 사이에 최소 간격을 강제하는 간단한 레이트리미터.

    data.go.kr(공공데이터포털)는 순간적으로 요청이 몰리면 '429 Too Many Requests'를
    바로 돌려줍니다. 세마포어로 동시 실행 개수만 줄이는 것만으로는 부족해서(세마포어를
    풀고 여러 개가 거의 동시에 새 요청을 쏘면 여전히 몰릴 수 있음), 실제로 요청이
    나가는 시점 자체를 최소 간격으로 강제합니다.
    """

    def __init__(self, min_interval_seconds: float) -> None:
        self._min_interval = min_interval_seconds
        self._lock = asyncio.Lock()
        self._last_call_at: float = 0.0

    async def wait_turn(self) -> None:
        async with self._lock:
            loop = asyncio.get_event_loop()
            now = loop.time()
            elapsed = now - self._last_call_at
            if elapsed < self._min_interval:
                await asyncio.sleep(self._min_interval - elapsed)
            self._last_call_at = loop.time()


class TourApiClient:
    def __init__(self) -> None:
        self.use_mock = settings.use_mock_data or not settings.tour_api_key
        # 초당 최대 요청 수를 제한합니다 (0.15초 간격 ≈ 초당 최대 약 6~7건).
        # data.go.kr 429 응답이 잦으면 이 값을 더 키워서(간격을 늘려서) 완화하세요.
        self._rate_limiter = _RateLimiter(min_interval_seconds=0.15)

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

    async def _fetch_overview(
        self, client: httpx.AsyncClient, content_id: str, diag: dict | None = None
    ) -> tuple[str | None, bool]:
        """
        detailCommon2(overviewYN=Y)로 소개문(overview)을 가져옵니다.
        이 API는 무장애 정보와 같은 서비스(같은 일일 트래픽 한도)를 쓰므로,
        429는 별도로 감지해서 재시도하고 실패하면 캐시에 안 남도록 신호를 줍니다.

        반환값: (overview 또는 None, api_ok)
        """
        max_retries = 2
        for attempt in range(max_retries + 1):
            await self._rate_limiter.wait_turn()
            try:
                resp = await client.get(
                    f"{settings.tour_api_base_url}/KorWithService2/detailCommon2",
                    params=self._common_params(
                        {"contentId": content_id, "defaultYN": "Y", "overviewYN": "Y"}
                    ),
                )
                if resp.status_code == 429:
                    if attempt < max_retries:
                        if diag is not None:
                            diag["rate_limited_retry"] = diag.get("rate_limited_retry", 0) + 1
                        retry_after = resp.headers.get("Retry-After")
                        wait_seconds = float(retry_after) if retry_after else 0.5 * (2 ** attempt)
                        await asyncio.sleep(wait_seconds)
                        continue
                    if diag is not None:
                        diag["rate_limit_exhausted"] = diag.get("rate_limit_exhausted", 0) + 1
                    return None, False

                resp.raise_for_status()
                items = self._extract_items(resp.json())
                overview = (items[0].get("overview") or "").strip() if items else ""
                if diag is not None:
                    diag["fetched"] = diag.get("fetched", 0) + 1
                return (overview or None), True
            except Exception as exc:
                if diag is not None:
                    diag["api_error"] = diag.get("api_error", 0) + 1
                    logger.warning(
                        "detailCommon2(overview) 호출 실패 (contentId=%s): %s", content_id, exc
                    )
                return None, False
        return None, False

    @staticmethod
    def _shorten_overview(text: str | None, max_len: int = 110) -> str | None:
        """소개문은 원문이 길어서 카드에 넣기 위해 첫 문장 위주로 짧게 자릅니다."""
        if not text:
            return None
        # 마침표 기준 첫 문장을 우선 쓰고, 그래도 너무 길면 글자 수로 자릅니다.
        first_sentence = text.split(". ")[0].strip()
        candidate = first_sentence if first_sentence else text
        was_truncated = len(candidate) < len(text.strip())
        if len(candidate) > max_len:
            candidate = candidate[:max_len].rstrip()
            was_truncated = True
        if was_truncated and not candidate.endswith((".", "…")):
            candidate += "…"
        elif not was_truncated and not candidate.endswith("."):
            candidate += "."
        return candidate

    async def _fill_overview_with_cache(
        self,
        client: httpx.AsyncClient,
        attractions: list[Attraction],
        diag: dict | None = None,
        max_concurrency: int = 8,
    ) -> None:
        """
        attractions 각각의 overview 필드를 채웁니다. 캐시(attraction_overview_cache)에
        있으면 그대로 쓰고, 없는 것만 새로 조회한 뒤 캐시에 저장합니다. 소개문은
        거의 안 바뀌는 정보라 place_accessibility_cache와 달리 예산/조기중단 없이
        간단하게 처리합니다 — 홈 화면 목록(20개 이하) 규모라 부담이 적습니다.
        """
        content_ids = [a.content_id for a in attractions if a.content_id]
        cached = await get_cached_overviews(content_ids)
        for a in attractions:
            if a.content_id in cached:
                a.overview = self._shorten_overview(cached[a.content_id])

        to_fetch = [a for a in attractions if a.content_id and a.content_id not in cached]
        if not to_fetch:
            return

        semaphore = asyncio.Semaphore(max_concurrency)

        async def bounded_fetch(a: Attraction) -> tuple[Attraction, str | None, bool]:
            async with semaphore:
                overview, api_ok = await self._fetch_overview(client, a.content_id, diag=diag)
                return a, overview, api_ok

        results = await asyncio.gather(*(bounded_fetch(a) for a in to_fetch))

        new_rows: list[dict] = []
        for a, overview, api_ok in results:
            if api_ok:
                a.overview = self._shorten_overview(overview)
                new_rows.append(
                    {
                        "content_id": a.content_id,
                        "overview": overview or "",
                        "fetched_at": datetime.datetime.utcnow().isoformat(),
                    }
                )
        if new_rows:
            await save_overviews_batch(new_rows)

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
    async def _fetch_accessibility(
        self, client: httpx.AsyncClient, content_id: str, diag: dict | None = None
    ) -> tuple[AccessibilityFeatures, bool]:
        """
        'detailWithTour2'(무장애정보조회) 오퍼레이션으로 편의시설 상세를 조회합니다.
        실제 확인된 응답 필드: route(이동로/경사로 설명), wheelchair(휠체어 대여/접근),
        elevator, restroom, stroller(유모차), lactationroom/babysparechair(가족 편의) 등
        모두 boolean이 아닌 '설명 텍스트' 필드라, 텍스트가 비어있지 않으면 해당 편의시설이
        있는 것으로 간주합니다.

        data.go.kr는 순간적으로 요청이 몰리면 '429 Too Many Requests'를 바로 돌려주는데,
        예전 코드는 이걸 다른 에러와 똑같이 취급해서 조용히 '접근성 없음'으로 처리했습니다.
        그러면 실제로는 정보가 있는 곳도 레이트리밋 때문에 없는 것처럼 집계됩니다.
        그래서 429는 별도로 감지해서 잠깐 기다렸다가 최대 3번까지 재시도합니다.

        반환값: (AccessibilityFeatures, record_found)
          record_found는 API 호출이 정상적으로 성공해서 실제 결과(레코드 있음/없음)를
          확인했는지 여부입니다. 429가 계속되거나 다른 오류로 실패한 경우엔 False라서,
          호출한 쪽에서 '진짜로 정보가 없는 곳'과 '조회 자체가 실패한 곳'을 구분해
          후자는 캐시에 저장하지 않고 다음 새로고침 때 다시 시도하게 할 수 있습니다.

        diag(선택): 진단용 카운터 dict를 넘기면 아래 케이스를 구분해서 집계합니다.
          - no_record: 호출은 성공했지만 해당 contentId에 무장애 정보가 아예 등록돼 있지 않은 경우
          - has_record: 무장애 정보 레코드는 있고, 그 안의 값(route/wheelchair 등)을 읽어온 경우
          - rate_limited_retry: 429를 받아서 재시도한 횟수 (여러 번 찍힐 수 있음)
          - rate_limit_exhausted: 재시도까지 다 했는데도 429가 계속 나서 결국 포기한 경우
          - api_error: 429가 아닌 다른 이유(타임아웃, 5xx 등)로 실패한 경우
        """
        max_retries = 3
        for attempt in range(max_retries + 1):
            await self._rate_limiter.wait_turn()
            try:
                resp = await client.get(
                    f"{settings.tour_api_base_url}/KorWithService2/detailWithTour2",
                    params=self._common_params({"contentId": content_id}),
                )
                if resp.status_code == 429:
                    if attempt < max_retries:
                        if diag is not None:
                            diag["rate_limited_retry"] = diag.get("rate_limited_retry", 0) + 1
                        retry_after = resp.headers.get("Retry-After")
                        wait_seconds = float(retry_after) if retry_after else 0.5 * (2 ** attempt)
                        await asyncio.sleep(wait_seconds)
                        continue
                    if diag is not None:
                        diag["rate_limit_exhausted"] = diag.get("rate_limit_exhausted", 0) + 1
                        logger.warning(
                            "detailWithTour2 재시도 소진, 429 계속 발생 (contentId=%s)", content_id
                        )
                    return AccessibilityFeatures(), False

                resp.raise_for_status()
                items = self._extract_items(resp.json())
                if not items:
                    if diag is not None:
                        diag["no_record"] = diag.get("no_record", 0) + 1
                    return AccessibilityFeatures(), True
                d = items[0]

                def has_text(key: str) -> bool:
                    return bool((d.get(key) or "").strip())

                # 활용매뉴얼(v4.3) [무장애여행 조회] 오퍼레이션 명세 기준 필드.
                visual_fields = (
                    "braileblock",       # 점자블록
                    "helpdog",           # 보조견 동반
                    "guidehuman",        # 안내요원
                    "audioguide",        # 오디오가이드
                    "bigprint",          # 큰 활자 홍보물
                    "brailepromotion",   # 점자 홍보물 및 점자표지판
                    "guidesystem",       # 유도 안내설비
                    "blindhandicapetc",  # 시각장애 기타상세
                )
                hearing_fields = (
                    "signguide",          # 수화 안내
                    "videoguide",         # 자막 비디오가이드 및 영상 자막안내
                    "hearingroom",        # 객실
                    "hearinghandicapetc",  # 청각장애 기타상세
                )

                features = AccessibilityFeatures(
                    has_ramp=has_text("route"),
                    has_elevator=has_text("elevator"),
                    has_accessible_restroom=has_text("restroom"),
                    has_wheelchair_rental=has_text("wheelchair"),
                    has_stroller_accessible_path=has_text("stroller"),
                    has_rest_area=has_text("lactationroom") or has_text("babysparechair"),
                    has_visual_accessibility=any(has_text(f) for f in visual_fields),
                    has_hearing_accessibility=any(has_text(f) for f in hearing_fields),
                )
                if diag is not None:
                    diag["has_record"] = diag.get("has_record", 0) + 1
                return features, True
            except Exception as exc:
                # 429가 아닌 다른 오류(타임아웃 등)는 재시도하지 않고 바로 빈 값 처리
                if diag is not None:
                    diag["api_error"] = diag.get("api_error", 0) + 1
                    logger.warning("detailWithTour2 호출 실패 (contentId=%s): %s", content_id, exc)
                return AccessibilityFeatures(), False

        return AccessibilityFeatures(), False

    async def _fetch_all_by_content_type(
        self,
        client: httpx.AsyncClient,
        ldong_regn_cd: str,
        content_type_id: int,
        page_size: int = 100,
        max_pages: int = 60,
    ) -> list[Attraction]:
        """
        전수조사용: 한 카테고리(contentTypeId)의 결과를 페이지가 끝날 때까지
        전부 가져옵니다. TourAPI 응답의 totalCount를 보고 필요한 페이지 수를
        계산합니다. max_pages는 API 오류/무한루프 방지용 안전장치입니다.
        """
        all_items: list[Attraction] = []
        page_no = 1
        total_count: int | None = None

        while page_no <= max_pages:
            try:
                resp = await client.get(
                    f"{settings.tour_api_base_url}/KorWithService2/areaBasedList2",
                    params=self._common_params(
                        {
                            "lDongRegnCd": ldong_regn_cd,
                            "contentTypeId": content_type_id,
                            "numOfRows": page_size,
                            "pageNo": page_no,
                        }
                    ),
                )
                resp.raise_for_status()
                payload = resp.json()
                raw_items = self._extract_items(payload)

                if total_count is None:
                    try:
                        total_count = int(payload["response"]["body"].get("totalCount", 0))
                    except Exception:
                        total_count = None

                if not raw_items:
                    break

                all_items.extend(self._map_item_to_attraction(item, content_type_id) for item in raw_items)

                # totalCount를 확인했으면 그걸로, 아니면 '이번 페이지가 요청보다 적게 왔으면 마지막 페이지'로 판단
                if total_count is not None and len(all_items) >= total_count:
                    break
                if len(raw_items) < page_size:
                    break
                page_no += 1
            except Exception:
                break

        return all_items

    async def _fetch_accessibility_bounded(
        self,
        client: httpx.AsyncClient,
        content_id: str,
        semaphore: asyncio.Semaphore,
        diag: dict | None = None,
    ) -> tuple[AccessibilityFeatures, bool]:
        """_fetch_accessibility를 동시 호출 개수 제한(세마포어)과 함께 실행합니다."""
        async with semaphore:
            return await self._fetch_accessibility(client, content_id, diag=diag)

    async def _fill_accessibility_with_cache(
        self,
        client: httpx.AsyncClient,
        candidates: list[Attraction],
        diag: dict | None = None,
        max_concurrency: int = 10,
        max_new_fetches: int | None = None,
    ) -> None:
        """
        candidates 각각의 accessibility 필드를 채웁니다.

        DB 캐시(place_accessibility_cache, supabase_service 경유)에 이미 있는 content_id는
        API를 다시 호출하지 않고 캐시 값을 그대로 쓰고, 캐시에 없는(=새로 등장했거나
        아직 한 번도 조회하지 못한) content_id만 실제 API로 조회합니다. 새로 조회한
        결과는 (레코드 조회에 성공한 경우에 한해) 다시 캐시에 저장해둡니다.

        레이트리밋(429)이 재시도까지 다 실패한 경우(record_found=False)는 캐시에
        저장하지 않습니다 — 그래야 다음 새로고침 때 '캐시가 없으니 다시 시도'가 되고,
        일시적인 API 장애가 영구적으로 '접근성 없음'으로 굳어버리는 걸 막을 수 있습니다.

        max_new_fetches(선택): 이번 호출에서 '새로 조회'할 최대 건수. 개발계정처럼
        일일 트래픽 한도가 낮을 때, 후보 전체를 한 번에 다 시도하다가 한도를 넘겨서
        전부 429로 낭비하는 걸 막기 위한 예산입니다. 한도를 넘는 나머지는 이번엔
        건드리지 않고 그대로 남겨둬서(캐시에 없는 채로), 다음 새로고침(=다음날)에
        이어서 채워집니다.

        또한 배치를 청크 단위로 순차 처리하면서, 한 청크가 통째로 레이트리밋으로
        실패하면(=이미 일일 한도를 소진했다고 판단) 남은 후보는 더 시도하지 않고
        바로 멈춥니다 — 이미 막힌 걸 알면서 나머지 수천 건에 재시도 백오프까지
        들여가며 시간을 낭비하지 않기 위함입니다.
        """
        content_ids = [a.content_id for a in candidates if a.content_id]
        cached_rows = await get_cached_place_accessibility(content_ids)
        if diag is not None:
            diag["from_cache"] = diag.get("from_cache", 0) + len(cached_rows)

        to_fetch = [a for a in candidates if a.content_id and a.content_id not in cached_rows]

        deferred_count = 0
        if max_new_fetches is not None and len(to_fetch) > max_new_fetches:
            deferred_count = len(to_fetch) - max_new_fetches
            to_fetch = to_fetch[:max_new_fetches]
        if diag is not None:
            diag["deferred_no_budget"] = diag.get("deferred_no_budget", 0) + deferred_count

        new_cache_rows: list[dict] = []
        stopped_early = False
        for chunk_start in range(0, len(to_fetch), max_concurrency):
            chunk = to_fetch[chunk_start : chunk_start + max_concurrency]
            semaphore = asyncio.Semaphore(max_concurrency)
            chunk_results = await asyncio.gather(
                *(
                    self._fetch_accessibility_bounded(client, a.content_id, semaphore, diag=diag)
                    for a in chunk
                )
            )

            chunk_all_rate_limited = True
            for attraction, (features, record_found) in zip(chunk, chunk_results):
                attraction.accessibility = features
                if record_found:
                    chunk_all_rate_limited = False
                    new_cache_rows.append(
                        {
                            "content_id": attraction.content_id,
                            "has_ramp": features.has_ramp,
                            "has_elevator": features.has_elevator,
                            "has_accessible_restroom": features.has_accessible_restroom,
                            "has_wheelchair_rental": features.has_wheelchair_rental,
                            "has_stroller_accessible_path": features.has_stroller_accessible_path,
                            "has_rest_area": features.has_rest_area,
                            "has_visual_accessibility": features.has_visual_accessibility,
                            "has_hearing_accessibility": features.has_hearing_accessibility,
                            "record_found": True,
                            "fetched_at": datetime.datetime.utcnow().isoformat(),
                        }
                    )

            # 청크 전체가 레이트리밋으로 실패했다면 일일 한도를 이미 다 쓴 것으로 보고 중단
            if chunk_all_rate_limited and len(chunk) > 0:
                remaining = len(to_fetch) - (chunk_start + len(chunk))
                if diag is not None:
                    diag["stopped_early_rate_limited"] = True
                    diag["deferred_no_budget"] = diag.get("deferred_no_budget", 0) + remaining
                stopped_early = True
                logger.warning(
                    "무장애정보 조회를 일찍 중단합니다 (연속 429로 일일 한도 소진 추정, "
                    "남은 %d건은 다음 새로고침으로 미룸)",
                    remaining,
                )
                break

        if new_cache_rows:
            await save_place_accessibility_batch(new_cache_rows)
            if diag is not None:
                diag["newly_fetched_and_cached"] = diag.get("newly_fetched_and_cached", 0) + len(
                    new_cache_rows
                )

        for attraction in candidates:
            row = cached_rows.get(attraction.content_id)
            if row is not None:
                attraction.accessibility = AccessibilityFeatures(
                    has_ramp=bool(row.get("has_ramp")),
                    has_elevator=bool(row.get("has_elevator")),
                    has_accessible_restroom=bool(row.get("has_accessible_restroom")),
                    has_wheelchair_rental=bool(row.get("has_wheelchair_rental")),
                    has_stroller_accessible_path=bool(row.get("has_stroller_accessible_path")),
                    has_rest_area=bool(row.get("has_rest_area")),
                    has_visual_accessibility=bool(row.get("has_visual_accessibility")),
                    has_hearing_accessibility=bool(row.get("has_hearing_accessibility")),
                )
        _ = stopped_early  # 로그/필요 시 확장을 위해 남겨둠 (현재는 diag로 충분히 노출됨)

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
            results = [a.model_copy(deep=True) for a in _MOCK_ATTRACTIONS]
            if user_type == "wheelchair":
                results = [a for a in results if a.accessibility.has_ramp]
            elif user_type == "stroller":
                results = [a for a in results if a.accessibility.has_stroller_accessible_path]
            elif user_type in ("senior", "pregnant"):
                results = [a for a in results if a.accessibility.has_rest_area]
            results = results[:limit]
            for a in results:
                a.accessibility_benefits = _accessibility_benefit_labels(a.accessibility)
                # 목업 모드에는 실제 집중률/API 소개문이 없어 표시용 예시 값을 넣습니다.
                a.congestion_rate = 42.0
                a.overview = f"{a.name}은(는) {a.category} 카테고리의 무장애 여행지입니다."
            return results

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

            # 각 관광지의 편의시설 상세 정보를 채웁니다. 캐시에 있으면 캐시를 쓰고,
            # 없는 것만 API로 조회합니다 (일일 트래픽 절약).
            #
            # 이 엔드포인트는 홈 화면/검색처럼 사람이 화면을 보면서 기다리는 곳이라,
            # 무장애 정보 API가 오늘처럼 레이트리밋에 걸려 응답이 계속 느려지는
            # 상황이어도 화면이 무한정 멈춰있으면 안 됩니다. 그래서 (1) 새로 조회할
            # 건수를 이번 목록 크기만큼으로 제한하고, (2) 전체 소요 시간에 상한선을
            # 둬서, 시간 안에 다 못 끝나면 지금까지 된 것만 반영하고 넘어갑니다.
            # (관광지 목록 자체는 이미 확보돼 있으니, 편의시설 정보가 일부 비어있는
            # 채로라도 화면에는 바로 뜹니다.)
            try:
                await asyncio.wait_for(
                    self._fill_accessibility_with_cache(
                        client, attractions, max_new_fetches=len(attractions)
                    ),
                    timeout=8.0,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "search_accessible_attractions: 편의시설 정보 조회가 8초 안에 "
                    "끝나지 않아 일부(또는 전부)는 비어있는 채로 목록을 반환합니다."
                )

        # 캐시된 집중률(≈인기도)로 정렬합니다. refresh_congestion_cache로 미리
        # 채워둔 DB 캐시만 읽으니, 이 단계는 별도 API 호출이 없습니다(빠름).
        # 집중률 데이터가 있는 장소는 높은 순으로, 없는 장소는 원래(카테고리
        # 라운드로빈) 순서 그대로 뒤에 남깁니다.
        signgu_by_content_id: dict[str, int] = {}
        for a in attractions:
            area_signgu = find_area_signgu(a.address)
            if area_signgu:
                signgu_by_content_id[a.content_id] = area_signgu[1]
        distinct_signgu = sorted(set(signgu_by_content_id.values()))
        congestion_rows = (
            await get_cached_congestion_rates(distinct_signgu) if distinct_signgu else {}
        )

        # 정렬에 쓸 congestion_rate와, 카드에 바로 표시할 accessibility_benefits를
        # 이 시점에 각 Attraction에 채워둡니다.
        for a in attractions:
            signgu_cd = signgu_by_content_id.get(a.content_id)
            row = congestion_rows.get((signgu_cd, a.name)) if signgu_cd is not None else None
            a.congestion_rate = float(row["cnctr_rate"]) if row else None
            a.accessibility_benefits = _accessibility_benefit_labels(a.accessibility)

        def congestion_sort_key(a: Attraction) -> tuple[int, float]:
            if a.congestion_rate is None:
                return (1, 0.0)  # 데이터 없음 → 뒤로
            return (0, -a.congestion_rate)  # 집중률 높은 순

        attractions.sort(key=congestion_sort_key)

        results = attractions
        if user_type == "wheelchair":
            results = [a for a in results if a.accessibility.has_ramp] or attractions
        elif user_type == "stroller":
            results = [a for a in results if a.accessibility.has_stroller_accessible_path] or attractions
        elif user_type in ("senior", "pregnant"):
            results = [a for a in results if a.accessibility.has_rest_area] or attractions
        results = results[:limit]

        # 소개문은 API 호출 비용이 있어서, 최종적으로 화면에 노출되는 목록에
        # 대해서만(잘려나가기 전 전체가 아니라) 조회합니다. 캐시에 있으면 API를
        # 안 부르니, 반복 조회 시엔 대부분 여기서 바로 채워집니다.
        # (위쪽 관광지 목록 조회에 쓰던 client는 이미 닫혀서 새로 엽니다.)
        async with httpx.AsyncClient(timeout=15) as overview_client:
            try:
                await asyncio.wait_for(
                    self._fill_overview_with_cache(overview_client, results),
                    timeout=6.0,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "search_accessible_attractions: 소개문 조회가 6초 안에 끝나지 않아 "
                    "일부는 비어있는 채로 반환합니다."
                )

        return results

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

    async def _fetch_congestion_rates_by_signgu(
        self, client: httpx.AsyncClient, area_cd: int, signgu_cd: int, diag: dict | None = None
    ) -> tuple[dict[str, dict], bool]:
        """
        시/군/구 하나 전체의 관광지 집중률을 한 번에 조회합니다 (tAtsNm 미지정).

        반환값: ({관광지명: {"cnctr_rate": float, "base_ymd": str}}, api_ok)
        - 관광지명별로 여러 날짜(baseYmd)가 올 수 있는데, 그 중 가장 이른(가까운) 날짜
          하나만 '현재 집중률'로 남깁니다.
        - api_ok가 False면(429 소진 등) 호출한 쪽에서 이 시군구를 캐시에 반영하지
          않고 다음 새로고침에 다시 시도하게 합니다.
        """
        max_retries = 3
        for attempt in range(max_retries + 1):
            await self._rate_limiter.wait_turn()
            try:
                resp = await client.get(
                    f"{_TATS_CNCTR_RATE_BASE}/tatsCnctrRatedList",
                    params=self._common_params(
                        {
                            "areaCd": area_cd,
                            "signguCd": signgu_cd,
                            "numOfRows": 500,
                            "pageNo": 1,
                        }
                    ),
                )
                if resp.status_code == 429:
                    if attempt < max_retries:
                        if diag is not None:
                            diag["rate_limited_retry"] = diag.get("rate_limited_retry", 0) + 1
                        retry_after = resp.headers.get("Retry-After")
                        wait_seconds = float(retry_after) if retry_after else 0.5 * (2 ** attempt)
                        await asyncio.sleep(wait_seconds)
                        continue
                    if diag is not None:
                        diag["rate_limit_exhausted"] = diag.get("rate_limit_exhausted", 0) + 1
                    return {}, False

                resp.raise_for_status()
                items = self._extract_items(resp.json())
                by_name: dict[str, dict] = {}
                for item in items:
                    name = str(item.get("tAtsNm") or "").strip()
                    base_ymd = str(item.get("baseYmd") or "")
                    if not name or len(base_ymd) != 8:
                        continue
                    try:
                        rate = float(item.get("cnctrRate") or 0)
                    except (TypeError, ValueError):
                        continue
                    existing = by_name.get(name)
                    if existing is None or base_ymd < existing["base_ymd"]:
                        by_name[name] = {"cnctr_rate": rate, "base_ymd": base_ymd}
                if diag is not None:
                    diag["signgu_ok"] = diag.get("signgu_ok", 0) + 1
                    diag["names_found"] = diag.get("names_found", 0) + len(by_name)
                return by_name, True
            except Exception as exc:
                if diag is not None:
                    diag["api_error"] = diag.get("api_error", 0) + 1
                    logger.warning(
                        "tatsCnctrRatedList 호출 실패 (signguCd=%s): %s", signgu_cd, exc
                    )
                return {}, False

        return {}, False

    async def refresh_congestion_cache(self, region: str) -> dict:
        """
        region(예: 경기도) 안의 모든 시/군/구를 순회하며 관광지 집중률을 조회해
        congestion_cache 테이블에 채워둡니다. 시/군/구 단위 호출이라(경기도 약
        44개) 무장애 정보 전수조사보다 훨씬 적은 호출로 끝나지만, 그래도 별도
        서비스라 하루 예산(congestion_api_daily_fetch_budget)과 연속 429 조기
        중단은 동일하게 적용합니다.
        """
        debug_info: dict = {"mode": "mock" if self.use_mock else "live"}
        if self.use_mock:
            return debug_info

        all_signgu = list_area_signgu_by_area(region)
        debug_info["total_signgu"] = len(all_signgu)

        already_cached = await get_cached_congestion_signgu_cds()
        to_fetch = [row for row in all_signgu if row[1] not in already_cached]
        debug_info["already_cached_signgu"] = len(already_cached & {r[1] for r in all_signgu})

        budget = settings.congestion_api_daily_fetch_budget
        deferred = 0
        if len(to_fetch) > budget:
            deferred = len(to_fetch) - budget
            to_fetch = to_fetch[:budget]
        debug_info["deferred_no_budget"] = deferred

        diag: dict = {}
        fetched_signgu = 0
        async with httpx.AsyncClient(timeout=30) as client:
            for area_cd, signgu_cd, signgu_nm in to_fetch:
                by_name, api_ok = await self._fetch_congestion_rates_by_signgu(
                    client, area_cd, signgu_cd, diag=diag
                )
                if not api_ok:
                    # 이 시군구는 이번엔 실패 — 캐시에 안 남겨서 다음 새로고침에 재시도
                    diag["stopped_early_rate_limited"] = True
                    debug_info["deferred_no_budget"] = debug_info.get("deferred_no_budget", 0) + (
                        len(to_fetch) - fetched_signgu
                    )
                    logger.warning(
                        "집중률 조회를 일찍 중단합니다 (signguCd=%s 실패, 나머지는 다음에)",
                        signgu_cd,
                    )
                    break
                fetched_signgu += 1
                if by_name:
                    rows = [
                        {
                            "signgu_cd": signgu_cd,
                            "tats_nm": name,
                            "cnctr_rate": vals["cnctr_rate"],
                            "base_ymd": vals["base_ymd"],
                            "fetched_at": datetime.datetime.utcnow().isoformat(),
                        }
                        for name, vals in by_name.items()
                    ]
                    await save_congestion_rates_batch(rows)

        debug_info["signgu_fetched_this_run"] = fetched_signgu
        debug_info["diag"] = diag
        logger.info(
            "refresh_congestion_cache(%s): 전체 시군구 %d개 / 이미 캐시됨 %d개 / "
            "이번에 조회 %d개 / 미룸 %d개",
            region,
            debug_info["total_signgu"],
            debug_info["already_cached_signgu"],
            fetched_signgu,
            debug_info["deferred_no_budget"],
        )
        return debug_info

    async def get_accessibility_summary(self, region: str) -> dict:
        """
        '접근성' 탭/홈 화면 통계용 요약 정보 — 전수조사 방식.
        경기도 전체의 관광지/음식점/문화시설/레포츠/숙박 각 카테고리를 페이지가
        끝날 때까지 전부 가져온 뒤(표본이 아니라 전체), 하나하나 편의시설 정보를
        조회해서 계산합니다. 항목 수가 많아서(보통 수천 건) 시간이 꽤 걸립니다 —
        그래서 이 함수는 매 요청마다 부르지 않고, 캐시(accessibility_stats 테이블)에
        저장해두고 필요할 때만(수동 새로고침) 다시 계산하는 용도로 씁니다.

        휠체어/고령자/유모차는 실제 편의시설 데이터(AccessibilityFeatures)로 계산하고,
        시각/청각장애는 관련 데이터를 제공하는 API가 없어 표시용 목업 숫자를 씁니다.
        관광지별 접근성 점수는 6개 편의시설 항목 중 몇 개를 만족하는지로 계산합니다
        (예: 6개 중 5개 충족 → 83점).
        """
        debug_info: dict = {}

        if self.use_mock:
            candidates = list(_MOCK_ATTRACTIONS)
            debug_info["mode"] = "mock"
        else:
            debug_info["mode"] = "live"
            ldong_regn_map = {"경기도": "41", "서울": "11"}
            ldong_regn_cd = ldong_regn_map.get(region, "41")

            async with httpx.AsyncClient(timeout=30) as client:
                # 1) 카테고리별로 전 페이지를 끝까지 가져옵니다 (전수조사).
                results_per_type = await asyncio.gather(
                    *(
                        self._fetch_all_by_content_type(client, ldong_regn_cd, content_type_id)
                        for content_type_id in _DEFAULT_CONTENT_TYPE_IDS
                    )
                )
                # 카테고리별로 몇 건씩 수집됐는지 기록 (특정 카테고리만 0건이면 그
                # 카테고리 호출/파라미터에 문제가 있다는 신호입니다).
                debug_info["candidates_per_category"] = {
                    str(content_type_id): len(group)
                    for content_type_id, group in zip(_DEFAULT_CONTENT_TYPE_IDS, results_per_type)
                }

                all_candidates: list[Attraction] = []
                seen_ids: set[str] = set()
                for group in results_per_type:
                    for a in group:
                        if a.content_id and a.content_id not in seen_ids:
                            seen_ids.add(a.content_id)
                            all_candidates.append(a)
                debug_info["total_candidates_before_accessibility_fetch"] = len(all_candidates)

                # 2) 전체 항목 각각의 편의시설 상세 정보를 채웁니다.
                #    캐시(place_accessibility_cache)에 이미 있는 content_id는 API를
                #    다시 부르지 않고, 새로 등장한 content_id만 (하루 예산 한도 안에서)
                #    조회합니다. (동시 연결 개수는 세마포어, 실제 요청 '속도'는
                #    self._rate_limiter로 제한)
                accessibility_diag: dict = {}
                await self._fill_accessibility_with_cache(
                    client,
                    all_candidates,
                    diag=accessibility_diag,
                    max_concurrency=10,
                    max_new_fetches=settings.tour_api_daily_fetch_budget,
                )

                debug_info["accessibility_fetch"] = {
                    "from_cache": accessibility_diag.get("from_cache", 0),
                    "newly_fetched_and_cached": accessibility_diag.get("newly_fetched_and_cached", 0),
                    "no_record": accessibility_diag.get("no_record", 0),
                    "has_record": accessibility_diag.get("has_record", 0),
                    "api_error": accessibility_diag.get("api_error", 0),
                    "rate_limited_retry": accessibility_diag.get("rate_limited_retry", 0),
                    "rate_limit_exhausted": accessibility_diag.get("rate_limit_exhausted", 0),
                    # 일일 예산(tour_api_daily_fetch_budget) 또는 연속 429로 인해
                    # 이번엔 아예 시도하지 못하고 미뤄진 건수. 이 값이 0이 될 때까지
                    # /refresh를 반복 호출하면(보통 매일 한 번씩) 캐시가 다 채워집니다.
                    "deferred_no_budget": accessibility_diag.get("deferred_no_budget", 0),
                    "stopped_early_rate_limited": accessibility_diag.get(
                        "stopped_early_rate_limited", False
                    ),
                }
                logger.info(
                    "get_accessibility_summary(%s): 후보 %d건 / 카테고리별 %s / "
                    "캐시적중 %d건, 신규조회 %d건, 미룸(예산/한도) %d건 / "
                    "무장애정보 등록없음 %d건, 등록됨 %d건, 조회실패 %d건, "
                    "429재시도 %d회, 429재시도소진 %d건",
                    region,
                    len(all_candidates),
                    debug_info["candidates_per_category"],
                    accessibility_diag.get("from_cache", 0),
                    accessibility_diag.get("newly_fetched_and_cached", 0),
                    accessibility_diag.get("deferred_no_budget", 0),
                    accessibility_diag.get("no_record", 0),
                    accessibility_diag.get("has_record", 0),
                    accessibility_diag.get("api_error", 0),
                    accessibility_diag.get("rate_limited_retry", 0),
                    accessibility_diag.get("rate_limit_exhausted", 0),
                )

            candidates = all_candidates

        def score(a: Attraction) -> int:
            feats = a.accessibility
            checks = [
                feats.has_ramp,
                feats.has_elevator,
                feats.has_accessible_restroom,
                feats.has_wheelchair_rental,
                feats.has_stroller_accessible_path,
                feats.has_rest_area,
            ]
            return round(sum(1 for c in checks if c) / len(checks) * 100)

        wheelchair_places = [a for a in candidates if a.accessibility.has_ramp or a.accessibility.has_wheelchair_rental]
        senior_places = [a for a in candidates if a.accessibility.has_rest_area]
        stroller_places = [a for a in candidates if a.accessibility.has_stroller_accessible_path]
        visual_places = [a for a in candidates if a.accessibility.has_visual_accessibility]
        hearing_places = [a for a in candidates if a.accessibility.has_hearing_accessibility]
        # '무장애 여행지' 총 개수는 휠체어/유모차/고령자·임산부(휴게공간) 중
        # 하나라도 해당하는 장소를 중복 없이 합친 값입니다.
        any_accessible_ids = {
            a.content_id for a in (wheelchair_places + senior_places + stroller_places)
        }

        top_wheelchair = sorted(wheelchair_places, key=score, reverse=True)[:5]

        return {
            "wheelchair_count": len(wheelchair_places),
            "senior_count": len(senior_places),
            "total_accessible_count": len(any_accessible_ids),
            # 활용매뉴얼(v4.3) 기준 실제 응답 필드(점자블록/오디오가이드/수화안내/
            # 자막비디오가이드 등)로 계산한 값입니다 — 더 이상 목업이 아닙니다.
            "visual_count": len(visual_places),
            "hearing_count": len(hearing_places),
            "top_wheelchair_places": [
                {
                    "name": a.name,
                    "score": score(a),
                    "address": a.address,
                }
                for a in top_wheelchair
            ],
            # 진단용 필드: 43 같은 숫자가 왜 그렇게 나왔는지 원인을 구분하기 위한 정보.
            # candidates_per_category: 카테고리별(관광지/음식점/문화시설/레포츠/숙박) 수집 건수
            # total_candidates_before_accessibility_fetch: 중복 제거 후 전체 후보 수
            # accessibility_fetch.no_record: 무장애 정보가 아예 등록 안 된 곳 (→ 자동으로 접근성 없음 처리됨)
            # accessibility_fetch.has_record: 무장애 정보가 등록돼 실제 값을 읽어온 곳
            # accessibility_fetch.api_error: 조회 자체가 실패해서 접근성 없음으로 처리된 곳
            "debug": debug_info,
        }


tour_api_client = TourApiClient()
