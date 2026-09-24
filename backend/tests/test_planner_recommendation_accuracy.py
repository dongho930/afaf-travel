"""장소 유형, 제외 표현, 지역, AI 출력 오류를 가로지르는 추천 회귀 검사."""

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction, PlaceRecommendationRequest
from app.services import ai_service, tour_api
from app.services.place_intent import venue_constraint_for_query


def place(cid: str, name: str, category: str = "문화시설", address: str = "경기도 과천시") -> Attraction:
    return Attraction(
        content_id=cid, name=name, category=category, address=address,
        latitude=37.43, longitude=127.0,
    )


@pytest.mark.parametrize("query, expected", [
    ("과학관과 미술관", {"과학관", "미술관"}),
    ("호텔과 펜션", {"호텔", "펜션"}),
    ("공원과 호수", {"공원", "호수"}),
    ("점심 카페", {"카페"}),
    ("등산 코스", {"등산로"}),
])
def test_같은_카테고리_안의_서로_다른_요구를_구분(query, expected):
    constraint = venue_constraint_for_query(query)
    assert {requirement.label for requirement in constraint.requirements} == expected


def test_과학관과_미술관은_각각_한_곳씩_필요():
    constraint = venue_constraint_for_query("과학관과 미술관")
    science = place("science", "국립과천과학관")
    art = place("art", "국립현대미술관")
    unrelated = place("history", "역사박물관")
    assert constraint.matches(science)
    assert constraint.matches(art)
    assert not constraint.matches(unrelated)
    assert constraint.missing_requirements([science]) == ["미술관"]
    assert constraint.missing_requirements([science, art]) == []


def test_당일치기_제외_표현은_다른_장소를_허용해도_지킨다():
    constraint = venue_constraint_for_query("과천 당일치기 미술관 말고 카페")
    assert constraint.allow_other_categories
    assert not constraint.matches(place("art", "국립현대미술관"))
    assert constraint.matches(place("science", "국립과천과학관"))
    assert constraint.matches(place("cafe", "과천 카페", "음식점"))
    assert constraint.missing_requirements([place("science", "국립과천과학관")]) == ["카페"]


def test_ai의_중복_무효_id_허위_접근성_근거를_정리(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def bad_ai(*_args):
        return [
            {"content_id": "science", "reason": "경사로가 있어 편하게 이동합니다."},
            {"content_id": "science", "reason": "중복"},
            {"content_id": ["bad"], "reason": "잘못된 ID"},
        ]

    monkeypatch.setattr(ai_service, "_groq_recommend", bad_ai)
    selected = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="과학관과 미술관", user_type="wheelchair"),
        [place("science", "국립과천과학관"), place("art", "국립현대미술관")],
    ))
    assert [item.attraction.content_id for item in selected] == ["science", "art"]
    assert "경사로" not in selected[0].reason
    assert all(item.reason for item in selected)


def test_당일치기_ai가_열두_곳을_골라도_필수_식당과_관광지_남김(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def only_museums(*_args):
        return [{"content_id": f"museum-{i}", "reason": "문화시설"} for i in range(12)]

    monkeypatch.setattr(ai_service, "_groq_recommend", only_museums)
    candidates = [place(f"museum-{i}", f"박물관 {i}") for i in range(12)] + [
        place("food", "과천 식당", "음식점"),
        place("park", "중앙공원", "관광지"),
    ]
    selected = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="과천 당일치기 코스와 점심 식당"), candidates,
    ))
    ids = {item.attraction.content_id for item in selected}
    assert len(selected) == 12
    assert {"food", "park"} <= ids


def test_선택한_코스에서_과학관과_미술관_중_하나가_빠지면_거절(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")

    async def detail(cid):
        return {"science": place("science", "국립과천과학관"),
                "art": place("art", "국립현대미술관")}.get(cid)

    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    client = TestClient(app)
    response = client.post("/api/courses/generate-from-selection", json={
        "query_text": "과천 과학관과 미술관", "selected_content_ids": ["science"],
    })
    assert response.status_code == 422
    assert "미술관" in response.json()["detail"]


def test_목적만_있는_질의는_규칙_기반에서도_맞는_카테고리_우선(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    parsed = asyncio.run(ai_service.parse_query("자연 속에서 쉬고 싶어"))
    museums = [place(f"museum-{i}", f"박물관 {i}") for i in range(14)]
    park = place("park", "숲 공원", "관광지")
    selected = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="자연 속에서 쉬고 싶어"),
        [*museums, park], parsed,
    ))
    assert selected[0].attraction.content_id == "park"
