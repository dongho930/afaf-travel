"""자연어 요청에서 명시한 장소 유형을 추천 후보의 검증 조건으로 바꿉니다."""

import re
from dataclasses import dataclass

from app.models.schemas import Attraction


_MEAL_MENU_TERMS = (
    "식사", "정식", "백반", "한식", "중식", "일식", "양식", "국밥", "비빔밥",
    "볶음밥", "덮밥", "김밥", "찌개", "칼국수", "냉면", "쌀국수", "국수",
    "라멘", "우동", "수제비", "떡볶이", "파스타", "피자", "버거", "샌드위치",
    "돈까스", "돈가스", "스테이크", "불고기", "갈비", "삼겹살", "초밥",
    "삼계탕", "보쌈", "족발", "치킨", "탕수육", "제육", "순두부", "곰탕",
    "샤브", "뷔페", "분식", "도시락", "브런치",
)
_DESSERT_MENU_TERMS = (
    "케이크", "커피", "라떼", "에이드", "주스", "스무디", "아이스크림",
    "마카롱", "도넛", "쿠키", "와플", "타르트", "디저트", "베이커리",
    "크루아상", "빵", "티라미수", "빙수",
)
_CAFE_NAME_TERMS = ("카페", "커피", "디저트", "베이커리", "제과", "coffee", "cafe")


def _matches_name_term(name: str, term: str) -> bool:
    normalized_name = name.replace(" ", "").lower()
    normalized_term = term.replace(" ", "").lower()
    if normalized_term == "공원":
        normalized_name = normalized_name.replace("놀이공원", "")
    return normalized_term in normalized_name


def is_meal_place(place: Attraction) -> bool:
    """대표 메뉴와 이름으로 디저트 전문점을 식사 후보에서 제외합니다.

    메뉴 정보가 비어 있으면 음식점 분류를 유지합니다. 확인할 근거가 없는 장소를
    임의로 카페라고 단정하지 않기 위해서입니다.
    """
    if place.category != "음식점":
        return False
    menu = " ".join(field.value for field in place.extra_info if field.label == "대표 메뉴").lower()
    if any(term in menu for term in _MEAL_MENU_TERMS):
        return True
    if any(term in menu for term in _DESSERT_MENU_TERMS):
        return False
    return not any(term in place.name.lower() for term in _CAFE_NAME_TERMS)


