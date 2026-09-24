"""심사 피드백 회귀 검사: 설명 보존, 요약-경고 일치, 식당 연속 배치."""

import asyncio

import pytest

from app.models.schemas import (
    AccessibilityFeatures, Attraction, CourseResponse, CourseStop, GenerateFromSelectionRequest,
    InfoField, PlaceRecommendationRequest, UserType,
)
from app.services import ai_service
from app.services.course_validator import clean_reason, facility_reason, validate_course
from app.services.schedule import arrange_for_meals, build_schedule, meal_window_at


def place(cid: str, name: str, category: str = "관광지", lat: float = 37.28, lng: float = 127.01,
          menu: str | None = None, hours: str | None = None, **features) -> Attraction:
    extra = []
    if menu:
        extra.append(InfoField(label="대표 메뉴", value=menu))
    if hours:
        extra.append(InfoField(label="영업시간", value=hours))
    return Attraction(
        content_id=cid, name=name, category=category, address="경기도 시흥시",
        latitude=lat, longitude=lng, accessibility=AccessibilityFeatures(**features), extra_info=extra,
    )


def stop(order: int, attraction: Attraction, time: str = "10:00", reason: str = "좋은 곳이에요.") -> CourseStop:
    return CourseStop(order=order, attraction=attraction, recommended_arrival_time=time, reason=reason)


def course(stops: list[CourseStop], user_type: UserType = UserType.GENERAL, summary: str = "요약") -> CourseResponse:
    return CourseResponse(course_id="c", title="t", summary=summary, stops=stops, generated_for=user_type)


ALL_WHEELCHAIR = dict(has_ramp=True, has_elevator=True, has_accessible_restroom=True, has_wheelchair_rental=True)


# ---------------------------------------------------------------------------
# 1. 설명: 장소 안의 편의시설 설명은 남기고, 장소 사이 경로 단정만 지운다
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("user_type, features, reason", [
    ("wheelchair", ALL_WHEELCHAIR, "휠체어 이동에 필요한 경사로가 있어요."),
    ("wheelchair", ALL_WHEELCHAIR, "경사로와 엘리베이터가 있어 휠체어로 관람하기 편해요."),
    ("wheelchair", ALL_WHEELCHAIR, "휠체어로 이동하기 편한 넓은 전시실이 있어요."),
    ("wheelchair", ALL_WHEELCHAIR, "장애인 화장실이 있어 오래 머물러도 안심이에요."),
    ("senior", dict(has_rest_area=True), "관람 동선이 편해 고령자도 무리 없이 둘러볼 수 있어요."),
    ("senior", dict(has_rest_area=True), "휴게 공간이 있어 쉬어 가기 좋아요."),
    ("stroller", dict(has_stroller_accessible_path=True), "유모차로 이동하기 편한 동선이 있어요."),
    ("visual", dict(has_braille_block=True, has_visual_accessibility=True), "점자블록과 오디오 가이드가 있어요."),
    ("hearing", dict(has_sign_guide=True, has_hearing_accessibility=True), "수어 안내가 있어 편하게 관람할 수 있어요."),
    ("general", {}, "붐비기 전에 먼저 둘러보면 여유로워요."),
    ("general", {}, "넓은 잔디광장이 있어 아이와 쉬기 좋아요."),
])
def test_장소_안의_설명은_남긴다(user_type, features, reason):
    assert clean_reason(reason, place("a", "A", **features), user_type=user_type) == reason


@pytest.mark.parametrize("reason", [
    "다음 장소까지 휠체어로 편하게 이동할 수 있어요.",
    "장소 사이 이동 경로가 평탄해요.",
    "코스 전체가 무장애 동선으로 이어져 있어요.",
    "주변 보도가 넓어 안전하게 이동할 수 있어요.",
    "두 곳이 턱 없이 이어지는 길이라 편해요.",
    "오가는 길에 계단이 없어 수월해요.",
])
def test_장소_사이_경로_단정은_지운다(reason):
    kept = "전시가 알차요."
    result = clean_reason(f"{kept} {reason}", place("a", "A", **ALL_WHEELCHAIR), user_type="wheelchair")
    assert result == kept


