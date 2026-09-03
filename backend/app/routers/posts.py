from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services.auth import get_optional_user_id
from app.services.post_service import (
    create_comment,
    create_post,
    delete_comment,
    delete_post,
    get_post,
    list_comments_for_post,
    list_posts_feed,
)

router = APIRouter(prefix="/api/posts", tags=["posts"])


class PostItem(BaseModel):
    id: str
    content_id: str
    place_name: str
    user_id: str
    username: str
    avatar_url: Optional[str] = None
    body: str
    photo_urls: list[str] = []
    comment_count: int = 0
    is_mine: bool = False
    created_at: str


class CreatePostRequest(BaseModel):
    content_id: str
    place_name: str
    body: str
    # 리뷰 사진과 같은 방식: 앱이 이미지를 base64로 인코딩해서 보냅니다.
    # 최대 5장까지만 반영됩니다(post_service._MAX_PHOTOS).
    photos: list[str] = []


class CommentItem(BaseModel):
    id: str
    post_id: str
    user_id: str
    username: str
    avatar_url: Optional[str] = None
    parent_comment_id: Optional[str] = None
    body: str
    is_mine: bool = False
    created_at: str


class CreateCommentRequest(BaseModel):
    body: str
    # 최상위 댓글에 다는 답글이면 그 댓글의 id를 넣습니다. 답글에는 다시
    # 답글을 달 수 없어요(서버에서 검증).
    parent_comment_id: Optional[str] = None


@router.get("", response_model=list[PostItem])
async def list_feed(
    limit: int = Query(default=20, le=50),
    before: Optional[str] = None,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """여행기록 전체 공개 피드 (최신순, 로그인 불필요). before는 이전 페이지
    마지막 게시물의 created_at을 넣어서 그 이전 게시물을 이어서 받습니다."""
    return await list_posts_feed(limit=limit, before=before, viewer_user_id=user_id)


@router.post("", response_model=PostItem)
async def submit_post(
    request: CreatePostRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """여행기록 게시물을 작성합니다 (로그인 필요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="게시물을 쓰려면 로그인이 필요해요.")

    ok, result = await create_post(
        user_id, request.content_id, request.place_name, request.body, request.photos
    )
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@router.get("/{post_id}", response_model=PostItem)
async def get_post_detail(post_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """게시물 상세 (로그인 불필요)."""
    post = await get_post(post_id, viewer_user_id=user_id)
    if not post:
        raise HTTPException(status_code=404, detail="게시물을 찾을 수 없어요.")
    return post


@router.delete("/{post_id}")
async def remove_post(post_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """본인 게시물 삭제 (로그인 필요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")
    ok = await delete_post(user_id, post_id)
    if not ok:
        raise HTTPException(status_code=404, detail="삭제할 게시물을 찾을 수 없어요.")
    return {"ok": True}


@router.get("/{post_id}/comments", response_model=list[CommentItem])
async def get_comments(post_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """게시물의 댓글+답글 전체 (오래된 순, 로그인 불필요)."""
    return await list_comments_for_post(post_id, viewer_user_id=user_id)


@router.post("/{post_id}/comments", response_model=CommentItem)
async def submit_comment(
    post_id: str,
    request: CreateCommentRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """댓글 또는 답글을 작성합니다 (로그인 필요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="댓글을 쓰려면 로그인이 필요해요.")

    ok, result = await create_comment(user_id, post_id, request.body, request.parent_comment_id)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    return result


@router.delete("/comments/{comment_id}")
async def remove_comment(comment_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """본인 댓글(또는 답글) 삭제 (로그인 필요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")
    ok = await delete_comment(user_id, comment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="삭제할 댓글을 찾을 수 없어요.")
    return {"ok": True}
