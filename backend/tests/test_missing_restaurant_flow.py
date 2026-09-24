"""관광공사 자료에 식당이 없는 지역은 다른 출처로 채우지 않습니다."""

import asyncio

from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction
from app.services import ai_service, tour_api


def place(cid: str, category: str = "관광지") -> Attraction:
    return Attraction(
        content_id=cid, name=cid, address="경기도 과천시", latitude=37.43,
        longitude=127.00, category=category,
    )


def test_과천_음식점_캐시가_비면_검색_결과도_비어_있다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def empty_region(*_args):
        return []

    monkeypatch.setattr(client, "_region_attractions", empty_region)
    found = asyncio.run(client.search_attractions("과천", category="음식점"))
    assert found == []


def test_식당_후보가_없어도_선택한_관광지로_코스를_만들고_식사_누락을_알린다(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    museum = place("museum", "문화시설")
    park = place("park")

    async def sample(**_kwargs):
        return [museum, park]

    async def detail(cid):
        return {"museum": museum, "park": park}.get(cid)

    async def no_fill(_places):
        return 0

    async def no_save(*_args, **_kwargs):
        return None

    monkeypatch.setattr(courses.tour_api_client, "sample_accessible_candidates", sample)
    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_fill)
    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", no_fill)
    monkeypatch.setattr(courses, "save_course", no_save)

    client = TestClient(app)
    query = "휠체어로 이동 가능한 과천 당일치기 코스와 점심 식당"
    recommendation = client.post("/api/courses/recommend", json={
        "query_text": query, "user_type": "wheelchair",
    })
    assert recommendation.status_code == 200
    body = recommendation.json()
    assert body["missing_categories"] == ["음식점"]
    assert {item["attraction"]["content_id"] for item in body["candidates"]} == {"museum", "park"}

    response = client.post("/api/courses/generate-from-selection", json={
        "query_text": query, "user_type": "wheelchair",
        "selected_content_ids": ["museum", "park"],
    })
    assert response.status_code == 200
    assert {stop["attraction"]["content_id"] for stop in response.json()["stops"]} == {"museum", "park"}
    assert "식사 장소가 이 코스에 포함되지 않았어요" in response.json()["summary"]
