"""자연어 요청에서 명시한 장소 유형을 추천 후보의 검증 조건으로 바꿉니다."""

import re
from dataclasses import dataclass

from app.models.schemas import Attraction


@dataclass(frozen=True)
class VenueConstraint:
    # None은 카테고리 전체를 허용하고, 단어 목록은 장소 이름까지 확인합니다.
    name_terms_by_category: dict[str, tuple[str, ...] | None]
    allow_other_categories: bool = False

    @property
    def categories(self) -> set[str]:
        return set(self.name_terms_by_category)

    def matches(self, place: Attraction) -> bool:
        if place.category not in self.name_terms_by_category:
            return self.allow_other_categories
        terms = self.name_terms_by_category[place.category]
        if terms is None:
            return True
        name = (place.name or "").replace(" ", "").lower()
        return any(term.replace(" ", "").lower() in name for term in terms)


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
    (("문화시설", "전시관", "전시", "공연장", "극장"), "문화시설", None),
    (("호텔",), "숙박", ("호텔", "hotel")),
    (("펜션",), "숙박", ("펜션",)),
    (("숙박", "숙소", "리조트", "모텔", "게스트하우스", "캠핑장"), "숙박", None),
    (("자전거",), "레포츠", ("자전거", "바이크", "사이클")),
    (("서핑",), "레포츠", ("서핑", "서프")),
    (("레포츠", "스포츠", "카약", "래프팅", "승마", "스키장"), "레포츠", None),
    (("공원",), "관광지", ("공원",)),
    (("관광지", "명소"), "관광지", None),
    (("산책로", "산책", "둘레길", "숲길"), "관광지",
     ("산책로", "둘레길", "숲길", "공원", "수목원")),
    (("수목원",), "관광지", ("수목원",)),
    (("계곡",), "관광지", ("계곡",)),
    (("호수",), "관광지", ("호수",)),
    (("해변",), "관광지", ("해변", "해수욕장")),
    (("전망대",), "관광지", ("전망대",)),
    (("사찰", "성곽", "행궁", "유적", "테마파크", "동물원", "놀이공원"),
     "관광지", None),
    (("등산", "등산로"), "관광지", ("등산로", "등산", "산")),
    (("등산", "등산로"), "레포츠", ("등산", "산악")),
)


def venue_constraint_for_query(query_text: str) -> VenueConstraint | None:
    """분명하게 언급한 장소만 제한합니다. 넓은 목적은 AI가 판단하게 둡니다."""
    text = re.sub(r"\s+", "", query_text or "")
    all_terms = {term for terms, _, _ in _VENUE_RULES for term in terms}
    for term in sorted(all_terms, key=len, reverse=True):
        # '공원 근처 식당'의 공원과 '미술관 말고 카페'의 미술관은 방문지가 아닙니다.
        text = re.sub(
            re.escape(term) + r"(?:에서|의|을|를|은|는)?(?:근처|주변|인근|말고|빼고|제외)",
            "",
            text,
        )

    by_category: dict[str, tuple[str, ...] | None] = {}
    for terms, category, name_terms in _VENUE_RULES:
        if not any(term in text for term in terms):
            continue
        if category not in by_category:
            by_category[category] = name_terms
        elif name_terms is not None and by_category[category] is None:
            by_category[category] = name_terms
        elif name_terms is not None and by_category[category] is not None:
            by_category[category] = tuple(sorted(set(by_category[category]) | set(name_terms)))
    # 하루 코스처럼 전체 일정을 요청했다면 언급한 식당은 필수지만, 관광지와
    # 문화시설도 함께 추천할 수 있어야 합니다.
    broad_trip = any(term in text for term in ("당일치기", "하루코스", "여행코스", "여행일정", "일일코스"))
    return VenueConstraint(by_category, allow_other_categories=broad_trip) if by_category else None
