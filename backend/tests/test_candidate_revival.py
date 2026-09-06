"""
편의시설 캐시에서 후보를 되살리는지.

관광지 '목록' API가 잘리면 그 카테고리가 통째로 후보에서 빠지고, 편의시설
정보가 캐시에 멀쩡히 있어도 '접근성 없음'으로 세어집니다. place_accessibility_cache는
잘린 목록에 덮어써지지 않는 유일한 캐시라, 여기 남은 content_id를 후보로
되살리면 목록 API 복구를 기다리지 않고 개수가 돌아옵니다.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api

# 2026-09-06 실제 상태: 목록 캐시는 543건으로 줄었지만 편의시설 캐시에는 1247건이 남아 있었습니다.
LIST_CACHE_IDS = [f"L{i}" for i in range(543)]
REVIVABLE_IDS = [f"R{i}" for i in range(704)]
ACCESSIBILITY_CACHE_IDS = LIST_CACHE_IDS + REVIVABLE_IDS


def _accessibility_row(content_id: str) -> dict:
    """편의시설 캐시 한 행 — 휠체어 편의시설을 갖춘 곳."""
    return {
        "content_id": content_id,
        "has_ramp": True,
        "has_elevator": True,
        "has_accessible_restroom": True,
        "has_wheelchair_rental": False,
        "has_stroller_accessible_path": False,
        "has_rest_area": True,
        "wheelchair_accessibility_count": 4,
        "visual_accessibility_count": 0,
        "hearing_accessibility_count": 0,
        "family_accessibility_count": 0,
        "pregnant_accessibility_count": 3,
        "record_found": True,
    }


@pytest.fixture
def broken_list_api(monkeypatch):
    """목록 API는 전부 실패하고, 목록 캐시에는 관광지(12)만 543건 남은 상태."""
    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)

    async def no_live_results(self, client, ldong_regn_cd, content_type_id, diag=None):
        if diag is not None:
            diag["list_truncated"] = 1
        return []

    async def damaged_list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        if content_type_id != 12:
            return []
        return [
            {
                "content_id": content_id,
                "name": f"관광지{content_id}",
                "address": "경기도 수원시",
                "latitude": 0.0,
                "longitude": 0.0,
                "category": "관광지",
            }
            for content_id in LIST_CACHE_IDS
        ]

    async def all_cached_ids():
        return set(ACCESSIBILITY_CACHE_IDS)

    async def cached_accessibility(content_ids):
        return {
            content_id: _accessibility_row(content_id)
            for content_id in content_ids
            if content_id in ACCESSIBILITY_CACHE_IDS
        }

    async def never_called(*args, **kwargs):
        raise AssertionError("되살린 후보는 이미 캐시에 있으므로 API를 부르면 안 됩니다")

    async def noop(*args, **kwargs):
        return None

    async def no_ratings(content_ids):
        return {}

    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_all_by_content_type", no_live_results)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_accessibility_bounded", never_called)
    monkeypatch.setattr(tour_api, "get_cached_attraction_list", damaged_list_cache)
    monkeypatch.setattr(tour_api, "get_all_cached_place_accessibility_ids", all_cached_ids)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", cached_accessibility)
    monkeypatch.setattr(tour_api, "save_attraction_list_cache", noop)
    monkeypatch.setattr(tour_api, "save_place_accessibility_batch", noop)
    monkeypatch.setattr(tour_api, "get_average_ratings", no_ratings)


@pytest.fixture
def summary(broken_list_api) -> dict:
    return asyncio.run(tour_api.tour_api_client.get_accessibility_summary("경기도"))


def test_목록이_죽어도_후보가_되살아난다(summary):
    assert summary["debug"]["candidates_revived_from_accessibility_cache"] == len(REVIVABLE_IDS)
    assert summary["total_candidates"] == len(ACCESSIBILITY_CACHE_IDS)


def test_되살린_후보가_개수에_반영된다(summary):
    # 543건만 세던 때의 539에서 1247건 전부로 돌아와야 합니다.
    assert summary["total_accessible_count"] == len(ACCESSIBILITY_CACHE_IDS)


def test_되살리는_데_API를_쓰지_않는다(summary):
    # _fetch_accessibility_bounded는 호출되면 AssertionError를 냅니다.
    assert summary["debug"]["accessibility_fetch"]["newly_fetched_and_cached"] == 0
    assert summary["debug"]["accessibility_fetch"]["deferred_no_budget"] == 0


def test_이름_없는_후보는_주요_여행지_목록에서_뺀다(summary):
    # 되살린 후보는 이름이 없습니다(캐시에 없음). 목록에 넣으면 빈 카드가 됩니다.
    for key in (
        "top_wheelchair_places",
        "top_senior_places",
        "top_visual_places",
        "top_hearing_places",
        "top_family_places",
        "top_pregnant_places",
    ):
        assert all(place["name"] for place in summary[key]), key


def test_다른_지역에는_되살리기를_쓰지_않는다(broken_list_api):
    # 편의시설 캐시에는 지역 정보가 없습니다. 경기도 전수조사가 채운 캐시라,
    # 다른 지역 집계에 섞어 쓰면 없는 관광지를 세게 됩니다.
    revived = asyncio.run(
        tour_api.tour_api_client._accessibility_cache_candidates("서울", set())
    )
    assert revived == []