def test_등록되지_않은_시설을_말한_문장만_지운다():
    result = clean_reason("엘리베이터가 있어요. 경사로가 있어 편해요.", place("a", "A", has_ramp=True))
    assert result == "경사로가 있어 편해요."


# ---------------------------------------------------------------------------
# 2. 설명이 모두 지워지면 기본 문구 대신 등록된 편의시설로 설명한다
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("user_type, category, features, expected", [
    ("wheelchair", "관광지", dict(has_ramp=True, has_accessible_restroom=True),
     "경사로·장애인 화장실 정보가 등록된 관광지예요."),
    ("wheelchair", "문화시설", ALL_WHEELCHAIR, "경사로·엘리베이터·장애인 화장실 정보가 등록된 문화시설이에요."),
    ("stroller", "관광지", dict(has_stroller_accessible_path=True, has_lactation_room=True),
     "유모차 이동 동선·수유실 정보가 등록된 관광지예요."),
    ("visual", "문화시설", dict(has_audio_guide=True), "오디오 가이드 정보가 등록된 문화시설이에요."),
    ("hearing", "관광지", dict(has_sign_guide=True), "수어 안내 정보가 등록된 관광지예요."),
    ("senior", "레포츠", dict(has_rest_area=True), "휴게 공간 정보가 등록된 레포츠예요."),
])
def test_모두_지워지면_편의시설로_설명한다(user_type, category, features, expected):
    target = place("a", "A", category, **features)
    assert clean_reason("다음 장소까지 편하게 이동해요.", target, user_type=user_type) == expected


def test_사용자_유형과_무관한_시설로는_설명하지_않는다():
    # 시각장애 사용자에게 경사로를 근거로 들지 않습니다.
    assert facility_reason(place("a", "A", has_ramp=True), "visual") is None
    assert clean_reason("", place("a", "A", has_ramp=True), user_type="visual") == "요청하신 조건에 맞춰 고른 관광지예요."


def test_코스_검증에서도_편의시설_설명으로_대체된다():
    first = place("a", "갯골생태공원", **ALL_WHEELCHAIR, has_rest_area=True)
    second = place("b", "시흥오이도박물관", "문화시설", lat=37.281, has_ramp=True, has_elevator=True)
    result = validate_course(course([
        stop(1, first, reason="다음 장소까지 휠체어로 편하게 이동할 수 있어요."),
        stop(2, second, reason="마지막으로 들르기 좋아요. 코스 전체가 무장애 동선이에요."),
    ], UserType.WHEELCHAIR), "시흥 여행")
    assert result.stops[0].reason == "경사로·엘리베이터·장애인 화장실 정보가 등록된 관광지예요."
    assert result.stops[1].reason == "마지막으로 들르기 좋아요."


def test_장소_추천_단계도_편의시설_설명을_쓴다():
    request = PlaceRecommendationRequest(query_text="시흥 여행", user_type="wheelchair", region="경기도")
    target = place("a", "A", has_ramp=True)
    assert ai_service._safe_recommendation_reason(
        "다음 장소까지 안전하게 이동할 수 있어요.", target, request
    ) == "경사로 정보가 등록된 관광지예요."


# ---------------------------------------------------------------------------
# 3. 요약과 경고가 서로 맞는다
# ---------------------------------------------------------------------------

def far_course(summary: str, user_type: UserType = UserType.WHEELCHAIR) -> CourseResponse:
    return course([
        stop(1, place("a", "A", **ALL_WHEELCHAIR)),
        stop(2, place("b", "B", lat=37.30, **ALL_WHEELCHAIR)),  # 직선 ≈ 2.2km
    ], user_type, summary=summary)


def test_짧은_동선_경고가_있으면_요약의_짧은_동선_주장을_지운다():
    result = validate_course(far_course("짧은 동선으로 묶은 시흥 코스예요. 바다 풍경을 즐겨요."), "짧은 동선으로")
    assert "짧은 동선으로 묶은" not in result.summary
    assert result.summary.startswith("바다 풍경을 즐겨요.")
    assert "일부 구간은 요청하신 짧은 동선보다 멀어요(최대 직선 약 2.2km)." in result.summary


