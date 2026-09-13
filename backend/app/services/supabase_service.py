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
import re
import uuid

from app.config import get_settings
from app.models.schemas import Attraction, CourseResponse, CourseStop
from app.services.db import execute as _execute
from app.services.memory_cache import TTLCache
from app.services.schedule import build_schedule, next_day_of

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)


class CacheUnavailable(RuntimeError):
    """
    캐시 테이블을 '읽지 못했다'는 신호 — '저장된 값이 없다'와 구분하기 위한 것입니다.

    조회 실패와 행 없음을 똑같이 None/빈 결과로 돌려주면, 호출부는 "아직 없구나"로
    오해하고 그 자리에서 다시 계산하거나 전부 다시 조회합니다. 외부 API가 불안정한
    순간에 이 일이 겹치면 멀쩡하던 캐시가 반토막 난 값으로 덮어써지고(실제로 무장애
    여행지 수가 1232에서 539로 떨어졌습니다), 멀쩡할 때도 일일 트래픽 예산을
    통째로 날립니다.

    그래서 이 파일의 캐시 '읽기' 함수는 전부 같은 규약을 씁니다.
      - 값이 없다  -> None / 빈 dict / 빈 set (정상)
      - 못 읽었다  -> CacheUnavailable (예외)

    호출부는 둘을 구분해 처리해야 합니다. 캐시가 '있으면 좋은' 자리(소개문·부가정보
    등)는 예외를 잡아 캐시 미스처럼 넘어가고, 캐시가 '안전망'인 자리(목록 캐시,
    편의시설 캐시, 갱신 전 직전 값)는 넘기지 말고 이번 작업을 멈춰야 합니다.
    """

# 관광지 목록 캐시(attraction_list_cache)는 한 행에 카테고리 하나의 목록이 통째로
# 들어있어 덩치가 큽니다. 홈 화면 한 번 열 때마다 카테고리 5개를 조회하니, 매번
# DB에서 그 큰 JSON들을 다시 받아오지 않도록 몇 분간 메모리에 들고 있습니다.
# (DB 캐시 자체의 유효기간은 아래 기본값 24시간이라, 이 몇 분은 신선도에 사실상
# 영향이 없습니다.)
_ATTRACTION_LIST_DEFAULT_MAX_AGE_HOURS = 24.0
_attraction_list_memcache: TTLCache[list[dict]] = TTLCache(ttl_seconds=300.0)


async def save_course(
    course: CourseResponse, query_text: str, region: str, user_id: Optional[str] = None
) -> None:
    """코스 생성 직후 자동으로 기록합니다 (아직 어느 '여행'에도 속하지 않은 상태, trip_id=None)."""
    if _client is None:
        return
    try:
        await _execute(_client.table("courses").insert(
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
        ))
    except Exception as e:
        # 저장 실패는 로그만 남기고 사용자 응답은 그대로 내려줍니다.
        print(f"[supabase] 코스 저장 실패: {e}")


