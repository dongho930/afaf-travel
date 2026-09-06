"""
서비스키 회전과 일일 예산.

공공데이터포털 개발계정 한도는 '키당' 하루 1,000건입니다. 키를 두 개 등록하고
번갈아 쓰면 하루 예산이 두 배가 되는데, 한쪽 키만 계속 쓰면 아무 효과가 없습니다.
"""
import asyncio

import pytest

import app.services.tour_api as tour_api
from app.config import Settings


def _settings(*keys: str) -> Settings:
    s = Settings()
    s.tour_api_key = keys[0] if keys else ""
    s.tour_api_key_2 = keys[1] if len(keys) > 1 else ""
    return s


def test_키가_둘이면_번갈아_쓴다(monkeypatch):
    monkeypatch.setattr(tour_api, "settings", _settings("KEY_A", "KEY_B"))
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "_key_index", 0)

    used = [client._common_params({})["serviceKey"] for _ in range(4)]

    assert used == ["KEY_A", "KEY_B", "KEY_A", "KEY_B"]


def test_키가_하나면_그대로_쓴다(monkeypatch):
    monkeypatch.setattr(tour_api, "settings", _settings("KEY_A"))
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "_key_index", 0)

    assert {client._common_params({})["serviceKey"] for _ in range(3)} == {"KEY_A"}


@pytest.mark.parametrize(
    "keys,expected_multiplier",
    [((), 1), (("A",), 1), (("A", "B"), 2)],
)
def test_일일_예산은_키_개수만큼_커진다(keys, expected_multiplier):
    s = _settings(*keys)

    assert s.daily_accessibility_budget == s.tour_api_daily_fetch_budget * expected_multiplier
    assert s.daily_overview_budget == s.overview_api_daily_fetch_budget * expected_multiplier
    assert s.daily_intro_budget == s.intro_api_daily_fetch_budget * expected_multiplier


def test_키_하나당_예산_합이_한도를_넘지_않는다():
    """
    편의시설/소개문/부가정보는 키 하나의 같은 한도(개발계정 1,000건/일)를
    나눠 씁니다. 합이 1,000을 넘으면 뒤에 도는 배치가 통째로 429를 맞습니다.
    """
    s = Settings()

    총합 = (
        s.tour_api_daily_fetch_budget
        + s.overview_api_daily_fetch_budget
        + s.intro_api_daily_fetch_budget
    )
    assert 총합 <= 1000, f"키 하나당 예산 합계가 {총합}건입니다"


def test_부가정보_배치는_예산을_넘게_조회하지_않는다(monkeypatch):
    """
    부가정보 캐시는 그동안 채우는 배치가 없어 통째로 비어 있었습니다. 새로 만든
    배치가 하루 예산을 무시하면 그날의 다른 배치가 전부 429를 맞습니다.
    """
    budget = 3
    attractions = [
        tour_api.Attraction(
            content_id=str(i), name=f"관광지{i}", address="경기도", latitude=0.0,
            longitude=0.0, category="관광지",
        )
        for i in range(10)
    ]
    fetched: list[str] = []

    async def empty_cache(content_ids):
        return {}

    async def fake_fetch(self, client, content_id, content_type_id):
        fetched.append(content_id)
        return {"usetime": "09:00~18:00"}

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tour_api, "get_cached_intro_info_batch", empty_cache)
    monkeypatch.setattr(tour_api.TourApiClient, "_fetch_intro_info", fake_fetch)
    monkeypatch.setattr(tour_api, "save_intro_info_batch", noop)

    diag: dict = {}
    asyncio.run(
        tour_api.tour_api_client._fill_extra_info_with_cache(
            None, attractions, max_new_fetches=budget, diag=diag
        )
    )

    assert len(fetched) == budget
    assert diag["deferred_no_budget"] == len(attractions) - budget
    assert diag["newly_fetched_and_cached"] == budget