@pytest.mark.parametrize("claim", [
    "가까운 곳끼리 모았어요.", "이동이 적은 코스예요.", "이동 부담이 적어요.", "멀지 않은 곳들이에요.",
    "동선이 짧아 편해요.",
])
def test_요약의_다양한_짧은_동선_표현을_지운다(claim):
    result = validate_course(far_course(f"{claim} 풍경이 좋아요."), "이동 적게")
    assert claim not in result.summary
    assert "풍경이 좋아요." in result.summary


def test_요약이_전부_주장이면_기본_문구에_안내를_붙인다():
    result = validate_course(far_course("짧은 동선 코스예요."), "짧은 동선")
    assert result.summary.startswith("선택하신 장소로 구성한 코스예요. ※ ")


def test_짧은_동선을_지키면_요약을_바꾸지_않는다():
    summary = "짧은 동선으로 묶은 코스예요."
    near = course([stop(1, place("a", "A")), stop(2, place("b", "B", lat=37.285))], summary=summary)
    assert validate_course(near, "짧은 동선").summary == summary


def test_짧은_동선_요청이_없으면_먼_구간이어도_요약을_바꾸지_않는다():
    summary = "바다를 따라 도는 코스예요."
    assert validate_course(far_course(summary), "시흥 여행").summary == summary


def test_요약_안내는_여러_번_검증해도_한_번만_붙는다():
    c = far_course("바다 풍경을 즐겨요.")
    validate_course(c, "짧은 동선")
    once = c.summary
    validate_course(c, "짧은 동선")
    assert c.summary == once
    assert c.summary.count("※") == 1


def test_다시_검증해도_라우터가_붙인_식사_안내는_남는다():
    c = far_course("바다 풍경을 즐겨요.")
    validate_course(c, "짧은 동선")
    c.summary += " 요청하신 식사 장소가 이 코스에 포함되지 않았어요."
    validate_course(c, "짧은 동선")
    assert "요청하신 식사 장소가 이 코스에 포함되지 않았어요." in c.summary
    assert c.summary.count("짧은 동선보다 멀어요") == 1


def test_순서를_바꿔_경고가_사라지면_요약_안내도_사라진다():
    c = far_course("바다 풍경을 즐겨요.")
    validate_course(c, "짧은 동선")
    assert "※" in c.summary
    c.stops[1].attraction = place("b", "B", lat=37.285, **ALL_WHEELCHAIR)
    validate_course(c, "짧은 동선")
    assert c.summary == "바다 풍경을 즐겨요."


# ---------------------------------------------------------------------------
# 4. 식당이 연달아 오지 않는다
# ---------------------------------------------------------------------------

def is_food_pair(attractions: list[Attraction], order: list[int]) -> bool:
    return any(attractions[a].category == "음식점" and attractions[b].category == "음식점"
               for a, b in zip(order, order[1:]))


def test_심사_사례_관광지_카페_식당은_식당끼리_붙지_않는다():
    # 관광지 1곳 + 음식점 2곳(시화연풍 + 식당)을 직접 고른 경우
    spots = [
        place("park", "갯골생태공원"),
        place("cafe", "시화연풍", "음식점", lat=37.281, menu="아메리카노, 케이크"),
        place("food", "오이도 칼국수", "음식점", lat=37.282, menu="바지락칼국수"),
    ]
    order = arrange_for_meals(spots)
    assert not is_food_pair(spots, order)


@pytest.mark.parametrize("names", [
    ("r1", "r2", "a1", "a2"),
    ("a1", "r1", "r2", "a2"),
    ("a1", "a2", "r1", "r2"),
    ("r1", "a1", "r2", "a2"),
])
def test_식당_두_곳은_관광지를_사이에_둔다(names):
    catalog = {
        "r1": place("r1", "수원 국밥", "음식점", lat=37.281, menu="순대국밥"),
        "r2": place("r2", "수원 칼국수", "음식점", lat=37.282, menu="칼국수"),
        "a1": place("a1", "화성행궁"),
        "a2": place("a2", "수원화성박물관", "문화시설", lat=37.283),
    }
    spots = [catalog[n] for n in names]
    assert not is_food_pair(spots, arrange_for_meals(spots))


