"""
응답에 붙는 Cache-Control이 의도한 곳에만 붙는지.

캐시 헤더는 잘못 붙으면 티가 안 나게 사고를 냅니다 — 갱신 엔드포인트가 캐시되면
GitHub Actions가 갱신을 불러도 실제로는 아무 일도 안 일어나고, 503이 캐시되면
서버가 회복된 뒤에도 한동안 실패 화면이 보입니다. 그래서 '붙어야 할 곳'뿐 아니라
'붙으면 안 되는 곳'도 함께 확인합니다.
"""
import pytest
from fastapi.testclient import TestClient

import app.routers.tourism as tourism
from app.main import _cache_control_for, app
from app.services.supabase_service import CacheUnavailable


@pytest.mark.parametrize(
    "path, expected_max_age",
    [
        ("/api/tourism/regions", "max-age=86400"),
        ("/api/tourism/attractions", "max-age=300"),
        ("/api/tourism/attractions/126508", "max-age=300"),
        ("/api/tourism/attractions/search", "max-age=300"),
        ("/api/tourism/attractions/126508/nearby", "max-age=300"),
        ("/api/tourism/attractions/overviews", "max-age=3600"),
        ("/api/tourism/attractions/extra-info", "max-age=3600"),
        ("/api/tourism/attractions/126508/related", "max-age=3600"),
        ("/api/tourism/attractions/126508/congestion", "max-age=3600"),
        ("/api/tourism/accessibility-summary", "max-age=3600"),
        ("/api/tourism/accessibility-places", "max-age=3600"),
        ("/api/tourism/region-popularity", "max-age=3600"),
    ],
)
def test_public_tourism_reads_are_cacheable(path, expected_max_age):
    value = _cache_control_for(path)
    assert value is not None
    assert value.startswith(expected_max_age)


@pytest.mark.parametrize(
    "path",
    [
        # 매일 GitHub Actions가 실제로 갱신하라고 부르는 곳
        "/api/tourism/accessibility-summary/refresh",
        "/api/tourism/congestion-cache/refresh",
        "/api/tourism/overview-cache/refresh",
        "/api/tourism/region-popularity/refresh",
        "/api/tourism/place-popularity/refresh",
        "/api/courses/selection-logs/purge",
        # 사용자별 응답 / 상태 확인
        "/api/reviews/126508",
        "/api/account/profile",
        "/health",
    ],
)
def test_refresh_and_user_specific_paths_are_not_cached(path):
    assert _cache_control_for(path) is None


def test_header_is_set_on_success():
    client = TestClient(app)
    res = client.get("/api/tourism/regions")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "max-age=86400"


def test_header_is_not_set_on_failure(monkeypatch):
    async def boom(region, columns="*"):
        raise CacheUnavailable("JWT issued at future")

    monkeypatch.setattr(tourism, "get_cached_accessibility_stats", boom)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.get("/api/tourism/accessibility-summary?include_places=false")
    assert res.status_code == 503
    assert "cache-control" not in res.headers
