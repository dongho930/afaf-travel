import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import (
    Attraction,
    CourseRequest,
    CourseResponse,
    CourseStop,
    GenerateFromSelectionRequest,
    ParsedQuery,
    PlaceRecommendationRequest,
    PlaceRecommendationResponse,
    SaveCourseRequest,
    SavedCourseDetail,
    SavedCourseSummary,
    TripCreateRequest,
    TripSummary,
    TripUpdateRequest,
    UpdateCourseRequest,
    UpdateVisitedDateRequest,
    UserType,
    VisitedPlace,
)
from app.services.ai_service import (
    generate_course,
    generate_course_from_selection,
    parse_query,
    recommend_places,
)
from app.services.auth import get_optional_user_id
from app.services.supabase_service import (
    attach_course_to_trip,
    count_visited_places,
    create_trip,
    delete_course,
    delete_trip,
    delete_visited_place,
    get_saved_course_detail,
    list_saved_courses,
    list_trip_courses,
    list_trips,
    list_visited_places,
    mark_trip_as_visited,
    row_to_course_response,
    save_course,
    unmark_trip_as_visited,
    update_course,
    update_trip,
    update_visited_place_date,
)
from app.services.tour_api import tour_api_client

router = APIRouter(tags=["courses"])
logger = logging.getLogger(__name__)

courses_router = APIRouter(prefix="/api/courses", tags=["courses"])
trips_router = APIRouter(prefix="/api/trips", tags=["trips"])

# 1·2단계가 후보를 받아올 때 쓰는 개수. 두 단계가 같은 값을 써야 2단계에서
# "1단계에서 고른 장소가 후보에 없다"는 상황이 덜 생깁니다.
_CANDIDATE_LIMIT = 25


async def _candidates_with_conditions(
    query_text: str, user_type: str, region: str, sigungu_cd: Optional[int]
) -> tuple[list[Attraction], ParsedQuery]:
    """
    질의에서 조건을 뽑아낸 뒤, 그 조건(특히 지역)으로 좁힌 무장애 관광지 후보를 돌려줍니다.

    1단계(추천)와 2단계(코스 생성)가 똑같은 방식으로 후보를 만들어야, 사용자가
    1단계에서 고른 장소를 2단계가 그대로 찾을 수 있습니다. 그래서 두 단계가 이
    함수 하나를 공유합니다 (parse_query는 같은 질의를 10분간 캐시하므로, 2단계에서
    AI를 다시 부르지 않습니다).

    질의에서 읽어낸 지역으로 좁혔는데 후보가 하나도 없으면 지역 제한을 풀고 다시
    찾습니다 — 사용자가 직접 고른 지역이 아니라 문장에서 넘겨짚은 지역이라,
    잘못 읽었을 때 빈 화면을 주는 것보다 넓게 찾아주는 편이 낫습니다.
    """
    parsed = await parse_query(query_text, sigungu_cd, region)

    candidates = await tour_api_client.search_accessible_attractions(
        region=region,
        user_type=user_type,
        limit=_CANDIDATE_LIMIT,
        sigungu_cd=parsed.sigungu_cds or None,
    )

    if not candidates and parsed.region_source == "query_text":
        logger.info(
            "질의에서 읽어낸 지역(%s)으로는 후보가 없어 지역 제한 없이 다시 찾습니다: %r",
            parsed.region_text,
            query_text,
        )
        candidates = await tour_api_client.search_accessible_attractions(
            region=region, user_type=user_type, limit=_CANDIDATE_LIMIT, sigungu_cd=None
        )
        # 캐시에 들어있는 원본을 그대로 고치면 다른 단계까지 오염되므로 복사본을 만듭니다.
        parsed = parsed.model_copy(
            update={"sigungu_cds": [], "region_source": "none", "region_text": None}
        )

    return candidates, parsed