def test_사이를_띄워도_점심_식당은_점심_시간에_도착한다():
    spots = [
        place("r1", "수원 국밥", "음식점", menu="순대국밥"),
        place("r2", "수원 카페", "음식점", lat=37.281, menu="아메리카노"),
        place("a1", "화성행궁", lat=37.282),
        place("a2", "수원화성박물관", "문화시설", lat=37.283),
    ]
    order = arrange_for_meals(spots)
    placed = [spots[i] for i in order]
    times = {p.content_id: s.arrival_time for p, s in zip(placed, build_schedule(placed))}
    assert not is_food_pair(spots, order)
    assert meal_window_at(times["r1"]) == "점심"


def test_음식점만_고르면_순서는_그대로고_경고와_요약_안내가_붙는다():
    spots = [
        place("r1", "수원 국밥", "음식점", menu="순대국밥"),
        place("r2", "수원 카페", "음식점", lat=37.281, menu="아메리카노"),
    ]
    assert arrange_for_meals(spots) in ([0, 1], [1, 0])
    result = validate_course(course([stop(1, spots[0], time="12:00"), stop(2, spots[1], time="13:10")]), "수원")
    assert any("식당이 연달아" in w for w in result.stops[1].warnings)
    assert "식당이 연달아 배치된 구간이 있어요." in result.summary


def test_음식점_셋에_관광지_하나면_연속을_하나로_줄인다():
    spots = [
        place("r1", "국밥집", "음식점", menu="국밥"),
        place("r2", "칼국수집", "음식점", lat=37.281, menu="칼국수"),
        place("r3", "카페", "음식점", lat=37.282, menu="아메리카노"),
        place("a1", "화성행궁", lat=37.283),
    ]
    order = arrange_for_meals(spots)
    pairs = sum(1 for a, b in zip(order, order[1:])
                if spots[a].category == "음식점" and spots[b].category == "음식점")
    assert pairs == 1


def test_식사_시간대가_아닐_때_도착하는_식당에_경고한다():
    r = place("r", "수원 국밥", "음식점", menu="국밥")
    result = validate_course(course([stop(1, place("a", "A")), stop(2, r, time="15:30")]), "수원")
    assert any("식사 시간대" in w for w in result.stops[1].warnings)


def test_선택_코스_생성_전체_흐름에서_식당이_붙지_않고_요약이_경고와_맞는다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    spots = [
        place("park", "갯골생태공원", **ALL_WHEELCHAIR),
        place("cafe", "시화연풍", "음식점", lat=37.281, menu="아메리카노, 케이크", **ALL_WHEELCHAIR),
        place("food", "오이도 칼국수", "음식점", lat=37.30, menu="바지락칼국수", **ALL_WHEELCHAIR),
    ]
    request = GenerateFromSelectionRequest(
        query_text="휠체어로 짧은 동선 코스", user_type="wheelchair", region="경기도",
        selected_content_ids=[s.content_id for s in spots],
    )
    result = asyncio.run(ai_service.generate_course_from_selection(request, spots))
    categories = [s.attraction.category for s in result.stops]
    assert all(not (a == b == "음식점") for a, b in zip(categories, categories[1:]))
    has_far_warning = any("짧은 동선" in w for s in result.stops for w in s.warnings)
    assert ("짧은 동선보다 멀어요" in result.summary) == has_far_warning
    assert all(s.reason and "요청하신 조건에 맞춰 고른" not in s.reason for s in result.stops)


def test_첫_장소_09시_카페에는_아침_식사_경고를_붙이지_않는다():
    cafe = place("c", "시화연풍", "음식점", menu="아메리카노")
    result = validate_course(course([stop(1, cafe, time="09:00"), stop(2, place("a", "A"))]), "시흥")
    assert result.stops[0].warnings == []


def test_AI_없이_만든_코스도_편의시설로_설명한다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    spots = [place("a", "갯골생태공원", **ALL_WHEELCHAIR), place("b", "B", lat=37.281, has_ramp=True)]
    request = GenerateFromSelectionRequest(
        query_text="시흥 여행", user_type="wheelchair", region="경기도", selected_content_ids=["a", "b"],
    )
    result = asyncio.run(ai_service.generate_course_from_selection(request, spots))
    reasons = {s.attraction.content_id: s.reason for s in result.stops}
    assert reasons["a"] == "경사로·엘리베이터·장애인 화장실 정보가 등록된 관광지예요."
    assert reasons["b"] == "경사로 정보가 등록된 관광지예요."
