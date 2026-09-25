"""
만들어진 코스를 요청 조건과 대조해 어긋나는 곳에 경고를 붙입니다.

AI에게도 "짧은 동선이면 가까운 곳끼리", "디저트 카페를 식사 장소로 설명하지 말 것",
"없는 편의시설을 근거로 들지 말 것"을 요청하지만 지켜진다는 보장이 없습니다. 여기서는
코스를 다시 만들지 않고, 확인할 수 있는 사실(좌표·메뉴·편의시설·도착 시각)로 검사해
그대로 경고로 보여줍니다 — 사용자가 결과를 보자마자 무엇이 어긋나는지 알 수 있게요.

검사는 결정적이고 가벼워서, 코스를 처음 만들 때뿐 아니라 저장된 코스를 다시 읽거나
순서를 바꿀 때도 똑같이 돌립니다 (순서가 바뀌면 거리·식사 시간대도 바뀌기 때문입니다).
"""

import re
from typing import Iterable

from app.models.schemas import AccessibilityFeatures, Attraction, CourseResponse, CourseStop
from app.services.accessibility_criteria import has_any_relevant
from app.services.place_intent import MEAL, MEAL_UNKNOWN, NOT_MEAL, meal_status
from app.services.schedule import meal_window_at, straight_distance_km

# '짧은 동선' 요청으로 보는 표현 (공백을 지운 문장에서 찾습니다).
# '근처'는 '공원 근처 식당'처럼 장소 위치를 말할 때가 많아서 넣지 않았습니다.
_SHORT_ROUTE_TERMS = (
    "짧은동선", "동선짧", "동선이짧", "동선을짧", "동선최소", "이동적", "이동이적", "이동짧",
    "이동이짧", "이동을짧", "이동거리짧", "이동최소", "적게걷", "걷기적", "덜걷", "조금만걷",
    "많이안걷", "한동네", "근거리", "멀지않", "가까운곳끼리", "가까운곳위주", "가깝게",
)

# 짧은 동선 요청일 때 한 구간으로 받아들일 수 있는 최대 직선거리(km).
# 도로로는 대략 3km / 2km에 해당합니다(직선거리 × 우회 계수 1.3). 화면에 보여주는
# 거리를 직선거리로 통일해야 지도 화면의 실제 경로 거리와 또 다른 숫자가 생기지 않습니다.
_SHORT_ROUTE_LIMIT_KM = 2.3
# 휠체어·유모차는 같은 거리도 부담이 훨씬 커서 기준을 더 좁힙니다.
_SHORT_ROUTE_LIMIT_KM_MOBILITY = 1.5
_MOBILITY_USER_TYPES = ("wheelchair", "stroller")

# 사용자 유형과 관련된 편의시설이 하나도 등록되지 않은 곳에 붙이는 경고.
# 어떤 항목이 '관련 있는지'는 접근성 탭과 같은 기준(accessibility_criteria)을 씁니다.
_MISSING_FACILITY_WARNINGS: dict[str, str] = {
    "wheelchair": "경사로·장애인 화장실 등 휠체어 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    "stroller": "유모차 이동 동선·수유실 등 영유아 동반 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    "senior": "경사로·엘리베이터·장애인 화장실 정보가 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    "pregnant": "수유실·임산부 주차구역 등 임산부 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    "visual": "시각장애인 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    "hearing": "청각장애인 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
}

_ROUTE_UNVERIFIED_WARNING = (
    "장소 사이 이동 경로(보도·횡단보도·경사)의 무장애 여부는 확인되지 않았어요. "
    "이동 전 지도에서 실제 경로를 확인해 주세요."
)
_NO_ACCESSIBLE_RESTROOM_WARNING = "코스 안에 장애인 화장실이 확인된 장소가 없어요."
_DRINK_PLACE_AT_MEAL_WARNING = (
    "음료·디저트 위주 가게로 보여 {meal} 식사는 어려울 수 있어요. 식사할 곳을 따로 확인해 주세요."
)
_CONSECUTIVE_FOOD_WARNING = (
    "앞 장소도 음식점이라 식당이 연달아 있어요. 한 곳은 빼거나 다른 날로 나누는 걸 고려해 주세요."
)
_MEAL_OUTSIDE_WINDOW_WARNING = (
    "식사 시간대(점심 11~14시, 저녁 17~20시)가 아닐 때 도착해요. 가볍게 들르거나 순서를 바꿔 보세요."
)
_UNKNOWN_MEAL_AT_MEAL_WARNING = (
    "등록된 정보로는 {meal} 식사가 가능한지 확인하지 못했어요. 방문 전 메뉴를 확인해 주세요."
)

