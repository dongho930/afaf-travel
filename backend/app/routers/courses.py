from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import (
    CourseRequest,
    CourseResponse,
    GenerateFromSelectionRequest,
    PlaceRecommendationRequest,
    PlaceRecommendationResponse,
    SaveCourseRequest,
    SavedCourseDetail,
    SavedCourseSummary,
)
from app.services.ai_service import generate_course, generate_course_from_selection, recommend_places
from app.services.auth import get_optional_user_id
from app.services.supabase_service import (
    row_to_course_response,
    delete_course,
    get_saved_course_detail,
    list_recent_courses,
    list_saved_courses,
    mark_course_saved,
    save_course,
)
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.post("/recommend", response_model=PlaceRecommendationResponse)
async def recommend_course_places(request: PlaceRecommendationRequest):
    """
    1단계: 사용자의 자연어 질의에 맞는 장소 후보를 넓게 추천합니다.
    아직 코스(순서/시간)를 확정하지 않고, 사용자가 이 중에서 직접 고를 수 있게 목록만 보여줍니다.
    """
    candidates = await tour_api_client.search_accessible_attractions(
        region=request.region, user_type=request.user_type.value, limit=25, sigungu_cd=request.sigungu_cd
    )
    try:
        selected = await recommend_places(request, candidates)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return PlaceRecommendationResponse(query_text=request.query_text, candidates=selected)


@router.post("/generate-from-selection", response_model=CourseResponse)
async def create_course_from_selection(
    request: GenerateFromSelectionRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    2단계: 1단계 추천 목록에서 사용자가 직접 고른 장소들로 최종 코스(순서/시간대)를 생성합니다.
    로그인한 사용자면 자동으로 기록되지만(is_saved=False), 결과 화면에서 이름/분류를
    지정해 명시적으로 '저장'해야 마이페이지 목록에 나타납니다.
    """
    # 사용자가 고른 장소들의 최신 정보(편의시설, 혼잡도 등)를 다시 가져옵니다.
    candidates = await tour_api_client.search_accessible_attractions(
        region=request.region, user_type=request.user_type.value, limit=25, sigungu_cd=request.sigungu_cd
    )
    by_id = {a.content_id: a for a in candidates}
    selected_attractions = [
        by_id[cid] for cid in request.selected_content_ids if cid in by_id
    ]

    if not selected_attractions:
        raise HTTPException(status_code=422, detail="선택하신 관광지 정보를 다시 불러오지 못했습니다. 다시 시도해주세요.")

    try:
        course = await generate_course_from_selection(request, selected_attractions)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    return course


@router.post("/generate", response_model=CourseResponse)
async def create_course(
    request: CourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    (레거시) 질의 하나로 후보 선택 없이 바로 코스를 생성합니다.
    새 플로우는 /recommend → /generate-from-selection 두 단계를 씁니다.
    """
    candidates = await tour_api_client.search_accessible_attractions(
        region=request.region, user_type=request.user_type.value, limit=25
    )
    try:
        course = await generate_course(request, candidates)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    return course


@router.get("/history")
async def get_course_history(
    limit: int = 20,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    로그인한 사용자의 최근 코스 이력을 조회합니다 (저장 여부와 상관없이 생성된 것 전부).
    비로그인 상태면 빈 목록을 반환합니다.
    """
    return await list_recent_courses(limit=limit, user_id=user_id)


@router.post("/{course_id}/save")
async def save_course_endpoint(
    course_id: str,
    request: SaveCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    결과 화면에서 '저장하기'를 눌렀을 때 호출합니다. 여행 이름과 분류를 지정해서
    이 코스를 마이페이지 '저장된 코스' 목록에 남깁니다. 로그인이 필요합니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="저장하려면 로그인이 필요해요.")

    ok, message = await mark_course_saved(course_id, user_id, request.name, request.category)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@router.delete("/{course_id}")
async def delete_course_endpoint(
    course_id: str,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """저장된 코스를 삭제합니다. 본인이 저장한 코스만 지울 수 있습니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")

    ok, message = await delete_course(course_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@router.get("/saved", response_model=list[SavedCourseSummary])
async def list_saved_courses_endpoint(user_id: Optional[str] = Depends(get_optional_user_id)):
    """마이페이지에 표시할, 사용자가 이름/분류를 지정해 저장한 코스 목록입니다."""
    if not user_id:
        return []

    rows = await list_saved_courses(user_id)
    return [
        SavedCourseSummary(
            course_id=row["id"],
            name=row.get("name") or "",
            category=row.get("category") or "기타",
            title=row["title"],
            summary=row["summary"],
            region=row.get("region") or "",
            stop_count=len(row.get("stops") or []),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@router.get("/saved/{course_id}", response_model=SavedCourseDetail)
async def get_saved_course_endpoint(
    course_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """저장된 코스 하나를 다시 불러옵니다 (지도/결과 화면 재진입용)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")

    row = await get_saved_course_detail(course_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="저장된 코스를 찾을 수 없어요.")

    return SavedCourseDetail(
        course=row_to_course_response(row),
        name=row.get("name") or "",
        category=row.get("category") or "기타",
        region=row.get("region") or "",
        created_at=row.get("created_at"),
    )
