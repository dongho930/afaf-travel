"""과천 식당 데이터가 비어 있을 때의 검색, 추천, 코스 생성 회귀 검사."""

import asyncio
from types import SimpleNamespace

import httpx

from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction, PlaceRecommendationRequest
from app.services import ai_service, tour_api
from app.services import kakao_places


def place(cid: str, category: str = "관광지") -> Attraction:
    return Attraction(
        content_id=cid, name=cid, address="경기도 과천시", latitude=37.43,
        longitude=127.00, category=category,
    )


def external_food() -> Attraction:
    return Attraction(
        content_id="kakao:123", name="과천 점심 식당", address="경기도 과천시 중앙로",
        latitude=37.43, longitude=127.00, category="음식점", data_source="kakao",
        external_url="https://place.map.kakao.com/123",
    )


def test_과천_음식점_검색_캐시가_비면_외부_검색_결과를_구분해서_반환(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def empty_region(*_args):
        return []

    async def kakao(_query, _limit):
        return [external_food()]

    monkeypatch.setattr(client, "_region_attractions", empty_region)
    monkeypatch.setattr(tour_api, "search_kakao_restaurants", kakao)
    found = asyncio.run(client.search_attractions("과천", category="음식점"))
    assert len(found) == 1
    assert found[0].data_source == "kakao"
    assert found[0].accessibility.wheelchair_accessibility_count == 0


def test_카카오_음식점_응답의_http_링크를_안전한_https로_정규화(monkeypatch):
    monkeypatch.setattr(kakao_places, "get_settings", lambda: SimpleNamespace(kakao_rest_api_key="test-key"))

    def respond(request: httpx.Request):
        assert request.url.params["category_group_code"] == "FD6"
        assert request.headers["Authorization"] == "KakaoAK test-key"
        return httpx.Response(200, json={"documents": [{
            "id": "123", "place_name": "과천 점심 식당", "address_name": "경기도 과천시",
            "y": "37.43", "x": "127.00", "place_url": "http://place.map.kakao.com/123",
        }]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(kakao_places.httpx, "AsyncClient", lambda **_kwargs: real_client(transport=httpx.MockTransport(respond)))
    found = asyncio.run(kakao_places.search_kakao_restaurants("과천 음식점"))
    assert found[0].external_url == "https://place.map.kakao.com/123"
    assert found[0].accessibility.wheelchair_accessibility_count == 0


def test_당일치기_식당_요청에서_ai가_식당만_골라도_관광지를_보충(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def only_food(*_args):
        return [{"content_id": "food", "reason": "점심 식당"}]

    monkeypatch.setattr(ai_service, "_groq_recommend", only_food)
    selected = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="과천 당일치기 코스와 점심 식당"),
        [place("food", "음식점"), place("park"), place("museum", "문화시설")],
    ))
    assert {item.attraction.content_id for item in selected} == {"food", "park", "museum"}


def test_점심이_빠진_과천_코스를_막고_미확인_식당은_동의_후_포함(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")

    museum = place("museum", "문화시설")
    park = place("park")

    async def sample(**_kwargs):
        return [museum, park]

    async def kakao(_query, _limit):
        return [external_food()]

    async def detail(cid):
        return {"museum": museum, "park": park}.get(cid)

    async def no_op(*_args, **_kwargs):
        return None

    monkeypatch.setattr(courses.tour_api_client, "sample_accessible_candidates", sample)
    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_op)
    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", no_op)
    monkeypatch.setattr(courses, "search_kakao_restaurants", kakao)
    monkeypatch.setattr(courses, "save_course", no_op)

    client = TestClient(app)
    query = "휠체어로 이동 가능한 과천 당일치기 코스와 점심 식당"
    recommendation = client.post("/api/courses/recommend", json={
        "query_text": query, "user_type": "wheelchair",
    })
    assert recommendation.status_code == 200
    body = recommendation.json()
    assert body["missing_categories"] == ["음식점"]
    assert {item["attraction"]["content_id"] for item in body["candidates"]} >= {
        "museum", "park", "kakao:123",
    }

    base = {
        "query_text": query, "user_type": "wheelchair",
        "selected_content_ids": ["museum", "park"],
    }
    missing = client.post("/api/courses/generate-from-selection", json=base)
    assert missing.status_code == 422
    assert "음식점" in missing.json()["detail"]

    with_food = {
        **base,
        "selected_content_ids": ["museum", "park", "kakao:123"],
        "selected_external_places": [external_food().model_dump(mode="json")],
    }
    no_consent = client.post("/api/courses/generate-from-selection", json=with_food)
    assert no_consent.status_code == 422
    consented = client.post("/api/courses/generate-from-selection", json={
        **with_food, "allow_unverified_accessibility": True,
    })
    assert consented.status_code == 200
    stops = consented.json()["stops"]
    assert len(stops) == 3
    assert any(stop["attraction"]["data_source"] == "kakao" for stop in stops)
    assert "확인되지" in consented.json()["summary"]
