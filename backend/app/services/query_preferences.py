"""
AI 플래너 문장에서 '무엇을 더 원하는지'를 읽어 후보 순서를 정합니다.

추천 우선순위:
  1) 화면에서 고른 유형·지역·방문일 — 반드시 지킵니다 (후보를 거르는 조건).
  2) 문장에서 읽은 조건 — 1)을 통과한 후보 안에서 점수로 순서를 정합니다.
  3) 접근성 등급(많음/보통/적음) — 문장 점수가 같으면 등급이 높은 곳이 앞.

문장 조건은 거르지 않고 점수로만 씁니다. 맞는 곳이 하나도 없으면 결과를 0개로
만들지 않고 1)에 맞는 곳을 추천하면서, 무엇을 찾지 못했는지 알려줍니다.
(장소 종류를 분명히 말한 요청 — "맛집", "박물관" — 은 place_intent가 따로 거릅니다.)
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field

from app.models.schemas import Attraction
from app.services import accessibility_criteria
from app.services.supabase_service import CacheUnavailable, get_cached_overview_texts

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Concept:
    """
    장소 특성. 문장에 trigger가 있으면, 이름이 name_pattern에 맞거나 소개문이
    overview_pattern에 맞는 곳에 점수를 줍니다.
    """
    label: str           # 찾지 못했을 때 안내에 쓰는 이름 ("○○ 장소를 찾지 못했어요")
    trigger: re.Pattern
    name_pattern: re.Pattern
    # 소개문은 긴 글이라 짧은 말('궁'→'궁금', '몰'→'몰려', '섬'→'섬세')이 엉뚱하게
    # 걸립니다. 그런 특성은 소개문용 표현을 따로 둡니다 (None이면 name_pattern).
    overview_pattern: re.Pattern | None = None

    @property
    def overview_re(self) -> re.Pattern:
        return self.overview_pattern or self.name_pattern


@dataclass(frozen=True)
class FacilityWish:
    """접근성 표현. 문장에 trigger가 있으면, fields 중 하나를 갖춘 곳에 점수."""
    label: str
    trigger: re.Pattern
    fields: tuple[str, ...]


def _re(pattern: str) -> re.Pattern:
    return re.compile(pattern)


CONCEPTS: tuple[Concept, ...] = (
    Concept("산책로", _re(r"산책|걷기|둘레길|트레킹"),
            _re(r"공원|수목원|호수|숲|둘레길|산책|생태|정원|천변|유원지|휴양림")),
    Concept("호수·물가", _re(r"호수|강변|강가|바다|물가|계곡|해변|폭포|저수지"),
            _re(r"호수|저수지|강변|한강|바다|해수욕장|해변|계곡|폭포|포구|섬"),
            _re(r"호수|저수지|강변|한강|바다|해수욕장|해변|계곡|폭포|포구|강가|물가")),
    Concept("숲·정원", _re(r"숲|수목원|정원|꽃|식물|자연"),
            _re(r"수목원|숲|정원|식물원|꽃|휴양림|허브|농원")),
    Concept("박물관·전시", _re(r"박물관|미술관|전시|갤러리|기념관|역사관|과학관"),
            _re(r"박물관|미술관|갤러리|전시|기념관|역사관|과학관|뮤지엄")),
    Concept("공연장", _re(r"공연|연극|음악회|콘서트|뮤지컬"),
            _re(r"아트홀|예술의전당|아트센터|문화예술회관|공연장|극장|시민회관")),
    Concept("역사 유적", _re(r"역사|유적|궁|성곽|문화재|왕릉|전통"),
            _re(r"궁|행궁|성곽|산성|릉|유적|향교|서원|사찰|민속촌|한옥"),
            _re(r"궁궐|행궁|성곽|산성|왕릉|유적|문화재|향교|서원|사찰|민속촌|한옥")),
    Concept("체험 장소", _re(r"체험|키즈|어린이|동물|아이들?이\s*좋아"),
            _re(r"어린이|키즈|체험|동물원|아쿠아|과학관|놀이|랜드|목장|농장|파크")),
    Concept("쇼핑 장소", _re(r"쇼핑|시장|아울렛|백화점"),
            _re(r"시장|아울렛|백화점|몰|스타필드|쇼핑"),
            _re(r"전통시장|아울렛|백화점|쇼핑몰|쇼핑")),
    Concept("온천·휴양", _re(r"온천|스파|힐링|휴양"),
            _re(r"온천|스파|휴양림|힐링|찜질")),
    Concept("전망 좋은 곳", _re(r"야경|전망|경치|뷰\b|풍경"),
            _re(r"전망대|타워|스카이|전망")),
)

FACILITY_WISHES: tuple[FacilityWish, ...] = (
    FacilityWish("장애인 화장실이 있는", _re(r"화장실"), ("has_accessible_restroom",)),
    FacilityWish("엘리베이터가 있는", _re(r"엘리베이터|승강기"), ("has_elevator",)),
    FacilityWish("계단·턱 없는", _re(r"계단\s*(이\s*)?없|경사\s*(가\s*)?없|턱\s*(이\s*)?없|평지|평탄"),
                 ("has_ramp", "has_exit")),
    FacilityWish("주차가 되는", _re(r"주차"), ("has_parking", "has_pregnant_parking")),
    FacilityWish("휠체어 대여가 되는", _re(r"휠체어\s*대여|휠체어\s*빌"), ("has_wheelchair_rental",)),
    FacilityWish("유모차 대여가 되는", _re(r"유모차|유아차"), ("has_stroller_accessible_path",)),
    FacilityWish("수유실이 있는", _re(r"수유"), ("has_lactation_room",)),
    FacilityWish("기저귀 교환대가 있는", _re(r"기저귀"), ("has_diaper_station",)),
    FacilityWish("점자 안내가 있는", _re(r"점자"), ("has_braille_block", "has_braille_promotion")),
    FacilityWish("음성 안내가 있는", _re(r"음성|오디오"), ("has_audio_guide",)),
    FacilityWish("안내견 동반이 되는", _re(r"안내견|보조견"), ("has_help_dog",)),
    FacilityWish("수어 안내가 있는", _re(r"수어|수화"), ("has_sign_guide",)),
    FacilityWish("자막 안내가 있는", _re(r"자막"), ("has_video_guide",)),
    FacilityWish("쉴 곳이 있는", _re(r"쉴\s*(곳|데)|쉼터|벤치|휴게"), ("has_rest_area",)),
    FacilityWish("저상버스로 갈 수 있는", _re(r"저상\s*버스|대중교통|버스"), ("has_low_floor_bus",)),
)

# 가중치: 문장이 콕 집어 말한 것(특성·편의시설·이름) > 목적에서 짐작한 카테고리.
_CONCEPT_POINTS = 3
_CONCEPT_OVERVIEW_POINTS = 2   # 이름보다 약하게 — 소개문은 주변 설명이 섞입니다
_FACILITY_POINTS = 3
_KEYWORD_POINTS = 3
_PURPOSE_POINTS = 1


@dataclass
class TextPreferences:
    concepts: list[Concept] = field(default_factory=list)
    facilities: list[FacilityWish] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)          # 장소 이름에서 찾을 말
    purpose_categories: set[str] = field(default_factory=set)  # 목적에서 짐작한 카테고리

    @property
    def is_empty(self) -> bool:
        return not (self.concepts or self.facilities or self.keywords or self.purpose_categories)


def extract_preferences(
    query_text: str, keywords: list[str] | None = None, purpose_categories: set[str] | None = None
) -> TextPreferences:
    text = query_text or ""
    concepts = [c for c in CONCEPTS if c.trigger.search(text)]
    facilities = [f for f in FACILITY_WISHES if f.trigger.search(text)]
    # 특성·편의시설 표현으로 이미 읽은 말은 이름 검색 키워드에서 뺍니다
    # ("산책로" 키워드로 이름에 '산책로'가 든 곳만 찾는 것보다 특성 점수가 넓습니다).
    covered = [c.trigger for c in concepts] + [f.trigger for f in facilities]
    needles = [
        k.replace(" ", "").lower() for k in (keywords or [])
        if len(k) >= 2 and not any(p.search(k) for p in covered)
    ]
    return TextPreferences(concepts, facilities, needles, set(purpose_categories or ()))


def text_matches(a: Attraction, prefs: TextPreferences) -> tuple[int, list[str]]:
    """문장 조건 점수와, 맞은 조건 이름들."""
    score = 0
    matched: list[str] = []
    name = (a.name or "").replace(" ", "")
    for c in prefs.concepts:
        if c.name_pattern.search(name):
            score += _CONCEPT_POINTS
            matched.append(c.label)
    for f in prefs.facilities:
        if any(getattr(a.accessibility, field_name, False) for field_name in f.fields):
            score += _FACILITY_POINTS
            matched.append(f.label)
    tags = overview_tags(a.content_id)
    for c in prefs.concepts:
        if c.label not in matched and c.label in tags:
            score += _CONCEPT_OVERVIEW_POINTS
            matched.append(c.label)
    lowered = name.lower()
    if any(n in lowered for n in prefs.keywords):
        score += _KEYWORD_POINTS
    if a.category in prefs.purpose_categories:
        score += _PURPOSE_POINTS
    return score, matched


_GRADE_RANK = {"high": 2, "mid": 1, "low": 0}


def grade_rank(a: Attraction, user_type: str) -> int:
    """접근성 등급 순위 (많음 2 / 보통 1 / 적음 0). 일반 유형은 등급을 보지 않습니다."""
    category = accessibility_criteria.USER_TYPE_CATEGORY.get(user_type)
    if category is None:
        return 0
    return _GRADE_RANK[accessibility_criteria.evaluate(a.accessibility, category, a.category).tier]


def unmet_labels(candidates: list[Attraction], prefs: TextPreferences) -> list[str]:
    """문장에서 원한 특성·편의시설 중 후보에 하나도 없는 것 (안내용)."""
    names = [(a.name or "").replace(" ", "") for a in candidates]
    unmet = [
        c.label for c in prefs.concepts
        if not any(c.name_pattern.search(n) for n in names)
        and not any(c.label in overview_tags(a.content_id) for a in candidates)
    ]
    unmet += [
        f.label for f in prefs.facilities
        if not any(getattr(a.accessibility, fn, False) for a in candidates for fn in f.fields)
    ]
    return unmet


# ---- 소개문에서 뽑은 특성 표시 ----
#
# 소개문 캐시(attraction_overview_cache)에는 원문 전체가 들어 있어 지역 전체를 매번
# 읽으면 요청 하나에 수 MB가 오갑니다. 소개문은 거의 바뀌지 않으므로, 한 번 읽어
# 특성 표시(예: {"호수·물가", "산책로"})로 바꾼 뒤 하루 동안 메모리에 둡니다.
# 소개문이 없는 곳도 빈 표시로 기억해서 다시 읽지 않습니다.

_OVERVIEW_TAG_TTL_SECONDS = 24 * 3600
_OVERVIEW_TAGS: dict[str, tuple[float, frozenset[str]]] = {}


def _tags_from_overview(text: str) -> frozenset[str]:
    return frozenset(c.label for c in CONCEPTS if text and c.overview_re.search(text))


def overview_tags(content_id: str) -> frozenset[str]:
    entry = _OVERVIEW_TAGS.get(content_id)
    return entry[1] if entry else frozenset()


async def load_overview_tags(content_ids: list[str]) -> None:
    """아직 없거나 오래된 곳만 소개문을 읽어 특성 표시를 채웁니다. 실패하면 이름만으로 판단합니다."""
    now = time.monotonic()
    missing = [
        cid for cid in dict.fromkeys(content_ids)
        if cid and (cid not in _OVERVIEW_TAGS or now - _OVERVIEW_TAGS[cid][0] > _OVERVIEW_TAG_TTL_SECONDS)
    ]
    if not missing:
        return
    try:
        texts = await get_cached_overview_texts(missing)
    except CacheUnavailable as e:
        # 소개문은 점수를 보태는 용도라, 못 읽어도 추천은 이름만으로 진행합니다.
        logger.warning("소개문 캐시를 읽지 못해 이름으로만 특성을 판단합니다: %s", e)
        return
    for cid in missing:
        _OVERVIEW_TAGS[cid] = (now, _tags_from_overview(texts.get(cid, "")))
