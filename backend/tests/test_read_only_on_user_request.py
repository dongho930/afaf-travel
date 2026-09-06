"""
사용자 요청을 처리하는 중에는 공공데이터 API를 부르지 않는지.

공공데이터포털은 자주 죽고(ReadTimeout), 죽어 있는 동안 사용자 요청 경로에서
그걸 부르면 그 시간이 그대로 사람이 기다리는 시간이 됩니다. 일일 트래픽 예산도
사람이 화면을 넘길 때마다 야금야금 사라집니다. 그래서 채우는 일은 자정 갱신이
전담하고, 화면은 저장된 캐시(DB)만 읽습니다.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api
from app.models.schemas import Attraction

CACHED_ID = "1"
UNCACHED_ID = "2"


def _attraction(content_id: str) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=f"관광지{content_id}",
        address="경기도 수원시",
        latitude=0.0,
        longitude=0.0,
        category="관광지",
    )


@pytest.fixture
def no_api(monkeypatch):
    """공공데이터 API를 부르면 즉시 실패하도록 막아둡니다."""

    async def forbidden(*args, **kwargs):
        raise AssertionError("사용자 요청 경로에서 공공데이터 API를 부르면 안 됩니다")

    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_accessibility_bounded", forbidden)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_overview", forbidden)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_intro_info", forbidden)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_all_by_content_type", forbidden)


def test_편의시설은_캐시에_있는_것만_채운다(no_api, monkeypatch):
    async def cached(content_ids):
        return {
            CACHED_ID: {
                "content_id": CACHED_ID,
                "has_ramp": True,
                "wheelchair_accessibility_count": 4,
            }
        }

    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", cached)
    attractions = [_attraction(CACHED_ID), _attraction(UNCACHED_ID)]
    diag: dict = {}

    asyncio.run(
        tour_api.tour_api_client._fill_accessibility_with_cache(
            None, attractions, diag=diag, max_new_fetches=tour_api._NO_LIVE_FETCH
        )
    )

    assert attractions[0].accessibility.has_ramp is True  # 캐시에 있던 곳은 채워지고
    assert attractions[1].accessibility.has_ramp is False  # 없던 곳은 빈 채로
    assert diag["deferred_no_budget"] == 1  # 미뤄진 건수로 남습니다


def test_소개문은_캐시에_있는_것만_채운다(no_api, monkeypatch):
    async def cached(content_ids):
        return {CACHED_ID: "수원화성은 조선시대 성곽입니다."}

    monkeypatch.setattr(tour_api, "get_cached_overviews", cached)
    attractions = [_attraction(CACHED_ID), _attraction(UNCACHED_ID)]

    asyncio.run(
        tour_api.tour_api_client._fill_overview_with_cache(
            None, attractions, max_new_fetches=tour_api._NO_LIVE_FETCH
        )
    )

    assert attractions[0].overview
    assert attractions[1].overview is None


def test_부가정보는_캐시에_있는_것만_채운다(no_api, monkeypatch):
    async def cached(content_ids):
        return {CACHED_ID: {"content_id": CACHED_ID, "fields": {"usetime": "09:00~18:00"}}}

    monkeypatch.setattr(tour_api, "get_cached_intro_info_batch", cached)
    attractions = [_attraction(CACHED_ID), _attraction(UNCACHED_ID)]

    asyncio.run(
        tour_api.tour_api_client._fill_extra_info_with_cache(
            None, attractions, max_new_fetches=tour_api._NO_LIVE_FETCH
        )
    )

    assert attractions[0].extra_info
    assert attractions[1].extra_info == []


def test_목록_캐시는_유효기간이_지나도_그대로_읽는다(no_api, monkeypatch):
    """
    24시간이 지났다고 사용자 요청 중에 전수 조회를 시작하면, 공공데이터포털이
    느린 날 홈 화면이 그만큼 느려집니다. 오래된 목록도 그대로 씁니다.
    """
    asked: dict = {}

    async def cached_list(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        asked["max_age_hours"] = max_age_hours
        return [
            {
                "content_id": CACHED_ID,
                "name": "수원화성",
                "address": "경기도 수원시",
                "latitude": 0.0,
                "longitude": 0.0,
                "category": "관광지",
            }
        ]

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", cached_list)

    results = asyncio.run(
        tour_api.tour_api_client._fetch_by_content_type(None, "41", 12, num_of_rows=10)
    )

    assert asked["max_age_hours"] == tour_api._LIST_CACHE_ANY_AGE_HOURS
    assert [a.content_id for a in results] == [CACHED_ID]
