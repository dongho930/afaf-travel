"""
요청 조건을 경고만 하지 않고 후보 단계에서 맞추는지, 제목·설명이 경고·순서·혼잡도
표시와 어긋나지 않는지 확인합니다.

재현 사례: "휠체어 짧은 동선 + 식사" 요청에 후보가 세 곳뿐이었고, 그중 공원 두 곳은
5.6km 떨어져 있었으며 식사 가능한 식당이 없었습니다. 제목은 "휠체어 친화 짧은 반나절
코스"인데 요약은 멀다고 경고했고, 2번째 장소 설명에 "앞쪽에 배치해", 혼잡도 '보통'인
곳 설명에 "방문객이 많이 몰리는 편"이 들어갔습니다.
"""

from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import (
    AccessibilityFeatures, Attraction, CongestionForecast, CourseResponse, CourseStop, InfoField, UserType,
)
from app.services import ai_service
from app.services.course_validator import (
    congestion_level, fits_congestion, strip_meal_from_title, validate_course,
)
from app.services.place_intent import venue_constraint_for_query
from app.services.route_cluster import narrow_for_short_route, prefer_confirmed_meals

# 위도 0.01도 ≈ 1.1km
BASE_LAT, BASE_LNG = 37.28, 127.05


def place(cid: str, category: str = "관광지", dlat: float = 0.0, menu: str | None = None,
          name: str | None = None, rate: float | None = None, forecast=None) -> Attraction:
    return Attraction(
        content_id=cid, name=name or cid, category=category, address="경기도 수원시 영통구",
        latitude=BASE_LAT + dlat, longitude=BASE_LNG,
        accessibility=AccessibilityFeatures(has_ramp=True, has_accessible_restroom=True),
        extra_info=[InfoField(label="대표 메뉴", value=menu)] if menu else [],
        congestion_rate=rate, congestion_forecast=forecast or [],
    )


def stop(order: int, attraction: Attraction, reason: str, time: str = "10:00") -> CourseStop:
    return CourseStop(order=order, attraction=attraction, recommended_arrival_time=time, reason=reason)


def course(stops: list[CourseStop], title: str = "t", summary: str = "s") -> CourseResponse:
    return CourseResponse(course_id="c", title=title, summary=summary, stops=stops,
                          generated_for=UserType.WHEELCHAIR)


# --- 후보 단계: 짧은 동선 (중간 강도) ----------------------------------------------

def test_짧은_동선이면_가까이_모인_묶음을_남기고_먼_곳은_뺀다():
    near = [place("park_a", dlat=0.0), place("museum", "문화시설", dlat=0.005),
            place("rest", "음식점", dlat=0.008, menu="비빔밥, 칼국수")]
    slightly = place("garden", dlat=0.02)   # 묶음에서 약 1.3km — 휠체어 한도(1.5km)의 2배 안
    far = place("park_b", dlat=0.05)        # 약 4.6km 이상 — 뺀다
    result = narrow_for_short_route([*near, slightly, far], "wheelchair")

    ids = [p.content_id for p in result.places]
    assert set(ids[:3]) == {"park_a", "museum", "rest"}
    assert "park_b" not in ids
    assert ids[-1] == "garden"
    assert result.nearby_km == {"garden": 1.3}


def test_조금_떨어진_곳은_뒤에_붙이고_거리를_알린다():
    cluster = [place("a"), place("b", dlat=0.005)]
    outside = place("c", dlat=0.025)   # b에서 약 2.2km: 1.5km 초과, 3.0km 이내
    result = narrow_for_short_route([outside, *cluster], "wheelchair")

    assert [p.content_id for p in result.places] == ["a", "b", "c"]
    assert result.nearby_km["c"] == 2.2


def test_식사_요청이면_식사가_확인된_식당이_있는_묶음을_고른다():
    constraint = venue_constraint_for_query("휠체어로 짧은 동선 공원 산책하고 점심 식사")
    # 공원만 셋 모인 묶음 vs 공원+식당 둘 모인 묶음
    parks = [place("p1"), place("p2", dlat=0.003), place("p3", dlat=0.006)]
    far_pair = [place("p4", dlat=0.1), place("r1", "음식점", dlat=0.103, menu="국밥")]
    result = narrow_for_short_route([*parks, *far_pair], "wheelchair", constraint)

    assert {"p4", "r1"} <= {p.content_id for p in result.places}


def test_식사가_확인된_식당이_있으면_확인_불가_식당은_뺀다():
    constraint = venue_constraint_for_query("수원 공원이랑 점심 식당")
    confirmed = place("r_ok", "음식점", menu="냉면, 갈비탕")
    unknown = place("r_unknown", "음식점", name="시그니처하우스")
    kept, unconfirmed = prefer_confirmed_meals([place("park"), confirmed, unknown], constraint)

    assert [p.content_id for p in kept] == ["park", "r_ok"]
    assert unconfirmed is False


def test_식사가_확인된_식당이_없으면_남기되_알린다():
    constraint = venue_constraint_for_query("수원 공원이랑 점심 식당")
    unknown = place("r_unknown", "음식점", name="시그니처하우스")
    kept, unconfirmed = prefer_confirmed_meals([place("park"), unknown], constraint)

    assert {p.content_id for p in kept} == {"park", "r_unknown"}
    assert unconfirmed is True