# 추천 이유에서 걸러낼 표현들 --------------------------------------------------

# 등록되지 않았는데 근거로 들면 안 되는 편의시설 (단어, 확인할 필드들).
_FACILITY_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("경사로", ("has_ramp",)),
    ("엘리베이터", ("has_elevator",)),
    ("승강기", ("has_elevator",)),
    ("휠체어 대여", ("has_wheelchair_rental",)),
    ("장애인 화장실", ("has_accessible_restroom",)),
    ("장애인화장실", ("has_accessible_restroom",)),
    ("점자블록", ("has_braille_block",)),
    ("수어", ("has_sign_guide",)),
    ("수화", ("has_sign_guide",)),
    ("수유실", ("has_lactation_room",)),
    ("휴게 공간", ("has_rest_area",)),
    ("휴게공간", ("has_rest_area",)),
    ("기저귀", ("has_diaper_station",)),
    ("저상버스", ("has_low_floor_bus",)),
    ("관람석", ("has_accessible_seating",)),
)

# 부가정보(detailIntro)로만 확인할 수 있는 주장 — (표현, 뒷받침하는 부가정보 라벨,
# 뒷받침하는 편의시설 필드). AI는 이 정보를 받지 못한 채 "좌석 수가 충분해"처럼
# 지어내곤 해서, 근거가 실제로 있을 때만 남깁니다.
_EXTRA_INFO_CLAIMS: tuple[tuple[re.Pattern, tuple[str, ...], tuple[str, ...]], ...] = (
    (re.compile(r"좌석"), ("좌석 수",), ()),
    (re.compile(r"주차"), ("주차시설", "주차요금", "주차 요금"), ("has_parking",)),
    (re.compile(r"놀이방|키즈\s*(존|룸|카페|공간)"), ("어린이 놀이방 여부",), ()),
    (re.compile(r"포장\s*(이|도)?\s*(가능|돼|되|주문|판매)|테이크\s*아웃"), ("포장 가능 여부",), ()),
    (re.compile(r"예약"), ("예약 안내", "예약 전화", "예약 홈페이지"), ()),
)
# 부가정보 값이 이렇게만 적혀 있으면 '있다'는 근거로 보지 않습니다.
_EMPTY_INFO_VALUES = {"없음", "불가", "불가능", "x", "-", "미운영"}

# 장소 '안'의 시설이 아니라 장소 '사이' 경로가 무장애라고 단정하는 표현.
# 데이터에는 장소 사이 경로 정보가 없어서 이런 문장은 근거 없는 안전 보장이 됩니다.
#
# 두 가지가 함께 있을 때만 경로 단정으로 봅니다: (1) 장소 '사이'를 가리키는 말과
# (2) 편하다·안전하다는 주장. 예전에는 (2)만 봐서 "휠체어 이동에 필요한 경사로가
# 있어요"처럼 장소 안의 편의시설 설명까지 지워져 기본 문구만 남았습니다.
_BETWEEN_PLACES = re.compile(
    r"다음\s*(장소|코스|목적지|방문지|일정)|장소\s*(사이|간|끼리)|목적지\s*(사이|간|까지)|"
    r"이동\s*경로|코스\s*(전체|전반|내내)|전\s*구간|구간|오가는|오가기|오가며|오갈|"
    r"이어지는\s*(길|동선|경로)|(으로|로)\s*이어져|까지\s*(가는|가기|이동|걸어|이어|연결)|"
    r"보도|횡단보도|주변\s*(길|도로)"
)
_EASE_CLAIM = re.compile(
    r"편하|편리|편안|쉽|쉬운|쉬워|안전|무리\s*없|수월|평탄|완만|무난|무장애|턱\s*(이\s*)?없|"
    r"계단\s*(이\s*)?없|문제\s*없|어려움\s*없|막힘\s*없"
)
# 이런 말이 함께 있으면 장소 안의 동선 이야기로 보고 경로 단정으로 치지 않습니다.
_INSIDE_PLACE_HINTS = ("내부", "안에서", "안에", "시설 내", "관내", "경내", "실내")

