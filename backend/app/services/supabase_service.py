"""
Supabase(PostgreSQL) 연동 - 생성된 여행 코스를 저장하고 이력을 조회합니다.

SUPABASE_URL / SUPABASE_SERVICE_KEY가 .env에 없으면 자동으로 '저장 안 함' 모드로
동작해 다른 기능은 그대로 쓸 수 있게 해뒀습니다 (키 없이도 앱이 죽지 않습니다).

user_id가 함께 오면(로그인한 사용자) 그 코스를 해당 사용자 소유로 저장하고,
이력 조회도 그 사용자 것만 필터링합니다. user_id가 없으면(비로그인) 저장은
하되 이력 조회에는 노출되지 않습니다 — 로그인해야 "내 코스 이력"이 보입니다.

코스가 생성될 때는 항상 자동으로 한 행이 기록되지만(is_saved=False), 사용자가
결과 화면에서 이름/분류를 지정해 '저장하기'를 눌러야 is_saved=True가 되고
마이페이지 목록에 나타납니다. 서비스 키로 접근하는 구조라 RLS가 없으므로,
수정/삭제/조회 시 반드시 user_id가 행의 소유자와 일치하는지 이 계층에서 확인합니다.

주의: Supabase 대시보드에서 courses 테이블에 다음 컬럼이 필요합니다.
- user_id (text, nullable)
- is_saved (bool, 기본값 false)
- name (text, nullable) — 사용자가 저장 시 지정하는 여행 이름
- category (text, nullable) — 가족/커플/친구/혼자/기타
"""
from typing import Optional

from app.config import get_settings
from app.models.schemas import CourseResponse, CourseStop

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)


async def save_course(
    course: CourseResponse, query_text: str, region: str, user_id: Optional[str] = None
) -> None:
    """코스 생성 직후 자동으로 기록합니다 (아직 '저장'한 상태는 아님, is_saved=False)."""
    if _client is None:
        return
    try:
        _client.table("courses").insert(
            {
                "id": course.course_id,
                "user_id": user_id,
                "user_type": course.generated_for.value,
                "query_text": query_text,
                "region": region,
                "title": course.title,
                "summary": course.summary,
                "stops": [s.model_dump() for s in course.stops],
                "is_saved": False,
            }
        ).execute()
    except Exception as e:
        # 저장 실패는 로그만 남기고 사용자 응답은 그대로 내려줍니다.
        print(f"[supabase] 코스 저장 실패: {e}")


async def list_recent_courses(limit: int = 20, user_id: Optional[str] = None) -> list[dict]:
    """
    최근 저장된 코스 이력을 조회합니다. Supabase 미설정 시 빈 리스트를 반환합니다.
    user_id가 없으면(비로그인) 빈 리스트를 반환합니다 — 로그인해야 이력이 보입니다.
    """
    if _client is None or not user_id:
        return []
    try:
        result = (
            _client.table("courses")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 코스 조회 실패: {e}")
        return []


async def mark_course_saved(course_id: str, user_id: str, name: str, category: str) -> tuple[bool, Optional[str]]:
    """
    사용자가 결과 화면에서 '저장하기'를 눌렀을 때 호출합니다. 여행 이름/분류를
    지정하고 is_saved를 True로 바꿉니다. 본인 소유의 코스인지 확인 후 진행합니다.
    """
    if _client is None:
        return False, "서버 설정 오류로 저장할 수 없어요."
    try:
        # 소유권 확인: 이 코스가 정말 이 user_id 것인지 먼저 조회
        existing = _client.table("courses").select("user_id").eq("id", course_id).limit(1).execute()
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        _client.table("courses").update(
            {"is_saved": True, "name": name, "category": category}
        ).eq("id", course_id).execute()
        return True, None
    except Exception as e:
        print(f"[supabase] 코스 저장(즐겨찾기) 실패: {e}")
        return False, "저장 중 오류가 발생했어요."


async def delete_course(course_id: str, user_id: str) -> tuple[bool, Optional[str]]:
    """저장된 코스를 삭제합니다. 본인 소유의 코스인지 확인 후 진행합니다."""
    if _client is None:
        return False, "서버 설정 오류로 삭제할 수 없어요."
    try:
        existing = _client.table("courses").select("user_id").eq("id", course_id).limit(1).execute()
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        _client.table("courses").delete().eq("id", course_id).execute()
        return True, None
    except Exception as e:
        print(f"[supabase] 코스 삭제 실패: {e}")
        return False, "삭제 중 오류가 발생했어요."


def row_to_course_response(row: dict) -> CourseResponse:
    return CourseResponse(
        course_id=row["id"],
        title=row["title"],
        summary=row["summary"],
        stops=[CourseStop(**s) for s in row.get("stops") or []],
        generated_for=row["user_type"],
    )


async def list_saved_courses(user_id: str) -> list[dict]:
    """마이페이지 목록용: is_saved=True인 코스들의 요약 정보를 최신순으로 반환합니다."""
    if _client is None:
        return []
    try:
        result = (
            _client.table("courses")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_saved", True)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 저장된 코스 목록 조회 실패: {e}")
        return []


async def get_saved_course_detail(course_id: str, user_id: str) -> Optional[dict]:
    """저장된 코스 하나를 다시 불러올 때(지도/결과 화면 재진입용) 사용합니다."""
    if _client is None:
        return None
    try:
        result = (
            _client.table("courses")
            .select("*")
            .eq("id", course_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 저장된 코스 상세 조회 실패: {e}")
        return None
