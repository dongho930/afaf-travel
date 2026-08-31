from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services.auth import get_optional_user_id
from app.services.review_service import (
    count_reviews_by_user,
    create_review,
    list_reviews_by_user,
    list_reviews_for_place,
)
from app.services.tour_api import tour_api_client

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


class ReviewItem(BaseModel):
    id: str
    content_id: str
    user_id: str
    username: str
    avatar_url: Optional[str] = None
    rating: int
    body: str
    photo_urls: list[str] = []
    created_at: str


class MyReviewItem(BaseModel):
    id: str
    content_id: str
    place_name: str
    rating: int
    body: str
    photo_urls: list[str] = []
    created_at: str


class CreateReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str
    # 프로필 사진과 같은 방식: 앱이 이미지를 base64로 인코딩해서 보냅니다.
    # 최대 5장까지만 반영됩니다(review_service._MAX_PHOTOS).
    photos: list[str] = []


@router.get("/me/count")
async def my_review_count(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자가 지금까지 작성한 리뷰 개수. 비로그인이면 0."""
    if not user_id:
        return {"count": 0}
    return {"count": await count_reviews_by_user(user_id)}


@router.get("/me/list", response_model=list[MyReviewItem])
async def my_reviews(user_id: Optional[str] = Depends(get_optional_user_id)):
    """
    '내 여행' 탭의 '리뷰 작성' 통계 카드를 눌렀을 때 쓰는, 내가 작성한 리뷰
    전체입니다. place_reviews 테이블엔 여행지 이름이 안 저장돼 있어서(content_id만
    있음), 화면에 어떤 장소인지 보여주기 위해 상세 조회로 이름을 붙여줍니다.
    """
    if not user_id:
        return []
    rows = await list_reviews_by_user(user_id)
    result = []
    for r in rows:
        attraction = await tour_api_client.get_attraction_detail(r["content_id"])
        result.append(
            MyReviewItem(
                id=r["id"],
                content_id=r["content_id"],
                place_name=attraction.name if attraction else "알 수 없는 장소",
                rating=r["rating"],
                body=r["body"],
                photo_urls=r.get("photo_urls") or [],
                created_at=r["created_at"],
            )
        )
    return result


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

    ok, result = await create_review(
        user_id, content_id, request.rating, request.body, request.photos
    )
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result
