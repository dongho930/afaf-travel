from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services.auth import get_optional_user_id
from app.services.review_service import (
    count_reviews_by_user,
    create_review,
    list_reviews_for_place,
)

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


class ReviewItem(BaseModel):
    id: str
    content_id: str
    user_id: str
    username: str
    rating: int
    body: str
    created_at: str


class CreateReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str


@router.get("/me/count")
async def my_review_count(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자가 지금까지 작성한 리뷰 개수. 비로그인이면 0."""
    if not user_id:
        return {"count": 0}
    return {"count": await count_reviews_by_user(user_id)}


@router.get("/{content_id}", response_model=list[ReviewItem])
async def list_reviews(content_id: str):
    """특정 관광지의 방문자 리뷰 목록 (최신순, 로그인 불필요)."""
    return await list_reviews_for_place(content_id)


@router.post("/{content_id}")
async def submit_review(
    content_id: str,
    request: CreateReviewRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    리뷰를 작성합니다 (로그인 필요). 이미 이 장소에 리뷰를 쓴 적이 있으면
    새로 만들지 않고 기존 리뷰를 수정합니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="리뷰를 쓰려면 로그인이 필요해요.")

    ok, result = await create_review(user_id, content_id, request.rating, request.body)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result
