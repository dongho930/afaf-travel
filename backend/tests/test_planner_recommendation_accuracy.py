"""장소 유형, 제외 표현, 지역, AI 출력 오류를 가로지르는 추천 회귀 검사."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction, GenerateFromSelectionRequest, PlaceRecommendationRequest
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


@pytest.mark.parametrize("query", [
    "과천 당일치기 코스와 점심 식당",
    "과천 데이트 코스와 점심 식당",
    "과천 당일 여행과 점심 식당",
    "과천 여행하며 점심 식사",
    "과천 나들이 중 점심 식사",
])
def test_여행_코스와_식사_요청은_다른_장소도_추천할_수_있다(query):
    constraint = venue_constraint_for_query(query)
    assert constraint.allow_other_categories
    assert constraint.matches(place("park", "중앙공원", "관광지"))
    assert constraint.missing_requirements([place("park", "중앙공원", "관광지")]) == ["음식점"]


def test_제외_표현만_있어도_제외한_장소를_추천하지_않는다():
    constraint = venue_constraint_for_query("미술관은 빼고 아무 데나 추천")
    assert constraint is not None
    assert not constraint.matches(place("art", "국립현대미술관"))
    assert constraint.matches(place("park", "중앙공원", "관광지"))


def test_제외한_미술관을_문화예술_목적으로_다시_읽지_않는다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    parsed = asyncio.run(ai_service.parse_query("미술관은 빼고 카페 추천"))
    assert [purpose.value for purpose in parsed.purposes] == ["식도락"]


def test_놀이공원_요청에_일반_공원을_섞지_않는다():
    constraint = venue_constraint_for_query("아이와 놀이공원")
    assert constraint.matches(place("theme", "과천 놀이공원", "관광지"))
    assert not constraint.matches(place("park", "중앙공원", "관광지"))
    assert [requirement.label for requirement in constraint.requirements] == ["테마파크"]


def test_동물원으로_알려진_서울대공원_이름도_인정한다():
    constraint = venue_constraint_for_query("과천 동물원")
    assert constraint.matches(place("zoo", "서울대공원", "관광지"))


def test_놀이공원_제외가_일반_공원까지_제외하지_않는다():
    constraint = venue_constraint_for_query("놀이공원 말고 공원 산책")
    assert not constraint.matches(place("theme", "과천 놀이공원", "관광지"))
    assert constraint.matches(place("park", "중앙공원", "관광지"))


@pytest.mark.parametrize("query, matching, unrelated, category", [
    ("캠핑장", "과천 캠핑장", "과천 호텔", "숙박"),
    ("동물원", "서울대공원 동물원", "국립현대미술관", "관광지"),
    ("사찰", "청계사 사찰", "중앙공원", "관광지"),
    ("공연장", "과천 시민회관 공연장", "역사박물관", "문화시설"),
    ("영화관", "과천 영화관", "역사박물관", "문화시설"),
    ("승마", "과천 승마장", "과천 스키장", "레포츠"),
    ("백화점", "과천 백화점", "과천 전통시장", "쇼핑"),
])
def test_세부_장소를_말하면_같은_카테고리의_다른_장소를_제외(query, matching, unrelated, category):
    constraint = venue_constraint_for_query(query)
    assert constraint.matches(place("matching", matching, category))
    assert not constraint.matches(place("unrelated", unrelated, category))


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


def test_ai가_선택한_장소를_코스_응답에서_누락해도_복원(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def partial_order(*_args, **_kwargs):
        return {"title": "과천 하루", "summary": "과천 여행", "stops": [
            {"content_id": "science", "order": 1, "reason": "과학관"},
            {"content_id": "science", "order": 2, "reason": "중복"},
            {"content_id": ["bad"], "order": 3, "reason": "잘못된 값"},
        ]}

    monkeypatch.setattr(ai_service, "_groq_call", partial_order)
    course = asyncio.run(ai_service.generate_course_from_selection(
        GenerateFromSelectionRequest(
            query_text="과천 과학관과 미술관", selected_content_ids=["science", "art"],
        ),
        [place("science", "국립과천과학관"), place("art", "국립현대미술관")],
    ))
    assert {stop.attraction.content_id for stop in course.stops} == {"science", "art"}
    assert len(course.stops) == 2


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


def test_장소_유형을_지정하지_않은_질의는_ai에_전체_유형을_허용(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")
    received = {}

    async def fake_groq(_system, user_prompt, **_kwargs):
        received.update(json.loads(user_prompt))
        return {"selected": [{"content_id": "park", "reason": "쉬기 좋은 곳"}]}

    monkeypatch.setattr(ai_service, "_groq_call", fake_groq)
    selected = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="조용히 쉬고 싶어"),
        [place("park", "중앙공원", "관광지")],
    ))
    assert received["required_venue_types"] == []
    assert received["allow_other_categories"] is True
    assert [item.attraction.content_id for item in selected] == ["park"]
