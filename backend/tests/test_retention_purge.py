"""개인정보처리방침의 보관 기간대로 지우는지 — 비로그인 코스 1년, 추천·선택 기록 90일."""

import asyncio
import datetime

from fastapi.testclient import TestClient

import app.routers.courses as courses
from app.main import app
from app.services import supabase_service


class _Courses:
    def __init__(self, rows):
        self.rows = rows
        self.filters = {}

    def delete(self):
        return self

    def is_(self, column, value):
        self.filters["null"] = column
        return self

    def lt(self, column, value):
        self.filters["before"] = (column, value)
        return self


class _Client:
    def __init__(self, rows):
        self.courses = _Courses(rows)

    def table(self, name):
        assert name == "courses"
        return self.courses


class _Result:
    def __init__(self, data):
        self.data = data


def _days_ago(days):
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()


def test_1년_지난_비로그인_코스만_지움(monkeypatch):
    rows = [
        {"id": "old-anon", "user_id": None, "created_at": _days_ago(400)},
        {"id": "new-anon", "user_id": None, "created_at": _days_ago(30)},
        {"id": "old-member", "user_id": "u1", "created_at": _days_ago(400)},
    ]
    client = _Client(rows)

    async def fake_execute(query):
        column = query.filters["null"]
        field, cutoff = query.filters["before"]
        gone = [r for r in query.rows if r[column] is None and r[field] < cutoff]
        query.rows[:] = [r for r in query.rows if r not in gone]
        return _Result(gone)

    monkeypatch.setattr(supabase_service, "_client", client)
    monkeypatch.setattr(supabase_service, "_execute", fake_execute)
    assert asyncio.run(supabase_service.purge_old_anonymous_courses()) == 1
    assert {r["id"] for r in rows} == {"new-anon", "old-member"}


def test_정리_주소는_두_기록을_함께_지우고_하나라도_실패하면_알림(monkeypatch):
    async def logs():
        return 3

    async def anon_courses():
        return 2

    async def fail():
        return None

    monkeypatch.setattr(courses, "purge_old_logs", logs)
    monkeypatch.setattr(courses, "purge_old_anonymous_courses", anon_courses)
    client = TestClient(app)
    body = client.get("/api/courses/selection-logs/purge").json()
    assert body["deleted"] == 3 and body["deleted_anonymous_courses"] == 2
    assert body["anonymous_course_retention_days"] == 365

    monkeypatch.setattr(courses, "purge_old_anonymous_courses", fail)
    assert client.get("/api/courses/selection-logs/purge").status_code == 503
