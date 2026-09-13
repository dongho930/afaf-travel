"""
질의에서 뽑은 조건이 실제 API 흐름에 반영되는지 (라우터까지).

단위 테스트(test_query_parsing.py)는 "조건을 뽑아내는가"만 봅니다. 여기서는 그
조건이 실제로 후보 검색에 쓰이는지, 응답으로 사용자에게 돌아오는지, 그리고
2단계에서 예보가 채워지는지를 라우터를 통해 확인합니다.

Groq 키는 비워두고 규칙 기반 경로로만 돌리므로 외부 통신이 없습니다.
"""
import pytest
from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction
from app.services import ai_service

SUWON_ALL = [41111, 41113, 41115, 41117]


def _attraction(content_id: str, name: str = "관광지") -> Attraction:
    return Attraction(
        content_id=content_id,
        name=name,
        address="경기도 수원시 팔달구",
        latitude=37.28,
        longitude=127.01,
        category="관광지",
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def no_ai_no_db(monkeypatch):
    """AI 호출 없이(규칙 기반) 돌리고, 저장/예보 조회는 아무 일도 하지 않게 둡니다."""
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")

    async def no_save(*args, **kwargs):
        return None

    monkeypatch.setattr(courses, "save_course", no_save)


@pytest.fixture
def searches(monkeypatch) -> list:
    """search_accessible_attractions가 어떤 지역으로 불렸는지 기록합니다."""
    calls: list = []

    async def fake_search(region, user_type, limit=20, sigungu_cd=None, **kwargs):
        calls.append(sigungu_cd)
        return [_attraction("1", "수원화성"), _attraction("2", "광교호수공원")]

    monkeypatch.setattr(courses.tour_api_client, "search_accessible_attractions", fake_search)
    return calls


def test_질의에_쓴_지역으로_후보를_좁힌다(client, searches):
    """화면에서 지역을 안 골라도, 문장에 '수원'이 있으면 수원으로 좁혀야 합니다."""
    response = client.post(
        "/api/courses/recommend",
        json={"query_text": "수원에서 아이랑 갈 만한 곳", "user_type": "wheelchair"},
    )

    assert response.status_code == 200
    assert searches == [SUWON_ALL]


def test_무엇으로_이해했는지_응답에_담아준다(client, searches):
    response = client.post(
        "/api/courses/recommend",
        json={"query_text": "수원에서 아이랑 갈 만한 맛집", "user_type": "general"},
    )

    parsed = response.json()["parsed"]
    assert parsed["region_text"] == "수원시"
    assert parsed["region_source"] == "query_text"
    assert parsed["companion"] == "가족"
    assert "식도락" in parsed["purposes"]


def test_화면에서_고른_지역이_있으면_그대로_쓴다(client, searches):
    response = client.post(
        "/api/courses/recommend",
        json={"query_text": "가평 계곡", "user_type": "general", "sigungu_cd": 41135},
    )

    assert searches == [[41135]]
    assert response.json()["parsed"]["region_source"] == "user_selected"


def test_추측한_지역으로_후보가_없으면_지역_제한을_푼다(client, monkeypatch):
    """문장에서 넘겨짚은 지역이 틀렸을 때 빈 화면을 주는 대신 넓게 다시 찾습니다."""
    calls: list = []

    async def fake_search(region, user_type, limit=20, sigungu_cd=None, **kwargs):
        calls.append(sigungu_cd)
        return [] if sigungu_cd else [_attraction("1")]

    monkeypatch.setattr(courses.tour_api_client, "search_accessible_attractions", fake_search)

    response = client.post(
        "/api/courses/recommend", json={"query_text": "가평에서 놀 곳", "user_type": "general"}
    )

    assert calls == [[41820], None]  # 가평으로 한 번, 실패 후 지역 없이 한 번
    assert response.status_code == 200
    assert response.json()["parsed"]["region_source"] == "none"
    assert response.json()["candidates"]


def test_2단계에서_예보를_채운_뒤_코스를_만든다(client, searches, monkeypatch):
    filled: list = []

    async def fake_fill(attractions):
        filled.append([a.content_id for a in attractions])
        return len(attractions)

    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", fake_fill)

    response = client.post(
        "/api/courses/generate-from-selection",
        json={"query_text": "수원 나들이", "user_type": "general", "selected_content_ids": ["1", "2"]},
    )

    assert response.status_code == 200
    assert filled == [["1", "2"]]  # 코스를 만들기 전에 선택한 장소들의 예보를 채웁니다


def test_후보에_없는_선택지는_상세_조회로_살린다(client, searches, monkeypatch):
    """1단계와 2단계 사이에 후보 구성이 달라져도, 사용자가 고른 장소는 살아남아야 합니다."""
    async def fake_detail(content_id):
        return _attraction(content_id, "직접 불러온 곳") if content_id == "99" else None

    async def fake_fill(attractions):
        return 0

    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", fake_detail)
    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", fake_fill)

    response = client.post(
        "/api/courses/generate-from-selection",
        json={"query_text": "수원 나들이", "user_type": "general", "selected_content_ids": ["1", "99"]},
    )

    assert response.status_code == 200
    assert {s["attraction"]["content_id"] for s in response.json()["stops"]} == {"1", "99"}
