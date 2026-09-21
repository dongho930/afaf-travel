"""리뷰와 접근성 제보는 방문 기록이 있는 장소에만 작성할 수 있습니다."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import reports, reviews
from app.services.auth import get_optional_user_id


@pytest.fixture
def client():
    app.dependency_overrides[get_optional_user_id] = lambda: "user-1"
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "module,path,payload",
    [
        (reviews, "/api/reviews/place-1", {"rating": 5, "body": "좋았어요"}),
        (reports, "/api/reports", {"content_id": "place-1", "place_name": "여행지", "category": "wheelchair", "body": "경사로가 있어요"}),
    ],
)
def test_unvisited_place_cannot_be_written(client, monkeypatch, module, path, payload):
    async def not_visited(user_id, content_id):
        assert (user_id, content_id) == ("user-1", "place-1")
        return False

    async def should_not_write(*args, **kwargs):
        pytest.fail("방문 기록이 없는데 저장 함수를 호출했습니다")

    monkeypatch.setattr(module, "has_visited_place", not_visited)
    monkeypatch.setattr(module, "create_review" if module is reviews else "create_report", should_not_write)
    response = client.post(path, json=payload)
    assert response.status_code == 403
    assert "방문한 여행지" in response.json()["detail"]


@pytest.mark.parametrize(
    "module,path,payload",
    [
        (reviews, "/api/reviews/place-1", {"rating": 5, "body": "좋았어요"}),
        (reports, "/api/reports", {"content_id": "place-1", "place_name": "여행지", "category": "wheelchair", "body": "경사로가 있어요"}),
    ],
)
def test_visited_place_can_be_written(client, monkeypatch, module, path, payload):
    async def visited(user_id, content_id):
        return True

    async def saved(*args, **kwargs):
        return True, {"id": "saved-1"}

    monkeypatch.setattr(module, "has_visited_place", visited)
    monkeypatch.setattr(module, "create_review" if module is reviews else "create_report", saved)
    response = client.post(path, json=payload)
    assert response.status_code == 200
    assert response.json()["id"] == "saved-1"


@pytest.mark.parametrize(
    "module,path,payload",
    [
        (reviews, "/api/reviews/place-1", {"rating": 5, "body": "좋았어요"}),
        (reports, "/api/reports", {"content_id": "place-1", "place_name": "여행지", "category": "wheelchair", "body": "경사로가 있어요"}),
    ],
)
def test_visit_lookup_failure_does_not_write(client, monkeypatch, module, path, payload):
    async def failed_lookup(user_id, content_id):
        raise RuntimeError("database unavailable")

    async def should_not_write(*args, **kwargs):
        pytest.fail("방문 기록을 확인하지 못했는데 저장 함수를 호출했습니다")

    monkeypatch.setattr(module, "has_visited_place", failed_lookup)
    monkeypatch.setattr(module, "create_review" if module is reviews else "create_report", should_not_write)
    response = client.post(path, json=payload)
    assert response.status_code == 503
