"""
캐시를 '읽지 못했을 때'와 '값이 없을 때'를 구분해서 처리하는지.

둘 다 None을 돌려주던 시절에는, DB가 잠깐 흔들린 순간(JWT issued at future 등)
호출부가 "아직 계산한 적 없구나"로 오해하고 그 자리에서 재계산해 저장까지
했습니다. 하필 관광공사 API가 죽어 있으면 반토막 난 값이 그대로 박혔습니다.
"""
import pytest
from fastapi.testclient import TestClient

import app.routers.tourism as tourism
import app.services.tour_api as tour_api
from app.main import app
from app.services.supabase_service import CacheUnavailable
from tests.conftest import summary_payload

REGION = "경기도"
SUMMARY_URL = f"/api/tourism/accessibility-summary?region={REGION}&include_places=false"
PLACES_URL = f"/api/tourism/accessibility-places?region={REGION}&category=wheelchair"
REFRESH_URL = f"/api/tourism/accessibility-summary/refresh?region={REGION}"


@pytest.fixture
def client() -> TestClient:
    # raise_server_exceptions=False: 예외 핸들러(503)가 실제 응답으로 바뀌는지
    # 보려면 TestClient가 예외를 그대로 되던지지 않아야 합니다.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def saved(monkeypatch) -> list:
    """save_accessibility_stats로 실제 저장된 값들을 모읍니다."""
    calls: list = []

    async def fake_save(region, data):
        calls.append((region, data.get("total_accessible_count")))

    monkeypatch.setattr(tourism, "save_accessibility_stats", fake_save)
    return calls


def _cache_read_fails(monkeypatch):
    async def boom(region, columns="*"):
        raise CacheUnavailable("JWT issued at future")

    monkeypatch.setattr(tourism, "get_cached_accessibility_stats", boom)


def _cache_is_empty(monkeypatch):
    async def empty(region, columns="*"):
        return None

    monkeypatch.setattr(tourism, "get_cached_accessibility_stats", empty)


def _cache_has(monkeypatch, row: dict):
    async def existing(region, columns="*"):
        return row

    monkeypatch.setattr(tourism, "get_cached_accessibility_stats", existing)


def _computes(monkeypatch, total: int, candidates: int):
    async def compute(region):
        return summary_payload(total, candidates)

    monkeypatch.setattr(tourism.tour_api_client, "get_accessibility_summary", compute)


def _never_computes(monkeypatch):
    async def boom(region):
        raise AssertionError("캐시를 못 읽었을 뿐인데 재계산하면 안 됩니다")

    monkeypatch.setattr(tourism.tour_api_client, "get_accessibility_summary", boom)


def test_통계_캐시를_못_읽으면_503이고_재계산하지_않는다(client, saved, monkeypatch):
    _cache_read_fails(monkeypatch)
    _never_computes(monkeypatch)

    response = client.get(SUMMARY_URL)

    assert response.status_code == 503
    assert saved == []


def test_목록_캐시를_못_읽으면_503이다(client, monkeypatch):
    _cache_read_fails(monkeypatch)

    assert client.get(PLACES_URL).status_code == 503


def test_캐시가_비었어도_미완성_집계는_저장하지_않는다(client, saved, monkeypatch):
    # 캐시가 '진짜로' 비어 있으면 그 자리에서 계산하는 건 맞습니다. 다만 그
    # 결과가 미완성(후보 543건)이면 저장까지 하면 안 됩니다 — 한 번 저장되면
    # 다음 갱신의 '직전 값'이 돼서 낮은 숫자가 굳어버립니다.
    _cache_is_empty(monkeypatch)
    _computes(monkeypatch, total=539, candidates=543)

    response = client.get(SUMMARY_URL)

    assert response.status_code == 200
    assert response.json()["total_accessible_count"] == 539  # 응답에는 나가되
    assert saved == []  # 저장은 안 함


def test_캐시가_비고_집계가_정상이면_저장한다(client, saved, monkeypatch):
    _cache_is_empty(monkeypatch)
    _computes(monkeypatch, total=1240, candidates=2500)

    assert client.get(SUMMARY_URL).status_code == 200
    assert saved == [(REGION, 1240)]


def test_갱신은_직전_값을_못_읽으면_저장하지_않는다(client, saved, monkeypatch):
    # 퇴보인지 판단할 근거가 없는 상태에서 저장하면 검사를 건너뛴 것과 같습니다.
    _cache_read_fails(monkeypatch)
    _computes(monkeypatch, total=1240, candidates=2500)

    response = client.get(REFRESH_URL)

    assert response.status_code == 200  # 계산 결과는 돌려주되
    assert saved == []  # 저장은 안 함


def test_갱신은_퇴보한_값을_저장하지_않는다(client, saved, monkeypatch, healthy_cache):
    _cache_has(monkeypatch, healthy_cache)
    _computes(monkeypatch, total=539, candidates=543)

    assert client.get(REFRESH_URL).status_code == 200
    assert saved == []


def test_갱신은_복구된_값을_저장한다(client, saved, monkeypatch, damaged_cache):
    _cache_has(monkeypatch, damaged_cache)
    _computes(monkeypatch, total=1232, candidates=1247)

    assert client.get(REFRESH_URL).status_code == 200
    assert saved == [(REGION, 1232)]


@pytest.mark.parametrize("attractions_count", [500])
def test_기존_목록_캐시를_못_읽으면_목록_캐시를_덮어쓰지_않는다(monkeypatch, attractions_count):
    """
    목록 캐시는 목록 API가 죽었을 때 후보를 지켜주는 마지막 안전망입니다.
    '얼마나 줄었는지' 비교할 기존 캐시를 못 읽었다면, 판단 근거 없이 덮어쓰지
    않아야 합니다.
    """
    import asyncio

    async def boom(ldong_regn_cd, content_type_id, max_age_hours=24.0):
        raise CacheUnavailable("Resource temporarily unavailable")

    monkeypatch.setattr(tour_api, "get_cached_attraction_list", boom)

    should_save = asyncio.run(
        tour_api.tour_api_client._should_save_list_cache(
            "41", 12, [object()] * attractions_count, {}
        )
    )
    assert should_save is False
