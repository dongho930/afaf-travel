"""자연어 요청에서 명시한 장소 유형을 추천 후보의 검증 조건으로 바꿉니다."""

import re
from dataclasses import dataclass

from app.models.schemas import Attraction


@dataclass(frozen=True)
class VenueRequirement:
    label: str
    # 등산처럼 한 요청이 두 TourAPI 카테고리에 걸칠 수 있습니다.
    options: tuple[tuple[str, tuple[str, ...] | None], ...]

    def matches(self, place: Attraction) -> bool:
        name = (place.name or "").replace(" ", "").lower()
        return any(
            place.category == category and (
                terms is None or any(term.replace(" ", "").lower() in name for term in terms)
            )
            for category, terms in self.options
        )


@dataclass(frozen=True)
class VenueConstraint:
    # None은 카테고리 전체를 허용하고, 단어 목록은 장소 이름까지 확인합니다.
    name_terms_by_category: dict[str, tuple[str, ...] | None]
    allow_other_categories: bool = False
    requirements: tuple[VenueRequirement, ...] = ()
    exclusions: tuple[tuple[str, tuple[str, ...] | None], ...] = ()

    @property
    def categories(self) -> set[str]:
        return set(self.name_terms_by_category)

    def matches(self, place: Attraction) -> bool:
        if any(VenueRequirement("제외", ((category, terms),)).matches(place)
               for category, terms in self.exclusions):
            return False
        if self.allow_other_categories:
            return True
        if place.category not in self.name_terms_by_category:
            return False
        terms = self.name_terms_by_category[place.category]
        if terms is None:
            return True
        name = (place.name or "").replace(" ", "").lower()
        return any(term.replace(" ", "").lower() in name for term in terms)

    def missing_requirements(self, places: list[Attraction]) -> list[str]:
        return [requirement.label for requirement in self.requirements
                if not any(requirement.matches(place) for place in places)]

    def matches_requirement(self, place: Attraction) -> bool:
        return any(requirement.matches(place) for requirement in self.requirements)


# (질의 표현, TourAPI 카테고리, 이름에서 확인할 표현). 범주가 넓은 경우에만
# 이름 조건을 더합니다. '과학관' 요청에 다른 문화시설이 섞이는 일을 막습니다.
_VENUE_RULES: tuple[tuple[tuple[str, ...], str, tuple[str, ...] | None], ...] = (
    (("맛집", "먹거리", "식당", "음식점", "음식", "식사", "점심", "저녁",
      "아침", "밥집", "브런치", "먹을", "먹방", "식도락"), "음식점", None),
    (("카페", "커피", "디저트"), "음식점", ("카페", "커피", "디저트", "coffee")),
    (("빵집", "베이커리"), "음식점", ("빵", "베이커리", "제과", "bakery")),
    (("과학관",), "문화시설", ("과학관", "과학센터", "과학체험관")),
    (("미술관", "갤러리"), "문화시설", ("미술관", "미술", "갤러리", "아트센터")),
    (("박물관",), "문화시설", ("박물관",)),
    (("문화시설",), "문화시설", None),
    (("전시관", "전시"), "문화시설", ("전시", "미술관", "박물관", "갤러리")),
    (("공연장",), "문화시설", ("공연장", "아트홀", "예술회관", "시민회관", "문화회관")),
    (("극장", "영화관", "시네마"), "문화시설", ("극장", "시네마", "영화관")),
    (("호텔",), "숙박", ("호텔", "hotel")),
    (("펜션",), "숙박", ("펜션",)),
    (("숙박", "숙소"), "숙박", None),
    (("리조트",), "숙박", ("리조트", "resort")),
    (("모텔",), "숙박", ("모텔", "motel")),
    (("게스트하우스",), "숙박", ("게스트하우스", "게하", "guesthouse")),
    (("캠핑장", "캠핑"), "숙박", ("캠핑", "야영장", "오토캠핑")),
    (("자전거",), "레포츠", ("자전거", "바이크", "사이클")),
    (("서핑",), "레포츠", ("서핑", "서프")),
    (("레포츠", "스포츠"), "레포츠", None),
    (("카약",), "레포츠", ("카약", "kayak")),
    (("래프팅",), "레포츠", ("래프팅", "rafting")),
    (("승마",), "레포츠", ("승마", "승마장")),
    (("스키장",), "레포츠", ("스키장", "스키리조트")),
    (("쇼핑", "기념품"), "쇼핑", None),
    (("시장",), "쇼핑", ("시장", "마켓")),
    (("아울렛", "아웃렛"), "쇼핑", ("아울렛", "아웃렛", "프리미엄")),
    (("백화점",), "쇼핑", ("백화점",)),
    (("공원",), "관광지", ("공원",)),
    (("관광지", "명소"), "관광지", None),
    (("산책로", "산책", "둘레길", "숲길"), "관광지",
     ("산책로", "둘레길", "숲길", "공원", "수목원")),
    (("수목원",), "관광지", ("수목원",)),
    (("계곡",), "관광지", ("계곡",)),
    (("호수",), "관광지", ("호수",)),
    (("해변",), "관광지", ("해변", "해수욕장")),
    (("전망대",), "관광지", ("전망대",)),
    (("사찰",), "관광지", ("사찰", "사원", "청계사")),
    (("성곽",), "관광지", ("성곽", "산성", "성벽")),
    (("행궁",), "관광지", ("행궁",)),
    (("유적",), "관광지", ("유적", "유적지")),
    (("테마파크", "놀이공원"), "관광지", ("테마파크", "놀이공원")),
    (("동물원",), "관광지", ("동물원", "서울대공원")),
    (("등산", "등산로"), "관광지", ("등산로", "등산", "산")),
    (("등산", "등산로"), "레포츠", ("등산", "산악")),
)


