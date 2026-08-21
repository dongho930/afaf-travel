"""
Supabase(PostgreSQL) 연동 - 생성된 여행 코스를 저장하고 이력을 조회합니다.

SUPABASE_URL / SUPABASE_SERVICE_KEY가 .env에 없으면 자동으로 '저장 안 함' 모드로
동작해 다른 기능은 그대로 쓸 수 있게 해뒀습니다 (키 없이도 앱이 죽지 않습니다).

user_id가 함께 오면(로그인한 사용자) 그 코스를 해당 사용자 소유로 저장하고,
이력 조회도 그 사용자 것만 필터링합니다.

코스가 생성될 때는 항상 자동으로 courses 테이블에 한 행이 기록되지만, 아직
'여행'에 소속되지 않은 상태(trip_id=NULL)입니다. 사용자가 결과 화면에서
'저장하기'로 기존 여행에 추가하거나 새 여행을 만들어야 trips 테이블에 그룹이
생기고(또는 기존 그룹에 연결되고) courses.trip_id가 채워집니다 — 그래야
마이페이지 '내 코스'(여행별 목록)에 나타납니다.

서비스 키로 접근하는 구조라 RLS가 없으므로, 수정/삭제/조회 시 반드시 user_id가
행의 소유자와 일치하는지 이 계층에서 확인합니다.

주의: Supabase 대시보드에서 다음이 필요합니다.
1) courses 테이블에 컬럼 추가: user_id (text, nullable), trip_id (text, nullable)
2) 새 테이블 trips: id (uuid, PK, 기본값 gen_random_uuid()), user_id (text),
   name (text), category (text), created_at (timestamptz, 기본값 now())
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
    """코스 생성 직후 자동으로 기록합니다 (아직 어느 '여행'에도 속하지 않은 상태, trip_id=None)."""
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
                "trip_id": None,
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


async def create_trip(user_id: str, name: str, category: str) -> Optional[str]:
    """새 여행(그룹)을 만들고 그 id를 반환합니다."""
    if _client is None:
        return None
    try:
        result = (
            _client.table("trips")
            .insert({"user_id": user_id, "name": name, "category": category})
            .execute()
        )
        rows = result.data or []
        return rows[0]["id"] if rows else None
    except Exception as e:
        print(f"[supabase] 여행 생성 실패: {e}")
        return None


async def list_trips(user_id: str) -> list[dict]:
    """사용자의 여행 목록을, 각 여행에 저장된 코스 수와 함께 최신순으로 반환합니다."""
    if _client is None:
        return []
    try:
        trips_result = (
            _client.table("trips")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        trips = trips_result.data or []
        if not trips:
            return []

        courses_result = (
            _client.table("courses")
            .select("trip_id")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
            .execute()
        )
        counts: dict[str, int] = {}
        for row in courses_result.data or []:
            tid = row.get("trip_id")
            if tid:
                counts[tid] = counts.get(tid, 0) + 1

        for trip in trips:
            trip["course_count"] = counts.get(trip["id"], 0)
        return trips
    except Exception as e:
        print(f"[supabase] 여행 목록 조회 실패: {e}")
        return []


async def delete_trip(trip_id: str, user_id: str) -> tuple[bool, Optional[str]]:
    """여행과 그 안에 저장된 코스들을 함께 삭제합니다."""
    if _client is None:
        return False, "서버 설정 오류로 삭제할 수 없어요."
    try:
        existing = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 여행을 찾을 수 없거나 접근 권한이 없어요."

        _client.table("courses").delete().eq("trip_id", trip_id).eq("user_id", user_id).execute()
        _client.table("trips").delete().eq("id", trip_id).execute()
        return True, None
    except Exception as e:
        print(f"[supabase] 여행 삭제 실패: {e}")
        return False, "삭제 중 오류가 발생했어요."


async def attach_course_to_trip(course_id: str, user_id: str, trip_id: str) -> tuple[bool, Optional[str]]:
    """생성된 코스를 특정 여행에 소속시킵니다(저장하기). 본인 소유의 코스/여행인지 확인 후 진행합니다."""
    if _client is None:
        return False, "서버 설정 오류로 저장할 수 없어요."
    try:
        course_row = _client.table("courses").select("user_id").eq("id", course_id).limit(1).execute()
        course_rows = course_row.data or []
        if not course_rows or course_rows[0].get("user_id") != user_id:
            return False, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        trip_row = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return False, "해당 여행을 찾을 수 없거나 접근 권한이 없어요."

        _client.table("courses").update({"trip_id": trip_id}).eq("id", course_id).execute()
        return True, None
    except Exception as e:
        print(f"[supabase] 코스-여행 연결 실패: {e}")
        return False, "저장 중 오류가 발생했어요."


async def delete_course(course_id: str, user_id: str) -> tuple[bool, Optional[str]]:
    """저장된 코스 하나를 여행에서 삭제합니다 (여행 자체는 유지)."""
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


async def list_trip_courses(trip_id: str, user_id: str) -> list[dict]:
    """특정 여행에 저장된 코스들을 최신순으로 반환합니다."""
    if _client is None:
        return []
    try:
        trip_row = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return []

        result = (
            _client.table("courses")
            .select("*")
            .eq("trip_id", trip_id)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 여행 내 코스 목록 조회 실패: {e}")
        return []


async def get_saved_course_detail(course_id: str, user_id: str) -> Optional[dict]:
    """저장된 코스 하나를 다시 불러올 때(지도/결과 화면 재진입용) 사용합니다. 소속 여행 정보도 함께 반환."""
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
        if not rows:
            return None
        row = rows[0]

        trip_id = row.get("trip_id")
        if trip_id:
            trip_result = _client.table("trips").select("*").eq("id", trip_id).limit(1).execute()
            trip_rows = trip_result.data or []
            row["_trip"] = trip_rows[0] if trip_rows else None
        else:
            row["_trip"] = None
        return row
    except Exception as e:
        print(f"[supabase] 저장된 코스 상세 조회 실패: {e}")
        return None
