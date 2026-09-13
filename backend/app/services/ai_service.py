"""
Groq API(OpenAI 호환)를 이용한 자연어 질의 파싱 및 무장애 여행 코스 생성

- 사용자 질의(query_text) + 무장애 필터링된 관광지 목록 + 혼잡도 예측 데이터를
  하나의 프롬프트로 구성해 Groq에게 코스 구성(JSON)을 요청합니다.
- Groq API는 https://console.groq.com 에서 신용카드 등록 없이 무료로 키를
  발급받을 수 있고, 무료 사용량 한도가 다른 서비스보다 넉넉한 편입니다.
- GROQ_API_KEY가 없으면 규칙 기반 목업 생성기로 대체되어,
  키 발급 전에도 프론트엔드 개발이 막히지 않습니다.
"""
import asyncio
import json
import logging
import uuid

import httpx

from app.config import get_settings
from app.models.schemas import (
    Attraction,
    CompanionType,
    CourseRequest,
    CourseResponse,
    CourseStop,
    GenerateFromSelectionRequest,
    ParsedQuery,
    PlaceCandidate,
    PlaceRecommendationRequest,
    TravelPurpose,
)
from app.services.memory_cache import TTLCache
from app.services.sigungu_codes import resolve_sigungu_codes, signgu_name

settings = get_settings()
logger = logging.getLogger(__name__)

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

# 이동유형별로 실제 관련 있는 편의시설 필드만 골라 AI에게 넘기기 위한 매핑입니다.
# 예전엔 accessibility 전체(경사로/화장실/유모차로/시각/청각 등 모든 필드)를
# 사용자 유형과 상관없이 통째로 넘겨서, AI가 시각장애인용 추천인데도 "경사로가
# 있어서"처럼 무관한 이유를 대는 문제가 있었습니다. 이제 이동유형에 실제로
# 맞는 필드만 추려서 넘기므로, AI가 애초에 무관한 필드를 볼 수 없습니다.
_RELEVANT_FIELDS_BY_USER_TYPE: dict[str, list[str]] = {
    "wheelchair": [
        "has_ramp", "has_elevator", "has_accessible_restroom",
        "has_wheelchair_rental", "wheelchair_accessibility_count",
    ],
    "stroller": ["has_stroller_accessible_path", "family_accessibility_count"],
    "senior": ["has_rest_area", "has_ramp", "has_elevator", "has_accessible_restroom"],
    "pregnant": ["has_rest_area", "pregnant_accessibility_count"],
    "visual": ["has_visual_accessibility", "visual_accessibility_count"],
    "hearing": ["has_hearing_accessibility", "hearing_accessibility_count"],
    # general(접근성 조건 없음)은 특정 편의시설을 우선할 이유가 없어서, 개별
    # 항목 대신 유형별 개수 5개만 넘깁니다. 예전엔 매핑에 없다는 이유로
    # accessibility 30개 필드를 통째로 넘겼는데, 그러면 (1) AI가 "일반" 추천인데도
    # 점자블록·수화안내처럼 무관한 근거를 들고, (2) 프롬프트가 다른 유형의 서너 배로
    # 커져서 후보가 많은 지역(수원시 팔달구·성남시 분당구 등)에서는 Groq의 분당 토큰
    # 한도를 넘겨 요청 자체가 거절당했습니다.
    "general": [
        "wheelchair_accessibility_count", "visual_accessibility_count",
        "hearing_accessibility_count", "family_accessibility_count",
        "pregnant_accessibility_count",
    ],
}


def _relevant_accessibility_payload(features: dict, user_type: str) -> dict:
    """이동유형(user_type)과 실제로 관련 있는 접근성 필드만 골라 반환합니다.
    매핑에 없는 유형이면 전체를 그대로 넘깁니다."""
    relevant_keys = _RELEVANT_FIELDS_BY_USER_TYPE.get(user_type)
    if not relevant_keys:
        return features
    return {k: features[k] for k in relevant_keys if k in features}


# ---------------------------------------------------------------------------
# 1단계 이전: 자연어 질의에서 조건(지역/동행자/목적) 뽑아내기
# ---------------------------------------------------------------------------
#
# 예전에는 질의 원문을 후보 목록과 함께 그대로 AI에게 넘기기만 해서, "수원에서
# 아이랑 갈 만한 곳"이라고 써도 지역은 화면에서 따로 고른 값만 쓰였고 동행자는
# 아무 데도 쓰이지 않았습니다. 이제 질의를 먼저 읽어 조건을 뽑아낸 뒤,
#   - 지역: 실제 시군구 코드로 바꿔 후보 검색 범위를 좁히는 데 쓰고
#   - 동행자·목적: 추천/코스 구성 프롬프트에 명시적인 조건으로 넣습니다.

