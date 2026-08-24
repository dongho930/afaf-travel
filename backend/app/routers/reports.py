from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services.auth import get_optional_user_id
from app.services.report_service import (
    ReportCategory,
    count_reports_by_user,
    create_report,
    list_reports_by_category,
    list_reports_by_user,
)
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/reports", tags=["reports"])


class ReportItem(BaseModel):
    id: str
    content_id: str
    place_name: str
    category: str
    body: str
    user_id: str
    username: str
    avatar_url: Optional[str] = None
    created_at: str


class MyReportItem(BaseModel):
    id: str
    content_id: str
    place_name: str
    category: str
    body: str
    created_at: str


class CreateReportRequest(BaseModel):
    content_id: str
    place_name: str
    category: ReportCategory
    body: str


class AttractionSearchResult(BaseModel):
    content_id: str
    name: str
    address: str
    category: str


@router.get("/search", response_model=list[AttractionSearchResult])
async def search_attractions(q: str = Query(..., min_length=1, description="여행지 이름 검색어")):
    """제보 작성 화면의 여행지 이름 자동완성 검색."""
    return await tour_api_client.search_attractions_by_keyword(q)


@router.get("/me/count")
async def my_report_count(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자가 지금까지 작성한 제보 개수. 비로그인이면 0."""
    if not user_id:
        return {"count": 0}
    return {"count": await count_reports_by_user(user_id)}


@router.get("/me/list", response_model=list[MyReportItem])
async def my_reports(user_id: Optional[str] = Depends(get_optional_user_id)):
    """'내 여행' 탭의 '접근성 제보' 통계 카드를 눌렀을 때 쓰는, 내가 작성한 제보 전체."""
    if not user_id:
        return []
    return await list_reports_by_user(user_id)


@router.get("/{category}", response_model=list[ReportItem])
async def list_reports(category: ReportCategory, limit: int = Query(default=20, le=50)):
    """특정 카테고리(휠체어/시각/청각/고령자/영유아가족/임산부)의 접근성 제보 목록 (최신순)."""
    return await list_reports_by_category(category, limit)


@router.post("")
async def submit_report(
    request: CreateReportRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """접근성 제보를 작성합니다 (로그인 필요). 같은 장소에 여러 번 남길 수 있어요."""
    if not user_id:
        raise HTTPException(status_code=401, detail="제보를 쓰려면 로그인이 필요해요.")

    ok, result = await create_report(
        user_id, request.content_id, request.place_name, request.category, request.body
    )
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result
