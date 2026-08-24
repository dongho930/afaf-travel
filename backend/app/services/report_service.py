"""
접근성 제보(어떤 여행지의 어떤 접근성 유형에 대해 실제로 겪은 점을 남기는 글).

방문자 리뷰(review_service.py)와 구조는 비슷하지만, 리뷰와 달리 한 사람이
같은 장소에 여러 번 제보할 수 있습니다 — 예전엔 경사로가 없었는데 나중에
생겼다는 식으로 상황이 바뀔 수 있어서, "장소당 1개"로 제한하지 않습니다.

접근성 점수(우수/보통/주의) 계산에는 반영하지 않고, 참고용 정보로만 접근성
탭에 따로 보여줍니다 — 점수 계산 로직에 반영하면 악의적 제보로 점수를
조작할 수 있는 위험이 있어서입니다.
"""
from typing import Literal, Optional

from app.config import get_settings

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_REPORTS_TABLE = "place_accessibility_reports"

ReportCategory = Literal["wheelchair", "visual", "hearing", "senior", "family", "pregnant"]
REPORT_CATEGORIES: tuple[str, ...] = ("wheelchair", "visual", "hearing", "senior", "family", "pregnant")


async def create_report(
    user_id: str, content_id: str, place_name: str, category: str, body: str
) -> tuple[bool, Optional[dict] | str]:
    """
    제보를 작성합니다. 리뷰와 달리 같은 장소에 여러 번 남길 수 있어서 항상 새 행을
    만듭니다(수정이 아니라 추가). 성공 시 (True, 저장된 행), 실패 시
    (False, 사용자에게 보여줄 메시지)를 반환합니다.
    """
    if _client is None:
        return False, "서버 설정 오류로 제보를 저장할 수 없어요."
    if category not in REPORT_CATEGORIES:
        return False, "올바르지 않은 카테고리예요."
    if not body.strip():
        return False, "제보 내용을 입력해주세요."
    if not place_name.strip():
        return False, "여행지를 선택해주세요."
    try:
        payload = {
            "content_id": content_id,
            "place_name": place_name.strip(),
            "category": category,
            "body": body.strip(),
            "user_id": user_id,
        }
        result = _client.table(_REPORTS_TABLE).insert(payload).execute()
        rows = result.data or []
        return True, (rows[0] if rows else None)
    except Exception as e:
        print(f"[report] 제보 저장 실패: {e}")
        return False, "제보를 저장하지 못했어요. 잠시 후 다시 시도해주세요."


async def list_reports_by_category(category: str, limit: int = 20) -> list[dict]:
    """특정 카테고리의 제보를 최신순으로 반환합니다 (작성자 아이디/프로필 사진 포함)."""
    if _client is None or category not in REPORT_CATEGORIES:
        return []
    try:
        result = (
            _client.table(_REPORTS_TABLE)
            .select("*")
            .eq("category", category)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return []

        user_ids = list({r["user_id"] for r in rows})
        usernames: dict[str, str] = {}
        avatar_urls: dict[str, str | None] = {}
        try:
            profile_result = (
                _client.table("profiles")
                .select("id, username, avatar_url")
                .in_("id", user_ids)
                .execute()
            )
            for p in profile_result.data or []:
                usernames[p["id"]] = p.get("username") or "익명"
                avatar_urls[p["id"]] = p.get("avatar_url") or None
        except Exception as e:
            print(f"[report] 작성자 정보 조회 실패: {e}")

        for r in rows:
            r["username"] = usernames.get(r["user_id"], "익명")
            r["avatar_url"] = avatar_urls.get(r["user_id"])
        return rows
    except Exception as e:
        print(f"[report] 제보 목록 조회 실패: {e}")
        return []


async def count_reports_by_user(user_id: str) -> int:
    """이 사용자가 작성한 제보 총 개수."""
    if _client is None:
        return 0
    try:
        result = (
            _client.table(_REPORTS_TABLE)
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        return result.count or 0
    except Exception as e:
        print(f"[report] 내 제보 개수 조회 실패: {e}")
        return 0
