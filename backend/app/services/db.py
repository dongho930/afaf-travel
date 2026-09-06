"""
Supabase 쿼리를 이벤트 루프를 막지 않고 실행하기 위한 헬퍼.

supabase-py의 execute()는 동기(blocking) 함수입니다. async 함수 안에서 그대로
부르면 Supabase가 응답할 때까지 FastAPI의 이벤트 루프 전체가 멈춰서, 그동안
다른 요청은 처리는커녕 시작조차 못 합니다 — 사용자가 한 명일 때는 티가 안 나지만
두세 명만 동시에 앱을 켜도 서로의 응답을 순서대로 기다리게 됩니다.

그래서 쿼리 실행만 별도 스레드로 넘기고, 기다리는 동안 이벤트 루프는 다른 요청을
계속 처리하게 합니다. 쿼리를 만드는 부분(_client.table(...).select(...))은 실제
통신을 하지 않으므로 그대로 두고, 마지막 execute()만 이 함수로 감싸면 됩니다.

    result = await execute(_client.table("trips").select("*").eq("user_id", uid))
"""
import asyncio
from typing import Any


async def execute(query: Any) -> Any:
    """supabase-py 쿼리를 별도 스레드에서 실행하고 결과를 돌려줍니다."""
    return await asyncio.to_thread(query.execute)
