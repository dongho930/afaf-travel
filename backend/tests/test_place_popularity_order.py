"""
홈 화면 '인기 여행지'의 순서.

이 목록은 관광공사 areaBasedList2가 돌려주는 순서를 그대로 썼는데, 그 API는
arrange를 주지 않으면 제목순(가나다)으로 돌려줍니다. 정렬 코드는 있었지만
'목록을 자른 뒤'에 돌아서, 아무리 정렬해도 대상은 늘 이름이 ㄱ으로 시작하는
맨 앞 몇 개였습니다. 여기서는 그 두 가지를 검사합니다.
  - 순서를 자르기 '전에' 정하는가 (목록 끝에 있는 인기 장소가 첫 페이지에 오는가)
  - 활동 기록이 없는 곳들이 가나다순으로 남지 않는가 (날짜로 섞되 그날 안에서는 고정)
"""
import asyncio

import pytest

import app.services.tour_api as tour_api
from app.models.schemas import Attraction

# 이름이 가나다순으로 정렬된 목록. 마지막 '흥부네농장'이 인기 1위라고 가정합니다 —
# 예전 코드에서는 이 곳이 첫 페이지에 절대 나올 수 없었습니다.
PLACES = [
    ("1", "가평잣향기푸른숲"),
    ("2", "나흘공원"),
    ("3", "다산생태공원"),
    ("4", "라온숲길"),
    ("5", "마장호수출렁다리"),
    ("6", "바우덕이공원"),
    ("7", "사평역사공원"),
    ("8", "아침고요수목원"),
    ("9", "자유공원"),
    ("10", "흥부네농장"),
]


@pytest.fixture(autouse=True)
def cached_list_only(monkeypatch):
    """목록 캐시만 있는 상태 (공공데이터 API는 부르지 않습니다)."""
    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)

    async def list_cache(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        # 카테고리 하나(관광지)에만 목록을 둡니다 — 순서만 보는 테스트라
        # 카테고리 라운드로빈이 섞이지 않는 편이 읽기 쉽습니다.
        if content_type_id != 12:
            return []
        return [
            {
                "content_id": cid,
                "name": name,
                "address": "경기도 수원시 팔달구 정조로 825",
                "category": "관광지",
                "image_url": None,
            }
            for cid, name in PLACES
        ]

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", list_cache)

    # 목록 순서 자체만 보는 테스트라, 뒤따르는 부가 조회는 전부 비워둡니다.
    async def no_rows(*args, **kwargs):
        return {}

    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", no_rows)
    monkeypatch.setattr(tour_api, "get_cached_congestion_rates", no_rows)
    monkeypatch.setattr(tour_api, "get_average_ratings", no_rows)


def _attraction(content_id: str, name: str) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=name,
        address="경기도",
        category="관광지",
        latitude=37.28,
        longitude=127.01,
    )


def _search(limit: int = 5, offset: int = 0) -> list[Attraction]:
    return asyncio.run(
        tour_api.tour_api_client.search_accessible_attractions(
            "경기도", "general", limit=limit, include_overview=False, offset=offset
        )
    )


def test_인기_장소는_목록_끝에_있어도_첫_페이지에_온다(monkeypatch):
    """예전에는 '자르고 나서' 정렬해서, 가나다 뒤쪽 장소는 영영 못 나왔습니다."""

    async def scores(_self):
        return {"10": 0.9, "8": 0.5}

    monkeypatch.setattr(tour_api.TourApiClient, "_place_popularity_scores", scores)

    names = [a.name for a in _search(limit=5)]

    assert names[0] == "흥부네농장"  # 점수 0.9
    assert names[1] == "아침고요수목원"  # 점수 0.5


def test_점수가_높은_곳은_카테고리가_달라도_맨_앞에_온다(monkeypatch):
    """
    카테고리별 목록은 라운드로빈으로 이어붙입니다. 그 자체는 숙박만 잔뜩 나오는
    걸 막아주지만, 앞의 다섯 칸이 '카테고리별 1등'으로 채워지는 탓에 전체 1위가
    뒤쪽 카테고리(여기선 음식점)에 있으면 활동 기록이 없는 곳들 뒤로 밀렸습니다.
    """

    async def two_categories(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        if content_type_id == 12:  # 관광지 — 점수 없는 곳들
            return [
                {
                    "content_id": cid,
                    "name": name,
                    "address": "경기도 수원시 팔달구 정조로 825",
                    "category": "관광지",
                    "image_url": None,
                }
                for cid, name in PLACES
            ]
        if content_type_id == 39:  # 음식점 — 전체 1위가 여기 있습니다
            return [
                {
                    "content_id": "100",
                    "name": "수원왕갈비",
                    "address": "경기도 수원시 팔달구 정조로 825",
                    "category": "음식점",
                    "image_url": None,
                }
            ]
        return []

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", two_categories)

    async def scores(_self):
        return {"100": 0.9}

    monkeypatch.setattr(tour_api.TourApiClient, "_place_popularity_scores", scores)

    names = [a.name for a in _search(limit=10)]

    assert names[0] == "수원왕갈비"


def test_활동_기록이_없으면_가나다순으로_남지_않는다(monkeypatch):
    async def no_scores(_self):
        return {}

    monkeypatch.setattr(tour_api.TourApiClient, "_place_popularity_scores", no_scores)

    names = [a.name for a in _search(limit=60)]

    assert sorted(names) == sorted(n for _, n in PLACES)  # 빠진 곳 없이 전부
    assert names != [n for _, n in PLACES]  # 그러나 원래(가나다) 순서는 아님


def test_같은_날에는_순서가_고정된다():
    """
    '더보기'(offset)로 이어 볼 때 같은 곳이 두 번 나오거나 건너뛰어지지 않으려면,
    섞는 값이 그 날짜 안에서는 항상 같아야 합니다.
    """
    seed = "2026-09-18"
    key = tour_api._popularity_order_key({}, seed)
    items = [_attraction(cid, name) for cid, name in PLACES]

    first = [a.name for a in sorted(items, key=key)]
    second = [a.name for a in sorted(items, key=tour_api._popularity_order_key({}, seed))]

    assert first == second


def test_날짜가_바뀌면_순서도_바뀐다():
    items = [_attraction(cid, name) for cid, name in PLACES]

    today = [a.name for a in sorted(items, key=tour_api._popularity_order_key({}, "2026-09-18"))]
    tomorrow = [a.name for a in sorted(items, key=tour_api._popularity_order_key({}, "2026-09-19"))]

    assert today != tomorrow


def test_점수가_있는_곳이_섞이는_곳보다_항상_앞이다():
    key = tour_api._popularity_order_key({"9": 0.01}, "2026-09-18")
    items = [_attraction(cid, name) for cid, name in PLACES]

    names = [a.name for a in sorted(items, key=key)]

    # 0.01점짜리 한 곳이라도 점수가 없는 아홉 곳보다 앞에 옵니다.
    assert names[0] == "자유공원"


def test_인기도를_못_읽어도_목록은_나온다(monkeypatch):
    """인기도 조회가 실패해도 화면이 비면 안 됩니다 — 순서만 전부 '섞기'가 됩니다."""

    async def boom():
        raise RuntimeError("supabase 연결 실패")

    monkeypatch.setattr(tour_api, "read_place_popularity", boom)

    names = [a.name for a in _search(limit=60)]

    assert len(names) == len(PLACES)