def query_without_excluded_venues(query_text: str) -> str:
    """'미술관 말고 카페'의 미술관을 목적 파서가 문화예술로 읽지 않게 합니다."""
    text = query_text or ""
    terms = sorted({term for words, _, _ in _VENUE_RULES for term in words}, key=len, reverse=True)
    for term in terms:
        text = re.sub(
            re.escape(term) + r"\s*(?:에서|의|을|를|은|는)?\s*(?:말고|빼고|제외)",
            " ", text,
        )
    return text


def _active_term_spans(text: str, all_terms: set[str]) -> dict[str, list[tuple[int, int]]]:
    """'놀이공원' 안의 '공원'처럼 더 긴 장소명이 차지한 글자는 다시 읽지 않습니다."""
    occupied: set[int] = set()
    active: dict[str, list[tuple[int, int]]] = {}
    for term in sorted(all_terms, key=len, reverse=True):
        for match in re.finditer(re.escape(term), text):
            span = set(range(match.start(), match.end()))
            if occupied.isdisjoint(span):
                active.setdefault(term, []).append((match.start(), match.end()))
                occupied.update(span)
    return active


def venue_constraint_for_query(query_text: str) -> VenueConstraint | None:
    """분명하게 언급한 장소만 제한합니다. 넓은 목적은 AI가 판단하게 둡니다."""
    text = re.sub(r"\s+", "", query_text or "")
    all_terms = {term for terms, _, _ in _VENUE_RULES for term in terms}
    active_spans = _active_term_spans(text, all_terms)
    negated: list[tuple[str, tuple[str, ...] | None]] = []
    for terms, category, name_terms in _VENUE_RULES:
        if any(re.match(r"(?:에서|의|을|를|은|는)?(?:말고|빼고|제외)", text[end:])
               for term in terms for _, end in active_spans.get(term, [])):
            negated.append((category, name_terms))
    for term in sorted(all_terms, key=len, reverse=True):
        # '공원 근처 식당'의 공원과 '미술관 말고 카페'의 미술관은 방문지가 아닙니다.
        text = re.sub(
            re.escape(term) + r"(?:에서|의|을|를|은|는)?(?:근처|주변|인근|말고|빼고|제외)",
            "",
            text,
        )

    by_category: dict[str, tuple[str, ...] | None] = {}
    by_label: dict[str, list[tuple[str, tuple[str, ...] | None]]] = {}
    active_terms = set(_active_term_spans(text, all_terms))
    for terms, category, name_terms in _VENUE_RULES:
        if not any(term in active_terms for term in terms):
            continue
        label = {"맛집": "음식점", "등산": "등산로"}.get(terms[0], terms[0])
        by_label.setdefault(label, []).append((category, name_terms))
        if category not in by_category:
            by_category[category] = name_terms
        elif name_terms is not None and by_category[category] is None:
            by_category[category] = name_terms
        elif by_category[category] is not None:
            if name_terms is not None:
                by_category[category] = tuple(sorted(set(by_category[category]) | set(name_terms)))
    # '점심 카페'의 점심은 별도 식당 한 곳을 요구하지 않습니다. 세부 장소가
    # 명시됐다면 같은 카테고리의 넓은 요구는 중복으로 세지 않습니다.
    specific_categories = {category for options in by_label.values()
                           for category, terms in options if terms is not None}
    requirements = tuple(
        VenueRequirement(label, tuple(options)) for label, options in by_label.items()
        if any(terms is not None for _, terms in options)
        or not any(category in specific_categories for category, _ in options)
    )
    # 하루 코스처럼 전체 일정을 요청했다면 언급한 식당은 필수지만, 관광지와
    # 문화시설도 함께 추천할 수 있어야 합니다.
    broad_trip = any(term in text for term in (
        "당일치기", "당일여행", "하루코스", "하루여행", "하루일정", "여행코스", "여행일정",
        "일일코스", "관광코스", "나들이코스", "데이트코스", "가족코스",
        "코스와", "코스랑", "여행", "나들이", "데이트", "구경", "1박2일", "2박3일",
    ))
    if not by_category and not negated:
        return None
    return VenueConstraint(
        by_category, broad_trip or not by_category, requirements, tuple(negated)
    )