_MEAL_WORDS = ("점심", "저녁", "아침 식사", "식사", "끼니", "밥", "한 끼", "배를 채")

# 다른 장소와의 순서를 전제로 한 표현. AI가 이유를 쓴 뒤에 시스템이 식사 시간에 맞춰
# 순서를 옮기므로(schedule.arrange_for_meals), 실제 순서와 맞는지 다시 확인합니다.
_MEAL_REF = r"(점심|저녁|식사|밥)"
_AFTER_MEAL = re.compile(
    _MEAL_REF + r"\s*(을|를)?\s*(먹은\s*(후|뒤|다음)|먹고|든든히\s*먹고|마치고|하고|한\s*(후|뒤|다음)|후|뒤|다음)"
)
_BEFORE_MEAL = re.compile(_MEAL_REF + r"\s*(을|를)?\s*(먹기\s*)?(시간\s*)?전")
_LAST_STOP = re.compile(r"마지막(으로|\s*(코스|장소|일정|방문지|순서))|코스를\s*마무리|하루를\s*마무리")
_FIRST_STOP = re.compile(r"첫\s*(번째\s*)?(코스|장소|일정|방문지|순서)|처음으로\s*(들르|방문)|하루를\s*시작")
# 코스 안에서의 위치를 말하는 표현. "앞쪽에 배치해"라고 써 놓고 실제로는 2번째에
# 오는 식으로 어긋나지 않도록, 실제 위치가 앞쪽(뒤쪽)일 때만 남깁니다.
_FRONT_CLAIM = re.compile(
    r"앞쪽|앞\s*순서|앞부분|초반|가장\s*먼저|먼저\s*(들르|들러|방문|둘러|배치|가|찾)|"
    r"이른\s*시간|일찍\s*(들르|들러|방문|배치|가)|오전\s*일찍"
)
_BACK_CLAIM = re.compile(
    r"뒤쪽|뒷부분|뒤\s*순서|후반|나중에\s*(들르|들러|방문|배치|가)|늦은\s*시간|오후\s*늦게"
)

# 혼잡도 주장. 화면에 표시되는 등급(congestion_level)과 맞을 때만 남깁니다.
# '붐비지 않아'가 '붐비'에 걸리지 않도록 한산 쪽 표현을 먼저 지우고 붐빔 표현을 찾습니다.
# '덜 몰리도록'은 붐비는 곳을 피하려는 말이라 붐빔 쪽으로 봅니다.
_CALM_STRONG_CLAIM = re.compile(r"한산|사람이\s*(적|많지\s*않)")
_CALM_WEAK_CLAIM = re.compile(
    r"(붐비|몰리)지\s*않|혼잡하지\s*않|혼잡도(가|는)?\s*(낮|높지\s*않)"
)
_CROWD_CLAIM = re.compile(
    r"몰리|몰려|붐비|붐빌|붐벼|북적|인파|사람이\s*많|혼잡(?!도)|혼잡도(가|는)?\s*(높|큰)"
)
_LEVEL_RANK = {"low": 0, "medium": 1, "high": 2}
# 집중률(0~100)을 등급으로 나누는 경계. tour_api가 예보 등급을 나눌 때, 앱이
# 혼잡도를 표시할 때와 같은 값입니다 (mobile/constants/congestion.ts).
_CONGESTION_MEDIUM_RATE = 34.0
_CONGESTION_HIGH_RATE = 66.0

