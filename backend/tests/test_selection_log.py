"""AI 플래너 추천·선택 기록 — 무엇을 추천했고 무엇을 골랐는지가 제대로 남는지."""

import asyncio
import datetime
import uuid

from app.services import selection_log_service as logs


class _Query:
    def __init__(self, table: "_Table", op: str, payload=None):
        self.table, self.op, self.payload, self.filters = table, op, payload, {}

    def in_(self, column, values):
        self.filters[column] = set(values)
        return self

    def eq(self, column, value):
        self.filters[column] = {value}
        return self

    def lt(self, column, value):
        self.before = (column, value)
        return self


class _Table:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    def insert(self, row):
        return _Query(self, "insert", row)

    def select(self, _columns):
        return _Query(self, "select")

    def update(self, values):
        return _Query(self, "update", values)

    def delete(self):
        return _Query(self, "delete")


class _Client:
    def __init__(self):
        self.logs = _Table()

    def table(self, _name):
        return self.logs


class _Result:
    def __init__(self, data):
        self.data = data


async def _fake_execute(query: _Query):
    rows = query.table.rows
    if query.op == "insert":
        rows[query.payload["id"]] = dict(query.payload)
        return _Result([query.payload])
    if query.op == "delete":
        column, cutoff = query.before
        old = [r for r in rows.values() if r[column] < cutoff]
        for r in old:
            del rows[r["id"]]
        return _Result(old)
    matched = [r for r in rows.values() if r["id"] in query.filters.get("id", set())]
    if query.op == "update":
        for r in matched:
            r.update(query.payload)
    return _Result(matched)


def _setup(monkeypatch) -> _Client:
    client = _Client()
    monkeypatch.setattr(logs, "_client", client)
    monkeypatch.setattr(logs, "_execute", _fake_execute)
    return client


async def _drain():
    while logs._pending:
        await asyncio.gather(*list(logs._pending))


def test_다시_추천한_세션에서_각_추천마다_고른_곳만_남김(monkeypatch):
    client = _setup(monkeypatch)
    common = dict(user_type="wheelchair", sigungu_cd=None, visit_date=None, query_text="호수 산책")

    async def scenario():
        first = logs.log_recommendation(recommended_ids=["a", "b", "c"], user_id=None, **common)
        second = logs.log_recommendation(recommended_ids=["d", "e"], user_id=None, **common)
        skipped = logs.log_recommendation(recommended_ids=["f"], user_id=None, **common)
        await _drain()
        logs.log_selection([first, second, skipped], ["b", "d", "a"])
        await _drain()
        return first, second, skipped

    first, second, skipped = asyncio.run(scenario())
    rows = client.logs.rows
    assert rows[first]["selected_ids"] == ["b", "a"]
    assert rows[second]["selected_ids"] == ["d"]
    assert rows[skipped]["selected_ids"] == []
    assert rows[first]["user_id"] is None  # 비로그인도 기록


def test_로그인_사용자_id를_남기고_잘못된_id는_무시(monkeypatch):
    client = _setup(monkeypatch)
    user = str(uuid.uuid4())

    async def scenario():
        log_id = logs.log_recommendation(
            query_text="박물관", user_type="general", sigungu_cd=41111, visit_date="2026-10-01",
            recommended_ids=["a"], user_id=user,
        )
        await _drain()
        logs.log_selection(["not-a-uuid", log_id], ["a"])
        await _drain()
        return log_id

    log_id = asyncio.run(scenario())
    assert client.logs.rows[log_id]["user_id"] == user
    assert client.logs.rows[log_id]["selected_ids"] == ["a"]


def test_기록할_수_없는_환경이면_아무것도_하지_않음(monkeypatch):
    monkeypatch.setattr(logs, "_client", None)
    assert logs.log_recommendation(
        query_text="x", user_type="general", sigungu_cd=None, visit_date=None,
        recommended_ids=["a"], user_id=None,
    ) is None
    logs.log_selection([str(uuid.uuid4())], ["a"])  # 예외 없이 지나감


def test_저장이_실패해도_요청은_계속됨(monkeypatch):
    _setup(monkeypatch)

    async def broken(_query):
        raise RuntimeError("supabase down")

    monkeypatch.setattr(logs, "_execute", broken)

    async def scenario():
        log_id = logs.log_recommendation(
            query_text="x", user_type="general", sigungu_cd=None, visit_date=None,
            recommended_ids=["a"], user_id=None,
        )
        await _drain()
        return log_id

    assert asyncio.run(scenario()) is not None


def test_보관_기간_90일이_지난_기록만_지움(monkeypatch):
    client = _setup(monkeypatch)
    now = datetime.datetime.now(datetime.timezone.utc)
    for log_id, age in [("old", 91), ("edge", 89), ("new", 1)]:
        client.logs.rows[log_id] = {"id": log_id, "created_at": (now - datetime.timedelta(days=age)).isoformat()}
    assert asyncio.run(logs.purge_old_logs()) == 1
    assert set(client.logs.rows) == {"edge", "new"}