async def list_saved_courses(user_id: str, limit: int = 50) -> list[dict]:
    """
    '내 여행' 탭의 '저장한 경로' 통계 카드를 눌렀을 때 보여줄, 실제로 여행에
    저장된(trip_id가 있는) 코스 전체를 여행 구분 없이 한 번에 최신순으로
    반환합니다. trip_id가 없는 코스(생성만 하고 저장하지 않은 것)를 함께 세면
    '저장한 경로' 개수(trips의 course_count 합)와 안 맞아서 여기서 걸러냅니다.
    """
    if _client is None or not user_id:
        return []
    try:
        result = await _execute(
            _client.table("courses")
            .select("*")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
            .order("created_at", desc=True)
            .limit(limit)
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
        result = await _execute(
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
        trips_result = await _execute(
            _client.table("trips")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        trips = trips_result.data or []
        if not trips:
            return []

        courses_result = await _execute(
            _client.table("courses")
            .select("trip_id")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
        )
        counts: dict[str, int] = {}
        for row in courses_result.data or []:
            tid = row.get("trip_id")
            if tid:
                counts[tid] = counts.get(tid, 0) + 1

        # 각 여행이 '방문 완료' 처리된 적 있는지(visited_places에 이 trip_id로
        # 저장된 행이 하나라도 있는지)도 같이 계산해서 붙여줍니다.
        visited_result = await _execute(
            _client.table("visited_places")
            .select("trip_id")
            .eq("user_id", user_id)
            .not_.is_("trip_id", "null")
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
        existing = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
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

        await _execute(_client.table("trips").update(update_fields).eq("id", trip_id))
        return True, None
    except Exception as e:
        print(f"[supabase] 여행 수정 실패: {e}")
        return False, "수정 중 오류가 발생했어요."


async def delete_trip(trip_id: str, user_id: str) -> tuple[bool, Optional[str]]:
    """여행과 그 안에 저장된 코스들을 함께 삭제합니다."""
    if _client is None:
        return False, "서버 설정 오류로 삭제할 수 없어요."
    try:
        existing = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 여행을 찾을 수 없거나 접근 권한이 없어요."

        await _execute(_client.table("courses").delete().eq("trip_id", trip_id).eq("user_id", user_id))
        await _execute(_client.table("trips").delete().eq("id", trip_id))
        return True, None
    except Exception as e:
        print(f"[supabase] 여행 삭제 실패: {e}")
        return False, "삭제 중 오류가 발생했어요."


async def attach_course_to_trip(course_id: str, user_id: str, trip_id: str) -> tuple[bool, Optional[str]]:
    """생성된 코스를 특정 여행에 소속시킵니다(저장하기). 본인 소유의 코스/여행인지 확인 후 진행합니다."""
    if _client is None:
        return False, "서버 설정 오류로 저장할 수 없어요."
    try:
        course_row = await _execute(_client.table("courses").select("user_id").eq("id", course_id).limit(1))
        course_rows = course_row.data or []
        if not course_rows or course_rows[0].get("user_id") != user_id:
            return False, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        trip_row = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return False, "해당 여행을 찾을 수 없거나 접근 권한이 없어요."

        await _execute(_client.table("courses").update({"trip_id": trip_id}).eq("id", course_id))
        return True, None
    except Exception as e:
        print(f"[supabase] 코스-여행 연결 실패: {e}")
        return False, "저장 중 오류가 발생했어요."


async def delete_course(course_id: str, user_id: str) -> tuple[bool, Optional[str]]:
    """저장된 코스 하나를 여행에서 삭제합니다 (여행 자체는 유지)."""
    if _client is None:
        return False, "서버 설정 오류로 삭제할 수 없어요."
    try:
        existing = await _execute(_client.table("courses").select("user_id").eq("id", course_id).limit(1))
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return False, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        await _execute(_client.table("courses").delete().eq("id", course_id))
        return True, None
    except Exception as e:
        print(f"[supabase] 코스 삭제 실패: {e}")
        return False, "삭제 중 오류가 발생했어요."


def _rebuild_arrival_times(stops: list[dict]) -> None:
    """
    새 순서에 맞춰 방문 시각과 시간 안내를 다시 계산합니다 (stops를 직접 고칩니다).

    저장된 stop에는 관광지 정보가 통째로(좌표·카테고리·부가정보까지) 들어 있어서,
    코스를 처음 만들 때와 같은 계산을 그대로 다시 할 수 있습니다. 옛날에 저장돼
    형식이 다른 행을 만나면 시각을 건드리지 않고 그냥 둡니다 — 순서 저장이
    통째로 실패하는 것보다 낫습니다.
    """
    try:
        attractions = [Attraction(**stop["attraction"]) for stop in stops]
    except Exception as e:
        print(f"[supabase] 저장된 코스에서 관광지 정보를 읽지 못해 시각은 그대로 둡니다: {e}")
        return

    for stop, scheduled in zip(stops, build_schedule(attractions)):
        stop["recommended_arrival_time"] = scheduled.arrival_time
        stop["time_note"] = scheduled.time_note
        # closed_note(방문일 휴무 경고)는 순서와 무관한 정보라 그대로 둡니다.
        # 다만 '그날 갈 수 있는지'는 시각이 바뀌면 함께 바뀌므로, 순서 기준으로
        # 다시 판단하되 이미 붙어 있던 휴무 경고는 그대로 반영합니다.
        stop["fits_today"] = scheduled.fits_today and not stop.get("closed_note")


async def update_course(
    course_id: str,
    user_id: str,
    title: Optional[str] = None,
    stop_order: Optional[list[str]] = None,
) -> tuple[Optional[dict], Optional[str]]:
    """
    저장된 코스의 제목을 바꾸거나(title), 관광지 순서를 바꿉니다(stop_order —
    새 순서대로 나열한 content_id 목록). stop_order를 줄 땐 기존 stops에 있는
    항목들과 정확히 같은 집합이어야 합니다(추가/제외 불가).

    순서를 바꾸면 방문 시각도 새 순서 기준으로 다시 계산합니다. 예전에는 시각이
    장소에 붙어 그대로 따라다녀서, 순서만 바꾸면 1번이 13:00, 2번이 09:00처럼
    거꾸로 뒤집히는 일이 있었습니다. 반면 방문일 휴무 경고(closed_note)는 '어느
    날 가는지'에 달린 정보라 순서와 무관하므로 그대로 둡니다.
    """
    if _client is None:
        return None, "서버 설정 오류로 수정할 수 없어요."
    try:
        existing = await _execute(_client.table("courses").select("*").eq("id", course_id).limit(1))
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
            _rebuild_arrival_times(new_stops)
            update_payload["stops"] = new_stops

        if not update_payload:
            return row, None

        result = await _execute(_client.table("courses").update(update_payload).eq("id", course_id))
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


# "수원 나들이 (2일차)"처럼 제목 끝에 붙는 일차 표기.
_DAY_SUFFIX_PATTERN = re.compile(r"\s*\((\d+)일차\)\s*$")


def _next_day_title(title: str) -> str:
    """
    다음 날 코스의 제목. 이미 '(2일차)'가 붙어 있으면 숫자를 올립니다 —
    한 코스를 두 번 나눠도 '(2일차) (2일차)'가 되지 않게 하기 위함입니다.
    """
    match = _DAY_SUFFIX_PATTERN.search(title)
    if match:
        return _DAY_SUFFIX_PATTERN.sub(f" ({int(match.group(1)) + 1}일차)", title)
    return f"{title} (2일차)"


def _reschedule_stops(stops: list[dict], visit_date: Optional[str]) -> list[dict]:
    """
    떼어낸 stops를 1번부터 다시 번호 매기고, 그 날짜 기준으로 시각을 다시 계산합니다.

    날짜가 바뀌면 휴무일 판단도 달라지므로(월요일 휴관이던 곳이 화요일엔 정상),
    closed_note까지 새로 계산합니다 — 순서만 바꾸는 _rebuild_arrival_times와
    다른 점입니다.
    """
    renumbered = []
    for index, stop in enumerate(stops, start=1):
        copied = dict(stop)
        copied["order"] = index
        renumbered.append(copied)

    try:
        attractions = [Attraction(**stop["attraction"]) for stop in renumbered]
    except Exception as e:
        print(f"[supabase] 코스를 나누는 중 관광지 정보를 읽지 못해 시각은 그대로 둡니다: {e}")
        return renumbered

    for stop, scheduled in zip(renumbered, build_schedule(attractions, visit_date)):
        stop["recommended_arrival_time"] = scheduled.arrival_time
        stop["time_note"] = scheduled.time_note
        stop["closed_note"] = scheduled.closed_note
        stop["fits_today"] = scheduled.fits_today
    return renumbered


async def split_course(
    course_id: str, user_id: str, from_order: int, visit_date: Optional[str] = None
) -> tuple[Optional[dict], Optional[dict], Optional[str]]:
    """
    코스를 'from_order 앞'과 'from_order부터 끝까지' 둘로 나눕니다.

    뒤쪽은 같은 여행에 속하는 새 코스로 저장하고, 하루 뒤 날짜로 시각과 휴무일을
    다시 계산합니다 — 문 닫은 뒤 도착하거나 그날 쉬는 곳을 다음 날로 넘기기 위한
    기능이라, 날짜가 바뀌면 판단도 다시 해야 하기 때문입니다.

    반환: (그날 코스 행, 다음 날 코스 행, 오류 메시지)
    """
    if _client is None:
        return None, None, "서버 설정 오류로 코스를 나눌 수 없어요."
    try:
        existing = await _execute(_client.table("courses").select("*").eq("id", course_id).limit(1))
        rows = existing.data or []
        if not rows or rows[0].get("user_id") != user_id:
            return None, None, "해당 코스를 찾을 수 없거나 접근 권한이 없어요."

        row = rows[0]
        stops = row.get("stops") or []
        if len(stops) < 2:
            return None, None, "장소가 하나뿐이라 나눌 수 없어요."
        if not 2 <= from_order <= len(stops):
            return None, None, "첫 장소부터는 나눌 수 없어요. 순서를 바꾸거나 장소를 줄여보세요."

        today_stops = _reschedule_stops(stops[: from_order - 1], visit_date)
        next_visit_date = next_day_of(visit_date)
        next_day_stops = _reschedule_stops(stops[from_order - 1 :], next_visit_date)

        next_day_row = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "user_type": row.get("user_type"),
            "query_text": row.get("query_text"),
            "region": row.get("region"),
            "title": _next_day_title(row.get("title") or "여행 코스"),
            "summary": f"하루에 다 돌기 어려워 다음 날로 옮긴 {len(next_day_stops)}곳입니다.",
            "stops": next_day_stops,
            # 원본이 이미 여행에 저장돼 있으면 같은 여행에 함께 들어갑니다.
            "trip_id": row.get("trip_id"),
        }

        await _execute(_client.table("courses").update({"stops": today_stops}).eq("id", course_id))
        inserted = await _execute(_client.table("courses").insert(next_day_row))
        inserted_rows = inserted.data or []
        if not inserted_rows:
            return None, None, "다음 날 코스를 만들지 못했어요."

        today_row = dict(row)
        today_row["stops"] = today_stops
        return today_row, inserted_rows[0], None
    except Exception as e:
        print(f"[supabase] 코스 나누기 실패: {e}")
        return None, None, "코스를 나누는 중 오류가 발생했어요."


async def list_trip_courses(trip_id: str, user_id: str) -> list[dict]:
    """특정 여행에 저장된 코스들을 최신순으로 반환합니다."""
    if _client is None:
        return []
    try:
        trip_row = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return []

        result = await _execute(
            _client.table("courses")
            .select("*")
            .eq("trip_id", trip_id)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
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
        result = await _execute(
            _client.table("courses")
            .select("*")
            .eq("id", course_id)
            .eq("user_id", user_id)
            .limit(1)
        )
        rows = result.data or []
        if not rows:
            return None
        row = rows[0]

        trip_id = row.get("trip_id")
        if trip_id:
            trip_result = await _execute(_client.table("trips").select("*").eq("id", trip_id).limit(1))
            trip_rows = trip_result.data or []
            row["_trip"] = trip_rows[0] if trip_rows else None
        else:
            row["_trip"] = None
        return row
    except Exception as e:
        print(f"[supabase] 저장된 코스 상세 조회 실패: {e}")
        return None


# accessibility_stats에서 '개수'만 읽을 때 쓰는 컬럼 목록.
#
# 이 테이블의 top_*_places 6개 컬럼에는 카테고리마다 최대 200곳씩(이름·주소·
# 이미지·편의시설 목록까지) 들어 있어서 한 행이 240KB를 넘습니다. 숫자만
# 필요한 곳(홈 화면 통계, 퇴보 방지 판단)에서 select("*")로 통째로 읽으면
# 그 240KB를 매번 Supabase에서 내려받게 됩니다.
_ACCESSIBILITY_COUNT_COLUMNS = (
    "region,wheelchair_count,senior_count,total_accessible_count,visual_count,"
    "hearing_count,family_count,pregnant_count,total_candidates"
)


async def get_cached_accessibility_stats(region: str, columns: str = "*") -> Optional[dict]:
    """
    '접근성' 탭/홈 화면 통계용으로 미리 계산해둔 고정 값을 조회합니다.
    아직 한 번도 계산해서 저장한 적이 없으면(캐시 없음) None을 반환하고,
    조회 자체가 실패하면 CacheUnavailable을 올립니다 — 호출부가 이 둘을
    구분해야 "읽지 못한 김에 재계산해서 덮어쓰는" 사고를 막을 수 있습니다.

    columns로 필요한 컬럼만 골라 읽을 수 있습니다 — 기본값 "*"는 top_*_places
    6개(총 240KB 남짓)까지 전부 가져오므로, 숫자만 필요하면
    _ACCESSIBILITY_COUNT_COLUMNS를, 특정 카테고리 목록만 필요하면 그 컬럼명을
    넘기세요.
    """
    if _client is None:
        return None
    try:
        result = await _execute(
            _client.table("accessibility_stats")
            .select(columns)
            .eq("region", region)
            .limit(1)
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        # 여기서 None을 돌려주면 호출부가 '캐시 없음'으로 보고 재계산 후 저장까지
        # 해버립니다. 읽지 못한 것과 없는 것은 다르므로 구분해서 알립니다.
        print(f"[supabase] 접근성 통계 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e


# accessibility_stats 테이블에 아직 없을 수도 있는 컬럼들.
#
# Supabase 쪽은 스키마에 없는 컬럼이 payload에 하나라도 섞이면 그 요청 '전체'를
# 거부합니다. 그래서 새 진단 컬럼 하나 때문에 통계 저장이 통째로 실패하는 일이
# 생깁니다. 아래 컬럼들은 있으면 저장하고, 없으면 빼고 다시 시도합니다 —
# add_accessibility_stats_total_candidates.sql을 아직 안 돌린 환경에서도
# 기존 숫자는 정상적으로 저장되도록 하기 위함입니다.
_ACCESSIBILITY_STATS_OPTIONAL_COLUMNS = ("total_candidates",)


async def save_accessibility_stats(region: str, data: dict) -> None:
    """
    새로 계산한 접근성 통계를 저장(있으면 갱신, 없으면 생성)합니다.
    이후 조회는 이 저장된 값을 그대로 읽기만 해서, 다시 계산하기 전까지는 항상
    같은(고정된) 숫자가 나옵니다.
    """
    if _client is None:
        return

    async def _write(payload: dict) -> None:
        existing = await _execute(
            _client.table("accessibility_stats").select("id").eq("region", region).limit(1)
        )
        if existing.data or []:
            await _execute(_client.table("accessibility_stats").update(payload).eq("region", region))
        else:
            await _execute(_client.table("accessibility_stats").insert(payload))

    payload = {**data, "region": region}
    try:
        await _write(payload)
        return
    except Exception as e:
        fallback = {k: v for k, v in payload.items() if k not in _ACCESSIBILITY_STATS_OPTIONAL_COLUMNS}
        if fallback == payload:
            print(f"[supabase] 접근성 통계 캐시 저장 실패: {e}")
            return
        dropped = sorted(set(payload) - set(fallback))
        print(
            f"[supabase] 접근성 통계 저장이 실패해서 선택 컬럼({', '.join(dropped)}) 없이 다시 "
            f"시도합니다 — 해당 컬럼을 쓰려면 backend/sql/"
            f"add_accessibility_stats_total_candidates.sql을 실행하세요: {e}"
        )

    try:
        await _write(fallback)
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
            result = await _execute(
                _client.table(_PLACE_ACCESSIBILITY_TABLE)
                .select("*")
                .in_("content_id", chunk)
            )
            for row in result.data or []:
                found[row["content_id"]] = row
    except Exception as e:
        print(f"[supabase] 장소별 무장애 정보 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return found


async def get_all_cached_place_accessibility_ids() -> set[str]:
    """
    편의시설 캐시에 들어 있는 content_id를 전부 돌려줍니다.

    관광지 '목록' API가 잘려서 후보에서 빠진 곳도, 한 번 조회해둔 편의시설 정보는
    이 캐시에 그대로 남아 있습니다. 그 id를 후보로 되살리면 목록 API가 복구되기
    전에도 무장애 여행지 수가 원래대로 돌아옵니다 (DB 읽기라 TourAPI 호출/일일
    예산을 전혀 쓰지 않습니다).

    한 번에 돌려주는 행 수에 상한이 있어 페이지를 넘겨가며 전부 읽습니다.
    조회 실패는 CacheUnavailable로 알립니다 — 빈 집합을 돌려주면 "되살릴 게
    없다"와 구분되지 않아, 실패한 날에 조용히 숫자가 떨어집니다.
    """
    if _client is None:
        return set()
    ids: set[str] = set()
    page_size = 1000
    offset = 0
    try:
        while True:
            result = await _execute(
                _client.table(_PLACE_ACCESSIBILITY_TABLE)
                .select("content_id")
                .range(offset, offset + page_size - 1)
            )
            rows = result.data or []
            ids.update(row["content_id"] for row in rows if row.get("content_id"))
            if len(rows) < page_size:
                break
            offset += page_size
    except Exception as e:
        print(f"[supabase] 장소별 무장애 정보 캐시 id 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return ids


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
            await _execute(_client.table(_PLACE_ACCESSIBILITY_TABLE).upsert(chunk))
    except Exception as e:
        print(f"[supabase] 장소별 무장애 정보 캐시 저장 실패: {e}")


# ---- content_id를 키로 쓰는 캐시 공통 처리 ----
#
# 이 파일에는 content_id가 기본 키인 캐시 테이블이 여럿 있습니다(편의시설,
# 소개문, 부가정보, 연관 관광지, 혼잡도 예보). 조회/저장 모양이 똑같아서,
# 새로 추가하는 것부터는 아래 두 함수를 씁니다. 기존 것들도 나중에 옮기면
# 좋지만, 잘 도는 코드를 한꺼번에 건드리지 않으려고 그대로 뒀습니다.

_CONTENT_ID_CHUNK = 500


async def _get_rows_by_content_ids(table: str, content_ids: list[str], what: str) -> dict[str, dict]:
    """캐시에 있는 것만 {content_id: row}로 돌려줍니다. 못 읽으면 CacheUnavailable."""
    if _client is None or not content_ids:
        return {}
    found: dict[str, dict] = {}
    try:
        for i in range(0, len(content_ids), _CONTENT_ID_CHUNK):
            chunk = content_ids[i : i + _CONTENT_ID_CHUNK]
            result = await _execute(_client.table(table).select("*").in_("content_id", chunk))
            for row in result.data or []:
                found[row["content_id"]] = row
    except Exception as e:
        print(f"[supabase] {what} 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return found


async def _upsert_rows(table: str, rows: list[dict], what: str) -> None:
    """content_id를 기본 키로 upsert합니다. 저장 실패는 로그만 남깁니다."""
    if _client is None or not rows:
        return
    try:
        for i in range(0, len(rows), _CONTENT_ID_CHUNK):
            await _execute(_client.table(table).upsert(rows[i : i + _CONTENT_ID_CHUNK]))
    except Exception as e:
        print(f"[supabase] {what} 캐시 저장 실패: {e}")


# ---- 연관 관광지 캐시 (상세 페이지 '함께 가볼 만한 곳') ----
#
# Supabase 대시보드에서 미리 만들어둬야 하는 테이블:
#   attraction_related_cache (content_id PK, items jsonb, fetched_at)
#   -> backend/sql/create_related_and_forecast_cache.sql

_RELATED_TABLE = "attraction_related_cache"


async def get_cached_related(content_ids: list[str]) -> dict[str, dict]:
    return await _get_rows_by_content_ids(_RELATED_TABLE, content_ids, "연관 관광지")


async def save_related_batch(rows: list[dict]) -> None:
    await _upsert_rows(_RELATED_TABLE, rows, "연관 관광지")


# ---- 혼잡도 예보 캐시 (상세 페이지 날짜별 혼잡도) ----
#
#   attraction_forecast_cache (content_id PK, forecast jsonb, fetched_at)

_FORECAST_TABLE = "attraction_forecast_cache"


async def get_cached_forecast(content_ids: list[str]) -> dict[str, dict]:
    return await _get_rows_by_content_ids(_FORECAST_TABLE, content_ids, "혼잡도 예보")


async def save_forecast_batch(rows: list[dict]) -> None:
    await _upsert_rows(_FORECAST_TABLE, rows, "혼잡도 예보")


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
        result = await _execute(
            _client.table(_CONGESTION_TABLE)
            .select("*")
            .in_("signgu_cd", signgu_cds)
        )
        for row in result.data or []:
            found[(row["signgu_cd"], row["tats_nm"])] = row
    except Exception as e:
        print(f"[supabase] 집중률 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return found


async def get_cached_congestion_signgu_cds() -> set[int]:
    """캐시에 이미 채워져 있는 시군구코드 집합을 돌려줍니다 (전수조사 진행 상황 판단용)."""
    if _client is None:
        return set()
    try:
        result = await _execute(_client.table(_CONGESTION_TABLE).select("signgu_cd"))
        return {row["signgu_cd"] for row in (result.data or [])}
    except Exception as e:
        print(f"[supabase] 집중률 캐시 시군구 목록 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e


async def save_congestion_rates_batch(rows: list[dict]) -> None:
    """새로 조회한 집중률 데이터를 캐시 테이블에 upsert합니다."""
    if _client is None or not rows:
        return
    chunk_size = 500
    try:
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            await _execute(_client.table(_CONGESTION_TABLE).upsert(chunk))
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
            result = await _execute(_client.table(_OVERVIEW_TABLE).select("*").in_("content_id", chunk))
            for row in result.data or []:
                found[row["content_id"]] = row.get("overview") or ""
    except Exception as e:
        print(f"[supabase] 관광지 소개문 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return found


async def get_cached_attraction_basic(content_id: str) -> dict | None:
    """
    상세 페이지용: 캐시된 기본정보(이름/주소/좌표/이미지/카테고리/소개문) 한 건을
    돌려줍니다. name이 비어있으면(예: 소개문만 캐시됐던 예전 행) 캐시 미스로 취급합니다.
    """
    if _client is None or not content_id:
        return None
    try:
        result = await _execute(
            _client.table(_OVERVIEW_TABLE)
            .select("*")
            .eq("content_id", content_id)
            .limit(1)
        )
        rows = result.data or []
        if not rows or not rows[0].get("name"):
            return None
        return rows[0]
    except Exception as e:
        print(f"[supabase] 관광지 기본정보 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e


async def save_attraction_basic(row: dict) -> None:
    """상세 페이지 조회 성공 시, 기본정보 전체를 캐시에 upsert합니다."""
    if _client is None or not row:
        return
    try:
        await _execute(_client.table(_OVERVIEW_TABLE).upsert(row))
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
            await _execute(_client.table(_OVERVIEW_TABLE).upsert(chunk))
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
        result = await _execute(
            _client.table(_INTRO_TABLE)
            .select("*")
            .eq("content_id", content_id)
            .limit(1)
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e


async def save_intro_info(row: dict) -> None:
    """새로 조회한 부가 정보를 캐시 테이블에 upsert합니다."""
    if _client is None or not row:
        return
    try:
        await _execute(_client.table(_INTRO_TABLE).upsert(row))
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 저장 실패: {e}")


async def get_cached_intro_info_batch(content_ids: list[str]) -> dict[str, dict]:
    """홈 화면 카드용: 캐시된 카테고리별 부가 정보를 {content_id: row} 형태로 여러 건 한 번에 돌려줍니다."""
    if _client is None or not content_ids:
        return {}
    found: dict[str, dict] = {}
    chunk_size = 500
    try:
        for i in range(0, len(content_ids), chunk_size):
            chunk = content_ids[i : i + chunk_size]
            result = await _execute(_client.table(_INTRO_TABLE).select("*").in_("content_id", chunk))
            for row in result.data or []:
                found[row["content_id"]] = row
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 일괄 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e
    return found


async def save_intro_info_batch(rows: list[dict]) -> None:
    """새로 조회한 부가 정보 여러 건을 캐시 테이블에 upsert합니다."""
    if _client is None or not rows:
        return
    chunk_size = 500
    try:
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            await _execute(_client.table(_INTRO_TABLE).upsert(chunk))
    except Exception as e:
        print(f"[supabase] 관광지 부가정보 캐시 일괄 저장 실패: {e}")


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
        trip_row = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return 0

        courses_result = await _execute(_client.table("courses").select("stops").eq("trip_id", trip_id).eq("user_id", user_id))
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
        await _execute(_client.table("visited_places").upsert(rows, on_conflict="user_id,content_id"))
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
        trip_row = await _execute(_client.table("trips").select("user_id").eq("id", trip_id).limit(1))
        trip_rows = trip_row.data or []
        if not trip_rows or trip_rows[0].get("user_id") != user_id:
            return 0

        result = await _execute(
            _client.table("visited_places")
            .delete()
            .eq("trip_id", trip_id)
            .eq("user_id", user_id)
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
        result = await _execute(_client.table("visited_places").select("id", count="exact").eq("user_id", user_id))
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
        result = await _execute(
            _client.table("visited_places")
            .select("*")
            .eq("user_id", user_id)
            .order("visited_at", desc=True)
            .limit(limit)
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
        result = await _execute(
            _client.table("visited_places")
            .delete()
            .eq("id", visited_id)
            .eq("user_id", user_id)
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
        result = await _execute(
            _client.table("visited_places")
            .update({"visited_at": visited_at})
            .eq("id", visited_id)
            .eq("user_id", user_id)
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[supabase] 방문 날짜 수정 실패: {e}")
        return None


async def get_cached_attraction_list(
    ldong_regn_cd: str,
    content_type_id: int,
    max_age_hours: float = _ATTRACTION_LIST_DEFAULT_MAX_AGE_HOURS,
) -> Optional[list[dict]]:
    """
    areaBasedList2(관광지 목록) 캐시를 조회합니다. max_age_hours보다 오래됐거나
    캐시가 아예 없으면 None을 반환해서(=live 재조회 필요), 갱신 로직이 자연스럽게
    이어지게 합니다.

    이 캐시 행 하나에는 그 카테고리의 관광지 목록이 통째로(수백~수천 건) 들어
    있는데, 홈 화면은 그중 앞의 몇 개만 씁니다. 요청이 올 때마다 이 큰 JSON을
    Supabase에서 다시 내려받아 파싱하는 게 부담이라, 몇 분 동안은 프로세스
    메모리에 들고 있다가 그대로 재사용합니다 (DB 캐시 자체의 유효기간
    max_age_hours보다 훨씬 짧아서, 신선도에는 사실상 영향이 없습니다).
    """
    if _client is None:
        return None

    memo_key = (ldong_regn_cd, content_type_id, max_age_hours)
    memoized = _attraction_list_memcache.get(memo_key)
    if memoized is not None:
        return memoized

    try:
        result = await _execute(
            _client.table("attraction_list_cache")
            .select("*")
            .eq("ldong_regn_cd", ldong_regn_cd)
            .eq("content_type_id", content_type_id)
            .limit(1)
        )
        rows = result.data or []
        if not rows:
            return None
        row = rows[0]
        fetched_at = datetime.datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
        age_hours = (datetime.datetime.now(datetime.timezone.utc) - fetched_at).total_seconds() / 3600
        if age_hours > max_age_hours:
            return None
        items = row.get("items") or []
        _attraction_list_memcache.set(memo_key, items)
        return items
    except Exception as e:
        print(f"[supabase] 관광지 목록 캐시 조회 실패: {e}")
        raise CacheUnavailable(str(e)) from e


async def save_attraction_list_cache(ldong_regn_cd: str, content_type_id: int, items: list[dict]) -> None:
    """areaBasedList2로 새로 조회한 관광지 목록을 캐시에 upsert합니다."""
    if _client is None:
        return
    # 방금 받아온 목록이니 곧바로 메모리 캐시에도 올려둡니다 — 뒤이어 들어오는
    # 요청들이 같은 목록을 DB에서 다시 받아오지 않게 하기 위함입니다.
    _attraction_list_memcache.set(
        (ldong_regn_cd, content_type_id, _ATTRACTION_LIST_DEFAULT_MAX_AGE_HOURS), items
    )
    try:
        await _execute(_client.table("attraction_list_cache").upsert(
            {
                "ldong_regn_cd": ldong_regn_cd,
                "content_type_id": content_type_id,
                "items": items,
                "fetched_at": datetime.datetime.utcnow().isoformat(),
            },
            on_conflict="ldong_regn_cd,content_type_id",
        ))
    except Exception as e:
        print(f"[supabase] 관광지 목록 캐시 저장 실패: {e}")