_RAW_FIELD_TOKENS = ("has_", "_count", "true", "false")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def congestion_level(place: Attraction, visit_date: str | None = None) -> str | None:
    """
    앱에 표시되는 혼잡도 등급 — 앱의 getCongestionDisplay와 같은 순서로 고릅니다.

    1. 방문일을 알고 그날 예보가 있으면 그 예보 (하루에 여러 줄이면 가장 붐비는 값)
    2. 방문일을 모르면 예보의 첫 줄
    3. 집중률 숫자
    방문일을 아는데 그날 예보도 집중률도 없으면 다른 날 예보를 쓰지 않고 None입니다.
    """
    forecast = place.congestion_forecast or []
    if visit_date:
        levels = [c.congestion_level for c in forecast
                  if c.date == visit_date and c.congestion_level in _LEVEL_RANK]
        if levels:
            return max(levels, key=_LEVEL_RANK.__getitem__)
    elif forecast and forecast[0].congestion_level in _LEVEL_RANK:
        return forecast[0].congestion_level
    if place.congestion_rate is not None:
        rate = place.congestion_rate
        if rate >= _CONGESTION_HIGH_RATE:
            return "high"
        return "medium" if rate >= _CONGESTION_MEDIUM_RATE else "low"
    return None


def fits_congestion(sentence: str, level: str | None) -> bool:
    """문장의 혼잡도 주장이 표시 등급과 맞는지. 주장이 없으면 True."""
    if _CALM_STRONG_CLAIM.search(sentence) and level != "low":
        return False
    if _CALM_WEAK_CLAIM.search(sentence) and level not in ("low", "medium"):
        return False
    rest = _CALM_WEAK_CLAIM.sub(" ", _CALM_STRONG_CLAIM.sub(" ", sentence))
    if _CROWD_CLAIM.search(rest) and level != "high":
        return False
    return True


def prefers_short_route(query_text: str | None) -> bool:
    """질의가 장소 사이 이동을 줄여 달라는 요청인지."""
    compact = re.sub(r"\s+", "", query_text or "")
    return any(term in compact for term in _SHORT_ROUTE_TERMS)


def short_route_limit_km(user_type: str) -> float:
    return _SHORT_ROUTE_LIMIT_KM_MOBILITY if user_type in _MOBILITY_USER_TYPES else _SHORT_ROUTE_LIMIT_KM


def _has_any(features: AccessibilityFeatures, fields: Iterable[str]) -> bool:
    return any(bool(getattr(features, name, False)) for name in fields)


def _unbacked_extra_claim(sentence: str, place: Attraction) -> bool:
    """좌석·주차·놀이방·포장·예약을 말하는데 그 정보가 등록돼 있지 않은지."""
    labels = {
        field.label for field in place.extra_info
        if field.value and field.value.strip().lower() not in _EMPTY_INFO_VALUES
    }
    return any(
        pattern.search(sentence) and not labels.intersection(info_labels)
        and not _has_any(place.accessibility, features)
        for pattern, info_labels, features in _EXTRA_INFO_CLAIMS
    )


def _is_route_claim(sentence: str) -> bool:
    if any(hint in sentence for hint in _INSIDE_PLACE_HINTS):
        return False
    return bool(_BETWEEN_PLACES.search(sentence) and _EASE_CLAIM.search(sentence))


# 설명이 모두 걸러졌을 때 대신 쓸, 사용자 유형별로 보여줄 편의시설과 이름.
_FACILITY_LABELS: dict[str, str] = {
    "has_ramp": "경사로", "has_elevator": "엘리베이터", "has_accessible_restroom": "장애인 화장실",
    "has_wheelchair_rental": "휠체어 대여", "has_stroller_accessible_path": "유모차 이동 동선",
    "has_rest_area": "휴게 공간", "has_lactation_room": "수유실", "has_baby_spare_chair": "유아용 보조의자",
    "has_braille_block": "점자블록", "has_audio_guide": "오디오 가이드", "has_guide_human": "안내요원",
    "has_help_dog": "보조견 동반", "has_big_print": "큰 활자 안내물", "has_guide_system": "유도 안내설비",
    "has_braille_promotion": "점자 안내물", "has_sign_guide": "수어 안내", "has_video_guide": "자막 영상 안내",
    "has_hearing_room": "청각장애인용 객실", "has_parking": "장애인 주차구역", "has_exit": "턱 없는 출입구",
    "has_accessible_room": "장애인 객실", "has_accessible_seating": "장애인 관람석",
    "has_low_floor_bus": "저상버스", "has_seated_table": "의자식 테이블", "has_diaper_station": "기저귀 교환대",
    "has_pregnant_parking": "임산부 주차구역", "has_emergency_bell": "비상벨", "has_hearing_etc": "청각장애인 안내 설비",
}
_FACILITY_ORDER_BY_USER_TYPE: dict[str, tuple[str, ...]] = {
    "wheelchair": ("has_ramp", "has_elevator", "has_accessible_restroom", "has_wheelchair_rental",
                   "has_accessible_room", "has_accessible_seating", "has_seated_table"),
    "stroller": ("has_stroller_accessible_path", "has_lactation_room", "has_diaper_station",
                 "has_baby_spare_chair", "has_elevator"),
    "senior": ("has_ramp", "has_elevator", "has_accessible_restroom", "has_rest_area",
               "has_low_floor_bus", "has_emergency_bell"),
    "pregnant": ("has_lactation_room", "has_pregnant_parking", "has_diaper_station",
                 "has_elevator", "has_accessible_restroom"),
    "visual": ("has_braille_block", "has_audio_guide", "has_guide_human", "has_help_dog",
               "has_guide_system", "has_big_print", "has_braille_promotion"),
    "hearing": ("has_sign_guide", "has_video_guide", "has_hearing_room", "has_hearing_etc"),
    "general": ("has_ramp", "has_elevator", "has_accessible_restroom", "has_stroller_accessible_path",
                "has_rest_area"),
}