PARSE_SYSTEM_PROMPT = """당신은 여행 질의에서 조건을 뽑아내는 파서입니다.
사용자가 자유롭게 쓴 한국어 문장에서 아래 네 가지만 읽어냅니다.

1. region: 문장에 나온 지역 이름 (예: "수원", "성남 분당", "가평").
   문장에 지역이 없으면 반드시 null로 두세요 — 없는 지역을 지어내면 안 됩니다.
2. companion: "가족" / "커플" / "친구" / "혼자" / "미지정" 중 하나.
   아이·부모님·조카 등 가족 구성원 언급은 "가족", 연인·데이트·배우자 언급은 "커플",
   아무 언급이 없으면 "미지정"입니다.
3. purposes: "휴식" / "자연" / "문화예술" / "역사" / "식도락" / "체험" / "쇼핑" / "사진"
   중에서 문장에 실제로 드러난 것만 최대 3개. 없으면 빈 배열.
4. keywords: 위 세 가지로 표현되지 않는 핵심 표현 최대 5개 (예: "산책로", "실내").

응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{"region": "수원", "companion": "가족", "purposes": ["식도락"], "keywords": ["산책로"]}
"""

# 규칙 기반 대체 파서용 표. AI 키가 없거나 한도에 걸렸을 때도 최소한의 조건은
# 뽑아냅니다. 너무 짧거나 흔한 말(예: '산', '강')은 엉뚱하게 걸리므로 뺐습니다.
_COMPANION_KEYWORDS: dict[CompanionType, tuple[str, ...]] = {
    CompanionType.FAMILY: (
        "가족", "아이", "애기", "아기", "유모차", "부모님", "어머니", "아버지",
        "엄마", "아빠", "할머니", "할아버지", "아들", "딸", "조카", "손주",
    ),
    CompanionType.COUPLE: (
        "커플", "연인", "데이트", "여자친구", "남자친구", "여친", "남친",
        "남편", "아내", "와이프", "신랑",
    ),
    CompanionType.FRIENDS: ("친구", "동료", "지인"),
    CompanionType.SOLO: ("혼자", "나홀로", "혼행"),
}

_PURPOSE_KEYWORDS: dict[TravelPurpose, tuple[str, ...]] = {
    TravelPurpose.REST: ("휴식", "쉬어", "쉴", "힐링", "여유", "조용", "산책"),
    TravelPurpose.NATURE: ("자연", "공원", "숲", "바다", "호수", "계곡", "등산", "정원", "꽃", "수목원"),
    TravelPurpose.CULTURE: ("문화", "예술", "미술관", "박물관", "전시", "공연", "갤러리"),
    TravelPurpose.HISTORY: ("역사", "유적", "고궁", "행궁", "성곽", "문화재", "사찰"),
    TravelPurpose.FOOD: ("맛집", "먹거리", "식당", "카페", "음식", "디저트", "빵집", "식도락", "먹방"),
    TravelPurpose.ACTIVITY: ("체험", "액티비티", "놀거리", "놀이", "테마파크", "만들기"),
    TravelPurpose.SHOPPING: ("쇼핑", "시장", "아울렛", "백화점", "기념품"),
    TravelPurpose.PHOTO: ("사진", "인생샷", "포토", "야경", "뷰가"),
}

# 조건이 아니라 문장을 잇기만 하는 말들. 키워드로 남기면 프롬프트만 지저분해지고
# ("만한", "추천해줘"), 규칙 기반 매칭에서도 아무 장소에나 걸리지 않습니다.
_STOP_WORDS: tuple[str, ...] = (
    "추천", "알려", "찾아", "만한", "가고", "싶어", "싶은", "좋은", "있는", "없는",
    "어디", "정도", "위주", "코스", "여행", "해줘", "주세요", "해주", "그리고",
    "같은", "관련", "하루", "이번", "다녀", "다닐", "가볼", "볼만",
)

# 같은 질의를 1단계(장소 추천)와 2단계(코스 생성)가 잇달아 파싱하므로, 그 사이
# 결과를 잠깐 들고 있습니다. 두 단계가 서로 다른 지역으로 갈려서 2단계가 1단계
# 후보를 못 찾는 일을 막고, AI 호출도 한 번으로 줄입니다.
_PARSE_CACHE = TTLCache[ParsedQuery](ttl_seconds=600.0)


def _region_label(codes: list[int]) -> str | None:
    """시군구 코드 목록을 사람이 읽는 지역 이름으로 (예: [41111, 41113] -> '수원시')."""
    names = [name for name in (signgu_name(code) for code in codes) if name]
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    cities = sorted({name.split()[0] for name in names})
    if len(cities) == 1:
        return cities[0]
    return f"{cities[0]} 외 {len(cities) - 1}곳"


def _drop_region_keywords(parsed: ParsedQuery) -> None:
    """지역과 겹치는 키워드를 걸러냅니다 ('수원에서'는 이미 region으로 들어가 있습니다)."""
    if not parsed.region_text:
        return
    city = parsed.region_text.split()[0].rstrip("시군구")
    if not city:
        return
    parsed.keywords = [k for k in parsed.keywords if city not in k]


