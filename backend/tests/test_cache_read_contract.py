"""
캐시 '읽기' 함수들의 공통 규약.

    값이 없다  -> None / 빈 dict / 빈 set  (정상)
    못 읽었다  -> CacheUnavailable          (예외)

예전에는 둘 다 빈 결과였습니다. 그래서 DB가 한 번 흔들리면 호출부가 "아직
없구나"로 오해하고 전부 다시 조회하거나(일일 트래픽 예산이 통째로 날아감),
안전망이 사라진 줄 모른 채 미완성 값을 저장했습니다.

새 캐시 읽기 함수를 추가할 때 이 테스트의 목록에도 함께 넣어주세요.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api
from app.services import supabase_service
from app.services.supabase_service import CacheUnavailable


class _AnyChain:
    """supabase 클라이언트 흉내 — 어떤 메서드를 어떻게 이어 붙여도 자기 자신을 돌려줍니다."""

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self


# (이름, 호출) — 인자는 "조회할 게 있는" 최소값이어야 합니다. 빈 목록을 넘기면
# 함수가 DB에 가기 전에 빈 결과로 빠져나가서 검사가 무의미해집니다.
CACHE_READS = [
    ("get_cached_accessibility_stats", lambda m: m.get_cached_accessibility_stats("경기도")),
    ("get_cached_place_accessibility", lambda m: m.get_cached_place_accessibility(["1"])),
    ("get_all_cached_place_accessibility_ids", lambda m: m.get_all_cached_place_accessibility_ids()),
    ("get_cached_congestion_rates", lambda m: m.get_cached_congestion_rates([41111])),
    ("get_cached_congestion_signgu_cds", lambda m: m.get_cached_congestion_signgu_cds()),
    ("get_cached_overviews", lambda m: m.get_cached_overviews(["1"])),
    ("get_cached_attraction_basic", lambda m: m.get_cached_attraction_basic("1")),
    ("get_cached_intro_info", lambda m: m.get_cached_intro_info("1")),
    ("get_cached_intro_info_batch", lambda m: m.get_cached_intro_info_batch(["1"])),
    ("get_cached_attraction_list", lambda m: m.get_cached_attraction_list("41", 12)),
]


@pytest.fixture
def db_is_down(monkeypatch):
    async def boom(_query):
        raise RuntimeError("JWT issued at future")

    monkeypatch.setattr(supabase_service, "_client", _AnyChain())
    monkeypatch.setattr(supabase_service, "_execute", boom)


@pytest.mark.parametrize("name,call", CACHE_READS, ids=[n for n, _ in CACHE_READS])
def test_읽지_못하면_조용히_넘어가지_않는다(name, call, db_is_down):
    with pytest.raises(CacheUnavailable):
        asyncio.run(call(supabase_service))


def test_모든_캐시_읽기_함수가_목록에_들어_있다():
    """새 함수를 추가하고 이 테스트에 넣는 걸 잊지 않도록."""
    실제 = {
        name
        for name in dir(supabase_service)
        if name.startswith(("get_cached_", "get_all_cached_"))
    }
    assert 실제 == {name for name, _ in CACHE_READS}


def test_있으면_좋은_자리는_예외를_삼키고_계속한다():
    """
    _optional_cache: 상세 페이지의 소개문·부가정보처럼 없어도 화면이 뜨는 곳용.
    """

    async def boom():
        raise CacheUnavailable("일시 장애")

    assert asyncio.run(tour_api._optional_cache(boom(), {}, "테스트")) == {}
    assert asyncio.run(tour_api._optional_cache(boom(), None, "테스트")) is None


def test_안전망_자리는_예외를_삼키지_않는다():
    """
    전수조사용 편의시설 캐시는 못 읽으면 멈춰야 합니다 — 여기서 빈 dict로
    넘어가면 후보 전체를 '캐시 없음'으로 보고 수천 건을 다시 조회합니다.
    """

    async def boom(content_ids):
        raise CacheUnavailable("일시 장애")

    original = tour_api.get_cached_place_accessibility
    tour_api.get_cached_place_accessibility = boom
    try:
        with pytest.raises(CacheUnavailable):
            asyncio.run(
                tour_api.tour_api_client._fill_accessibility_with_cache(None, [], diag={})
            )
    finally:
        tour_api.get_cached_place_accessibility = original
