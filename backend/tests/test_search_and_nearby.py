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