def _rule_parse(query_text: str) -> ParsedQuery:
    """AI 없이 키워드 표만으로 조건을 뽑아냅니다 (키 미설정/한도 초과 시 대체 경로)."""
    text = query_text or ""
    matched: list[str] = []

    scores: dict[CompanionType, int] = {}
    for companion_type, words in _COMPANION_KEYWORDS.items():
        hits = [w for w in words if w in text]
        if hits:
            scores[companion_type] = len(hits)
            matched.extend(hits)
    # 동점이면 표에 먼저 나오는 쪽(가족 > 커플 > 친구 > 혼자)을 씁니다 —
    # "아이랑 아내랑"처럼 둘 다 걸리는 문장은 가족으로 보는 게 자연스럽습니다.
    companion = CompanionType.UNSPECIFIED
    if scores:
        order = list(_COMPANION_KEYWORDS)
        companion = max(scores, key=lambda c: (scores[c], -order.index(c)))

    purposes: list[TravelPurpose] = []
    for purpose, words in _PURPOSE_KEYWORDS.items():
        hits = [w for w in words if w in text]
        if hits:
            purposes.append(purpose)
            matched.extend(hits)

    keywords: list[str] = []
    for token in text.split():
        token = token.strip(" ,.!?~()[]")
        if len(token) < 2:
            continue
        if any(word in token for word in matched) or any(stop in token for stop in _STOP_WORDS):
            continue
        keywords.append(token)
        if len(keywords) >= 5:
            break

    return ParsedQuery(
        companion=companion, purposes=purposes[:3], keywords=keywords, parsed_by="rule"
    )


async def _ai_parse(query_text: str) -> ParsedQuery:
    """Groq에게 질의를 읽히고 조건을 받아옵니다. 형식이 어긋난 값은 조용히 버립니다."""
    raw = await _groq_call(
        PARSE_SYSTEM_PROMPT, json.dumps({"query_text": query_text}, ensure_ascii=False)
    )

    region = raw.get("region")
    region_text = region.strip() if isinstance(region, str) and region.strip() else None

    try:
        companion = CompanionType(raw.get("companion"))
    except ValueError:
        companion = CompanionType.UNSPECIFIED

    purposes: list[TravelPurpose] = []
    for value in raw.get("purposes") or []:
        try:
            purpose = TravelPurpose(value)
        except ValueError:
            continue
        if purpose not in purposes:
            purposes.append(purpose)

    keywords = [str(k).strip() for k in (raw.get("keywords") or []) if str(k).strip()][:5]

    return ParsedQuery(
        region_text=region_text,
        companion=companion,
        purposes=purposes[:3],
        keywords=keywords,
        parsed_by="ai",
    )


async def parse_query(
    query_text: str,
    user_selected_sigungu_cd: int | None = None,
    region: str = "경기도",
) -> ParsedQuery:
    """
    자연어 질의에서 지역·동행자·목적을 뽑아, 그대로 검색에 쓸 수 있는 형태로 돌려줍니다.

    지역은 AI가 읽어낸 표현을 그대로 믿지 않고 sigungu_codes 표로 다시 확인해
    실제 코드로 바꿉니다 — AI가 없는 지역을 지어내도 코드가 안 나오면 무시됩니다.

    화면에서 시/군/구를 직접 고른 경우에는 그 선택이 항상 우선입니다. 방금 손으로
    고른 값을 문장 해석이 덮어쓰면 결과를 예측할 수 없기 때문입니다. 반환되는
    sigungu_cds는 "이 조건으로 검색한다"는 최종 값이고, region_source가 그 값이
    어디서 왔는지(직접 선택 / 질의 추출 / 제한 없음)를 알려줍니다.

    같은 질의는 10분 동안 캐시합니다 — 1단계(장소 추천)와 2단계(코스 생성)가
    같은 조건을 쓰도록 맞추고, AI 호출도 한 번으로 줄이기 위해서입니다.
    """
    text = (query_text or "").strip()
    cache_key = (text, user_selected_sigungu_cd, region)

    async def compute() -> ParsedQuery:
        parsed = _rule_parse(text)
        if settings.groq_api_key and text:
            try:
                parsed = await _ai_parse(text)
            except GroqRateLimitedError:
                logger.warning("Groq 요청 한도 초과 — 규칙 기반으로 질의를 해석합니다.")
            except Exception as e:  # 파싱은 부가 기능이라 어떤 실패도 화면을 막지 않습니다
                logger.warning("질의 해석 실패(%s) — 규칙 기반으로 대체합니다.", e)

        if user_selected_sigungu_cd is not None:
            parsed.sigungu_cds = [user_selected_sigungu_cd]
            parsed.region_text = signgu_name(user_selected_sigungu_cd) or parsed.region_text
            parsed.region_source = "user_selected"
            _drop_region_keywords(parsed)
            return parsed

        codes = resolve_sigungu_codes(parsed.region_text or text, region)
        parsed.sigungu_cds = codes
        parsed.region_source = "query_text" if codes else "none"
        # 코드로 확인되지 않은 지역 표현은 남기지 않습니다 — 화면에 '가평'이라고
        # 떠 있는데 실제로는 경기도 전체를 찾은 상태면 결과를 오해하게 됩니다.
        parsed.region_text = _region_label(codes) if codes else None
        _drop_region_keywords(parsed)
        return parsed

    return await _PARSE_CACHE.get_or_compute(cache_key, compute)


