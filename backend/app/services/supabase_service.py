"""
Supabase(PostgreSQL) 연동 - 생성된 여행 코스를 저장하고 이력을 조회합니다.

SUPABASE_URL / SUPABASE_SERVICE_KEY가 .env에 없으면 자동으로 '저장 안 함' 모드로
동작해 다른 기능은 그대로 쓸 수 있게 해뒀습니다 (키 없이도 앱이 죽지 않습니다).
"""
from app.config import get_settings
from app.models.schemas import CourseResponse

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)


async def save_course(course: CourseResponse, query_text: str, region: str) -> None:
    """생성된 코스를 Supabase의 courses 테이블에 저장합니다. 실패해도 앱 흐름은 막지 않습니다."""
    if _client is None:
        return
    try:
        _client.table("courses").insert(
            {
                "id": course.course_id,
                "user_type": course.generated_for.value,
                "query_text": query_text,
                "region": region,
                "title": course.title,
                "summary": course.summary,
                "stops": [s.model_dump() for s in course.stops],
            }
        ).execute()
    except Exception as e:
        # 저장 실패는 로그만 남기고 사용자 응답은 그대로 내려줍니다.
        print(f"[supabase] 코스 저장 실패: {e}")


async def list_recent_courses(limit: int = 20) -> list[dict]:
    """최근 저장된 코스 이력을 조회합니다. Supabase 미설정 시 빈 리스트를 반환합니다."""
    if _client is None:
        return []
    try:
        result = (
            _client.table("courses")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 코스 조회 실패: {e}")
        return []