def copula(word: str) -> str:
    """'관광지예요' / '음식점이에요' — 받침 유무로 서술격 조사를 고릅니다."""
    last = word[-1] if word else ""
    has_final = "가" <= last <= "힣" and (ord(last) - ord("가")) % 28 != 0
    return f"{word}이에요" if has_final else f"{word}예요"


def facility_reason(place: Attraction, user_type: str) -> str | None:
    """등록된 편의시설로 만든 설명. 보여줄 시설이 없으면 None."""
    order = _FACILITY_ORDER_BY_USER_TYPE.get(user_type, _FACILITY_ORDER_BY_USER_TYPE["general"])
    labels = [_FACILITY_LABELS[f] for f in order if getattr(place.accessibility, f, False)][:3]
    if not labels:
        return None
    return f"{'·'.join(labels)} 정보가 등록된 {copula(place.category or '장소')}."


_LEVEL_LABELS = {"low": "여유", "medium": "보통", "high": "혼잡"}


def describe_place(
    place: Attraction, user_type: str, visit_date: str | None = None, lead: str | None = None
) -> str:
    """
    AI가 쓴 이유가 없을 때 등록된 데이터만으로 만드는 설명.

    "요청하신 산책로 장소예요" 같은 기본 문구 대신, 사용자 유형에 맞는 편의시설,
    음식점이면 대표 메뉴, 화면에 표시되는 혼잡도 등급을 이어 씁니다. 모두 화면에서
    확인할 수 있는 정보라 검증에서 지워지지 않습니다.
    lead는 맨 앞에 둘 문장입니다 (예: "산책로 요청에 맞는 관광지예요.").
    """
    sentences = [lead] if lead else []
    order = _FACILITY_ORDER_BY_USER_TYPE.get(user_type, _FACILITY_ORDER_BY_USER_TYPE["general"])
    labels = [_FACILITY_LABELS[f] for f in order if getattr(place.accessibility, f, False)][:3]
    if labels:
        sentences.append(f"{'·'.join(labels)} 정보가 등록돼 있어요.")
    if place.category == "음식점":
        menu = next((f.value for f in place.extra_info if f.label == "대표 메뉴" and f.value), None)
        if menu:
            items = [item.strip() for item in re.split(r"[,/·]", menu) if item.strip()][:2]
            if items:
                sentences.append(f"대표 메뉴는 {copula(', '.join(items))}.")
    level = congestion_level(place, visit_date)
    if level:
        label = _LEVEL_LABELS[level]
        sentences.append(f"혼잡도는 '{label}'{'으로' if label == '혼잡' else '로'} 표시돼요.")
    if not sentences:
        sentences.append(f"요청하신 조건에 맞춰 고른 {copula(place.category or '장소')}.")
    return " ".join(dict.fromkeys(sentences))