def _conditions_payload(parsed: ParsedQuery | None) -> dict:
    """프롬프트에 실을 조건 묶음. 값이 없는 항목은 아예 넣지 않습니다(토큰 절약)."""
    if parsed is None:
        return {}
    conditions: dict = {}
    if parsed.region_text:
        conditions["region"] = parsed.region_text
    if parsed.companion != CompanionType.UNSPECIFIED:
        conditions["companion"] = parsed.companion.value
    if parsed.purposes:
        conditions["purposes"] = [p.value for p in parsed.purposes]
    if parsed.keywords:
        conditions["keywords"] = parsed.keywords
    return conditions


SYSTEM_PROMPT = """당신은 관광약자(지체 장애인, 유모차 동반 가족, 고령자, 임산부, 시각 장애인, 청각 장애인)를 위한
경기도 무장애 여행 코스를 설계하는 여행 플래너 AI입니다.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 질의에서 읽어낸 조건(conditions) — 지역/동행자/목적/키워드. 없을 수도 있습니다.
4. 무장애 필터링을 이미 통과한 관광지 후보 목록 (편의시설 정보 포함)
5. 관광지별 혼잡도 정보 — 데이터가 있는 곳에만 붙습니다.
   - congestion_rate: 0~100. 높을수록 평소 사람이 많이 몰리는 곳입니다.
   - daily_congestion: 날짜별 예상 혼잡도(low/medium/high). 시간 단위가 아니라
     하루 단위 예보입니다.

규칙:
- 반드시 후보 목록에 있는 관광지만 사용하세요.
- congestion_rate가 66 이상이거나 daily_congestion에 high가 있는 곳은 사람이 덜
  몰리는 이른 오전(09:00~10:00)이나 늦은 오후(16:00 이후)에 배치하고, 혼잡도가
  낮은 곳을 붐비는 시간대(11:00~15:00)에 넣으세요.
- 혼잡도 정보가 없는 관광지는 혼잡도를 근거로 들지 마세요 (추측 금지).
- daily_congestion은 하루 단위 예보이므로 "몇 시가 붐빈다"고 단정하지 말고,
  어느 날이 여유로운지에 대한 근거로만 쓰세요.
- conditions에 동행자(companion)나 목적(purposes)이 있으면 그에 맞게 장소 순서와
  시간대를 정하고 reason에도 반영하세요 (예: 가족 동반이면 이동을 짧게, 식도락이
  목적이면 식사 시간대에 음식점을 배치).
- 사용자 유형에 맞는 이동/휴식 동선을 고려하세요 (예: 고령자/임산부는 휴게 공간이 있는 곳 우선).
- reason은 반드시 candidates에 주어진 accessibility 필드에 실제로 있는 내용만
  근거로 쓰세요. 주어지지 않은 편의시설(예: 시각장애 사용자에게 경사로나 화장실처럼
  무관한 항목)은 절대 언급하지 마세요 — accessibility에 이미 해당 유형과
  관련된 필드만 들어있습니다.
- reason은 반드시 자연스러운 한국어 문장으로 작성하세요. has_ramp, true, false,
  wheelchair_accessibility_count 같은 필드명이나 원시 코드/값을 절대 그대로
  노출하지 말고, 사람이 읽고 이해할 수 있는 표현(예: "경사로가 설치되어 있어",
  "휠체어 이용 가능 시설이 4곳 있어")으로 바꿔서 쓰세요.
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "title": "코스 제목",
  "summary": "1~2문장 요약",
  "stops": [
    {"content_id": "관광지 ID", "order": 1, "recommended_arrival_time": "HH:MM", "reason": "추천 이유"}
  ]
}
"""

