"""
접근성 유형 분류 기준 — 한 곳에서만 정의합니다.

접근성 탭(get_accessibility_summary), AI 코스 추천 후보 필터(_matches_user_type),
코스 검증(course_validator)이 모두 이 모듈을 씁니다. 예전에는 같은 기준이 세 곳에
따로 적혀 있어서 한쪽만 고치면 "탭에서는 우수한 곳"과 "추천 후보"가 갈렸습니다.

기준은 경기도 무장애 여행지 1,250곳의 실제 응답(detailWithTour2)을 표본 분석해서
정했습니다 (2026-09 조사). 주요 근거:
  - 정형 필드는 "없음" 대신 빈 칸으로 오지만, 값 안에 부정 표현("경사로 가파름",
    "공사중 이용 불가", "저상버스 없음")이 섞인 경우가 있어 _is_positive로 거릅니다.
  - '기타상세' 칸에 기저귀 교환대(12%), 의자식 테이블(20%), 저상버스, 비상벨,
    임산부 주차구역처럼 정형 필드에 없는 정보가 있어 키워드로 뽑습니다.
  - 장소 종류마다 해당 없는 항목이 있습니다 (예: 음식점의 휠체어 대여 0.3%,
    장애인 객실은 숙박에만). 그런 항목은 그 종류의 분모에서 뺍니다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.schemas import AccessibilityFeatures, Attraction

# ---------------------------------------------------------------------------
# 1) API 응답 → AccessibilityFeatures
# ---------------------------------------------------------------------------

# 캐시(place_accessibility_cache)에 저장된 행이 어떤 해석 규칙으로 만들어졌는지.
# 규칙을 바꾸면 올립니다 — 낮은 버전의 행은 다시 조회 대상이 됩니다.
PARSE_VERSION = 2

# "턱이 없어 휠체어 접근 가능"처럼 '없'이 들어가도 긍정인 표현. 부정 판단 전에 지웁니다.
_NEGATION_OK = re.compile(r"(턱|단차|경사|문턱|계단)[이가은는\s및와]*(거의\s*)?없")
# 이 표현이 있으면 긍정 문구가 함께 있어도 '없음'으로 봅니다.
_HARD_NEGATIVE = re.compile(r"공사\s*중|이용\s*불가|사용\s*불가")
# 접근로(route)는 "경사로가 설치되어 있음(가파름)"처럼 있어도 휠체어로 못 쓰는 경우가
# 있어 따로 봅니다. 출입통로 등 다른 칸의 '가파른 산길' 같은 부분 설명에는 쓰지 않습니다.
_STEEP = re.compile(r"가파")
_POSITIVE = re.compile(
    r"있|가능|설치|구비|보유|쉬움|쉽|대여|운영|제공|완만|\d+\s*(대|면|칸|석|개|실|곳)"
)
_NEGATIVE = re.compile(r"없|불가|어려|어렵|계단")


def _is_positive(value: str | None, hard_negative: re.Pattern | None = None) -> bool:
    """필드 값이 '그 시설이 있다'는 뜻인지. 빈 값은 없음, 부정 표현만 있으면 없음."""
    text = (value or "").strip()
    if not text:
        return False
    text = _NEGATION_OK.sub("", text)
    if _HARD_NEGATIVE.search(text) or (hard_negative is not None and hard_negative.search(text)):
        return False
    if _POSITIVE.search(text):
        return True
    return not _NEGATIVE.search(text)


_LOW_FLOOR_BUS = re.compile(r"저상\s*버스(?!\s*(운행\s*)?없)")
_ACCESSIBLE_SEATING = re.compile(r"(관람석|전용석|휠체어석)[^.,]{0,6}있")
_NO_DEDICATED_SEATING = re.compile(r"관람석[은는이가\s]*(따로\s*)?없")

# 기타상세 등 자유 서술에서 뽑는 항목. 모든 텍스트 필드를 이어 붙여 검색합니다.
_KEYWORD_FEATURES: dict[str, re.Pattern] = {
    "has_diaper_station": re.compile(r"기저귀"),
    "has_pregnant_parking": re.compile(r"임산부[^.,]{0,6}주차"),
    "has_seated_table": re.compile(r"의자식|입식\s*테이블"),
    "has_emergency_bell": re.compile(r"비상\s*벨|호출\s*벨|비상\s*호출"),
    # '유아휴게실'은 수유 공간이라 고령자 휴게 공간에서 뺍니다.
    "has_rest_area": re.compile(r"벤치|쉼터|(?<!유아)(?<!유아\s)휴게\s*(공간|시설|실|소)"),
}

# (필드명, 이 필드 값으로 True가 되는 AccessibilityFeatures 항목)
_FIELD_MAP: tuple[tuple[str, str], ...] = (
    ("parking", "has_parking"),
    ("route", "has_ramp"),
    ("wheelchair", "has_wheelchair_rental"),
    ("exit", "has_exit"),
    ("elevator", "has_elevator"),
    ("restroom", "has_accessible_restroom"),
    ("room", "has_accessible_room"),
    ("braileblock", "has_braille_block"),
    ("helpdog", "has_help_dog"),
    ("guidehuman", "has_guide_human"),
    ("audioguide", "has_audio_guide"),
    ("bigprint", "has_big_print"),
    ("brailepromotion", "has_braille_promotion"),
    ("guidesystem", "has_guide_system"),
    ("signguide", "has_sign_guide"),
    ("videoguide", "has_video_guide"),
    ("hearingroom", "has_hearing_room"),
    ("hearinghandicapetc", "has_hearing_etc"),
    ("stroller", "has_stroller_accessible_path"),
    ("lactationroom", "has_lactation_room"),
    ("babysparechair", "has_baby_spare_chair"),
)

_VISUAL_FIELDS = (
    "has_braille_block", "has_help_dog", "has_guide_human", "has_audio_guide",
    "has_big_print", "has_braille_promotion", "has_guide_system",
)
_HEARING_FIELDS = ("has_sign_guide", "has_video_guide", "has_hearing_room", "has_hearing_etc")


def features_from_detail(d: dict) -> AccessibilityFeatures:
    """detailWithTour2 응답 한 건을 AccessibilityFeatures로 바꿉니다."""
    values: dict[str, bool] = {
        feat: _is_positive(d.get(key), _STEEP if key == "route" else None) for key, feat in _FIELD_MAP
    }

    transport = (d.get("publictransport") or "").strip()
    values["has_low_floor_bus"] = bool(_LOW_FLOOR_BUS.search(transport))
    seating = (d.get("auditorium") or "").strip()
    values["has_accessible_seating"] = bool(
        _ACCESSIBLE_SEATING.search(seating) and not _NO_DEDICATED_SEATING.search(seating)
    )

    all_text = " ".join(str(v) for k, v in d.items() if k != "contentid" and isinstance(v, str))
    for feat, pattern in _KEYWORD_FEATURES.items():
        values[feat] = bool(pattern.search(all_text))

    values["has_visual_accessibility"] = any(values[f] for f in _VISUAL_FIELDS)
    values["has_hearing_accessibility"] = any(values[f] for f in _HEARING_FIELDS)

    # 아래 개수는 AI 프롬프트(일반 유형)와 예전 캐시 호환용으로만 남겨둡니다.
    # 분류/점수는 evaluate()가 장소 종류까지 보고 따로 계산합니다.
    counts = {
        "wheelchair_accessibility_count": ("has_parking", "has_ramp", "has_wheelchair_rental",
                                           "has_exit", "has_elevator", "has_accessible_restroom"),
        "visual_accessibility_count": _VISUAL_FIELDS,
        "hearing_accessibility_count": _HEARING_FIELDS,
        "family_accessibility_count": ("has_stroller_accessible_path", "has_lactation_room",
                                       "has_baby_spare_chair", "has_diaper_station"),
        "pregnant_accessibility_count": ("has_lactation_room", "has_pregnant_parking",
                                         "has_diaper_station", "has_ramp", "has_elevator",
                                         "has_accessible_restroom"),
    }
    return AccessibilityFeatures(
        **values,
        **{name: sum(1 for f in fields if values[f]) for name, fields in counts.items()},
    )


# ---------------------------------------------------------------------------
# 2) 유형별 분류 기준
# ---------------------------------------------------------------------------

# 아래 CRITERIA를 바꾸면 올립니다. 통계 캐시(accessibility_stats)에 함께 저장돼서,
# 기준이 바뀐 직후의 첫 집계가 '숫자가 줄었다'는 이유로 저장을 건너뛰지 않게 합니다.
CRITERIA_VERSION = 2

@dataclass(frozen=True)
class Item:
    field: str
    # 이 종류에서만 세는 항목 (None이면 모든 종류)
    only: frozenset[str] | None = None
    # 이 종류에서는 세지 않는 항목
    exclude: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Criteria:
    items: tuple[Item, ...]
    # 목록에 들어가는 조건: 각 묶음에서 하나 이상씩 (묶음끼리는 AND)
    entry: tuple[tuple[str, ...], ...]
    # 이 묶음을 모두 채우면 점수와 상관없이 '많음' (없으면 점수로만 판단)
    core: tuple[tuple[str, ...], ...] = ()
    # True면 core를 못 채운 곳은 점수가 높아도 '보통'까지만
    core_required_for_high: bool = False
    # core를 채워도 '많음'이 되려면 갖춰야 하는 최소 항목 수 (None이면 제한 없음)
    high_min_have: int | None = None
    # '보통' 최소 항목 수. 항목이 많은 유형은 절반(50점)을 넘기기 어려워서, 두 개만
    # 갖춰도 '적음'으로 떨어지지 않게 합니다. None이면 점수 50 기준.
    mid_min_have: int | None = None


_NO_ELEVATOR_NEEDED = frozenset({"관광지", "음식점"})  # 야외·단층이 많아 엘리베이터 표본 19~24%

CRITERIA: dict[str, Criteria] = {
    "wheelchair": Criteria(
        items=(
            Item("has_parking"),
            Item("has_ramp"),
            Item("has_exit"),
            Item("has_accessible_restroom"),
            Item("has_elevator", exclude=_NO_ELEVATOR_NEEDED),
            Item("has_wheelchair_rental", exclude=frozenset({"음식점"})),
            Item("has_accessible_room", only=frozenset({"숙박"})),
            Item("has_accessible_seating", only=frozenset({"문화시설"})),
            Item("has_seated_table", only=frozenset({"음식점"})),
        ),
        # 들어가는 길과 화장실이 모두 확인된 곳만. 예전(아무 항목 1개)엔 98.5%가 들어갔습니다.
        entry=(("has_ramp", "has_exit"), ("has_accessible_restroom",)),
    ),
    "visual": Criteria(
        items=tuple(Item(f) for f in _VISUAL_FIELDS),
        entry=(_VISUAL_FIELDS,),
        # 이동 안내 + 정보 안내를 모두 갖추면 '많음'. 7개 중 6개를 갖춘 곳이 표본에
        # 1곳뿐이라 개수 비율로는 '많음'이 사실상 나오지 않았습니다.
        core=(
            ("has_braille_block", "has_guide_system"),
            ("has_braille_promotion", "has_audio_guide", "has_guide_human", "has_big_print"),
        ),
        core_required_for_high=True,
        # 두 가지만으로 '많음 · 7개 중 2개'가 되면 어색해서 3개 이상일 때만 '많음'.
        high_min_have=3,
        mid_min_have=2,
    ),
    "hearing": Criteria(
        items=(
            Item("has_sign_guide"),
            Item("has_video_guide"),
            Item("has_hearing_room", only=frozenset({"숙박"})),
            Item("has_hearing_etc"),
        ),
        entry=(_HEARING_FIELDS,),
    ),
    "family": Criteria(
        items=(
            Item("has_stroller_accessible_path"),
            Item("has_lactation_room"),
            Item("has_diaper_station"),
            Item("has_baby_spare_chair", only=frozenset({"음식점", "숙박"})),
        ),
        entry=(("has_stroller_accessible_path", "has_lactation_room",
                "has_diaper_station", "has_baby_spare_chair"),),
        core=(("has_stroller_accessible_path",), ("has_lactation_room", "has_diaper_station")),
    ),
    "pregnant": Criteria(
        items=(
            Item("has_lactation_room"),
            Item("has_pregnant_parking"),
            Item("has_diaper_station"),
            Item("has_ramp"),
            Item("has_elevator", exclude=_NO_ELEVATOR_NEEDED),
            Item("has_accessible_restroom"),
        ),
        # 휠체어 탭과 분리: 임산부에게만 해당하는 시설이 하나는 있어야 합니다.
        # 예전엔 접근로·화장실만으로 들어온 곳이 대부분이라 휠체어 탭과 99% 겹쳤습니다.
        entry=(("has_lactation_room", "has_pregnant_parking", "has_diaper_station"),),
        core=(("has_lactation_room", "has_pregnant_parking"),
              ("has_ramp", "has_elevator"), ("has_accessible_restroom",)),
    ),
    "senior": Criteria(
        items=(
            Item("has_ramp"),
            Item("has_elevator", exclude=_NO_ELEVATOR_NEEDED),
            Item("has_accessible_restroom"),
            Item("has_parking"),
            Item("has_low_floor_bus"),
            Item("has_rest_area"),
            Item("has_emergency_bell"),
        ),
        # 걷는 부담을 줄여주는 시설 기준. 예전엔 수유실/유아용 의자가 있어야 들어갔습니다.
        entry=(("has_ramp", "has_elevator", "has_accessible_restroom"),),
        core=(("has_ramp", "has_elevator"), ("has_accessible_restroom",),
              ("has_parking", "has_low_floor_bus")),
        mid_min_have=2,
    ),
}

# 편의시설 항목의 사람이 읽는 이름. AI에게 넘기는 편의시설 목록과 코스 검증의
# 대체 설명이 같은 이름을 씁니다. 'has_stroller_accessible_path'는 이름과 달리 원문이
# 전부 "유모차 대여 가능/보유"라서(표본 93건 전부) '유모차 대여'로 부릅니다.
FEATURE_LABELS: dict[str, str] = {
    "has_ramp": "경사로", "has_elevator": "엘리베이터", "has_accessible_restroom": "장애인 화장실",
    "has_wheelchair_rental": "휠체어 대여", "has_stroller_accessible_path": "유모차 대여",
    "has_rest_area": "휴게 공간", "has_lactation_room": "수유실", "has_baby_spare_chair": "유아용 보조의자",
    "has_braille_block": "점자블록", "has_audio_guide": "오디오 가이드", "has_guide_human": "안내요원",
    "has_help_dog": "보조견 동반", "has_big_print": "큰 활자 안내물", "has_guide_system": "유도 안내설비",
    "has_braille_promotion": "점자 안내물", "has_sign_guide": "수어 안내", "has_video_guide": "자막 영상 안내",
    "has_hearing_room": "청각장애인용 객실", "has_parking": "장애인 주차구역", "has_exit": "턱 없는 출입구",
    "has_accessible_room": "장애인 객실", "has_accessible_seating": "장애인 관람석",
    "has_low_floor_bus": "저상버스", "has_seated_table": "의자식 테이블", "has_diaper_station": "기저귀 교환대",
    "has_pregnant_parking": "임산부 주차구역", "has_emergency_bell": "비상벨", "has_hearing_etc": "청각장애인 안내 설비",
}

# 기준 이름 → 사람이 읽는 유형 이름 (일반 유형 추천에서 '어떤 유형에 맞는 곳인지' 알려줄 때).
CATEGORY_LABELS: dict[str, str] = {
    "wheelchair": "휠체어 이용자",
    "visual": "시각장애인",
    "hearing": "청각장애인",
    "family": "영유아 동반 가족",
    "pregnant": "임산부",
    "senior": "고령자",
}

TIER_LABELS: dict[str, str] = {"high": "많음", "mid": "보통", "low": "적음"}


# 사용자 유형(user_type) 이름 → 기준 이름. 앱의 '유모차'는 영유아 가족 기준을 씁니다.
USER_TYPE_CATEGORY: dict[str, str] = {
    "wheelchair": "wheelchair",
    "visual": "visual",
    "hearing": "hearing",
    "stroller": "family",
    "family": "family",
    "pregnant": "pregnant",
    "senior": "senior",
}


@dataclass(frozen=True)
class Evaluation:
    have: list[str]      # 갖춘 항목 (화면 칩 순서)
    total: int           # 이 장소 종류에서 세는 전체 항목 수
    score: int           # have / total * 100
    tier: str            # "high" | "mid" | "low"
    qualifies: bool      # 이 유형 목록에 들어가는지


def _applicable(item: Item, place_category: str, present: bool) -> bool:
    if not place_category:
        # 종류를 모르는 곳(캐시에서 되살린 후보)은 종류 전용 항목을 갖췄을 때만 셉니다.
        return item.only is None or present
    if item.only is not None and place_category not in item.only:
        return False
    return place_category not in item.exclude


def _groups_met(have: set[str], groups: tuple[tuple[str, ...], ...]) -> bool:
    return all(any(f in have for f in group) for group in groups)


def evaluate(features: AccessibilityFeatures, category: str, place_category: str = "") -> Evaluation:
    crit = CRITERIA[category]
    applicable = [
        item.field for item in crit.items
        if _applicable(item, place_category, bool(getattr(features, item.field, False)))
    ]
    have = [f for f in applicable if getattr(features, f, False)]
    total = max(len(applicable), 1)
    score = round(len(have) / total * 100)
    # 핵심 항목·목록 조건도 '이 장소 종류에서 세는 항목'만 봅니다. 예전엔 원래 값을 봐서,
    # 엘리베이터를 세지 않는 음식점이 엘리베이터 덕분에 핵심 조건을 채워 2/5인데 '많음'이 됐습니다.
    have_set = set(have)
    core_met = (
        bool(crit.core)
        and _groups_met(have_set, crit.core)
        and len(have) >= (crit.high_min_have or 0)
    )

    if core_met or (score >= 80 and not crit.core_required_for_high):
        tier = "high"
    elif score >= 50 or (crit.mid_min_have is not None and len(have) >= crit.mid_min_have):
        tier = "mid"
    else:
        tier = "low"

    return Evaluation(
        have=have,
        total=total,
        score=score,
        tier=tier,
        qualifies=_groups_met(have_set, crit.entry),
    )


def qualifies(attraction: Attraction, user_type: str) -> bool:
    """이 사용자 유형의 목록/추천 후보에 들어가는 곳인지. 기준이 없는 유형(일반)은 통과."""
    category = USER_TYPE_CATEGORY.get(user_type)
    if category is None:
        return True
    return evaluate(attraction.accessibility, category, attraction.category).qualifies


def has_any_relevant(attraction: Attraction, user_type: str) -> bool:
    """그 유형과 관련된 편의시설이 하나라도 등록돼 있는지 (코스 검증 경고용)."""
    category = USER_TYPE_CATEGORY.get(user_type)
    if category is None:
        return True
    return bool(evaluate(attraction.accessibility, category, attraction.category).have)


def ai_payload(attraction: Attraction, user_type: str) -> dict:
    """
    AI에게 넘기는 편의시설 정보. 접근성 탭과 같은 기준으로 계산합니다.

    - 유형이 있으면: 그 장소 종류에서 세는 항목 중 갖춘 시설 이름과 등급.
      필드명·true/false 대신 이름만 넘겨서 AI가 원시 값을 노출하지 않고,
      없는 시설(예: 공원의 엘리베이터)을 약점으로 들지도 않습니다.
    - 일반 유형이면: 이 장소가 목록에 들어가는 유형 이름만 (토큰을 아끼기 위함).
    """
    category = USER_TYPE_CATEGORY.get(user_type)
    if category is None:
        return {
            "suitable_for": [
                CATEGORY_LABELS[c] for c in CRITERIA
                if evaluate(attraction.accessibility, c, attraction.category).qualifies
            ]
        }
    ev = evaluate(attraction.accessibility, category, attraction.category)
    return {
        "facilities": [FEATURE_LABELS.get(f, f) for f in ev.have],
        "grade": TIER_LABELS[ev.tier],
    }
