from fastapi import APIRouter, HTTPException

from app.models.schemas import CourseRequest, CourseResponse
from app.services.ai_service import generate_course
from app.services.supabase_service import list_recent_courses, save_course
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.post("/generate", response_model=CourseResponse)
async def create_course(request: CourseRequest):
    """
    모바일 앱의 입력 화면(텍스트/음성 STT 결과)에서 호출하는 핵심 엔드포인트.
    1) 무장애 필터링된 관광지 후보 조회
    2) 후보 + 질의 + 혼잡도 예측을 Claude API에 전달해 코스(JSON) 생성
    3) (Supabase 설정 시) 생성된 코스를 이력으로 저장
    """
    # 관광지/음식점/문화시설/레포츠/숙박 카테고리가 골고루 섞이도록 후보 풀을
    # 넉넉하게(25) 가져옵니다 — 너무 적으면 카테고리당 조회량이 줄어 다양성이 떨어집니다.
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
