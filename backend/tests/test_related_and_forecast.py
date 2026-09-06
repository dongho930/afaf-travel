"""
상세 페이지의 '함께 가볼 만한 곳'과 날짜별 혼잡도를 캐시에서만 읽는지.

둘 다 예전에는 상세 페이지를 열 때마다 공공데이터 API를 불렀습니다. 게다가
연관 관광지는 이름/주소를 알아내려고 detailCommon2를 한 번 더 부르고, 결과
이름마다 키워드검색을 또 불러서 페이지 하나에 호출이 여러 개 붙었습니다.
이제 자정 갱신이 채우고 화면은 DB만 읽습니다.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api

SUWON = [
    ("1", "수원화성", "경기도 수원시 팔달구 정조로 825", "관광지"),
    ("2", "수원화성행궁", "경기도 수원시 팔달구 정조로 825", "관광지"),
    ("3", "화성어차", "경기도 수원시 팔달구 정조로 780", "관광지"),
    ("4", "수원통닭거리", "경기도 수원시 팔달구 정조로 776", "음식점"),
    ("9", "가나아트파크", "경기도 양주시 광적면 부흥로 117", "관광지"),
]


def _cache_dict(cid, name, addr, category):
    return {
        "content_id": cid, "name": name, "address": addr,
        "latitude": 37.28, "longitude": 127.01, "category": category,
    }


@pytest.fixture(autouse=True)
def db_only(monkeypatch):
    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)
    tour_api._REGION_ATTRACTIONS_CACHE._entries.clear()

    async def list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        if content_type_id != 12:
            return []
        return [_cache_dict(*p) for p in SUWON]

    async def forbidden(*args, **kwargs):
        raise AssertionError("상세 페이지에서 공공데이터 API를 부르면 안 됩니다")

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", list_cache)
    monkeypatch.setattr(tour_api.TourApiClient, "_get_basic_info", forbidden)
    monkeypatch.setattr(tour_api.TourApiClient, "_resolve_attraction_by_name", forbidden)


# ---- 함께 가볼 만한 곳 ----

def test_캐시에_있으면_그대로_준다(monkeypatch):
    async def cached(content_ids):
        return {"1": {"content_id": "1", "items": [_cache_dict("2", "수원화성행궁", "경기도 수원시", "관광지")]}}

    monkeypatch.setattr(tour_api, "get_cached_related", cached)

    result = asyncio.run(tour_api.tour_api_client.get_related_attractions("1"))

    assert [a.name for a in result] == ["수원화성행궁"]


def test_캐시에_없으면_같은_시군구_같은_카테고리로_채운다(monkeypatch):
    async def empty(content_ids):
        return {}

    monkeypatch.setattr(tour_api, "get_cached_related", empty)

    result = asyncio.run(tour_api.tour_api_client.get_related_attractions("1"))
    names = [a.name for a in result]

    assert "수원화성행궁" in names and "화성어차" in names
    assert "수원통닭거리" not in names  # 카테고리가 다릅니다
    assert "가나아트파크" not in names  # 시군구가 다릅니다
    assert "수원화성" not in names      # 자기 자신


def test_캐시를_못_읽어도_화면은_뜬다(monkeypatch):
    async def boom(content_ids):
        raise tour_api.CacheUnavailable("일시 장애")

    monkeypatch.setattr(tour_api, "get_cached_related", boom)

    # 예외가 나가지 않고 대체 목록으로 넘어갑니다
    assert asyncio.run(tour_api.tour_api_client.get_related_attractions("1"))


# ---- 날짜별 혼잡도 ----

def test_예보는_캐시에_있는_것만_준다(monkeypatch):
    async def cached(content_ids):
        return {
            "1": {
                "content_id": "1",
                "forecast": [{"date": "2026-09-10", "hour": 12, "congestion_level": "low"}],
            }
        }

    monkeypatch.setattr(tour_api, "get_cached_forecast", cached)

    result = asyncio.run(tour_api.tour_api_client.get_congestion_forecast("1"))

    assert len(result) == 1
    assert result[0].congestion_level == "low"


def test_예보가_없으면_빈_목록(monkeypatch):
    async def empty(content_ids):
        return {}

    monkeypatch.setattr(tour_api, "get_cached_forecast", empty)

    assert asyncio.run(tour_api.tour_api_client.get_congestion_forecast("1")) == []


# ---- 자정 갱신 배치 ----

def test_연관_갱신은_이미_캐시된_곳을_건너뛴다(monkeypatch):
    fetched: list[str] = []

    async def cached(content_ids):
        return {"1": {"content_id": "1", "items": []}}

    async def fake_fetch(self, client, base):
        fetched.append(base.content_id)
        return []

    saved: list[list[dict]] = []

    async def fake_save(rows):
        saved.append(rows)

    monkeypatch.setattr(tour_api, "get_cached_related", cached)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_related_live", fake_fetch)
    monkeypatch.setattr(tour_api, "save_related_batch", fake_save)

    debug = asyncio.run(tour_api.tour_api_client.refresh_related_cache("경기도"))

    assert "1" not in fetched  # 이미 캐시된 곳
    assert debug["already_cached"] == 1
    assert debug["newly_cached"] == len(SUWON) - 1


def test_조회에_실패하면_빈_목록으로_덮어쓰지_않는다(monkeypatch):
    """
    '연관 관광지가 없음'과 '조회 실패'는 다릅니다. 실패를 빈 목록으로 저장하면
    다음부터 영영 빈 채로 남습니다.
    """
    async def empty(content_ids):
        return {}

    async def always_fails(self, client, base):
        return None

    saved: list[dict] = []

    async def fake_save(rows):
        saved.extend(rows)

    monkeypatch.setattr(tour_api, "get_cached_related", empty)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_related_live", always_fails)
    monkeypatch.setattr(tour_api, "save_related_batch", fake_save)

    debug = asyncio.run(tour_api.tour_api_client.refresh_related_cache("경기도"))

    assert saved == []
    assert debug["newly_cached"] == 0


def test_예보_갱신은_예산을_지킨다(monkeypatch):
    fetched: list[str] = []

    async def fake_fetch(self, client, base):
        fetched.append(base.content_id)
        return []

    async def fake_save(rows):
        return None

    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_forecast_live", fake_fetch)
    monkeypatch.setattr(tour_api, "save_forecast_batch", fake_save)
    monkeypatch.setattr(type(tour_api.settings), "daily_forecast_budget", property(lambda self: 2))

    debug = asyncio.run(tour_api.tour_api_client.refresh_forecast_cache("경기도"))

    assert len(fetched) == 2
    assert debug["deferred_no_budget"] == len(SUWON) - 2
