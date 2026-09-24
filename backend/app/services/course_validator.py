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

# 사용자 유형별 '이 중 하나는 확인돼야 하는' 편의시설.
_REQUIRED_FACILITIES: dict[str, tuple[tuple[str, ...], str]] = {
    "wheelchair": (
        ("has_ramp", "has_elevator", "wheelchair_accessibility_count"),
        "경사로·엘리베이터 등 휠체어 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
    "stroller": (
        ("has_stroller_accessible_path", "family_accessibility_count"),
        "유모차 이동 동선 등 영유아 동반 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
    "senior": (
        ("has_rest_area", "has_ramp", "has_elevator"),
        "휴게 공간·경사로·엘리베이터 정보가 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
    "pregnant": (
        ("has_rest_area", "pregnant_accessibility_count"),
        "휴게 공간 등 임산부 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
    "visual": (
        ("has_visual_accessibility", "visual_accessibility_count"),
        "시각장애인 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
    "hearing": (
        ("has_hearing_accessibility", "hearing_accessibility_count"),
        "청각장애인 편의시설이 등록돼 있지 않아요. 방문 전 확인해 주세요.",
    ),
}

_ROUTE_UNVERIFIED_WARNING = (
    "장소 사이 이동 경로(보도·횡단보도·경사)의 무장애 여부는 확인되지 않았어요. "
    "이동 전 지도에서 실제 경로를 확인해 주세요."
)
_NO_ACCESSIBLE_RESTROOM_WARNING = "코스 안에 장애인 화장실이 확인된 장소가 없어요."
_DRINK_PLACE_AT_MEAL_WARNING = (
    "음료·디저트 위주 가게로 보여 {meal} 식사는 어려울 수 있어요. 식사할 곳을 따로 확인해 주세요."
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
)

# 장소 '안'의 시설이 아니라 장소 '사이' 경로가 무장애라고 단정하는 표현.
# 데이터에는 장소 사이 경로 정보가 없어서 이런 문장은 근거 없는 안전 보장이 됩니다.
_ROUTE_CLAIM_PATTERNS = tuple(re.compile(p) for p in (
    r"(휠체어|유모차)[로도]?\s*(편하게|편리하게|쉽게|무리\s*없이|안전하게|수월하게)?\s*(이동|오가|다니|이어|갈\s*수)",
    r"무장애\s*(경로|동선|길|이동|코스로\s*이어)",
    r"(이동|동선|경로|길|구간)[이가은는도]?\s*(편하|편리|쉬|안전|평탄|완만|무난|수월)",
    r"(안전하게|편하게|편안하게|수월하게|무리\s*없이)\s*(이동|오가|다니|걸)",
    r"(이동하기|다니기|오가기|걷기)\s*(편한|편리한|좋은|수월한|쉬운|편해)",
    r"(턱|계단)\s*없이\s*(이동|이어|연결)",
))
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
_RAW_FIELD_TOKENS = ("has_", "_count", "true", "false")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def prefers_short_route(query_text: str | None) -> bool:
    """질의가 장소 사이 이동을 줄여 달라는 요청인지."""
    compact = re.sub(r"\s+", "", query_text or "")
    return any(term in compact for term in _SHORT_ROUTE_TERMS)


def short_route_limit_km(user_type: str) -> float:
    return _SHORT_ROUTE_LIMIT_KM_MOBILITY if user_type in _MOBILITY_USER_TYPES else _SHORT_ROUTE_LIMIT_KM


def _has_any(features: AccessibilityFeatures, fields: Iterable[str]) -> bool:
    return any(bool(getattr(features, name, False)) for name in fields)


def _is_route_claim(sentence: str) -> bool:
    if any(hint in sentence for hint in _INSIDE_PLACE_HINTS):
        return False
    return any(pattern.search(sentence) for pattern in _ROUTE_CLAIM_PATTERNS)


def clean_reason(reason: object, place: Attraction, fallback: str | None = None) -> str:
    """
    추천 이유에서 확인할 수 없는 주장이 담긴 문장만 덜어냅니다.

    - 등록되지 않은 편의시설을 근거로 든 문장
    - 장소 사이 이동 경로가 무장애·안전하다고 단정하는 문장
    - 식사할 수 없는 가게(음료·디저트 위주)를 식사 장소로 설명하는 문장
    - 필드명·원시값이 그대로 드러난 문장

    남는 문장이 없으면 fallback(없으면 장소 유형에 맞는 기본 문구)을 씁니다.
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
    if status == MEAL_UNKNOWN:
        return "요청하신 조건에 맞춰 고른 음식점이에요."
    return f"요청하신 조건에 맞춰 고른 {place.category} 장소예요."


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
    return True


def _order_consistent_reason(
    reason: str, place: Attraction, index: int, total: int, meal_indices: dict[str, list[int]]
) -> str:
    kept = [
        sentence.strip() for sentence in _SENTENCE_SPLIT.split(reason)
        if sentence.strip() and _fits_order(sentence, index, total, meal_indices)
    ]
    return " ".join(kept) if kept else clean_reason("", place)


def validate_course_stops(
    stops: list[CourseStop], user_type: str, query_text: str | None
) -> list[str]:
    """
    코스의 각 장소에 거리·경고를 채우고 추천 이유를 정리합니다 (stops를 직접 고칩니다).
    코스 전체에 대한 경고 목록을 돌려줍니다.

    같은 코스에 여러 번 돌려도 결과가 같습니다 — 경고는 매번 새로 계산하고,
    추천 이유 정리는 이미 정리된 문장을 다시 바꾸지 않습니다.
    """
    short_route = prefers_short_route(query_text)
    limit_km = short_route_limit_km(user_type)
    required = _REQUIRED_FACILITIES.get(user_type)

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
            if meal in ("점심", "저녁", "아침") and status == NOT_MEAL:
                warnings.append(_DRINK_PLACE_AT_MEAL_WARNING.format(meal=meal))
            elif meal in ("점심", "저녁", "아침") and status == MEAL_UNKNOWN:
                warnings.append(_UNKNOWN_MEAL_AT_MEAL_WARNING.format(meal=meal))

        if required and not _has_any(place.accessibility, required[0]):
            warnings.append(required[1])

        stop.warnings = warnings
        stop.reason = _order_consistent_reason(
            clean_reason(stop.reason, place), place, index, len(stops), meal_indices
        )

    course_warnings: list[str] = []
    if user_type in _MOBILITY_USER_TYPES and len(stops) >= 2:
        course_warnings.append(_ROUTE_UNVERIFIED_WARNING)
    if user_type == "wheelchair" and stops and not any(
        s.attraction.accessibility.has_accessible_restroom for s in stops
    ):
        course_warnings.append(_NO_ACCESSIBLE_RESTROOM_WARNING)
    return course_warnings


def validate_course(course: CourseResponse, query_text: str | None) -> CourseResponse:
    """CourseResponse 전체를 검증해 경고를 채웁니다 (course를 직접 고치고 그대로 돌려줍니다)."""
    course.warnings = validate_course_stops(course.stops, course.generated_for.value, query_text)
    return course