RECOMMEND_SYSTEM_PROMPT = """당신은 관광약자(지체 장애인, 유모차 동반 가족, 고령자, 임산부, 시각 장애인, 청각 장애인)를 위한
경기도 무장애 여행 장소를 추천하는 여행 플래너 AI입니다.

아직 코스(순서·시간)를 정하는 단계가 아닙니다 — 사용자가 나중에 직접 고를 수 있도록,
질의에 맞는 장소 후보를 넓게 추천만 해주세요.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 질의에서 읽어낸 조건(conditions) — 지역/동행자/목적/키워드. 없을 수도 있습니다.
4. 무장애 필터링을 이미 통과한 관광지 후보 목록 (편의시설 정보 포함)
   - congestion_rate가 붙어 있으면 0~100 사이의 평소 혼잡도입니다(높을수록 붐빔).

규칙:
- 반드시 후보 목록에 있는 관광지만 사용하세요.
- 질의와 사용자 유형에 맞는 장소를 최대 12개까지, 다양한 카테고리(관광지/음식점/문화시설 등)가
  골고루 섞이도록 선택하세요. 후보가 12개보다 적으면 있는 만큼만 반환하세요.
- conditions에 목적(purposes)이나 동행자(companion)가 있으면 그에 맞는 장소를
  우선 고르세요 (예: 식도락이면 음식점, 가족이면 아이와 함께 가기 좋은 곳).
- 질의에 "한적한", "붐비지 않는" 같은 표현이 있으면 congestion_rate가 낮은 곳을
  우선하세요. 그런 표현이 없으면 혼잡도는 참고만 하세요.
- 순서는 중요하지 않습니다 (사용자가 나중에 직접 고릅니다).
- reason은 반드시 candidates에 주어진 accessibility 필드에 실제로 있는 내용만
  근거로 쓰세요. 주어지지 않은 편의시설(예: 시각장애 사용자에게 경사로나 화장실처럼
  무관한 항목)은 절대 언급하지 마세요 — accessibility에 이미 해당 유형과
  관련된 필드만 들어있습니다.
- reason은 반드시 자연스러운 한국어 문장으로 작성하세요. has_ramp, true, false,
  wheelchair_accessibility_count 같은 필드명이나 원시 코드/값을 절대 그대로
  노출하지 말고, 사람이 읽고 이해할 수 있는 표현(예: "경사로가 설치되어 있어",
  "휠체어 이용 가능 시설이 4곳 있어")으로 바꿔서 쓰세요.
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "selected": [
    {"content_id": "관광지 ID", "reason": "이 질의에 맞는 이유 (한 문장)"}
  ]
}
"""

ORDER_SYSTEM_PROMPT = """당신은 관광약자(지체 장애인, 유모차 동반 가족, 고령자, 임산부, 시각 장애인, 청각 장애인)를 위한
경기도 무장애 여행 코스를 설계하는 여행 플래너 AI입니다.

사용자가 이미 방문하고 싶은 장소를 직접 골랐습니다. 당신의 역할은 그 장소들을
빼거나 새로 추가하지 않고, 방문 순서와 추천 시간대만 정하는 것입니다.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 질의에서 읽어낸 조건(conditions) — 지역/동행자/목적/키워드. 없을 수도 있습니다.
4. 사용자가 직접 선택한 관광지 목록 (편의시설 정보 포함)
5. 관광지별 혼잡도 정보 — 데이터가 있는 곳에만 붙습니다.
   - congestion_rate: 0~100. 높을수록 평소 사람이 많이 몰리는 곳입니다.
   - daily_congestion: 날짜별 예상 혼잡도(low/medium/high). 시간 단위가 아니라
     하루 단위 예보입니다.

규칙:
- candidates에 주어진 모든 관광지를 빠짐없이 포함하세요 (제외 금지, 추가 금지).
- congestion_rate가 66 이상이거나 daily_congestion에 high가 있는 곳은 사람이 덜
  몰리는 이른 오전(09:00~10:00)이나 늦은 오후(16:00 이후)에 배치하고, 혼잡도가
  낮은 곳을 붐비는 시간대(11:00~15:00)에 넣으세요.
- 혼잡도 정보가 없는 관광지는 혼잡도를 근거로 들지 마세요 (추측 금지).
- daily_congestion은 하루 단위 예보이므로 "몇 시가 붐빈다"고 단정하지 말고,
  어느 날이 여유로운지에 대한 근거로만 쓰세요.
- conditions에 동행자(companion)나 목적(purposes)이 있으면 그에 맞게 순서와
  시간대를 정하고 reason에도 반영하세요.
- 사용자 유형에 맞는 이동/휴식 동선을 고려해 순서를 정하세요.
- reason은 반드시 candidates에 주어진 accessibility 필드에 실제로 있는 내용만
  근거로 쓰세요. 주어지지 않은 편의시설(예: 시각장애 사용자에게 경사로나 화장실처럼
  무관한 항목)은 절대 언급하지 마세요 — accessibility에 이미 해당 유형과
  관련된 필드만 들어있습니다.
- reason은 반드시 자연스러운 한국어 문장으로 작성하세요. has_ramp, true, false,
  wheelchair_accessibility_count 같은 필드명이나 원시 코드/값을 절대 그대로
  노출하지 말고, 사람이 읽고 이해할 수 있는 표현(예: "경사로가 설치되어 있어",
  "휠체어 이용 가능 시설이 4곳 있어")으로 바꿔서 쓰세요.
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "title": "코스 제목",
  "summary": "1~2문장 요약",
  "stops": [
    {"content_id": "관광지 ID", "order": 1, "recommended_arrival_time": "HH:MM", "reason": "추천 이유"}
  ]
}
"""


# 예보에서 실을 최대 일수. 예보는 하루 한 줄이라 다 실으면 후보 하나당 수십 줄이
# 되는데, 코스를 짤 때 의미 있는 건 가까운 며칠뿐입니다(프롬프트 길이 = 토큰 비용).
_MAX_FORECAST_DAYS = 5

