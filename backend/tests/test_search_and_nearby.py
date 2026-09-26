"""
이름 검색과 '근처 가볼 만한 곳'을 DB만으로 답하는지.

둘 다 예전에는 사용자 요청 중에 공공데이터 API(searchKeyword2 /
locationBasedList2)를 불렀습니다. 특히 검색은 자동완성이라 타자 한 번에 한 번씩
나가서 일일 트래픽 한도를 가장 빨리 태우는 경로였고, 공공데이터포털이 느린
날에는 검색창이 그대로 멈췄습니다. 같은 데이터가 목록 캐시에 있으므로
DB에서 찾습니다.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api

# 수원 일대 좌표 (근처 판정용). 화성 기준 대략 거리:
#   행궁 ~0.4km / 팔달문 ~0.9km / 광교호수공원 ~6km
PLACES = [
    ("1", "수원화성", "경기도 수원시 팔달구 정조로 825", 37.2860, 127.0090),
    ("2", "수원화성행궁", "경기도 수원시 팔달구 정조로 825", 37.2825, 127.0130),
    ("3", "팔달문", "경기도 수원시 팔달구 정조로 780", 37.2790, 127.0155),
    ("4", "광교호수공원", "경기도 수원시 영통구 광교호수로 165", 37.2790, 127.0640),
    ("5", "가나아트파크", "경기도 양주시 광적면 부흥로 117", 37.8300, 127.0300),
]


@pytest.fixture(autouse=True)
def cached_list_only(monkeypatch):
    """목록 캐시만 있고, 공공데이터 API는 부르면 실패하는 상태."""
    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)
    tour_api._REGION_ATTRACTIONS_CACHE._entries.clear()

    async def list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        if content_type_id != 12:
            return []
        return [
            {
                "content_id": cid,
                "name": name,
                "address": addr,
                "latitude": lat,
                "longitude": lon,
                "category": "관광지",
            }
            for cid, name, addr, lat, lon in PLACES
        ]

    async def forbidden(*args, **kwargs):
        raise AssertionError("사용자 요청 경로에서 공공데이터 API를 부르면 안 됩니다")

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", list_cache)
    monkeypatch.setattr(tour_api.TourApiClient, "get_attraction_detail", forbidden)


def search(keyword: str, limit: int = 8):
    return asyncio.run(tour_api.tour_api_client.search_attractions_by_keyword(keyword, limit))


def nearby(content_id: str, radius_km: float = 2.0):
    return asyncio.run(tour_api.tour_api_client.get_nearby_attractions(content_id, radius_km))


# ---- 이름 검색 ----

def test_이름으로_찾는다():
    names = [r["name"] for r in search("화성")]

    assert "수원화성" in names and "수원화성행궁" in names


def test_공백을_무시한다():
    assert [r["name"] for r in search("수원 화성")] == [r["name"] for r in search("수원화성")]


def test_짧은_이름이_먼저_나온다():
    names = [r["name"] for r in search("수원화성")]

    assert names[0] == "수원화성"  # '수원화성행궁'보다 질의에 가깝습니다


def test_주소로도_찾되_이름_매칭_다음이다():
    names = [r["name"] for r in search("양주시")]

    assert names == ["가나아트파크"]  # 이름엔 없고 주소에만 있는 경우


def test_limit을_지킨다():
    assert len(search("경기도", limit=2)) == 2


def test_빈_질의는_빈_결과():
    assert search("   ") == []


def test_없는_이름은_빈_결과():
    assert search("제주올레") == []


# ---- 근처 가볼 만한 곳 ----

def test_반경_안의_곳만_거리순으로_준다():
    result = nearby("1", radius_km=2.0)

    assert [r["name"] for r in result] == ["수원화성행궁", "팔달문"]
    assert result[0]["distance_km"] <= result[1]["distance_km"]


def test_자기_자신은_빠진다():
    assert all(r["content_id"] != "1" for r in nearby("1"))


def test_반경을_넓히면_더_나온다():
    가까이 = nearby("1", radius_km=2.0)
    멀리 = nearby("1", radius_km=10.0)

    assert len(멀리) > len(가까이)
    assert "광교호수공원" in [r["name"] for r in 멀리]


def test_거리가_먼_곳은_안_나온다():
    assert "가나아트파크" not in [r["name"] for r in nearby("1", radius_km=10.0)]


# ---- DB를 순간적으로 못 읽었을 때 ----

def test_DB를_못_읽은_결과는_캐시하지_않는다(monkeypatch):
    """
    순간적인 DB 오류로 받은 빈 목록을 5분 동안 들고 있으면, 그동안 AI 플래너가
    매번 '장소 추천 실패'(후보 없음)로 끝나고 검색도 비어 있었습니다.
    DB가 돌아오면 바로 다음 요청부터 정상 목록이 나와야 합니다.
    """
    from app.services.supabase_service import CacheUnavailable

    good_list_cache = tour_api.get_cached_attraction_list
    down = {"value": True}

    async def flaky_list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        if down["value"]:
            raise CacheUnavailable("DB 연결 실패")
        return await good_list_cache(ldong_regn_cd, content_type_id, max_age_hours)

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", flaky_list_cache)

    assert search("화성") == []  # 장애 중에는 비어 있어도

    down["value"] = False
    assert "수원화성" in [r["name"] for r in search("화성")]  # 복구되면 곧바로 나옵니다


def test_정상적으로_읽은_목록은_캐시한다(monkeypatch):
    calls = {"count": 0}
    good_list_cache = tour_api.get_cached_attraction_list

    async def counting_list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        calls["count"] += 1
        return await good_list_cache(ldong_regn_cd, content_type_id, max_age_hours)

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", counting_list_cache)

    search("화성")
    first = calls["count"]
    search("팔달")

    assert first > 0 and calls["count"] == first  # 두 번째 검색은 DB를 다시 읽지 않습니다


def test_검색_결과를_이어서_나눠_받을_수_있다():
    """검색 화면이 내릴수록 다음 묶음을 받습니다 — 묶음끼리 겹치거나 빠지면 안 됩니다."""
    client = tour_api.tour_api_client
    everything = asyncio.run(client.search_attractions("수원", limit=10))
    pages = [asyncio.run(client.search_attractions("수원", limit=2, offset=o)) for o in (0, 2, 4)]
    assert [a.content_id for page in pages for a in page] == [a.content_id for a in everything]
    assert len(everything) == 4 and pages[2] == []