@dataclass(frozen=True)
class VenueRequirement:
    label: str
    # 등산처럼 한 요청이 두 TourAPI 카테고리에 걸칠 수 있습니다.
    options: tuple[tuple[str, tuple[str, ...] | None], ...]
    meal_only: bool = False

    def matches(self, place: Attraction) -> bool:
        if (self.label == "음식점" or self.meal_only) and not is_meal_place(place):
            return False
        return any(
            place.category == category and (
                terms is None or any(_matches_name_term(place.name or "", term) for term in terms)
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

    @property
    def meal_required(self) -> bool:
        return any(requirement.label == "음식점" or requirement.meal_only
                   for requirement in self.requirements)

    def ordered_requirements(self) -> list[VenueRequirement]:
        return sorted(
            self.requirements,
            key=lambda requirement: all(terms is None for _, terms in requirement.options),
        )

    def accepts_food_place(self, place: Attraction) -> bool:
        if place.category != "음식점" or not self.meal_required or is_meal_place(place):
            return True
        # 식당과 카페를 따로 요청했다면 디저트 카페는 카페 후보로 남깁니다.
        return any(req.label in ("카페", "빵집") and not req.meal_only and req.matches(place)
                   for req in self.requirements)

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
        return any(_matches_name_term(place.name or "", term) for term in terms)

    def _requirement_assignment(self, places: list[Attraction]) -> dict[int, int]:
        # 한 장소가 '식당과 카페', '관광지와 박물관'을 동시에 채운 것으로
        # 계산하지 않습니다. 구체적인 요구부터 서로 다른 장소에 배정합니다.
        assigned: dict[int, int] = {}
        distinct_indices: list[int] = []
        seen_ids: set[str] = set()
        for index, place in enumerate(places):
            if place.content_id not in seen_ids:
                seen_ids.add(place.content_id)
                distinct_indices.append(index)

        def assign(requirement_index: int, seen: set[int]) -> bool:
            for place_index in distinct_indices:
                place = places[place_index]
                if place_index in seen or not self.requirements[requirement_index].matches(place):
                    continue
                seen.add(place_index)
                previous = assigned.get(place_index)
                if previous is None or assign(previous, seen):
                    assigned[place_index] = requirement_index
                    return True
            return False

        ordered = sorted(range(len(self.requirements)), key=lambda i: all(
            terms is None for _, terms in self.requirements[i].options
        ))
        for index in ordered:
            assign(index, set())
        return {requirement_index: place_index for place_index, requirement_index in assigned.items()}

    def missing_requirements(self, places: list[Attraction]) -> list[str]:
        covered = self._requirement_assignment(places)
        return [requirement.label for i, requirement in enumerate(self.requirements) if i not in covered]

    def covering_place_ids(self, places: list[Attraction]) -> list[str]:
        assignment = self._requirement_assignment(places)
        return [places[assignment[i]].content_id for i in range(len(self.requirements)) if i in assignment]

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
    (("관광지", "명소"), "문화시설", None),
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


_SEPARATE_STOP_SUFFIXES = (
    ",", "/", "+", "&", "와", "과", "랑", "이랑", "및", "그리고", "하고", "먹고", "후", "후에",
    "뒤", "뒤에", "이후", "다음", "다음에", "갔다가", "들렀다가", "둘러보고",
)


def _separate_stops(
    first: tuple[int, int], second: tuple[int, int], text: str
) -> bool:
    left, right = sorted((first, second))
    between = text[left[1]:right[0]]
    return 0 < len(between) <= 12 and between.endswith(_SEPARATE_STOP_SUFFIXES)


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

    by_label: dict[str, list[tuple[str, tuple[str, ...] | None]]] = {}
    label_spans: dict[str, list[tuple[int, int]]] = {}
    remaining_spans = _active_term_spans(text, all_terms)
    for terms, category, name_terms in _VENUE_RULES:
        spans = [span for term in terms for span in remaining_spans.get(term, [])]
        if not spans:
            continue
        label = {"맛집": "음식점", "등산": "등산로"}.get(terms[0], terms[0])
        by_label.setdefault(label, []).append((category, name_terms))
        label_spans.setdefault(label, []).extend(spans)
    # '점심 카페'의 점심은 별도 식당 한 곳을 요구하지 않습니다. 세부 장소가
    # 명시됐다면 같은 카테고리의 넓은 요구는 중복으로 세지 않습니다.
    requirements_list: list[VenueRequirement] = []
    for label, options in by_label.items():
        if all(terms is None for _, terms in options):
            overlapping_specifics = [specific_label for specific_label, specific_options in by_label.items()
                                     if specific_label != label and any(
                                         category == broad_category and terms is not None
                                         for broad_category, _ in options
                                         for category, terms in specific_options
                                     )]
            if overlapping_specifics and not any(
                _separate_stops(broad_span, specific_span, text)
                for specific_label in overlapping_specifics
                for broad_span in label_spans[label]
                for specific_span in label_spans[specific_label]
            ):
                continue
        requirements_list.append(VenueRequirement(label, tuple(options)))
    # '점심 카페'는 카페 한 곳 요청이지만 케이크만 파는 카페로 식사를 대신할
    # 수는 없습니다. '점심 먹고 카페'는 별도 식당 요구가 살아 있으므로 제외합니다.
    meal_terms = ("식사", "점심", "저녁", "아침", "식당", "음식점", "밥집", "브런치")
    if "음식점" in by_label and not any(req.label == "음식점" for req in requirements_list):
        if any(remaining_spans.get(term) for term in meal_terms):
            requirements_list = [
                VenueRequirement(req.label, req.options, meal_only=True)
                if req.label in ("카페", "빵집") else req
                for req in requirements_list
            ]
    requirements = tuple(requirements_list)
    by_category: dict[str, tuple[str, ...] | None] = {}
    for requirement in requirements:
        for category, terms in requirement.options:
            if category not in by_category or terms is None:
                by_category[category] = terms
            elif by_category[category] is not None:
                by_category[category] = tuple(sorted(set(by_category[category]) | set(terms)))
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