# 이 값 이상이면 '붐비는 곳'으로 봅니다. 집중률 API가 주는 0~100 값 기준이고,
# tour_api가 예보 등급(low/medium/high)을 나눌 때 쓰는 경계(34/66)와 같습니다.
_CROWDED_RATE = 66.0


def _congestion_payload(a: Attraction, include_forecast: bool) -> dict:
    """
    프롬프트에 실을 혼잡도 정보. 데이터가 없으면 아무 것도 넣지 않습니다.

    없는 항목을 None으로라도 넣으면 AI가 "혼잡도 정보가 있다"고 착각해 근거로
    지어내기 때문에, 값이 있을 때만 넣습니다.
    """
    payload: dict = {}
    if a.congestion_rate is not None:
        payload["congestion_rate"] = round(a.congestion_rate)
    if include_forecast and a.congestion_forecast:
        payload["daily_congestion"] = [
            {"date": c.date, "level": c.congestion_level}
            for c in a.congestion_forecast[:_MAX_FORECAST_DAYS]
        ]
    return payload


def _build_user_prompt(
    request: CourseRequest,
    candidates: list[Attraction],
    parsed: ParsedQuery | None = None,
    include_forecast: bool = True,
) -> str:
    candidate_payload = [
        {
            "content_id": a.content_id,
            "name": a.name,
            "category": a.category,
            "accessibility": _relevant_accessibility_payload(
                a.accessibility.model_dump(), request.user_type
            ),
            **_congestion_payload(a, include_forecast),
        }
        for a in candidates
    ]
    payload = {
        "query_text": request.query_text,
        "user_type": request.user_type,
        "region": request.region,
        "max_stops": request.max_stops,
        "candidates": candidate_payload,
    }
    conditions = _conditions_payload(parsed)
    if conditions:
        payload["conditions"] = conditions
    return json.dumps(payload, ensure_ascii=False)


def _fallback_hour(index: int) -> int:
    """규칙 기반 대체 로직의 방문 시각 — 09시부터 두 시간 간격, 21시에서 멈춥니다."""
    return min(9 + 2 * index, 21)


def _fallback_congestion_key(a: Attraction) -> float:
    """
    붐비는 곳일수록 작은 값 — 이른 시간대를 먼저 배정하기 위한 정렬 키입니다.

    집중률 숫자가 있으면 그 값을 쓰고, 없으면 날짜별 예보의 등급을 숫자로 바꿔
    대신 씁니다. 둘 다 없으면 중간값(50)으로 둬서, 정보가 있는 곳들 사이에
    끼어들어 순서를 흔들지 않게 합니다.
    """
    if a.congestion_rate is not None:
        return -a.congestion_rate
    if a.congestion_forecast:
        levels = {"low": 20.0, "medium": 50.0, "high": 85.0}
        rates = [levels.get(c.congestion_level, 50.0) for c in a.congestion_forecast]
        return -(sum(rates) / len(rates))
    return -50.0


def _mock_generate(
    request: CourseRequest, candidates: list[Attraction], parsed: ParsedQuery | None = None
) -> dict:
    """
    GROQ_API_KEY 미설정 또는 한도 초과 시 사용하는 규칙 기반 대체 로직.

    혼잡도를 실제로 반영합니다 — 붐비는 곳일수록 사람이 몰리기 전인 이른 시간에
    배정하고, 한산한 곳을 한낮으로 미룹니다. 혼잡도 정보가 없는 곳끼리는 원래
    순서를 그대로 유지합니다(파이썬 정렬은 안정 정렬이라 동점이면 입력 순서 유지).
    """
    ordered = sorted(candidates[: request.max_stops], key=_fallback_congestion_key)

    stops = []
    for i, a in enumerate(ordered, start=1):
        hour = _fallback_hour(i - 1)
        if a.congestion_rate is not None and a.congestion_rate >= _CROWDED_RATE:
            reason = (
                f"{a.name}은(는) 평소 사람이 많이 몰리는 곳이라, 비교적 한산한 "
                f"{hour}시로 배치했습니다."
            )
        elif a.congestion_rate is not None:
            reason = (
                f"{a.name}은(는) 혼잡도가 높지 않은 편이라 {hour}시에 여유롭게 "
                "둘러보실 수 있습니다."
            )
        else:
            reason = f"{a.name}은(는) 요청하신 접근성 조건에 맞는 장소입니다."
        stops.append(
            {
                "content_id": a.content_id,
                "order": i,
                "recommended_arrival_time": f"{hour:02d}:00",
                "reason": reason,
            }
        )

    conditions = _conditions_payload(parsed)
    condition_text = ""
    if conditions.get("companion"):
        condition_text += f" {conditions['companion']} 동반"
    if conditions.get("purposes"):
        condition_text += f" {'·'.join(conditions['purposes'])} 중심"
    region_label = conditions.get("region") or request.region

    return {
        "title": f"{region_label} 무장애 여행 코스",
        "summary": (
            f"'{request.query_text}' 요청에 맞춰{condition_text} 구성한 {len(stops)}곳 코스입니다."
            if condition_text
            else f"'{request.query_text}' 요청에 맞춰 구성한 {len(stops)}곳 코스입니다."
        ),
        "stops": stops,
    }


