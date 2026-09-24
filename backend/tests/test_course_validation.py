"""코스 검증: 짧은 동선 거리, 음료 위주 가게의 식사 설명, 경로 무장애 단정을 걸러냅니다."""

import asyncio

import pytest

from app.models.schemas import (
    AccessibilityFeatures, Attraction, CourseResponse, CourseStop, GenerateFromSelectionRequest,
    InfoField, UserType,
)
from app.services import ai_service
from app.services.course_validator import clean_reason, prefers_short_route, validate_course
from app.services.place_intent import is_meal_place


def place(cid: str, name: str, category: str = "관광지", lat: float = 37.28, lng: float = 127.01,
          menu: str | None = None, **features) -> Attraction:
    return Attraction(
        content_id=cid, name=name, category=category, address="경기도 수원시",
        latitude=lat, longitude=lng,
        accessibility=AccessibilityFeatures(**features),
        extra_info=[InfoField(label="대표 메뉴", value=menu)] if menu else [],
    )


def stop(order: int, attraction: Attraction, time: str = "10:00", reason: str = "좋은 곳이에요.") -> CourseStop:
    return CourseStop(order=order, attraction=attraction, recommended_arrival_time=time, reason=reason)


def course(stops: list[CourseStop], user_type: UserType = UserType.GENERAL) -> CourseResponse:
    return CourseResponse(course_id="c", title="t", summary="s", stops=stops, generated_for=user_type)


@pytest.mark.parametrize("query, expected", [
    ("수원 짧은 동선으로 하루 코스", True),
    ("이동 적게 다닐 수 있는 곳", True),
    ("휠체어로 덜 걷는 코스", True),
    ("가까운 곳끼리 묶어줘", True),
    ("공원 근처 식당", False),
    ("수원 가족 여행", False),
])
def test_짧은_동선_요청_인식(query, expected):
    assert prefers_short_route(query) is expected


def test_짧은_동선인데_먼_구간이면_경고한다():
    # 위도 0.045도 ≈ 5km, 도로 보정 1.3배 ≈ 6.5km
    near = place("a", "화성행궁", lat=37.28)
    far = place("b", "광교호수공원", lat=37.325)
    result = validate_course(course([stop(1, near), stop(2, far)]), "짧은 동선으로 추천해줘")

    assert result.stops[0].distance_from_prev_km is None
    assert result.stops[1].distance_from_prev_km == pytest.approx(6.5, abs=0.2)
    assert any("짧은 동선" in w and "3km" in w for w in result.stops[1].warnings)


def test_짧은_동선_요청이_없으면_거리만_보여준다():
    near = place("a", "화성행궁", lat=37.28)
    far = place("b", "광교호수공원", lat=37.325)
    result = validate_course(course([stop(1, near), stop(2, far)]), "수원 여행")
    assert result.stops[1].distance_from_prev_km is not None
    assert result.stops[1].warnings == []


def test_휠체어_사용자는_짧은_동선_기준이_더_좁다():
    a = place("a", "A", lat=37.28, has_ramp=True, has_accessible_restroom=True)
    b = place("b", "B", lat=37.2995, has_ramp=True)  # ≈ 2.8km
    result = validate_course(course([stop(1, a), stop(2, b)], UserType.WHEELCHAIR), "짧은 동선")
    assert any("2km" in w for w in result.stops[1].warnings)


@pytest.mark.parametrize("name, menu", [
    ("수원 전통찻집", None),
    ("라온 티하우스", None),
    ("라온", "대추차, 쌍화차, 식혜"),
    ("라온", "브런치, 아메리카노, 카페라떼"),
])
def test_음료_위주_가게는_식사_장소가_아니다(name, menu):
    assert not is_meal_place(place("t", name, "음식점", menu=menu))


def test_식사_메뉴가_더_많으면_식사_장소다():
    assert is_meal_place(place("r", "라온", "음식점", menu="김치찌개, 제육볶음, 아메리카노"))


def test_점심_시간의_음료_가게는_경고하고_식사_설명을_지운다():
    teahouse = place("t", "수원 전통찻집", "음식점", menu="대추차, 식혜")
    result = validate_course(
        course([stop(1, teahouse, time="12:10", reason="점심 먹기 좋은 곳이에요. 한옥 분위기가 좋아요.")]),
        "수원 여행",
    )
    assert any("점심 식사는 어려울" in w for w in result.stops[0].warnings)
    assert result.stops[0].reason == "한옥 분위기가 좋아요."


def test_경로_무장애_단정은_지우고_코스_경고를_붙인다():
    a = place("a", "A", has_ramp=True, has_accessible_restroom=True)
    b = place("b", "B", lat=37.281, has_elevator=True)
    reason = "경사로가 있어요. 다음 장소까지 휠체어로 편하게 이동할 수 있어요."
    result = validate_course(course([stop(1, a, reason=reason), stop(2, b)], UserType.WHEELCHAIR), "수원")

    assert result.stops[0].reason == "경사로가 있어요."
    assert any("무장애 여부는 확인되지 않았" in w for w in result.warnings)


def test_시설_안의_동선_설명은_남긴다():
    a = place("a", "A", has_stroller_accessible_path=True)
    reason = "시설 안에 유모차로 이동하기 편한 동선이 있어요."
    assert clean_reason(reason, a) == reason


def test_등록되지_않은_편의시설과_필수시설_누락을_경고한다():
    a = place("a", "A")  # 휠체어 관련 시설이 하나도 없음
    result = validate_course(
        course([stop(1, a, reason="엘리베이터가 있어 편해요. 전시가 알차요.")], UserType.WHEELCHAIR), "수원"
    )
    assert result.stops[0].reason == "전시가 알차요."
    assert any("휠체어 편의시설이 등록돼 있지 않아요" in w for w in result.stops[0].warnings)
    assert any("장애인 화장실" in w for w in result.warnings)


def test_검증은_여러_번_돌려도_같다():
    teahouse = place("t", "수원 전통찻집", "음식점")
    c = course([stop(1, place("a", "A")), stop(2, teahouse, time="12:00", reason="점심 장소예요.")])
    first = validate_course(c, "짧은 동선").model_dump()
    second = validate_course(c, "짧은 동선").model_dump()
    assert first == second


def test_선택한_장소로_코스를_만들면_검증_결과가_붙는다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    near = place("a", "화성행궁", lat=37.28)
    far = place("b", "광교호수공원", lat=37.325)
    request = GenerateFromSelectionRequest(
        query_text="짧은 동선으로 추천해줘", user_type="general", region="경기도",
        selected_content_ids=["a", "b"],
    )
    result = asyncio.run(ai_service.generate_course_from_selection(request, [near, far]))
    assert any("짧은 동선" in w for s in result.stops for w in s.warnings)