@courses_router.post("/recommend", response_model=PlaceRecommendationResponse)
async def recommend_course_places(request: PlaceRecommendationRequest):
    """
    1단계: 사용자의 자연어 질의에 맞는 장소 후보를 넓게 추천합니다.
    아직 코스(순서/시간)를 확정하지 않고, 사용자가 이 중에서 직접 고를 수 있게 목록만 보여줍니다.

    질의는 그대로 AI에게 넘기기만 하는 게 아니라, 먼저 지역·동행자·목적을 뽑아
    (parse_query) 지역은 후보 검색 범위로, 동행자·목적은 추천 조건으로 씁니다.
    무엇으로 이해했는지는 응답의 parsed에 담아 앱이 보여줄 수 있게 합니다.
    """
    candidates, parsed = await _candidates_with_conditions(
        request.query_text, request.user_type.value, request.region, request.sigungu_cd
    )
    try:
        selected = await recommend_places(request, candidates, parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return PlaceRecommendationResponse(
        query_text=request.query_text, candidates=selected, parsed=parsed
    )


@courses_router.post("/generate-from-selection", response_model=CourseResponse)
async def create_course_from_selection(
    request: GenerateFromSelectionRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    2단계: 1단계 추천 목록에서 사용자가 직접 고른 장소들로 최종 코스(순서/시간대)를 생성합니다.
    로그인한 사용자면 자동으로 기록되지만, 결과 화면에서 여행에 저장해야
    마이페이지 목록에 나타납니다.

    코스를 짜기 전에 두 가지를 채웁니다.
    - 질의에서 뽑아낸 조건(지역/동행자/목적) — 1단계와 같은 해석을 씁니다.
    - 고른 장소들의 날짜별 혼잡도 예보 — 붐비는 곳을 한산한 시간대로 옮기려면
      실제 혼잡도 값이 있어야 합니다.
    """
    candidates, parsed = await _candidates_with_conditions(
        request.query_text, request.user_type.value, request.region, request.sigungu_cd
    )
    by_id = {a.content_id: a for a in candidates}

    selected_attractions: list[Attraction] = []
    for content_id in request.selected_content_ids:
        found = by_id.get(content_id)
        if found is not None:
            selected_attractions.append(found)
            continue
        # 후보 목록에 없으면 단건으로 직접 불러옵니다. 1단계와 2단계 사이에 후보
        # 구성이 조금만 달라져도(평점 변동에 따른 정렬 변화 등) 방금 고른 장소가
        # 통째로 빠지면서 "다시 불러오지 못했습니다"가 뜨던 문제를 막습니다.
        detail = await tour_api_client.get_attraction_detail(content_id)
        if detail is None:
            logger.warning("선택한 관광지를 불러오지 못했습니다 (content_id=%s)", content_id)
            continue
        selected_attractions.append(detail)

    if not selected_attractions:
        raise HTTPException(status_code=422, detail="선택하신 관광지 정보를 다시 불러오지 못했습니다. 다시 시도해주세요.")

    await tour_api_client.fill_congestion_forecasts(selected_attractions)

    try:
        course = await generate_course_from_selection(request, selected_attractions, parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    return course


@courses_router.post("/generate", response_model=CourseResponse, deprecated=True)
async def create_course(
    request: CourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    (레거시) 질의 하나로 후보 선택 없이 바로 코스를 생성합니다.
    새 플로우는 /recommend → /generate-from-selection 두 단계를 씁니다.

    앱은 2026-08-22부터 이 경로를 쓰지 않습니다. 그래도 남겨두는 이유는, 그 전에
    설치된 네이티브 빌드가 아직 이 경로를 부를 수 있어서입니다(웹은 항상 최신이
    배포되지만 EAS/dev client 빌드는 사용자 기기에 남습니다). Render 로그는 7일치만
    보관해서 "아무도 안 쓴다"를 확인할 수가 없었습니다 — 그래서 아래 한 줄을 남깁니다.
    한 달쯤 뒤 이 로그가 한 번도 안 찍혔으면 그때 안심하고 지우면 됩니다.
    """
    print(f"[legacy] POST /api/courses/generate 호출됨 (user_id={user_id})")
    candidates, parsed = await _candidates_with_conditions(
        request.query_text, request.user_type.value, request.region, None
    )
    await tour_api_client.fill_congestion_forecasts(candidates[: request.max_stops])
    try:
        course = await generate_course(request, candidates, parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    return course


@courses_router.post("/from-attraction/{content_id}", response_model=CourseResponse)
async def create_course_from_attraction(
    content_id: str,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    관광지 상세 페이지의 '저장' 버튼용. 이 관광지 하나만 담은 1개짜리 코스를
    만들어서 course_id를 발급합니다. 이후 흐름은 AI플래너 결과 화면의 저장과
    완전히 동일합니다 — 이 course_id로 /api/courses/{course_id}/save를 불러서
    기존 여행에 붙이거나 새 여행을 만들면 됩니다.
    """
    attraction = await tour_api_client.get_attraction_detail(content_id)
    if attraction is None:
        raise HTTPException(status_code=404, detail="관광지를 찾을 수 없어요.")

    course = CourseResponse(
        course_id=str(uuid.uuid4()),
        title=attraction.name,
        summary=f"{attraction.name}을(를) 직접 저장한 코스입니다.",
        stops=[
            CourseStop(
                order=1,
                attraction=attraction,
                recommended_arrival_time="09:00",
                reason="직접 저장한 장소",
            )
        ],
        generated_for=UserType.GENERAL,
    )
    # 지역 정보는 주소 앞부분(예: '경기도 수원시')을 그대로 씁니다 — 저장 시
    # 새 여행을 만들 때 필수는 아니지만, 코스 이력에 표시되면 도움이 됩니다.
    region = " ".join(attraction.address.split(" ")[:2]) if attraction.address else ""
    await save_course(course, query_text=attraction.name, region=region, user_id=user_id)
    return course


@courses_router.get("/saved", response_model=list[SavedCourseSummary])
async def list_saved_courses_endpoint(
    limit: int = 50,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    '내 여행' 탭의 '저장한 경로' 통계 카드를 눌렀을 때 쓰는 목록입니다.
    실제로 여행에 저장된 코스만(여행 구분 없이 전부) 최신순으로 반환합니다.
    """
    if not user_id:
        return []
    rows = await list_saved_courses(user_id, limit=limit)
    return [
        SavedCourseSummary(
            course_id=row["id"],
            title=row["title"],
            summary=row["summary"],
            region=row.get("region") or "",
            stop_count=len(row.get("stops") or []),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@courses_router.post("/{course_id}/save")
async def save_course_endpoint(
    course_id: str,
    request: SaveCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    결과 화면에서 '저장하기'를 눌렀을 때 호출합니다.
    - trip_id를 주면 기존 여행에 이 코스를 추가합니다.
    - new_trip_name(+category)을 주면 새 여행을 만들면서 그 여행에 이 코스를 추가합니다.
    로그인이 필요합니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="저장하려면 로그인이 필요해요.")

    trip_id = request.trip_id
    if not trip_id:
        if not request.new_trip_name:
            raise HTTPException(status_code=422, detail="기존 여행(trip_id)을 고르거나, 새 여행 이름(new_trip_name)을 입력해주세요.")
        trip_id = await create_trip(
            user_id, request.new_trip_name, request.category or "기타", request.start_date, request.end_date
        )
        if not trip_id:
            raise HTTPException(status_code=500, detail="새 여행을 만들지 못했어요.")

    ok, message = await attach_course_to_trip(course_id, user_id, trip_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True, "trip_id": trip_id}


@courses_router.delete("/{course_id}")
async def delete_course_endpoint(
    course_id: str,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """저장된 코스 하나를 여행에서 삭제합니다 (여행 자체는 남아있어요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")

    ok, message = await delete_course(course_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@courses_router.patch("/{course_id}", response_model=CourseResponse)
async def update_course_endpoint(
    course_id: str,
    request: UpdateCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    저장된 코스의 제목을 바꾸거나(title), 관광지 순서를 바꿉니다(stop_order).
    로그인이 필요하고, 본인 코스만 수정할 수 있습니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")

    row, error = await update_course(course_id, user_id, title=request.title, stop_order=request.stop_order)
    if row is None:
        raise HTTPException(status_code=404 if "찾을 수 없" in (error or "") else 422, detail=error)
    return row_to_course_response(row)


@courses_router.get("/saved/{course_id}", response_model=SavedCourseDetail)
async def get_saved_course_endpoint(
    course_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """저장된 코스 하나를 다시 불러옵니다 (지도/결과 화면 재진입용)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")

    row = await get_saved_course_detail(course_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="저장된 코스를 찾을 수 없어요.")

    trip = row.get("_trip") or {}
    return SavedCourseDetail(
        course=row_to_course_response(row),
        trip_id=row.get("trip_id") or "",
        trip_name=trip.get("name") or "",
        category=trip.get("category") or "기타",
        region=row.get("region") or "",
        created_at=row.get("created_at"),
    )


@trips_router.post("", response_model=TripSummary)
async def create_trip_endpoint(
    request: TripCreateRequest, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """새 여행을 미리 만들어둡니다 (보통은 코스 저장 시 한 번에 만들지만, 필요하면 따로도 가능)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")

    trip_id = await create_trip(user_id, request.name, request.category, request.start_date, request.end_date)
    if not trip_id:
        raise HTTPException(status_code=500, detail="여행을 만들지 못했어요.")
    return TripSummary(
        trip_id=trip_id,
        name=request.name,
        category=request.category,
        course_count=0,
        start_date=request.start_date,
        end_date=request.end_date,
    )


@trips_router.get("", response_model=list[TripSummary])
async def list_trips_endpoint(user_id: Optional[str] = Depends(get_optional_user_id)):
    """마이페이지에 표시할 내 여행 목록 (여행별 저장된 코스 개수 포함)."""
    if not user_id:
        return []
    rows = await list_trips(user_id)
    return [
        TripSummary(
            trip_id=row["id"],
            name=row["name"],
            category=row.get("category") or "기타",
            course_count=row.get("course_count", 0),
            start_date=row.get("start_date"),
            end_date=row.get("end_date"),
            created_at=row.get("created_at"),
            visited=row.get("visited", False),
        )
        for row in rows
    ]


@trips_router.patch("/{trip_id}", response_model=TripSummary)
async def update_trip_endpoint(
    trip_id: str,
    request: TripUpdateRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """마이페이지에서 여행 이름/분류/날짜를 수정합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")

    ok, message = await update_trip(
        trip_id, user_id, request.name, request.category, request.start_date, request.end_date
    )
    if not ok:
        raise HTTPException(status_code=404, detail=message)

    # 수정된 최신 상태를 다시 조회해서 반환
    rows = await list_trips(user_id)
    updated = next((r for r in rows if r["id"] == trip_id), None)
    if not updated:
        raise HTTPException(status_code=404, detail="수정 후 여행 정보를 다시 불러오지 못했어요.")
    return TripSummary(
        trip_id=updated["id"],
        name=updated["name"],
        category=updated.get("category") or "기타",
        course_count=updated.get("course_count", 0),
        start_date=updated.get("start_date"),
        end_date=updated.get("end_date"),
        created_at=updated.get("created_at"),
    )


@trips_router.delete("/{trip_id}")
async def delete_trip_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """여행과 그 안에 저장된 코스들을 함께 삭제합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")

    ok, message = await delete_trip(trip_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@trips_router.post("/{trip_id}/visit")
async def mark_trip_visited_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """'방문 완료' 버튼 — 이 여행 안의 모든 코스에 담긴 관광지들을 방문한 여행지로 표시합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="방문 완료로 표시하려면 로그인이 필요해요.")

    count = await mark_trip_as_visited(trip_id, user_id)
    if count == 0:
        raise HTTPException(status_code=404, detail="이 여행에 담긴 관광지를 찾지 못했어요.")
    return {"visited_count": count}


@trips_router.delete("/{trip_id}/visit")
async def unmark_trip_visited_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """'방문 완료' 버튼을 다시 누르면(취소) — 이 여행 기준으로 방문 처리됐던 기록을 지웁니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="방문 완료를 취소하려면 로그인이 필요해요.")

    count = await unmark_trip_as_visited(trip_id, user_id)
    return {"unvisited_count": count}


@trips_router.get("/{trip_id}/courses", response_model=list[SavedCourseSummary])
async def list_trip_courses_endpoint(
    trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """특정 여행에 저장된 코스 목록."""
    if not user_id:
        return []
    rows = await list_trip_courses(trip_id, user_id)
    return [
        SavedCourseSummary(
            course_id=row["id"],
            title=row["title"],
            summary=row["summary"],
            region=row.get("region") or "",
            stop_count=len(row.get("stops") or []),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@trips_router.get("/visited/me/count")
async def my_visited_count(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자가 방문 완료로 표시한 여행지 개수. 비로그인이면 0."""
    if not user_id:
        return {"count": 0}
    return {"count": await count_visited_places(user_id)}


@trips_router.get("/visited/me/list", response_model=list[VisitedPlace])
async def my_visited_list(user_id: Optional[str] = Depends(get_optional_user_id)):
    """'내 여행' 탭의 '방문한 여행지' 통계 카드를 눌렀을 때 쓰는, 내가 방문 완료로 표시한 여행지 전체."""
    if not user_id:
        return []
    return await list_visited_places(user_id)


@trips_router.delete("/visited/{visited_id}")
async def delete_visited_place_endpoint(
    visited_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """'방문한 여행지' 목록에서 하나를 삭제합니다(방문 취소)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")
    ok = await delete_visited_place(visited_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="삭제할 방문 기록을 찾지 못했어요.")
    return {"ok": True}


@trips_router.patch("/visited/{visited_id}", response_model=VisitedPlace)
async def update_visited_date_endpoint(
    visited_id: str,
    request: UpdateVisitedDateRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """'방문한 여행지' 목록에서 방문 날짜를 수정합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")
    updated = await update_visited_place_date(visited_id, user_id, request.visited_at)
    if not updated:
        raise HTTPException(status_code=404, detail="수정할 방문 기록을 찾지 못했어요.")
    return VisitedPlace(**updated)


router.include_router(courses_router)
router.include_router(trips_router)
