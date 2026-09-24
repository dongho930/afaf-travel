import asyncio

from app.models.schemas import Attraction
from app.services import tour_api
from app.services.place_intent import venue_constraint_for_query


def _place(content_id: str, category: str) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=f"{category} {content_id}",
        address="경기도 수원시",
        latitude=37.28,
        longitude=127.01,
        category=category,
    )


def test_목업_데이터에서도_공원_요청은_공원만_고른다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", True)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="wheelchair", limit=12,
        venue_constraint=venue_constraint_for_query("공원 산책"),
    ))

    assert [place.content_id for place in result] == ["GG-002"]


def test_호텔_숙박_요청에_펜션을_섞지_않는다():
    constraint = venue_constraint_for_query("호텔에서 숙박")
    hotel = _place("hotel", "숙박").model_copy(update={"name": "수원호텔"})
    pension = _place("pension", "숙박").model_copy(update={"name": "수원펜션"})

    assert constraint.matches(hotel)
    assert not constraint.matches(pension)


def test_식사_요청의_후보_표본은_음식점으로만_구성된다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def fake_region(_region):
        return [_place(str(i), "문화시설") for i in range(20)] + [
            _place(str(i + 20), "음식점") for i in range(20)
        ]

    async def fake_accessibility(_ids):
        return {}

    async def no_display_info(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "_fill_display_info", no_display_info)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="general", limit=12,
        venue_constraint=venue_constraint_for_query("점심 식사"),
    ))

    assert len(result) == 12
    assert all(place.category == "음식점" for place in result)


def test_접근_가능한_음식점이_드물어도_전체_음식점을_확인한다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)
    seen_ids = []

    async def fake_region(_region):
        return [_place(str(i), "음식점") for i in range(100)]

    async def fake_accessibility(ids):
        seen_ids.extend(ids)
        return {"99": {"wheelchair_accessibility_count": 1}}

    async def no_fallback(**kwargs):
        return []

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "search_accessible_attractions", no_fallback)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="wheelchair", limit=12,
        venue_constraint=venue_constraint_for_query("점심 식사"),
    ))

    assert len(seen_ids) == 100
    assert [place.content_id for place in result] == ["99"]


def test_과학관_요청은_다른_문화시설을_후보에_넣지_않는다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)
    seen_ids = []

    async def fake_region(_region):
        return [_place(str(i), "문화시설") for i in range(20)] + [
            _place("science", "문화시설").model_copy(update={"name": "과천과학관"})
        ]

    async def fake_accessibility(ids):
        seen_ids.extend(ids)
        return {}

    async def no_fallback(**kwargs):
        return []

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "search_accessible_attractions", no_fallback)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="general", limit=12,
        venue_constraint=venue_constraint_for_query("과학관 추천"),
    ))

    assert seen_ids == ["science"]
    assert [place.content_id for place in result] == ["science"]


def test_당일치기_식사_요청은_음식점과_관광지를_함께_남긴다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def fake_region(_region):
        return [_place(str(i), "관광지") for i in range(80)] + [_place("lunch", "음식점")]

    async def fake_accessibility(ids):
        return {content_id: {"wheelchair_accessibility_count": 1} for content_id in ids}

    async def no_display_info(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "_fill_display_info", no_display_info)

    constraint = venue_constraint_for_query("과천 당일치기 코스와 점심 식당")
    assert constraint.allow_other_categories
    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="wheelchair", limit=12,
        venue_constraint=constraint,
    ))

    assert len(result) == 12
    assert result[0].content_id == "lunch"
    assert any(place.category == "관광지" for place in result)


def test_당일치기_여러_필수_장소가_드물어도_각각_남긴다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def fake_region(_region):
        return [_place(str(i), "관광지") for i in range(80)] + [
            _place("lunch", "음식점"),
            _place("science", "문화시설").model_copy(update={"name": "과천과학관"}),
        ]

    async def fake_accessibility(ids):
        return {content_id: {"wheelchair_accessibility_count": 1} for content_id in ids}

    async def no_display_info(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "_fill_display_info", no_display_info)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="wheelchair", limit=12,
        venue_constraint=venue_constraint_for_query("과천 당일치기 과학관과 점심 식당"),
    ))
    assert {place.content_id for place in result} >= {"lunch", "science"}


def test_같은_문화시설_카테고리에서도_과학관과_미술관을_각각_남긴다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def fake_region(_region):
        return [
            _place(str(i), "문화시설").model_copy(update={"name": f"현대미술관 {i}"})
            for i in range(80)
        ] + [_place("science", "문화시설").model_copy(update={"name": "국립과천과학관"})]

    async def fake_accessibility(ids):
        return {content_id: {"wheelchair_accessibility_count": 1} for content_id in ids}

    async def no_display_info(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "_fill_display_info", no_display_info)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="wheelchair", limit=12,
        venue_constraint=venue_constraint_for_query("과학관과 미술관"),
    ))
    assert len(result) == 12
    assert "science" in {place.content_id for place in result}
    assert any("미술관" in place.name for place in result)


def test_플래너_목록_캐시는_쇼핑을_읽고_기본_목록의_카테고리수는_유지한다(monkeypatch):
    client = tour_api.tour_api_client
    read_types = []

    async def cached_list(_region, content_type_id, max_age_hours=24.0):
        read_types.append(content_type_id)
        if content_type_id == 38:
            return [{
                "content_id": "market", "name": "과천시장", "address": "경기도 과천시",
                "category": "쇼핑", "latitude": 37.43, "longitude": 127.0,
            }]
        return []

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", cached_list)
    result = asyncio.run(client._region_attractions("shopping-test-region"))

    assert 38 not in tour_api._DEFAULT_CONTENT_TYPE_IDS
    assert 38 in read_types
    assert [place.content_id for place in result] == ["market"]


def test_식당과_카페_요청은_카페가_많아도_식당을_후보에_남긴다(monkeypatch):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def fake_region(_region):
        return [
            _place(str(i), "음식점").model_copy(update={"name": f"수원 카페 {i}"})
            for i in range(60)
        ] + [_place("meal", "음식점").model_copy(update={"name": "수원 밥집"})]

    async def fake_accessibility(_ids):
        return {}

    async def no_display_info(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", fake_region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", fake_accessibility)
    monkeypatch.setattr(client, "_fill_display_info", no_display_info)

    result = asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type="general", limit=12,
        venue_constraint=venue_constraint_for_query("식당과 카페"),
    ))
    assert len(result) == 12
    assert "meal" in {place.content_id for place in result}
    assert any("카페" in place.name for place in result)