def clean_reason(
    reason: object, place: Attraction, fallback: str | None = None, user_type: str = "general"
) -> str:
    """
    추천 이유에서 확인할 수 없는 주장이 담긴 문장만 덜어냅니다.

    - 등록되지 않은 편의시설을 근거로 든 문장
    - 장소 사이 이동 경로가 무장애·안전하다고 단정하는 문장
    - 식사할 수 없는 가게(음료·디저트 위주)를 식사 장소로 설명하는 문장
    - 필드명·원시값이 그대로 드러난 문장

    남는 문장이 없으면 fallback을, 그것도 없으면 등록된 편의시설로 만든 설명을 씁니다.
    """
    features = place.accessibility
    status = meal_status(place) if place.category == "음식점" else MEAL
    # 식사가 확인되지 않은 곳(음료 가게·확인 불가)은 식사 장소로 설명하지 않습니다.
    meal_ok = status == MEAL
    text = reason.strip() if isinstance(reason, str) else ""

    kept: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if any(word in sentence and not _has_any(features, fields) for word, fields in _FACILITY_WORDS):
            continue
        if any(token in sentence for token in _RAW_FIELD_TOKENS):
            continue
        if _unbacked_extra_claim(sentence, place):
            continue
        if _is_route_claim(sentence):
            continue
        if not meal_ok and any(word in sentence for word in _MEAL_WORDS):
            continue
        kept.append(sentence)

    if kept:
        return " ".join(kept)[:200]
    if fallback is not None:
        return fallback
    if status == NOT_MEAL:
        return "음료나 디저트를 즐기며 쉬어 가기 좋은 곳이에요."
    facilities = facility_reason(place, user_type)
    if facilities:
        return facilities
    if status == MEAL_UNKNOWN:
        return "요청하신 조건에 맞춰 고른 음식점이에요."
    return f"요청하신 조건에 맞춰 고른 {copula(place.category or '장소')}."


def _meal_stop_indices(stops: list[CourseStop]) -> dict[str, list[int]]:
    """식사 시간대에 배치된 식사 장소의 위치 — {"점심": [2], "저녁": [...], "식사": [모두]}."""
    found: dict[str, list[int]] = {"점심": [], "저녁": [], "식사": []}
    for index, stop in enumerate(stops):
        # 확인 불가인 곳도 식사 자리에 놓였다면 '점심 후' 같은 표현의 기준이 됩니다.
        if stop.attraction.category != "음식점" or meal_status(stop.attraction) == NOT_MEAL:
            continue
        found["식사"].append(index)
        meal = meal_window_at(stop.recommended_arrival_time)
        if meal in found:
            found[meal].append(index)
    return found


def _fits_order(sentence: str, index: int, total: int, meal_indices: dict[str, list[int]]) -> bool:
    """문장이 전제한 순서(점심 후/전, 마지막, 첫 장소)가 실제 위치와 맞는지."""
    for pattern, after in ((_AFTER_MEAL, True), (_BEFORE_MEAL, False)):
        for match in pattern.finditer(sentence):
            meal = match.group(1)
            positions = meal_indices["식사" if meal in ("식사", "밥") else meal]
            if after and not any(p <= index for p in positions):
                return False
            if not after and not any(p > index for p in positions):
                return False
    if _LAST_STOP.search(sentence) and index != total - 1:
        return False
    if _FIRST_STOP.search(sentence) and index != 0:
        return False
    # 세 곳 이하면 첫(마지막) 장소만, 네 곳 이상이면 앞(뒤) 절반을 앞쪽(뒤쪽)으로 봅니다.
    edge = 1 if total <= 3 else total // 2
    if _FRONT_CLAIM.search(sentence) and index >= edge:
        return False
    if _BACK_CLAIM.search(sentence) and index < total - edge:
        return False
    return True


def _order_consistent_reason(
    reason: str, place: Attraction, index: int, total: int, meal_indices: dict[str, list[int]],
    user_type: str, level: str | None = None,
) -> str:
    kept = [
        sentence.strip() for sentence in _SENTENCE_SPLIT.split(reason)
        if sentence.strip() and _fits_order(sentence, index, total, meal_indices)
        and fits_congestion(sentence, level)
    ]
    return " ".join(kept) if kept else clean_reason("", place, user_type=user_type)


def _is_food(stop: CourseStop) -> bool:
    return stop.attraction.category == "음식점"


