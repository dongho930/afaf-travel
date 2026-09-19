"""
'방문한 여행지' 목록이 전체를 돌려주는지.

count_visited_places는 전체 개수를 정확히 세는데 list_visited_places는 50행에서
끊고 있었습니다. 그래서 방문지가 50곳을 넘으면 '내 여행' 탭 통계 카드의 숫자와
그 아래 목록의 길이가 어긋났고, 게시물 작성 화면의 여행지 선택 목록에서는
오래전에 방문한 장소가 잘렸다는 표시도 없이 선택지에서 사라졌습니다.

목록을 날짜별로 묶어 보여주게 되면서 이 잘림은 '오래된 날짜 그룹이 통째로
없어지는' 모양이 됩니다 — 그래서 여기서 지켜둡니다.
"""
import asyncio

import pytest

from app.services import supabase_service


class _FakeTable:
    """visited_places 테이블 흉내. .range()로 요청한 구간만 잘라서 돌려줍니다."""

    def __init__(
        self,
        rows: list[dict],
        ranges: list[tuple[int, int]],
        page_cap: int | None,
        report_count: bool,
    ):
        self._rows = rows
        self._ranges = ranges  # 테스트가 들여다볼 '실제로 요청된 구간' 기록
        self._page_cap = page_cap  # PostgREST의 서버측 max-rows 흉내
        self._report_count = report_count  # count="exact"를 실제로 돌려주는지
        self._counting = False
        self._start = 0
        self._stop = len(rows)
        self._order: list[tuple[str, bool]] = []

    def select(self, *_args, count: str | None = None, **_kwargs):
        self._counting = count == "exact"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def order(self, column: str, desc: bool = False):
        self._order.append((column, desc))
        return self

    def limit(self, count: int):
        self._start, self._stop = 0, count
        return self

    def range(self, start: int, end: int):
        self._start, self._stop = start, end + 1
        self._ranges.append((start, end))
        return self

    @property
    def data(self) -> list[dict]:
        rows = _sorted(self._rows, self._order)[self._start : self._stop]
        if self._page_cap is not None:
            rows = rows[: self._page_cap]
        return rows

    @property
    def count(self) -> int | None:
        """count="exact"로 함께 요청했을 때 오는 전체 개수."""
        if not (self._counting and self._report_count):
            return None
        return len(self._rows)


def _sorted(rows: list[dict], order: list[tuple[str, bool]]) -> list[dict]:
    """.order()로 지정된 순서대로 정렬합니다(나중에 지정한 키가 뒤쪽 기준)."""
    result = list(rows)
    for column, desc in reversed(order):
        result.sort(key=lambda row: row[column], reverse=desc)
    return result


class _FakeClient:
    def __init__(self, rows: list[dict], page_cap: int | None = None, report_count: bool = True):
        self.rows = rows
        self.ranges: list[tuple[int, int]] = []
        self._page_cap = page_cap
        self._report_count = report_count

    def table(self, name: str):
        assert name == "visited_places"
        return _FakeTable(self.rows, self.ranges, self._page_cap, self._report_count)


def _visited_rows(count: int, *, places_per_trip: int = 12) -> list[dict]:
    """방문 기록 count개.

    '방문 완료' 버튼은 여행 하나에 담긴 관광지를 한꺼번에 기록하므로(그때
    visited_at은 DB 기본값이 채웁니다) 수십 개 행이 같은 날짜를 공유합니다.
    동률이 페이지 경계에 걸리는 상황을 만들기 위해 그 모양을 그대로 씁니다.
    """
    return [
        {
            "id": f"v{i:04d}",
            "content_id": f"c{i}",
            "place_name": f"장소{i}",
            "visited_at": f"2026-09-{1 + (i // places_per_trip) % 28:02d}",
        }
        for i in range(count)
    ]


@pytest.fixture
def fake_db(monkeypatch):
    """_client를 갈아끼우고 _execute는 체인을 그대로 통과시킵니다."""

    def install(
        rows: list[dict], page_cap: int | None = None, report_count: bool = True
    ) -> _FakeClient:
        client = _FakeClient(rows, page_cap, report_count)

        async def passthrough(query):
            return query

        monkeypatch.setattr(supabase_service, "_client", client)
        monkeypatch.setattr(supabase_service, "_execute", passthrough)
        return client

    return install


def _list() -> list[dict]:
    return asyncio.run(supabase_service.list_visited_places("u1"))


@pytest.mark.parametrize("total", [0, 1, 50, 51, 137, 500, 501, 1200])
def test_방문지가_몇곳이든_전부_돌려준다(total, fake_db):
    # 통계 카드(count_visited_places)는 전체 개수를 세므로, 목록 길이가 그보다
    # 짧으면 두 숫자가 어긋납니다.
    fake_db(_visited_rows(total))
    assert len(_list()) == total


def test_페이지_경계에서_중복이나_누락이_없다(fake_db):
    # 한 여행의 관광지 12곳이 같은 visited_at을 공유하는 상태로 페이지를
    # 넘겨 읽습니다. visited_at만으로 정렬하면 동률끼리의 순서가 요청마다
    # 달라져 경계에 걸친 행이 두 번 나오거나 빠질 수 있습니다.
    rows = _visited_rows(1200)
    fake_db(rows)
    got = _list()
    ids = [row["id"] for row in got]
    assert len(ids) == len(set(ids)) == len(rows)
    assert set(ids) == {row["id"] for row in rows}


def test_최신순으로_돌려준다(fake_db):
    fake_db(_visited_rows(137))
    dates = [row["visited_at"] for row in _list()]
    assert dates == sorted(dates, reverse=True)


@pytest.mark.parametrize("page_cap", [200, 1000])
def test_서버측_상한에_걸려도_전부_읽는다(page_cap, fake_db):
    # PostgREST는 한 응답에 돌려주는 행 수에 자체 상한(max-rows)을 둘 수 있습니다.
    # 큰 limit 하나로 끝내면 여기서 조용히 잘립니다. 상한이 페이지 크기(500)보다
    # 작으면 '짧은 페이지'가 곧 끝이라고 볼 수도 없습니다.
    client = fake_db(_visited_rows(700), page_cap=page_cap)
    assert len(_list()) == 700
    assert len(client.ranges) > 1, "한 번에 다 받으려 했다면 상한에서 잘렸을 것입니다"


def test_전체_개수를_못_받아도_전부_읽는다(fake_db):
    # count="exact"가 오지 않는 환경(프록시나 설정에 따라)에서도 잘리면 안 됩니다.
    fake_db(_visited_rows(700), report_count=False)
    assert len(_list()) == 700


def test_흔한_규모는_왕복_한_번으로_끝낸다(fake_db):
    # 방문지 몇십 곳이 대부분입니다. 그 경우까지 페이지를 더 넘겨 읽으면
    # 목록을 열 때마다 쓸데없는 왕복이 붙습니다.
    client = fake_db(_visited_rows(37))
    assert len(_list()) == 37
    assert len(client.ranges) == 1


def test_안전_상한을_넘겨서까지_읽지_않는다(fake_db):
    fake_db(_visited_rows(supabase_service._VISITED_PLACES_MAX + 300))
    assert len(_list()) == supabase_service._VISITED_PLACES_MAX


def test_조회에_실패하면_빈_목록을_돌려준다(monkeypatch):
    async def boom(_query):
        raise RuntimeError("JWT issued at future")

    monkeypatch.setattr(supabase_service, "_client", _FakeClient([]))
    monkeypatch.setattr(supabase_service, "_execute", boom)
    assert _list() == []
