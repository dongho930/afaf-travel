"""'다시 추천'하면 이미 보여준 곳은 빼고 새로운 곳만 추천하는지."""

from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_service


def _recommend(client, exclude=()):
    response = client.post("/api/courses/recommend", json={
        "query_text": "가볼 만한 곳", "exclude_content_ids": list(exclude),
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_다시_추천하면_이미_보여준_곳은_나오지_않음(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    client = TestClient(app)
    first = [c["attraction"]["content_id"] for c in _recommend(client)["candidates"]]
    assert first
    second = _recommend(client, first)
    again = [c["attraction"]["content_id"] for c in second["candidates"]]
    assert not set(first) & set(again)


def test_새로운_곳이_적으면_그렇다고_알림(monkeypatch):
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")
    client = TestClient(app)
    first = [c["attraction"]["content_id"] for c in _recommend(client)["candidates"]]
    body = _recommend(client, first[:2])  # 목 데이터는 몇 곳뿐이라 두 곳만 빼도 6곳이 안 됩니다
    count = len(body["candidates"])
    assert 0 < count < 6
    assert body["notices"] == [f"이미 보여드린 곳을 빼면 새로 추천할 곳이 {count}곳뿐이에요."]
