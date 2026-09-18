"""
Supabase 조회의 한 번짜리 재시도.

운영 로그에서 하루 한두 번, 접근성 탭과 홈 화면의 통계가 503으로 실패했습니다.
원인은 둘 다 '이 순간에만' 나는 것이었습니다 — PostgREST의 'JWT issued at
future'(시계 어긋남)와 연결을 만들지 못한 [Errno 11]. 앱 쪽에서도 다시 걸지만,
여기서 한 번 받아내면 사용자에게 오류가 나가는 일 자체가 줄어듭니다.
"""
import asyncio
import errno

import pytest

from app.services.db import execute


class FakeQuery:
    """지정한 예외를 앞에서 몇 번 던지고 그 뒤로는 성공하는 가짜 쿼리."""

    def __init__(self, errors: list[BaseException], result: str = "ok"):
        self.errors = list(errors)
        self.result = result
        self.calls = 0

    def execute(self):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.result


def eagain() -> OSError:
    return OSError(errno.EAGAIN, "Resource temporarily unavailable")


def jwt_future() -> Exception:
    return Exception("{'message': 'JWT issued at future', 'code': 'PGRST303'}")


@pytest.mark.parametrize("error_factory", [eagain, jwt_future], ids=["EAGAIN", "PGRST303"])
def test_일시적인_실패는_한_번_다시_건다(monkeypatch, error_factory):
    monkeypatch.setattr("app.services.db._RETRY_DELAY_SECONDS", 0)
    query = FakeQuery([error_factory()])

    assert asyncio.run(execute(query)) == "ok"
    assert query.calls == 2


def test_다시_걸어도_실패하면_그대로_올려보낸다(monkeypatch):
    """두 번으로 안 풀리면 평소대로 예외가 올라가 503 안내로 이어집니다."""
    monkeypatch.setattr("app.services.db._RETRY_DELAY_SECONDS", 0)
    query = FakeQuery([eagain(), eagain()])

    with pytest.raises(OSError):
        asyncio.run(execute(query))
    assert query.calls == 2  # 한 번만 더 겁니다 — 계속 매달리지 않습니다


def test_다시_해도_같은_답일_실패는_바로_올려보낸다(monkeypatch):
    """권한 없음·행 없음 같은 실패까지 다시 걸면 응답만 느려집니다."""
    monkeypatch.setattr("app.services.db._RETRY_DELAY_SECONDS", 0)
    query = FakeQuery([PermissionError("permission denied for table courses")])

    with pytest.raises(PermissionError):
        asyncio.run(execute(query))
    assert query.calls == 1


def test_문제가_없으면_한_번만_부른다():
    query = FakeQuery([])

    assert asyncio.run(execute(query)) == "ok"
    assert query.calls == 1
