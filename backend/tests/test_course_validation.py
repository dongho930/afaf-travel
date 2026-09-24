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
    # 위도 0.045도 ≈ 직선 5km
    near = place("a", "화성행궁", lat=37.28)
    far = place("b", "광교호수공원", lat=37.325)
    result = validate_course(course([stop(1, near), stop(2, far)]), "짧은 동선으로 추천해줘")

    assert result.stops[0].distance_from_prev_km is None
    assert result.stops[1].distance_from_prev_km == pytest.approx(5.0, abs=0.1)
    assert any("직선거리로 약 5.0km" in w and "2.3km" in w for w in result.stops[1].warnings)


def test_짧은_동선_요청이_없으면_거리만_보여준다():
    near = place("a", "화성행궁", lat=37.28)
    far = place("b", "광교호수공원", lat=37.325)
    result = validate_course(course([stop(1, near), stop(2, far)]), "수원 여행")
    assert result.stops[1].distance_from_prev_km is not None
    assert result.stops[1].warnings == []


def test_휠체어_사용자는_짧은_동선_기준이_더_좁다():
    a = place("a", "A", lat=37.28, has_ramp=True, has_accessible_restroom=True)
    b = place("b", "B", lat=37.2995, has_ramp=True)  # 직선 ≈ 2.2km
    result = validate_course(course([stop(1, a), stop(2, b)], UserType.WHEELCHAIR), "짧은 동선")
    assert any("1.5km" in w for w in result.stops[1].warnings)


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


@pytest.mark.parametrize("menu", ["시그니처 바닐라", "시그니처 바닐라, 아인슈페너"])
def test_식사_메뉴가_확인되지_않으면_식사_장소가_아니다(menu):
    # 심사 지적 사례: 대표 메뉴가 '시그니처 바닐라'인 텔온
    assert not is_meal_place(place("tel", "텔온", "음식점", menu=menu))


def test_취급_메뉴도_함께_본다():
    shop = place("s", "라온", "음식점").model_copy(update={"extra_info": [
        InfoField(label="대표 메뉴", value="시그니처 바닐라"),
        InfoField(label="취급 메뉴", value="들깨칼국수, 보리밥"),
    ]})
    assert is_meal_place(shop)


@pytest.mark.parametrize("menu", ["한우 모둠", "도토리묵밥", "아귀찜", "골목시장 먹거리", "들깨수제비"])
def test_흔한_식당_메뉴는_식사로_인정한다(menu):
    assert is_meal_place(place("r", "라온", "음식점", menu=menu))


def test_메뉴_정보가_없으면_이름으로_판단한다():
    assert is_meal_place(place("r", "수원 한식당", "음식점"))
    assert not is_meal_place(place("c", "라온 카페", "음식점"))


def test_점심_전_장소의_점심_후_설명은_지운다():
    # 심사 지적 사례: 광교호수공원이 점심 전 2번째인데 '점심 후에도 산책'이라고 설명
    first = place("a", "화성행궁")
    lake = place("b", "광교호수공원", lat=37.281)
    lunch = place("c", "수원 한식당", "음식점", lat=37.282, menu="김치찌개")
    reason = "호수를 따라 걷기 좋아요. 점심 후에도 산책을 이어갈 수 있어요."
    result = validate_course(course([
        stop(1, first, time="09:00"),
        stop(2, lake, time="10:40", reason=reason),
        stop(3, lunch, time="12:20"),
    ]), "수원 여행")
    assert result.stops[1].reason == "호수를 따라 걷기 좋아요."


def test_점심_뒤_장소의_점심_후_설명은_남긴다():
    lunch = place("a", "수원 한식당", "음식점", menu="김치찌개")
    lake = place("b", "광교호수공원", lat=37.281)
    reason = "점심 후에 산책하기 좋아요."
    result = validate_course(course([
        stop(1, lunch, time="12:00"), stop(2, lake, time="13:20", reason=reason),
    ]), "수원 여행")
    assert result.stops[1].reason == reason


def test_마지막이_아닌데_마지막으로라고_하면_지운다():
    a = place("a", "A")
    b = place("b", "B", lat=37.281)
    result = validate_course(course([
        stop(1, a, reason="마지막으로 노을을 보기 좋아요. 전망이 좋아요."), stop(2, b),
    ]), "수원")
    assert result.stops[0].reason == "전망이 좋아요."