class GroqRateLimitedError(Exception):
    """Groq API가 요청 한도에 걸렸을 때 발생시켜서, 호출한 쪽이 규칙 기반
    대체 로직으로 넘어갈 수 있게 신호를 줍니다.

    한도는 두 가지 형태로 옵니다.
    - 429: 순간적으로 요청이 몰렸을 때. 잠깐 기다리면 풀리는 경우가 많습니다.
    - 413: 이번 요청 하나가 분당 토큰 한도(TPM)보다 커서 아예 못 받는 경우.
      기다린다고 풀리지 않으니 재시도 없이 바로 대체 로직으로 넘깁니다.
    """


async def _groq_call(system_prompt: str, user_prompt: str) -> dict:
    payload = {
        "model": settings.groq_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        # JSON 형식으로만 응답하도록 강제 (Groq의 OpenAI 호환 구조화된 출력 기능)
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
    }
    headers = {"Authorization": f"Bearer {settings.groq_api_key}"}

    # Groq 무료 티어는 순간적으로 요청이 몰리면 429가 나는데, 잠깐 기다리면
    # 풀리는 경우가 많아서 최대 2번까지 짧게 재시도합니다. 그래도 안 되면
    # GroqRateLimitedError를 던져서, 호출한 쪽이 규칙 기반 대체 로직으로
    # 자연스럽게 넘어가게 합니다 (사용자는 500 에러 대신 결과를 받습니다).
    #
    # 413(Payload Too Large)도 같은 대체 로직으로 넘깁니다. 프롬프트가 커서
    # 이번 요청 하나가 분당 토큰 한도를 통째로 넘긴 경우인데, 예전에는 이걸
    # 처리하지 않아 raise_for_status()에서 그대로 터지면서 500이 됐습니다
    # (후보가 많은 지역 — 예: 수원시 팔달구/성남시 분당구 — 을 고르면 AI
    # 플래너가 "장소 추천 실패"로 끝나던 원인). 재시도해도 같은 크기라 똑같이
    # 실패하므로 기다리지 않고 바로 넘깁니다.
    max_retries = 2
    for attempt in range(max_retries + 1):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(GROQ_ENDPOINT, headers=headers, json=payload)
        if resp.status_code == 413:
            raise GroqRateLimitedError(
                "Groq API 요청이 분당 토큰 한도보다 큽니다(413) — 프롬프트 길이 초과"
            )
        if resp.status_code == 429:
            if attempt < max_retries:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            raise GroqRateLimitedError("Groq API 요청 한도(429) 초과")
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        return json.loads(text)

    raise GroqRateLimitedError("Groq API 요청 한도(429) 초과")


async def _groq_generate(
    request: CourseRequest, candidates: list[Attraction], parsed: ParsedQuery | None = None
) -> dict:
    return await _groq_call(SYSTEM_PROMPT, _build_user_prompt(request, candidates, parsed))


def _stops_from_raw(raw: dict, candidates: list[Attraction]) -> list[CourseStop]:
    by_id = {a.content_id: a for a in candidates}
    stops = []
    for s in raw["stops"]:
        attraction = by_id.get(s["content_id"])
        if not attraction:
            continue
        stops.append(
            CourseStop(
                order=s["order"],
                attraction=attraction,
                recommended_arrival_time=s["recommended_arrival_time"],
                reason=s["reason"],
            )
        )
    return sorted(stops, key=lambda s: s.order)


async def generate_course(
    request: CourseRequest, candidates: list[Attraction], parsed: ParsedQuery | None = None
) -> CourseResponse:
    if not candidates:
        raise ValueError("추천할 수 있는 무장애 관광지 후보가 없습니다.")

    if settings.groq_api_key:
        try:
            raw = await _groq_generate(request, candidates, parsed)
        except GroqRateLimitedError:
            logger.warning("Groq 요청 한도 초과 — 규칙 기반 대체 로직으로 코스를 생성합니다.")
            raw = _mock_generate(request, candidates, parsed)
    else:
        raw = _mock_generate(request, candidates, parsed)

    return CourseResponse(
        course_id=str(uuid.uuid4()),
        title=raw["title"],
        summary=raw["summary"],
        stops=_stops_from_raw(raw, candidates),
        generated_for=request.user_type,
    )