def validate_course_stops(
    stops: list[CourseStop], user_type: str, query_text: str | None,
    visit_date: str | None = None,
) -> list[str]:
    """
    코스의 각 장소에 거리·경고를 채우고 추천 이유를 정리합니다 (stops를 직접 고칩니다).
    코스 전체에 대한 경고 목록을 돌려줍니다.

    같은 코스에 여러 번 돌려도 결과가 같습니다 — 경고는 매번 새로 계산하고,
    추천 이유 정리는 이미 정리된 문장을 다시 바꾸지 않습니다.

    visit_date를 주면 그날 기준으로 혼잡도 등급을 다시 매깁니다. 없으면(저장된 코스를
    다시 읽을 때) 처음 만들 때 매긴 등급을 그대로 씁니다.
    """
    short_route = prefers_short_route(query_text)
    limit_km = short_route_limit_km(user_type)
    missing_facility_warning = _MISSING_FACILITY_WARNINGS.get(user_type)

    meal_indices = _meal_stop_indices(stops)

    for index, stop in enumerate(stops):
        place = stop.attraction
        warnings: list[str] = []

        distance = straight_distance_km(stops[index - 1].attraction, place) if index > 0 else None
        stop.distance_from_prev_km = round(distance, 1) if distance is not None else None
        if short_route and distance is not None and distance > limit_km:
            warnings.append(
                f"앞 장소와 직선거리로 약 {distance:.1f}km 떨어져 있어 "
                f"'짧은 동선' 요청(직선 {limit_km:g}km 이내)과 맞지 않아요."
            )

        if place.category == "음식점":
            status = meal_status(place)
            meal = meal_window_at(stop.recommended_arrival_time)
            # 아침(07~09시)은 하루 시작(09:00)과 겹쳐서, 첫 장소로 들른 카페마다 '아침
            # 식사는 어려워요'가 붙습니다. 코스는 아침을 식사 자리로 잡지 않으므로 뺍니다.
            if meal in ("점심", "저녁") and status == NOT_MEAL:
                warnings.append(_DRINK_PLACE_AT_MEAL_WARNING.format(meal=meal))
            elif meal in ("점심", "저녁") and status == MEAL_UNKNOWN:
                warnings.append(_UNKNOWN_MEAL_AT_MEAL_WARNING.format(meal=meal))

        if missing_facility_warning and not has_any_relevant(place, user_type):
            warnings.append(missing_facility_warning)

        if index > 0 and _is_food(stop) and _is_food(stops[index - 1]):
            warnings.append(_CONSECUTIVE_FOOD_WARNING)
        elif (
            _is_food(stop) and meal_status(place) == MEAL
            and meal_window_at(stop.recommended_arrival_time) is None
        ):
            warnings.append(_MEAL_OUTSIDE_WINDOW_WARNING)

        stop.warnings = warnings
        if visit_date or stop.congestion_level is None:
            stop.congestion_level = congestion_level(place, visit_date)
        stop.reason = _order_consistent_reason(
            clean_reason(stop.reason, place, user_type=user_type),
            place, index, len(stops), meal_indices, user_type, stop.congestion_level,
        )

    course_warnings: list[str] = []
    if user_type in _MOBILITY_USER_TYPES and len(stops) >= 2:
        course_warnings.append(_ROUTE_UNVERIFIED_WARNING)
    if user_type == "wheelchair" and stops and not any(
        s.attraction.accessibility.has_accessible_restroom for s in stops
    ):
        course_warnings.append(_NO_ACCESSIBLE_RESTROOM_WARNING)
    return course_warnings


# 요약에서 '짧은 동선'을 주장하는 문장. 경고와 함께 두면 서로 모순됩니다.
_SHORT_ROUTE_CLAIM = re.compile(
    r"짧은\s*동선|동선이\s*짧|동선을\s*짧|가까운\s*(곳|장소|거리)|가깝게|가까이\s*(모여|붙어|있)|"
    r"이동(이|을|\s*거리가|\s*부담이)?\s*(적|짧|최소|줄)|멀지\s*않|한\s*동네|근거리"
)
# 검증이 요약 끝에 덧붙이는 안내. 다시 검증할 때(순서 변경·재조회) 지우고 새로 씁니다.
# 라우터가 뒤에 붙이는 다른 안내(식사 장소 누락)는 건드리지 않도록 이 문구만 찾습니다.
_SUMMARY_NOTE_PREFIX = "※ "
_SUMMARY_NOTE = re.compile(
    r"\s*※ (?:(?:일부 구간은 요청하신 짧은 동선보다 멀어요\(최대 직선 약 [\d.]+km\)\."
    r"|식당이 연달아 배치된 구간이 있어요\.)\s*)+"
)