def test_추천_API가_재현_사례에서_먼_공원과_식사_불가_식당을_거른다(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")

    park_a = place("광교호수공원", dlat=0.0)
    park_b = place("광교중앙공원", dlat=0.05)            # 약 5.6km
    cafe = place("디저트카페", "음식점", dlat=0.004, menu="아메리카노, 케이크")
    meal = place("국밥집", "음식점", dlat=0.006, menu="순대국밥, 수육")
    museum = place("수원박물관", "문화시설", dlat=0.003)

    async def sample(**_kwargs):
        return [park_a, park_b, cafe, meal, museum]

    async def no_fill(_places):
        return 0

    monkeypatch.setattr(courses.tour_api_client, "sample_accessible_candidates", sample)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_fill)

    response = TestClient(app).post("/api/courses/recommend", json={
        "query_text": "휠체어로 짧은 동선 공원 코스와 점심 식사", "user_type": "wheelchair",
    })
    assert response.status_code == 200
    body = response.json()
    ids = {item["attraction"]["content_id"] for item in body["candidates"]}
    assert "광교중앙공원" not in ids
    assert "디저트카페" not in ids
    assert {"광교호수공원", "국밥집"} <= ids
    assert body["missing_categories"] == []


# --- 제목과 경고 ------------------------------------------------------------------

def test_먼_구간이_있으면_제목에서_짧은_동선_표현을_뺀다():
    c = course([stop(1, place("a"), "좋아요."), stop(2, place("b", dlat=0.05), "좋아요.")],
               title="휠체어 친화 짧은 반나절 코스")
    result = validate_course(c, "휠체어로 짧은 동선")

    assert result.title == "휠체어 친화 반나절 코스"
    assert "짧은 동선보다 멀어요" in result.summary


def test_가까우면_제목을_그대로_둔다():
    c = course([stop(1, place("a"), "좋아요."), stop(2, place("b", dlat=0.005), "좋아요.")],
               title="휠체어 친화 짧은 반나절 코스")
    assert validate_course(c, "휠체어로 짧은 동선").title == "휠체어 친화 짧은 반나절 코스"


def test_저장된_코스를_다시_읽을_땐_제목을_고치지_않는다():
    c = course([stop(1, place("a"), "좋아요."), stop(2, place("b", dlat=0.05), "좋아요.")],
               title="우리 가족 짧은 나들이")
    assert validate_course(c, "짧은 동선", sync_title=False).title == "우리 가족 짧은 나들이"


def test_식사_장소가_빠지면_제목에서_식사_표현을_뺀다():
    assert strip_meal_from_title("수원 공원과 맛집 코스") == "수원 공원 코스"
    assert strip_meal_from_title("맛집과 공원 나들이") == "공원 나들이"
    assert strip_meal_from_title("점심 코스") == "무장애 여행 코스"
    assert strip_meal_from_title("광교 산책 코스") == "광교 산책 코스"


# --- 설명과 순서 ------------------------------------------------------------------

def test_2번째_장소의_앞쪽_배치_설명은_지운다():
    places = [place("a"), place("b", dlat=0.003), place("c", dlat=0.006)]
    c = course([
        stop(1, places[0], "산책로가 넓어요."),
        stop(2, places[1], "경사로가 있어요. 붐비기 전에 앞쪽에 배치해 여유롭게 둘러볼 수 있어요."),
        stop(3, places[2], "장애인 화장실이 있어요."),
    ])
    reason = validate_course(c, "수원").stops[1].reason
    assert "앞쪽" not in reason
    assert "경사로가 있어요." in reason


def test_첫_장소의_앞쪽_설명은_남긴다():
    c = course([stop(1, place("a"), "경사로가 있어요. 먼저 들르기 좋아요."), stop(2, place("b"), "좋아요.")])
    assert "먼저 들르기" in validate_course(c, "수원").stops[0].reason


# --- 설명과 혼잡도 표시 -----------------------------------------------------------

def test_혼잡도_등급은_앱과_같은_경계를_쓴다():
    assert congestion_level(place("a", rate=67)) == "high"
    assert congestion_level(place("a", rate=65)) == "medium"
    assert congestion_level(place("a", rate=33)) == "low"
    assert congestion_level(place("a")) is None


def test_방문일_예보가_있으면_그날_등급을_쓴다():
    forecast = [CongestionForecast(date="2026-09-25", hour=0, congestion_level="low"),
                CongestionForecast(date="2026-09-27", hour=0, congestion_level="high")]
    p = place("a", rate=50, forecast=forecast)
    assert congestion_level(p, "2026-09-27") == "high"
    assert congestion_level(p) == "low"          # 방문일을 모르면 예보 첫 줄 (앱과 같음)
    assert congestion_level(p, "2026-10-01") == "medium"  # 그날 예보가 없으면 집중률


def test_보통인_곳을_많이_몰리는_편이라고_설명하지_않는다():
    park = place("광교중앙공원", rate=55)
    c = course([
        stop(1, place("a"), "좋아요."),
        stop(2, park, "경사로가 있어요. 방문객이 많이 몰리는 편이에요."),
    ])
    result = validate_course(c, "수원")
    assert result.stops[1].congestion_level == "medium"
    assert "몰리는" not in result.stops[1].reason
    assert "경사로가 있어요." in result.stops[1].reason


def test_혼잡한_곳은_붐빈다는_설명을_남긴다():
    c = course([stop(1, place("a", rate=80), "평소 사람이 많이 몰리는 곳이에요.")])
    assert "몰리는" in validate_course(c, "수원").stops[0].reason


def test_혼잡도_주장_판별():
    assert fits_congestion("혼잡도가 보통 수준이에요.", "medium")
    assert not fits_congestion("한산하게 둘러볼 수 있어요.", "medium")
    assert fits_congestion("붐비지 않아 여유로워요.", "medium")
    assert not fits_congestion("붐비지 않아 여유로워요.", "high")
    assert not fits_congestion("사람이 덜 몰리도록 일찍 가세요.", "medium")
    assert not fits_congestion("사람이 많이 몰려요.", None)
    assert fits_congestion("경사로가 있어요.", None)