def _mock_recommend(
    request: PlaceRecommendationRequest,
    candidates: list[Attraction],
    parsed: ParsedQuery | None = None,
) -> list[dict]:
    """
    GROQ_API_KEY 미설정 또는 한도 초과 시 사용하는 규칙 기반 대체 로직.

    질의 원문뿐 아니라 파싱된 목적/키워드도 함께 맞춰봅니다 — AI가 없을 때도
    "맛집"이라고 쓴 질의에 음식점이 앞으로 오도록 하기 위해서입니다.
    """
    keywords = [w for w in request.query_text.replace(",", " ").split() if len(w) >= 2]
    if parsed:
        keywords += [p.value for p in parsed.purposes] + list(parsed.keywords)

    def score(a: Attraction) -> int:
        haystack = f"{a.name} {a.category} {a.address}"
        return sum(1 for k in keywords if k in haystack)

    ranked = sorted(candidates, key=score, reverse=True)
    top = ranked[:12] if any(score(a) > 0 for a in ranked) else candidates[:12]
    return [
        {"content_id": a.content_id, "reason": f"'{request.query_text}' 요청과 관련된 {a.category} 장소입니다."}
        for a in top
    ]


async def _groq_recommend(
    request: PlaceRecommendationRequest,
    candidates: list[Attraction],
    parsed: ParsedQuery | None = None,
) -> list[dict]:
    payload = {
        "query_text": request.query_text,
        "user_type": request.user_type,
        "region": request.region,
        "candidates": [
            {
                "content_id": a.content_id,
                "name": a.name,
                "category": a.category,
                "accessibility": _relevant_accessibility_payload(
                    a.accessibility.model_dump(), request.user_type
                ),
                # 1단계는 후보가 25곳까지 실려서 프롬프트가 큽니다. 날짜별 예보는
                # 빼고 집중률 숫자 하나만 넣습니다(장소 고르기엔 이걸로 충분).
                **_congestion_payload(a, include_forecast=False),
            }
            for a in candidates
        ],
    }
    conditions = _conditions_payload(parsed)
    if conditions:
        payload["conditions"] = conditions

    raw = await _groq_call(RECOMMEND_SYSTEM_PROMPT, json.dumps(payload, ensure_ascii=False))
    return raw["selected"]


async def recommend_places(
    request: PlaceRecommendationRequest,
    candidates: list[Attraction],
    parsed: ParsedQuery | None = None,
) -> list[PlaceCandidate]:
    """
    1단계: 질의에 맞는 장소 후보를 넓게 추천 (코스 순서/시간은 아직 정하지 않음).
    사용자가 이 목록 중에서 실제로 갈 곳을 골라야 2단계(generate_course_from_selection)로 넘어갑니다.

    parsed(질의에서 뽑아낸 지역/동행자/목적)를 주면 그 조건까지 프롬프트에 실립니다.
    parse_query()는 라우터가 먼저 부르고 결과를 여기로 넘겨줍니다 — 이 함수 안에서
    부르면 한 요청에 AI 호출이 두 번 일어나기 때문입니다.
    """
    if not candidates:
        raise ValueError("추천할 수 있는 무장애 관광지 후보가 없습니다.")

    if settings.groq_api_key:
        try:
            selected = await _groq_recommend(request, candidates, parsed)
        except GroqRateLimitedError:
            logger.warning("Groq 요청 한도 초과 — 규칙 기반 대체 로직으로 장소를 추천합니다.")
            selected = _mock_recommend(request, candidates, parsed)
    else:
        selected = _mock_recommend(request, candidates, parsed)

    by_id = {a.content_id: a for a in candidates}
    result = []
    for item in selected:
        attraction = by_id.get(item.get("content_id"))
        if not attraction:
            continue
        result.append(PlaceCandidate(attraction=attraction, reason=item.get("reason", "")))
    return result


async def generate_course_from_selection(
    request: GenerateFromSelectionRequest,
    selected_attractions: list[Attraction],
    parsed: ParsedQuery | None = None,
) -> CourseResponse:
    """
    2단계: 사용자가 1단계 추천 목록에서 직접 고른 장소들로만 코스를 구성합니다.
    AI는 이 장소들을 빼거나 새로 추가하지 않고, 방문 순서와 추천 시간대만 정합니다.

    selected_attractions에는 라우터가 미리 혼잡도 예보를 채워서 넘겨줍니다
    (tour_api.fill_congestion_forecasts) — 그래야 AI가 붐비는 곳을 한산한
    시간대로 옮겨 배치할 수 있습니다.
    """
    if not selected_attractions:
        raise ValueError("선택된 관광지가 없습니다.")

    course_request = CourseRequest(
        query_text=request.query_text,
        user_type=request.user_type,
        region=request.region,
        max_stops=len(selected_attractions),
    )

    if settings.groq_api_key:
        try:
            raw = await _groq_call(
                ORDER_SYSTEM_PROMPT,
                _build_user_prompt(course_request, selected_attractions, parsed),
            )
        except GroqRateLimitedError:
            logger.warning("Groq 요청 한도 초과 — 규칙 기반 대체 로직으로 순서를 정합니다.")
            raw = _mock_generate(course_request, selected_attractions, parsed)
    else:
        raw = _mock_generate(course_request, selected_attractions, parsed)

    return CourseResponse(
        course_id=str(uuid.uuid4()),
        title=raw["title"],
        summary=raw["summary"],
        stops=_stops_from_raw(raw, selected_attractions),
        generated_for=request.user_type,
    )