def test_음료_가게의_점심_설명만_남으면_기본_문구로_바꾼다():
    tel = place("tel", "텔온", "음식점", menu="시그니처 바닐라")
    result = validate_course(course([stop(1, tel, time="12:00", reason="점심을 먹기 좋은 곳이에요.")]), "수원")
    assert "점심" not in result.stops[0].reason
    assert any("점심 식사는 어려울" in w for w in result.stops[0].warnings)


# --- 분류 코드와 '확인 불가' 상태 ----------------------------------------------

from app.services.place_intent import MEAL, MEAL_UNKNOWN, NOT_MEAL, meal_slot_indices, meal_status
from app.services.schedule import arrange_for_meals
from app.services.tour_api import TourApiClient


@pytest.mark.parametrize("lcls, cat3, menu, expected", [
    ("FD050100", None, "김치찌개", NOT_MEAL),      # 카페 분류면 메뉴와 상관없이 식사 불가
    (None, "A05020900", None, NOT_MEAL),
    ("FD010100", None, "OO 스페셜", MEAL),         # 한식 분류면 특이한 메뉴 이름이어도 식사 가능
    ("FD020300", None, None, MEAL),
    (None, "A05020100", "OO 스페셜", MEAL),
    ("FD040100", None, "OO 스페셜", MEAL_UNKNOWN),  # 주점은 메뉴로 판단
    (None, None, "OO 스페셜", MEAL_UNKNOWN),
    (None, None, "시그니처 바닐라", NOT_MEAL),
])
def test_분류_코드를_먼저_보고_메뉴로_넘어간다(lcls, cat3, menu, expected):
    shop = place("s", "라온", "음식점", menu=menu).model_copy(update={"lcls_systm": lcls, "cat3": cat3})
    assert meal_status(shop) == expected


def test_메뉴가_없으면_이름으로_식당_카페_확인불가를_가른다():
    assert meal_status(place("a", "수원 한식당", "음식점")) == MEAL
    assert meal_status(place("b", "라온 카페", "음식점")) == NOT_MEAL
    assert meal_status(place("c", "라온", "음식점")) == MEAL_UNKNOWN


def test_식사_자리는_확인된_식당을_우선하고_없을_때만_확인불가를_쓴다():
    unknown = place("u", "라온", "음식점", menu="OO 스페셜")
    confirmed = place("m", "수원 국밥", "음식점", menu="순대국밥")
    assert meal_slot_indices([unknown, confirmed]) == {1}
    assert meal_slot_indices([unknown, place("t", "A")]) == {0}


def test_확인불가_식당이_점심_자리에_놓이면_확인_경고를_붙인다():
    unknown = place("u", "라온", "음식점", menu="OO 스페셜")
    result = validate_course(course([stop(1, unknown, time="12:00", reason="점심 먹기 좋아요.")]), "수원")
    assert any("식사가 가능한지 확인하지 못했어요" in w for w in result.stops[0].warnings)
    assert "점심" not in result.stops[0].reason


def test_확인불가_식당만_있으면_점심_자리에_배치한다():
    # 확인 불가 식당이 09시 첫 자리에 있어도, 식사 자리 후보로 인정돼 점심 시간으로 옮겨집니다.
    spots = [place("u", "라온", "음식점", menu="OO 스페셜"), place("a", "A"), place("b", "B", lat=37.281)]
    assert arrange_for_meals(spots)[0] != 0


def test_목록_응답과_캐시가_분류_코드를_보존한다():
    item = {"contentid": "1", "title": "텔온", "mapx": "127.0", "mapy": "37.3",
            "lclsSystm2": "FD05", "lclsSystm3": "FD050100", "cat3": "A05020900"}
    attraction = TourApiClient._map_item_to_attraction(item, 39)
    assert attraction.lcls_systm == "FD050100"
    assert attraction.cat3 == "A05020900"
    restored = TourApiClient._attraction_from_cache_dict(TourApiClient._attraction_to_cache_dict(attraction))
    assert (restored.lcls_systm, restored.cat3) == ("FD050100", "A05020900")
    assert meal_status(restored) == NOT_MEAL
