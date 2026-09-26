"""장소 유형, 제외 표현, 지역, AI 출력 오류를 가로지르는 추천 회귀 검사."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.models.schemas import Attraction, GenerateFromSelectionRequest, InfoField, PlaceRecommendationRequest
from app.services import ai_service, tour_api
from app.services.place_intent import is_meal_place, venue_constraint_for_query


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


def test_관광지_요청은_박물관도_방문지로_인정한다():
    constraint = venue_constraint_for_query("수원시 팔달구 관광지와 점심 식당")
    museum = place("museum", "수원화성박물관")
    assert constraint.matches(museum)
    assert constraint.missing_requirements([museum]) == ["음식점"]


def test_케이크_대표메뉴_카페는_점심_식당이_아니다():
    constraint = venue_constraint_for_query("점심 식당")
    cake_cafe = place("cafe", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })
    meal_cafe = place("brunch", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="브런치 샌드위치")],
    })
    assert not is_meal_place(cake_cafe)
    assert is_meal_place(meal_cafe)
    assert constraint.missing_requirements([cake_cafe]) == ["음식점"]
    assert constraint.missing_requirements([meal_cafe]) == []
    assert courses._required_place_gaps(constraint, [cake_cafe]) == (["음식점"], False)


def test_가게_이름에_카페가_없어도_디저트_메뉴이면_식사로_세지_않는다():
    dessert_shop = place("dessert", "라온", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크, 아메리카노")],
    })
    restaurant = place("restaurant", "라온", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="김치찌개, 된장찌개")],
    })

    assert not is_meal_place(dessert_shop)
    assert is_meal_place(restaurant)


@pytest.mark.parametrize("query", [
    "식당과 카페", "카페와 식당", "점심 먹고 카페", "식사 후 카페",
    "식당 및 카페", "식당에서 식사하고 카페", "식당, 카페",
])
def test_식당과_카페를_따로_요청하면_두_장소가_필요하다(query):
    constraint = venue_constraint_for_query(query)
    restaurant = place("meal", "수원 밥집", "음식점")
    cafe = place("cafe", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })

    assert {req.label for req in constraint.requirements} == {"음식점", "카페"}
    assert constraint.accepts_food_place(cafe)
    assert constraint.missing_requirements([cafe]) == ["음식점"]
    assert constraint.missing_requirements([cafe, cafe]) == ["음식점"]
    assert constraint.missing_requirements([restaurant]) == ["카페"]
    assert constraint.missing_requirements([restaurant, cafe]) == []


def test_점심_카페는_카페_한_곳을_요구하되_식사_메뉴가_있어야_한다():
    constraint = venue_constraint_for_query("점심 카페")
    cake_cafe = place("cake", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })
    brunch_cafe = place("brunch", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="브런치 샌드위치")],
    })

    assert [req.label for req in constraint.requirements] == ["카페"]
    assert constraint.meal_required
    assert not constraint.accepts_food_place(cake_cafe)
    assert constraint.missing_requirements([cake_cafe]) == ["카페"]
    assert constraint.missing_requirements([brunch_cafe]) == []


def test_디저트_카페_요청에는_케이크_카페를_남긴다():
    constraint = venue_constraint_for_query("카페에서 디저트 먹기")
    cake_cafe = place("cake", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })

    assert not constraint.meal_required
    assert constraint.accepts_food_place(cake_cafe)
    assert constraint.missing_requirements([cake_cafe]) == []


def test_관광지와_박물관을_따로_요청하면_한_곳으로_두_요구를_채우지_않는다():
    constraint = venue_constraint_for_query("관광지와 박물관")
    museum = place("museum", "수원화성박물관")
    park = place("park", "중앙공원", "관광지")

    assert {req.label for req in constraint.requirements} == {"관광지", "박물관"}
    assert constraint.missing_requirements([museum]) == ["관광지"]
    assert constraint.missing_requirements([museum, park]) == []
    assert set(constraint.covering_place_ids([museum, park])) == {"museum", "park"}


def test_점심_추천에서_디저트_카페를_제외한다(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    cake_cafe = place("cafe", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })
    restaurant = place("meal", "수원 밥집", "음식점")
    museum = place("museum", "수원화성박물관")

    async def sample(**_kwargs):
        return [cake_cafe, restaurant, museum]

    async def no_fill(_places):
        return 0

    monkeypatch.setattr(courses.tour_api_client, "sample_accessible_candidates", sample)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_fill)
    response = TestClient(app).post("/api/courses/recommend", json={
        "query_text": "점심 식당과 관광지", "user_type": "general",
    })
    assert response.status_code == 200
    assert {item["attraction"]["content_id"] for item in response.json()["candidates"]} == {"meal", "museum"}
    assert response.json()["missing_categories"] == []


def test_ai가_카페만_열두_곳_골라도_요청한_식당을_결과에_남긴다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")
    cafes = [place(f"cafe-{i}", f"수원 카페 {i}", "음식점") for i in range(12)]
    restaurant = place("meal", "수원 밥집", "음식점")

    async def cafes_only(*_args):
        return [{"content_id": cafe.content_id, "reason": "카페"} for cafe in cafes]

    monkeypatch.setattr(ai_service, "_groq_recommend", cafes_only)
    result = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="식당과 카페"), [*cafes, restaurant],
    ))

    assert len(result) == 12
    assert "meal" in {item.attraction.content_id for item in result}
    assert any(item.attraction.content_id.startswith("cafe-") for item in result)


def test_식당과_카페_추천은_디저트_카페와_식당을_각각_남긴다(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    cafe = place("cafe", "수원 카페", "음식점").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })
    restaurant = place("meal", "수원 밥집", "음식점")

    async def sample(**_kwargs):
        return [cafe, restaurant]

    async def no_fill(_places):
        return 0

    monkeypatch.setattr(courses.tour_api_client, "sample_accessible_candidates", sample)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_fill)
    response = TestClient(app).post("/api/courses/recommend", json={
        "query_text": "식당과 카페", "user_type": "general",
    })
    assert response.status_code == 200
    assert {item["attraction"]["content_id"] for item in response.json()["candidates"]} == {"cafe", "meal"}
    assert response.json()["missing_categories"] == []


def test_수원_박물관과_디저트_카페_선택은_코스를_만들되_점심으로_세지_않는다(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    museum = place("museum", "수원화성박물관", address="경기도 수원시 팔달구")
    cake_cafe = place("cafe", "수원 카페", "음식점", "경기도 수원시 팔달구").model_copy(update={
        "extra_info": [InfoField(label="대표 메뉴", value="생딸기케이크")],
    })

    async def detail(cid):
        return {"museum": museum, "cafe": cake_cafe}.get(cid)

    async def no_fill(_places):
        return 0

    async def no_save(*_args, **_kwargs):
        return None

    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    monkeypatch.setattr(courses.tour_api_client, "fill_extra_info", no_fill)
    monkeypatch.setattr(courses.tour_api_client, "fill_congestion_forecasts", no_fill)
    monkeypatch.setattr(courses, "save_course", no_save)
    response = TestClient(app).post("/api/courses/generate-from-selection", json={
        "query_text": "수원시 팔달구 관광지와 점심 식당",
        "selected_content_ids": ["museum", "cafe"],
    })
    assert response.status_code == 200
    assert {stop["attraction"]["content_id"] for stop in response.json()["stops"]} == {"museum", "cafe"}
    assert "식사 장소가 이 코스에 포함되지 않았어요" in response.json()["summary"]


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


def test_일반_공원_요청에_놀이공원을_공원으로_세지_않는다():
    park = place("park", "중앙공원", "관광지")
    theme_park = place("theme", "과천 놀이공원", "관광지")
    park_only = venue_constraint_for_query("공원 산책")
    both = venue_constraint_for_query("공원과 놀이공원")

    assert park_only.matches(park)
    assert not park_only.matches(theme_park)
    assert both.missing_requirements([theme_park]) == ["공원"]
    assert both.missing_requirements([park, theme_park]) == []


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


def test_선택한_코스에서_과학관과_미술관_중_하나가_빠져도_만들고_알림(monkeypatch):
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
    assert response.status_code == 200, response.text
    assert "요청하신 미술관은 이 코스에 포함되지 않았어요." in response.json()["warnings"]


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


def test_ai에게는_순위_앞쪽_후보만_보냄(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")
    sent: list[int] = []

    async def fake_ai(_request, candidates, _parsed, _constraint=None):
        sent.append(len(candidates))
        return [{"content_id": a.content_id, "reason": "좋아요"} for a in candidates[:6]]

    monkeypatch.setattr(ai_service, "_groq_recommend", fake_ai)
    candidates = [place(f"p{i}", f"공원 {i}", "관광지") for i in range(40)]
    asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="조용한 산책"), candidates,
    ))
    assert sent == [ai_service._AI_CANDIDATE_LIMIT]



def _select(monkeypatch, query, places):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    by_id = {p.content_id: p for p in places}

    async def detail(cid):
        return by_id.get(cid)

    monkeypatch.setattr(courses.tour_api_client, "get_attraction_detail", detail)
    return TestClient(app).post("/api/courses/generate-from-selection", json={
        "query_text": query, "selected_content_ids": list(by_id),
    })


def test_빼달라고_한_종류를_골라도_만들고_알림(monkeypatch):
    response = _select(monkeypatch, "미술관 말고 카페", [
        place("art", "국립현대미술관"), place("cafe", "과천 카페", "음식점"),
    ])
    assert response.status_code == 200, response.text
    assert "빼달라고 하신 종류인 국립현대미술관도 고르신 대로 코스에 넣었어요." in response.json()["warnings"]


def test_문장_속_지역_밖을_골라도_만들고_알림(monkeypatch):
    response = _select(monkeypatch, "수원 박물관", [
        place("suwon", "수원박물관", address="경기도 수원시 영통구"),
        place("gwacheon", "과천과학관 박물관", address="경기도 과천시"),
    ])
    assert response.status_code == 200, response.text
    assert any("밖의 과천과학관 박물관도" in w for w in response.json()["warnings"])
