"""
관광지 방문자 리뷰(별점 + 한줄평) 작성/조회.

place_reviews 테이블에 (content_id, user_id, rating, body)를 저장합니다.
작성자 이름은 리뷰 테이블에 중복 저장하지 않고, 조회 시 profiles 테이블에서
user_id로 username을 찾아 붙여줍니다 (Supabase PostgREST 조인 대신 두 번
조회해서 파이썬에서 합치는 방식 — profiles와의 FK 관계 설정 여부에 의존하지
않아서 더 안전합니다).
"""
from typing import Optional

from app.config import get_settings

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_REVIEWS_TABLE = "place_reviews"


async def create_review(
    user_id: str, content_id: str, rating: int, body: str
) -> tuple[bool, Optional[dict] | str]:
    """
    리뷰를 작성합니다. 사용자당 한 장소에 리뷰 하나만 허용합니다 — 이미 쓴 리뷰가
    있으면 새로 만들지 않고 그 내용을 덮어씁니다(수정).
    성공 시 (True, 저장된 행), 실패 시 (False, 사용자에게 보여줄 메시지)를 반환합니다.
    """
    if _client is None:
        return False, "서버 설정 오류로 리뷰를 저장할 수 없어요."
    if not (1 <= rating <= 5):
        return False, "별점은 1~5 사이여야 해요."
    if not body.strip():
        return False, "리뷰 내용을 입력해주세요."
    try:
        existing = (
            _client.table(_REVIEWS_TABLE)
            .select("id")
            .eq("content_id", content_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = existing.data or []
        payload = {
            "content_id": content_id,
            "user_id": user_id,
            "rating": rating,
            "body": body.strip(),
        }
        if rows:
            result = (
                _client.table(_REVIEWS_TABLE).update(payload).eq("id", rows[0]["id"]).execute()
            )
        else:
            result = _client.table(_REVIEWS_TABLE).insert(payload).execute()
        saved_rows = result.data or []
        return True, (saved_rows[0] if saved_rows else None)
    except Exception as e:
        print(f"[review] 리뷰 저장 실패: {e}")
        return False, "리뷰를 저장하지 못했어요. 잠시 후 다시 시도해주세요."


async def list_reviews_for_place(content_id: str) -> list[dict]:
    """특정 장소의 리뷰 전체를 최신순으로 반환합니다 (작성자 아이디 포함)."""
    if _client is None:
        return []
    try:
        result = (
            _client.table(_REVIEWS_TABLE)
            .select("*")
            .eq("content_id", content_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return []

        user_ids = list({r["user_id"] for r in rows})
        usernames: dict[str, str] = {}
        try:
            profile_result = (
                _client.table("profiles").select("id, username").in_("id", user_ids).execute()
            )
            for p in profile_result.data or []:
                usernames[p["id"]] = p.get("username") or "익명"
        except Exception as e:
            print(f"[review] 작성자 아이디 조회 실패: {e}")

        for r in rows:
            r["username"] = usernames.get(r["user_id"], "익명")
        return rows
    except Exception as e:
        print(f"[review] 리뷰 목록 조회 실패: {e}")
        return []


async def count_reviews_by_user(user_id: str) -> int:
    """이 사용자가 작성한 리뷰 총 개수."""
    if _client is None:
        return 0
    try:
        result = (
            _client.table(_REVIEWS_TABLE)
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        return result.count or 0
    except Exception as e:
        print(f"[review] 내 리뷰 개수 조회 실패: {e}")
        return 0
