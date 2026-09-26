"""
AI 플래너 추천·선택 기록 (planner_selection_logs, sql/create_planner_selection_logs.sql 참고).

기록은 추천·코스 생성 응답을 기다리게 하지 않습니다. id는 여기서 미리 만들어
응답에 바로 싣고, 저장은 백그라운드로 넘깁니다. 저장이 실패해도 사용자 요청은
그대로 성공합니다 — 기록은 품질 분석용이라 없어도 서비스에는 지장이 없습니다.
"""
import asyncio
import datetime
import logging
import uuid

from app.config import get_settings
from app.services.db import execute as _execute

logger = logging.getLogger(__name__)
settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_TABLE = "planner_selection_logs"
# 한 세션에서 '다시 추천'을 이보다 많이 누르는 일은 드뭅니다. 앱이 보낸 id를
# 끝없이 받아 업데이트하지 않도록 앞쪽만 씁니다.
_MAX_ROUNDS = 20

# create_task가 돌려준 작업을 붙잡아 두지 않으면 끝나기 전에 사라질 수 있습니다.
_pending: set[asyncio.Task] = set()


def _in_background(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def _valid_uuid(value: object) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError):
        return None


def log_recommendation(
    *, query_text: str, user_type: str, sigungu_cd: int | None, visit_date: str | None,
    recommended_ids: list[str], user_id: str | None,
) -> str | None:
    """추천 한 번을 기록하고 그 id를 돌려줍니다. 기록할 수 없는 환경이면 None."""
    if _client is None or not recommended_ids:
        return None
    log_id = str(uuid.uuid4())
    row = {
        "id": log_id,
        "user_id": _valid_uuid(user_id),
        "query_text": query_text,
        "user_type": user_type,
        "sigungu_cd": sigungu_cd,
        "visit_date": visit_date,
        "recommended_ids": recommended_ids,
    }

    async def save() -> None:
        try:
            await _execute(_client.table(_TABLE).insert(row))
        except Exception as e:
            logger.warning("추천 기록을 저장하지 못했습니다: %s", e)

    _in_background(save())
    return log_id


def log_selection(recommendation_ids: list[str], selected_ids: list[str]) -> None:
    """코스를 만들 때, 그 세션의 추천 기록마다 그중 고른 장소를 채웁니다."""
    ids = [i for i in dict.fromkeys(filter(None, map(_valid_uuid, recommendation_ids)))][:_MAX_ROUNDS]
    if _client is None or not ids:
        return
    selected = list(dict.fromkeys(selected_ids))

    async def save() -> None:
        try:
            rows = (await _execute(
                _client.table(_TABLE).select("id, recommended_ids").in_("id", ids)
            )).data or []
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            for row in rows:
                recommended = set(row.get("recommended_ids") or [])
                await _execute(_client.table(_TABLE).update({
                    "selected_ids": [cid for cid in selected if cid in recommended],
                    "selected_at": now,
                }).eq("id", row["id"]))
        except Exception as e:
            logger.warning("선택 기록을 저장하지 못했습니다: %s", e)

    _in_background(save())
