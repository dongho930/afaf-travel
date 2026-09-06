"""
서버 프로세스 메모리 안에 잠깐만 담아두는 TTL 캐시.

Supabase(DB) 캐시보다 한 단계 더 앞에 있는 캐시입니다.
- DB 캐시(attraction_list_cache 등): "외부 관광 API를 다시 부르지 않기" 위한 것
- 이 캐시: "짧은 시간 안에 똑같은 요청이 또 오면 DB 왕복조차 하지 않기" 위한 것

프로세스 메모리에만 있으므로 배포/재시작하면 비워지고, 인스턴스가 여러 개면
각자 따로 채워집니다. 잃어버려도 원래 경로로 다시 계산하면 그만이라 정확성에는
영향이 없는(속도만 좌우하는) 캐시입니다.

get_or_compute()는 같은 키에 대한 계산이 이미 진행 중이면 새로 계산하지 않고 그
결과를 같이 기다립니다 — 앱을 동시에 켠 사용자 여러 명이 똑같이 무거운 조회를
각자 처음부터 돌리는 일을 막기 위함입니다.
"""
import asyncio
import time
from typing import Awaitable, Callable, Generic, Hashable, Optional, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    """키별로 값을 ttl_seconds 동안만 들고 있는 아주 단순한 캐시."""

    def __init__(self, ttl_seconds: float, max_entries: int = 256) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._entries: dict[Hashable, tuple[float, T]] = {}
        self._locks: dict[Hashable, asyncio.Lock] = {}

    def get(self, key: Hashable) -> Optional[T]:
        """아직 유효한 값이 있으면 그 값을, 없거나 시간이 지났으면 None을 돌려줍니다."""
        entry = self._entries.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if time.monotonic() - stored_at > self._ttl:
            self._entries.pop(key, None)
            return None
        return value

    def set(self, key: Hashable, value: T) -> None:
        self._prune()
        self._entries[key] = (time.monotonic(), value)

    async def get_or_compute(
        self,
        key: Hashable,
        compute: Callable[[], Awaitable[T]],
        cache_if: Optional[Callable[[T], bool]] = None,
    ) -> T:
        """
        캐시에 있으면 그대로, 없으면 compute()로 계산해서 채운 뒤 돌려줍니다.

        같은 키를 동시에 여러 요청이 물어보면 그중 하나만 계산하고 나머지는 그
        결과를 기다립니다. cache_if를 주면 그 조건을 통과한 결과만 저장합니다
        (예: 빈 목록은 외부 API가 잠깐 말썽인 결과일 수 있어 캐시하지 않기).
        """
        cached = self.get(key)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # 기다리는 동안 앞선 요청이 이미 채워놨을 수 있으니 한 번 더 확인합니다.
            cached = self.get(key)
            if cached is not None:
                return cached
            value = await compute()
            if cache_if is None or cache_if(value):
                self.set(key, value)
            return value

    def _prune(self) -> None:
        """시간이 지난 항목을 정리하고, 그래도 너무 많으면 오래된 것부터 버립니다."""
        now = time.monotonic()
        for key in [k for k, (stored_at, _) in self._entries.items() if now - stored_at > self._ttl]:
            self._entries.pop(key, None)
            self._locks.pop(key, None)

        overflow = len(self._entries) - self._max_entries + 1
        if overflow > 0:
            oldest = sorted(self._entries.items(), key=lambda kv: kv[1][0])[:overflow]
            for key, _ in oldest:
                self._entries.pop(key, None)
                self._locks.pop(key, None)
