"""
추천이 적을 때 — 요청한 종류가 지역에 없으면 비슷한 종류로 대신하고, 그래도 적으면 이유를 알려주는지.

가평 '계곡이랑 맛집'은 자료에 계곡이 없어 음식점 3곳만 나왔고, 2단계에서는 계곡을
고르라며 코스를 만들 수 없었습니다. 분당 박물관 월요일 요청은 1곳만 나오는데 왜
적은지 알려주지 않았습니다.
"""
import asyncio

from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction, PlaceRecommendationRequest
from app.services import ai_service, tour_api
from app.services.place_intent import venue_constraint_for_query


def place(cid, name, category="관광지", lcls=None, address="경기도 가평군 가평읍"):
    return Attraction(content_id=cid, name=name, category=category, address=address,
                      latitude=37.8, longitude=127.5, lcls_systm=lcls)


LAKE_PARK = place("park", "호명호수공원", lcls="NA0202")
FOREST = place("forest", "잣향기푸른숲", lcls="NA0406")
FOOD = place("food", "가평 막국수", category="음식점")


def _region(monkeypatch, pool):
    async def region_attractions(_self, _code="41"):
        return pool

    async def no_rows(_ids):
        return {}

    monkeypatch.setattr(tour_api.TourApiClient, "_region_attractions", region_attractions)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", no_rows)


def test_없는_종류는_비슷한_종류로_넓히고_안내():
    constraint = venue_constraint_for_query("계곡이랑 맛집").with_substitutes(["계곡"])
    assert constraint.matches(LAKE_PARK)
    assert constraint.missing_requirements([LAKE_PARK, FOOD]) == []
    assert constraint.substitute_notices() == ["계곡을 찾지 못해 비슷한 자연 관광지를 대신 추천했어요."]


def test_지역에_계곡이_없을_때만_넓힘(monkeypatch):
    constraint = venue_constraint_for_query("계곡이랑 맛집")
    client = tour_api.tour_api_client

    _region(monkeypatch, [LAKE_PARK, FOREST, FOOD])
    widened = asyncio.run(client.widen_unavailable_venues(constraint, "general", 41820))
    assert widened.substitute_notices()

    valley = place("valley", "용추계곡", lcls="NA0104")
    _region(monkeypatch, [valley, LAKE_PARK, FOOD])
    assert asyncio.run(client.widen_unavailable_venues(constraint, "general", 41820)) is constraint


def test_비슷한_종류도_없으면_넓히지_않음(monkeypatch):
    constraint = venue_constraint_for_query("계곡이랑 맛집")
    _region(monkeypatch, [FOOD])
    assert asyncio.run(
        tour_api.tour_api_client.widen_unavailable_venues(constraint, "general", 41820)
    ) is constraint


def test_대신_추천한_곳을_골라도_코스를_만듦(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    _region(monkeypatch, [LAKE_PARK, FOREST, FOOD])

    async def detail(cid):
        return {"park": LAKE_PARK, "food": FOOD}.get(cid)

    async def nothing(*_args, **_kwargs):
        return None

    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", nothing)
    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", nothing)
    monkeypatch.setattr(courses, "save_course", nothing)
    response = TestClient(app).post("/api/courses/generate-from-selection", json={
        "query_text": "계곡이랑 맛집", "sigungu_cd": 41820, "selected_content_ids": ["park", "food"],
    })
    assert response.status_code == 200, response.text


def test_추천이_적으면_이유와_할_일을_알려줌():
    request = PlaceRecommendationRequest(query_text="박물관", user_type="wheelchair", sigungu_cd=41135,
                                         visit_date="2026-10-05")
    notice = courses._few_results_notice(1, 3, request)
    assert notice == ("조건에 맞는 곳이 1곳뿐이에요. 방문일에 쉬는 3곳은 뺐어요. "
                      "지역을 넓히거나 방문일을 바꾸거나 다른 표현으로 다시 요청해 보세요.")

    hearing = PlaceRecommendationRequest(query_text="산책", user_type="hearing")
    assert "청각 편의시설" in courses._few_results_notice(1, 0, hearing)