# 제목에서 지울 표현. 제목은 문장이 아니라 명사구라 표현만 덜어냅니다
# ("휠체어 친화 짧은 반나절 코스" → "휠체어 친화 반나절 코스").
_TITLE_SHORT_ROUTE = re.compile(
    r"짧은\s*동선|동선\s*짧은|짧은|가까운\s*곳\s*(위주|끼리)?|가까운|한\s*동네|근거리|"
    r"이동\s*(적은|최소|짧은)|멀지\s*않은"
)
_TITLE_MEAL = re.compile(r"맛집|식도락|미식|먹방|먹거리|식사|점심|저녁|브런치|밥집|식당")
_TITLE_JOINER = r"(?:과|와|및|&|\+|·|,)"
_DEFAULT_TITLE = "무장애 여행 코스"


def _strip_title(title: str, pattern: re.Pattern) -> str:
    """제목에서 표현을 덜어내고, 함께 남는 '과/와/·' 같은 연결어도 정리합니다."""
    words = pattern.pattern
    stripped = re.sub(
        rf"(?:(?<=\S)(?:과|와)\s+|\s*(?:및|&|\+|·|,)\s*)?(?:{words})(?:(?:과|와)(?=\s)|\s*(?:및|&|\+|·|,))?",
        " ", title,
    )
    stripped = re.sub(rf"^\s*{_TITLE_JOINER}\s+|\s+{_TITLE_JOINER}\s*$", " ", stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip(" ·&+,")
    if not stripped or stripped in ("코스", "여행", "여행 코스"):
        return _DEFAULT_TITLE
    return stripped


def strip_meal_from_title(title: str) -> str:
    """식사 장소가 빠진 코스라면 제목에서 식사 표현을 뺍니다."""
    return _strip_title(title, _TITLE_MEAL) if _TITLE_MEAL.search(title or "") else title


def _sync_summary(course: CourseResponse, short_route: bool, limit_km: float, sync_title: bool) -> None:
    """경고와 요약(과 제목)이 어긋나지 않게 고칩니다."""
    summary = _SUMMARY_NOTE.sub(" ", course.summary or "").strip()
    notes: list[str] = []

    far = [s.distance_from_prev_km for s in course.stops
           if short_route and s.distance_from_prev_km is not None and s.distance_from_prev_km > limit_km]
    if far:
        kept = [sentence for sentence in _SENTENCE_SPLIT.split(summary)
                if sentence.strip() and not _SHORT_ROUTE_CLAIM.search(sentence)]
        summary = " ".join(kept).strip()
        notes.append(f"일부 구간은 요청하신 짧은 동선보다 멀어요(최대 직선 약 {max(far):.1f}km).")
        if sync_title and _TITLE_SHORT_ROUTE.search(course.title or ""):
            course.title = _strip_title(course.title, _TITLE_SHORT_ROUTE)
    if any(_CONSECUTIVE_FOOD_WARNING in s.warnings for s in course.stops):
        notes.append("식당이 연달아 배치된 구간이 있어요.")

    if not summary:
        summary = "선택하신 장소로 구성한 코스예요."
    course.summary = f"{summary} {_SUMMARY_NOTE_PREFIX}{' '.join(notes)}" if notes else summary


def validate_course(
    course: CourseResponse, query_text: str | None, visit_date: str | None = None,
    sync_title: bool = True,
) -> CourseResponse:
    """
    CourseResponse 전체를 검증해 경고를 채웁니다 (course를 직접 고치고 그대로 돌려줍니다).

    sync_title=False는 저장된 코스를 다시 읽을 때 씁니다 — 저장된 제목은 사용자가
    직접 바꿨을 수 있어서 검증이 고치지 않습니다.
    """
    user_type = course.generated_for.value
    course.warnings = validate_course_stops(course.stops, user_type, query_text, visit_date)
    _sync_summary(course, prefers_short_route(query_text), short_route_limit_km(user_type), sync_title)
    return course
