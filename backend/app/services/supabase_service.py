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

import datetime

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


async def list_saved_courses(user_id: str, limit: int = 50) -> list[dict]:
    """
    '내 여행' 탭의 '저장한 경로' 통계 카드를 눌렀을 때 보여줄, 실제로 여행에
    저장된(trip_id가 있는) 코스 전체를 여행 구분 없이 한 번에 최신순으로
    반환합니다. list_recent_courses는 여행에 저장하지 않은 것까지 다 포함해서
    '저장한 경로' 개수(trips의 course_count 합)와 안 맞을 수 있어 따로 둡니다.
    """
    if _client is None or not user_id:
        return []
    try:
        result = (
            _client.table("courses")
            .select("*")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 저장된 코스 전체 조회 실패: {e}")
        return []


async def create_trip(
    user_id: str,
    name: str,
    category: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[str]:
    """새 여행(그룹)을 만들고 그 id를 반환합니다."""
    if _client is None:
        return None
    try:
        result = (
            _client.table("trips")
            .insert(
                {
                    "user_id": user_id,
                    "name": name,
                    "category": category,
                    "start_date": start_date,
                    "end_date": end_date,
                }
            )
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

        # 각 여행이 '방문 완료' 처리된 적 있는지(visited_places에 이 trip_id로
        # 저장된 행이 하나라도 있는지)도 같이 계산해서 붙여줍니다.
        visited_result = (
            _client.table("visited_places")
            .select("trip_id")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
            .execute()
        )
        visited_trip_ids = {row.get("trip_id") for row in (visited_result.data or [])}

        for trip in trips:
            trip["course_count"] = counts.get(trip["id"], 0)
            trip["visited"] = trip["id"] in visited_trip_ids
        return trips
    except Exception as e:
        print(f"[supabase] 여행 목록 조회 실패: {e}")
        return []


async def update_trip(
    trip_id: str,
    user_id: str,
    name: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> tuple[bool, Optional[str]]:
    """마이페이지에서 여행 이름/분류/날짜를 수정합니다. 넘겨준 값만 반영됩니다."""
    if _client is None:
        return False, "서버 설정 오류로 수정할 수 없어요."
    try:
        existing = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 여행을 찾을 수 없거나 접근 권한이 없어요."

        update_fields = {}
        if name is not None:
            update_fields["name"] = name
        if category is not None:
            update_fields["category"] = category
        if start_date is not None:
            update_fields["start_date"] = start_date
        if end_date is not None:
            update_fields["end_date"] = end_date

        if not update_fields:
            return True, None

        _client.table("trips").update(update_fields).eq("id", trip_id).execute()
        return True, None
    except Exception as e:
        print(f"[supabase] 여행 수정 실패: {e}")
        return False, "수정 중 오류가 발생했어요."


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


async def update_course(
    course_id: str,
    user_id: str,
    title: Optional[str] = None,
    stop_order: Optional[list[str]] = None,
) -> tuple[Optional[dict], Optional[str]]:
    """
    저장된 코스의 제목을 바꾸거나(title), 관광지 순서를 바꿉니다(stop_order —
    새 순서대로 나열한 content_id 목록). stop_order를 줄 땐 기존 stops에 있는
    항목들과 정확히 같은 집합이어야 하고(추가/제외 불가), 각 항목의 attraction/
    reason/recommended_arrival_time 등 나머지 데이터는 그대로 유지한 채 순서와
    order 번호만 새로 매깁니다.
    """
    if _client is None:
        return None, "서버 설정 오류로 수정할 수 없어요."
    try:
        existing = _client.table("courses").select("*").eq("id", course_id).limit(1).execute()
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return None, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."
        row = rows[0]

        update_payload: dict = {}
        if title is not None:
            update_payload["title"] = title

        if stop_order is not None:
            existing_stops = row.get("stops") or []
            by_content_id = {s["attraction"]["content_id"]: s for s in existing_stops}
            if set(by_content_id.keys()) != set(stop_order) or len(stop_order) != len(existing_stops):
                return None, "순서를 지정한 관광지 목록이 기존 코스와 일치하지 않아요."
            new_stops = []
            for i, content_id in enumerate(stop_order, start=1):
                stop = dict(by_content_id[content_id])
                stop["order"] = i
                new_stops.append(stop)
            update_payload["stops"] = new_stops

        if not update_payload:
            return row, None

        result = _client.table("courses").update(update_payload).eq("id", course_id).execute()
        updated_rows = result.data or []
        return (updated_rows[0] if updated_rows else row), None
    except Exception as e:
        print(f"[supabase] 코스 수정 실패: {e}")
        return None, "수정 중 오류가 발생했어요."


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


async def get_cached_accessibility_stats(region: str) -> Optional[dict]:
    """
    '접근성' 탭/홈 화면 통계용으로 미리 계산해둔 고정 값을 조회합니다.
    아직 한 번도 계산해서 저장한 적이 없으면(캐시 없음) None을 반환합니다.
    """
    if _client is None:
        return None
    try:
        result = (
            _client.table("accessibility_stats")
            .select("*")
            .eq("region", region)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 접근성 통계 캐시 조회 실패: {e}")
        return None


async def save_accessibility_stats(region: str, data: dict) -> None:
    """
    새로 계산한 접근성 통계를 저장(있으면 갱신, 없으면 생성)합니다.
    이후 조회는 이 저장된 값을 그대로 읽기만 해서, 다시 계산하기 전까지는 항상
    같은(고정된) 숫자가 나옵니다.
    """
    if _client is None:
        return
    try:
        existing = _client.table("accessibility_stats").select("id").eq("region", region).limit(1).execute()
        rows = existing.data or []
        payload = {**data, "region": region}
        if rows:
            _client.table("accessibility_stats").update(payload).eq("region", region).execute()
        else:
            _client.table("accessibility_stats").insert(payload).execute()
    except Exception as e:
        print(f"[supabase] 접근성 통계 캐시 저장 실패: {e}")


# ---- 장소별 무장애 정보(편의시설) 캐시 ----
#
# 왜 필요한가: 접근성 통계를 새로고침할 때마다 경기도 전체 후보(수천 건) 각각에
# 대해 한국관광공사 '무장애 여행 정보' API(detailWithTour2)를 다시 호출하면
# data.go.kr의 일일 트래픽 한도를 금방 넘겨버립니다. 장소별 편의시설 정보는
# 자주 바뀌는 데이터가 아니므로, 한 번 조회한 결과는 DB에 저장해두고 다음
# 새로고침부터는 '새로 등장한 장소'나 '오래돼서 다시 확인이 필요한 장소'만
# API를 호출하도록 합니다.
#
# Supabase 대시보드에서 미리 만들어둬야 하는 테이블:
#   place_accessibility_cache
#     - content_id (text, Primary Key)
#     - has_ramp (bool)
#     - has_elevator (bool)
#     - has_accessible_restroom (bool)
#     - has_wheelchair_rental (bool)
#     - has_stroller_accessible_path (bool)
#     - has_rest_area (bool)
#     - record_found (bool)   -- 무장애 정보 API에 이 장소의 레코드가 실제로 있었는지
#     - fetched_at (timestamptz)

_PLACE_ACCESSIBILITY_TABLE = "place_accessibility_cache"


async def get_cached_place_accessibility(content_ids: list[str]) -> dict[str, dict]:
    """
    주어진 content_id 목록 중 이미 캐시에 있는 것만 {content_id: row} 형태로 돌려줍니다.
    캐시에 없는 content_id는 결과 dict에 아예 안 나타납니다(그게 곧 '새로 조회해야 함' 신호).
    한 번에 너무 많은 id를 물어보면 요청이 실패할 수 있어 500개씩 나눠서 조회합니다.
    """
    if _client is None or not content_ids:
        return {}
    found: dict[str, dict] = {}
    chunk_size = 500
    try:
        for i in range(0, len(content_ids), chunk_size):
            chunk = content_ids[i : i + chunk_size]
            result = (
                _client.table(_PLACE_ACCESSIBILITY_TABLE)
                .select("*")
                .in_("content_id", chunk)
                .execute()
            )
            for row in result.data or []:
                found[row["content_id"]] = row
    except Exception as e:
        print(f"[supabase] 장소별 무장애 정보 캐시 조회 실패: {e}")
        return {}
    return found


async def save_place_accessibility_batch(rows: list[dict]) -> None:
    """
    새로 조회한 장소별 무장애 정보를 캐시 테이블에 upsert(있으면 갱신, 없으면 생성)합니다.
    content_id가 Primary Key라고 가정합니다.
    """
    if _client is None or not rows:
        return
    chunk_size = 500
    try:
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            _client.table(_PLACE_ACCESSIBILITY_TABLE).upsert(chunk).execute()
    except Exception as e:
        print(f"[supabase] 장소별 무장애 정보 캐시 저장 실패: {e}")


# ---- 관광지 집중률(≈인기도) 캐시 ----
#
# 한국관광공사 '관광지 집중률 방문자 추이 예측 정보'(TatsCnctrRateService)는
# areaCd+signguCd만으로 그 시/군/구 안 관광지들의 집중률(cnctrRate, 0~100%)을
# 한 번에 받아올 수 있습니다(관광지명 지정은 옵션). 시/군/구 단위 호출이라
# 경기도 전체도 44개 시/군/구 정도로 커버되어, 무장애 정보(장소 단위 수천 건)
# 보다 훨씬 적은 API 호출로 전수조사가 가능합니다.
#
# Supabase 대시보드에서 미리 만들어둬야 하는 테이블:
#   congestion_cache
#     - signgu_cd (integer)
#     - tats_nm (text)          -- 관광지명 (API가 content_id를 안 주기 때문에 이름 기준)
#     - cnctr_rate (numeric)
#     - base_ymd (text)         -- 이 집중률이 어느 날짜 기준인지 (YYYYMMDD)
#     - fetched_at (timestamptz)
#     - PRIMARY KEY (signgu_cd, tats_nm)

_CONGESTION_TABLE = "congestion_cache"


async def get_cached_congestion_rates(signgu_cds: list[int]) -> dict[tuple[int, str], dict]:
    """
    주어진 시군구코드 목록에 해당하는 캐시된 집중률 행을 전부 가져와
    {(signgu_cd, tats_nm): row} 형태로 돌려줍니다.
    """
    if _client is None or not signgu_cds:
        return {}
    found: dict[tuple[int, str], dict] = {}
    try:
        result = (
            _client.table(_CONGESTION_TABLE)
            .select("*")
            .in_("signgu_cd", signgu_cds)
            .execute()
        )
        for row in result.data or []:
            found[(row["signgu_cd"], row["tats_nm"])] = row
    except Exception as e:
        print(f"[supabase] 집중률 캐시 조회 실패: {e}")
        return {}
    return found


async def get_cached_congestion_signgu_cds() -> set[int]:
    """캐시에 이미 채워져 있는 시군구코드 집합을 돌려줍니다 (전수조사 진행 상황 판단용)."""
    if _client is None:
        return set()
    try:
        result = _client.table(_CONGESTION_TABLE).select("signgu_cd").execute()
        return {row["signgu_cd"] for row in (result.data or [])}
    except Exception as e:
        print(f"[supabase] 집중률 캐시 시군구 목록 조회 실패: {e}")
        return set()


async def save_congestion_rates_batch(rows: list[dict]) -> None:
    """새로 조회한 집중률 데이터를 캐시 테이블에 upsert합니다."""
    if _client is None or not rows:
        return
    chunk_size = 500
    try:
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            _client.table(_CONGESTION_TABLE).upsert(chunk).execute()
    except Exception as e:
        print(f"[supabase] 집중률 캐시 저장 실패: {e}")


# ---- 관광지 소개문 + 기본정보(이름/주소/좌표/이미지/카테고리) 캐시 ----
#
# detailCommon2(공통정보조회)는 장소당 한 번만 받아두면 되는(거의 안 바뀌는)
# 정보라, 무장애 정보와 똑같은 방식으로 캐시합니다. 이 API는 무장애 정보
# (KorWithService2)와 같은 일일 트래픽 한도를 공유하므로, 캐시로 재조회를
# 막는 게 특히 중요합니다.
#
# 원래는 overview(소개문)만 캐시했는데, 관광지 상세 페이지가 이름/주소/좌표/
# 이미지까지 매번 실시간으로 다시 조회하다 보니 API가 막히면 상세 페이지 전체가
# 아예 안 뜨는 문제가 있었습니다. 그래서 detailCommon2 응답 전체를 여기 같이
# 캐시해서, 한 번 성공하면 그 다음부턴 API 호출 없이 항상 뜨도록 합니다.
#
# Supabase 대시보드에서 미리 만들어둬야 하는 테이블(기존 attraction_overview_cache에
# 컬럼을 추가):
#   attraction_overview_cache
#     - content_id (text, Primary Key)
#     - overview (text)
#     - name (text)
#     - address (text)
#     - latitude (double precision)
#     - longitude (double precision)
#     - category (text)
#     - image_url (text)
#     - fetched_at (timestamptz)

_OVERVIEW_TABLE = "attraction_overview_cache"


async def get_cached_overviews(content_ids: list[str]) -> dict[str, str]:
    """캐시된 소개문을 {content_id: overview} 형태로 돌려줍니다."""
    if _client is None or not content_ids:
        return {}
    found: dict[str, str] = {}
    chunk_size = 500
    try:
        for i in range(0, len(content_ids), chunk_size):
            chunk = content_ids[i : i + chunk_size]
            result = (
                _client.table(_OVERVIEW_TABLE).select("*").in_("content_id", chunk).execute()
            )
            for row in result.data or []:
                found[row["content_id"]] = row.get("overview") or ""
    except Exception as e:
        print(f"[supabase] 관광지 소개문 캐시 조회 실패: {e}")
        return {}
    return found


async def get_cached_attraction_basic(content_id: str) -> dict | None:
    """
    상세 페이지용: 캐시된 기본정보(이름/주소/좌표/이미지/카테고리/소개문) 한 건을
    돌려줍니다. name이 비어있으면(예: 소개문만 캐시됐던 예전 행) 캐시 미스로 취급합니다.
    """
    if _client is None or not content_id:
        return None
    try:
        result = (
            _client.table(_OVERVIEW_TABLE)
            .select("*")
            .eq("content_id", content_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows or not rows[0].get("name"):
            return None
        return rows[0]
    except Exception as e:
        print(f"[supabase] 관광지 기본정보 캐시 조회 실패: {e}")
        return None


async def save_attraction_basic(row: dict) -> None:
    """상세 페이지 조회 성공 시, 기본정보 전체를 캐시에 upsert합니다."""
    if _client is None or not row:
        return
    try:
        _client.table(_OVERVIEW_TABLE).upsert(row).execute()
    except Exception as e:
        print(f"[supabase] 관광지 기본정보 캐시 저장 실패: {e}")


async def save_overviews_batch(rows: list[dict]) -> None:
    """새로 조회한 소개문을 캐시 테이블에 upsert합니다."""
    if _client is None or not rows:
        return
    chunk_size = 500
    try:
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            _client.table(_OVERVIEW_TABLE).upsert(chunk).execute()
    except Exception as e:
        print(f"[supabase] 관광지 소개문 캐시 저장 실패: {e}")


# ---- 관광지 카테고리별 부가 정보(이용시간/요금/주차 등) 캐시 ----
#
# detailIntro2(소개정보 조회)는 detailCommon2/detailWithTour2와 같은 일일
# 트래픽 한도를 공유하는 별도 오퍼레이션이라, 이것도 똑같이 캐시합니다.
# 카테고리(contentTypeId)마다 응답 필드가 완전히 달라서, 뽑아낸 화이트리스트
# 필드만 fields(jsonb)에 통째로 저장합니다.
#
# Supabase 대시보드에서 미리 만들어둬야 하는 테이블(backend/sql/create_attraction_intro_cache.sql 참고):
#   attraction_intro_cache
#     - content_id (text, Primary Key)
#     - content_type_id (int4)
#     - fields (jsonb)
#     - fetched_at (timestamptz)

_INTRO_TABLE = "attraction_intro_cache"


async def get_cached_intro_info(content_id: str) -> dict | None:
    """상세 페이지용: 캐시된 카테고리별 부가 정보(한 건)를 돌려줍니다."""
    if _client is None or not content_id:
        return None
    try:
        result = (
            _client.table(_INTRO_TABLE)
            .select("*")
            .eq("content_id", content_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 조회 실패: {e}")
        return None


async def save_intro_info(row: dict) -> None:
    """새로 조회한 부가 정보를 캐시 테이블에 upsert합니다."""
    if _client is None or not row:
        return
    try:
        _client.table(_INTRO_TABLE).upsert(row).execute()
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 저장 실패: {e}")


async def mark_trip_as_visited(trip_id: str, user_id: str) -> int:
    """
    '내 여행' 탭의 '방문 완료' 버튼용. 그 여행(trip) 안의 모든 코스에 담긴
    관광지들을 전부 방문한 여행지로 표시합니다. 같은 장소가 여러 코스에
    중복으로 들어있어도, visited_places의 (user_id, content_id) 유니크
    제약 덕분에 한 번만 기록됩니다.

    반환값: 이번에 방문 처리한(=이 여행에 담긴) 관광지 개수.
    """
    if _client is None:
        return 0
    try:
        trip_row = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return 0

        courses_result = (
            _client.table("courses").select("stops").eq("trip_id", trip_id).eq("user_id", user_id).execute()
        )
        places: dict[str, str] = {}  # content_id -> place_name, 중복 제거용
        for row in courses_result.data or []:
            for stop in row.get("stops") or []:
                attraction = stop.get("attraction") or {}
                content_id = attraction.get("content_id")
                name = attraction.get("name")
                if content_id and name:
                    places[content_id] = name
        if not places:
            return 0

        rows = [
            {"user_id": user_id, "content_id": cid, "place_name": name, "trip_id": trip_id}
            for cid, name in places.items()
        ]
        _client.table("visited_places").upsert(rows, on_conflict="user_id,content_id").execute()
        return len(places)
    except Exception as e:
        print(f"[supabase] 여행 방문 완료 처리 실패: {e}")
        return 0


async def unmark_trip_as_visited(trip_id: str, user_id: str) -> int:
    """
    '방문 완료' 버튼을 다시 눌렀을 때(= 방문 완료 취소)용. mark_trip_as_visited로
    이 여행 기준으로 방문 처리됐던 기록들을 지웁니다 (trip_id로 저장해둔 것만
    지우므로, 같은 장소를 다른 여행에서 또 방문 완료했다면 그 기록은 남습니다).

    반환값: 이번에 취소된(삭제된) 방문 기록 개수.
    """
    if _client is None:
        return 0
    try:
        trip_row = _client.table("trips").select("user_id").eq("id", trip_id).limit(1).execute()
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return 0

        result = (
            _client.table("visited_places")
            .delete()
            .eq("trip_id", trip_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data or [])
    except Exception as e:
        print(f"[supabase] 여행 방문 완료 취소 실패: {e}")
        return 0


async def count_visited_places(user_id: str) -> int:
    """이 사용자가 방문 완료 처리한 여행지(장소 기준 중복 없이) 총 개수."""
    if _client is None:
        return 0
    try:
        result = (
            _client.table("visited_places").select("id", count="exact").eq("user_id", user_id).execute()
        )
        return result.count or 0
    except Exception as e:
        print(f"[supabase] 방문한 여행지 개수 조회 실패: {e}")
        return 0


async def list_visited_places(user_id: str, limit: int = 50) -> list[dict]:
    """'내 여행' 탭의 '방문한 여행지' 통계 카드를 눌렀을 때 쓰는, 이 사용자가
    방문 완료로 표시한 여행지 전체를 최신순으로 반환합니다."""
    if _client is None:
        return []
    try:
        result = (
            _client.table("visited_places")
            .select("*")
            .eq("user_id", user_id)
            .order("visited_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[supabase] 방문한 여행지 목록 조회 실패: {e}")
        return []


async def delete_visited_place(visited_id: str, user_id: str) -> bool:
    """'방문한 여행지' 목록에서 하나를 삭제합니다(방문 취소). 본인 것만 지울 수 있습니다."""
    if _client is None:
        return False
    try:
        result = (
            _client.table("visited_places")
            .delete()
            .eq("id", visited_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data or []) > 0
    except Exception as e:
        print(f"[supabase] 방문한 여행지 삭제 실패: {e}")
        return False


async def update_visited_place_date(visited_id: str, user_id: str, visited_at: str) -> Optional[dict]:
    """'방문한 여행지' 목록에서 방문 날짜를 수정합니다. 본인 것만 수정할 수 있습니다."""
    if _client is None:
        return None
    try:
        result = (
            _client.table("visited_places")
            .update({"visited_at": visited_at})
            .eq("id", visited_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 방문 날짜 수정 실패: {e}")
        return None


async def get_cached_attraction_list(
    ldong_regn_cd: str, content_type_id: int, max_age_hours: float = 24.0
) -> Optional[list[dict]]:
    """
    areaBasedList2(관광지 목록) 캐시를 조회합니다. max_age_hours보다 오래됐거나
    캐시가 아예 없으면 None을 반환해서(=live 재조회 필요), 갱신 로직이 자연스럽게
    이어지게 합니다.
    """
    if _client is None:
        return None
    try:
        result = (
            _client.table("attraction_list_cache")
            .select("*")
            .eq("ldong_regn_cd", ldong_regn_cd)
            .eq("content_type_id", content_type_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        row = rows[0]
        fetched_at = datetime.datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
        age_hours = (datetime.datetime.now(datetime.timezone.utc) - fetched_at).total_seconds() / 3600
        if age_hours > max_age_hours:
            return None
        return row.get("items") or []
    except Exception as e:
        print(f"[supabase] 관광지 목록 캐시 조회 실패: {e}")
        return None


async def save_attraction_list_cache(ldong_regn_cd: str, content_type_id: int, items: list[dict]) -> None:
    """areaBasedList2로 새로 조회한 관광지 목록을 캐시에 upsert합니다."""
    if _client is None:
        return
    try:
        _client.table("attraction_list_cache").upsert(
            {
                "ldong_regn_cd": ldong_regn_cd,
                "content_type_id": content_type_id,
                "items": items,
                "fetched_at": datetime.datetime.utcnow().isoformat(),
            },
            on_conflict="ldong_regn_cd,content_type_id",
        ).execute()
    except Exception as e:
        print(f"[supabase] 관광지 목록 캐시 저장 실패: {e}")
