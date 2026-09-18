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

여기에 더해, '이 순간에만' 실패하는 두 가지 경우에는 한 번 다시 겁니다 —
아래 _is_transient의 설명을 참고하세요.
"""
import asyncio
import errno
import logging
from typing import Any

logger = logging.getLogger(__name__)

# 다시 걸기 전에 쉬는 시간. 짧게 숨만 고르면 되는 종류의 실패라 길게 기다릴
# 이유가 없고, 오래 붙잡고 있으면 그만큼 요청 처리가 밀립니다.
_RETRY_DELAY_SECONDS = 0.25


def _is_transient(error: BaseException) -> bool:
    """
    곧바로 다시 걸면 풀릴 실패인지 판단합니다.

    실제로 운영 로그에 남은 두 가지만 봅니다. 둘 다 쿼리가 데이터베이스에
    닿기 '전에' 끊긴 경우라, 다시 걸어도 같은 작업이 두 번 적용될 일이 없습니다.

      - PGRST303 'JWT issued at future'
        서버와 Supabase의 시계가 순간적으로 어긋나면 PostgREST가 토큰을 미래에
        발급된 것으로 보고 거부합니다. 쿼리는 실행되지 않았고, 몇 백 밀리초면
        해소됩니다.

      - [Errno 11] Resource temporarily unavailable (EAGAIN)
        요청이 겹쳐 연결을 새로 만들지 못한 순간입니다. 연결이 없었으니 쿼리도
        보내지지 않았고, 앞 요청이 끝나는 대로 풀립니다.

    '행이 없다', '권한이 없다'처럼 다시 해도 같은 답이 올 실패는 그대로
    올려보냅니다 — 여기서 대신 삼키면 호출한 쪽이 판단할 근거를 잃습니다.
    """
    if isinstance(error, OSError) and error.errno == errno.EAGAIN:
        return True
    text = str(error)
    return (
        "PGRST303" in text
        or "JWT issued at future" in text
        or "Resource temporarily unavailable" in text
    )


async def execute(query: Any) -> Any:
    """
    supabase-py 쿼리를 별도 스레드에서 실행하고 결과를 돌려줍니다.

    일시적인 이유로 실패하면 한 번만 다시 겁니다. 여러 번 거는 대신 한 번만
    거는 이유는, 이미 자원이 모자란 순간에 같은 요청을 몇 번씩 더 얹으면
    상황을 악화시키기 때문입니다. 한 번으로 안 풀리면 평소대로 예외를
    올려보내고, 그 위(app/main.py)에서 503으로 안내합니다.
    """
    try:
        return await asyncio.to_thread(query.execute)
    except Exception as error:
        if not _is_transient(error):
            raise
        logger.warning("Supabase 조회가 일시적인 이유로 실패해 한 번 다시 겁니다: %s", error)

    await asyncio.sleep(_RETRY_DELAY_SECONDS)
    return await asyncio.to_thread(query.execute)
