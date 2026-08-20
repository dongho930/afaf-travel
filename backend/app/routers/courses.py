from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    CourseRequest,
    CourseResponse,
    GenerateFromSelectionRequest,
    PlaceRecommendationRequest,
    PlaceRecommendationResponse,
)
from app.services.ai_service import generate_course, generate_course_from_selection, recommend_places
from app.services.supabase_service import list_recent_courses, save_course
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
async def create_course_from_selection(request: GenerateFromSelectionRequest):
    """
    2단계: 1단계 추천 목록에서 사용자가 직접 고른 장소들로 최종 코스(순서/시간대)를 생성합니다.
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

    await save_course(course, query_text=request.query_text, region=request.region)
    return course


@router.post("/generate", response_model=CourseResponse)
async def create_course(request: CourseRequest):
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

    await save_course(course, query_text=request.query_text, region=request.region)
    return course


@router.get("/history")
async def get_course_history(limit: int = 20):
    """Supabase에 저장된 최근 코스 이력 조회 (Supabase 미설정 시 빈 목록)"""
    return await list_recent_courses(limit=limit)
