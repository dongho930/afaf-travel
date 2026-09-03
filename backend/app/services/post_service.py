"""
여행기록(게시물) 작성/조회 + 댓글/답글(1단계).

posts 테이블에 (user_id, content_id, place_name, body, photo_urls)를 저장합니다.
장소 이름은 접근성 제보(report_service.py)와 같은 방식으로 작성 시점에 함께
저장합니다 — 리뷰(review_service.py)처럼 조회할 때마다 관광공사 API로 장소
이름을 다시 찾지 않습니다. 이 피드는 전체 공개라 조회가 훨씬 잦을 수 있어서,
하루 호출 한도가 있는 관광공사 API(tour_api_client)에 매번 의존하면 부담이 큽니다.

댓글은 post_comments 테이블에 (post_id, user_id, parent_comment_id, body)로
저장하고, 답글은 parent_comment_id로 최상위 댓글을 가리킵니다. 답글에는 다시
답글을 달 수 없도록(1단계까지만) create_comment에서 검증합니다.

사진 업로드는 리뷰 사진과 같은 방식입니다: 앱이 base64로 인코딩해서 보내면,
이 서비스가 서비스 키(관리자 권한)로 Supabase Storage(post-photos 버킷)에
대신 업로드하고, 공개 URL 목록을 photo_urls(jsonb 배열)에 저장합니다.
"""
import base64
import time
from typing import Optional

from app.config import get_settings

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_POSTS_TABLE = "posts"
_COMMENTS_TABLE = "post_comments"
_PHOTOS_BUCKET = "post-photos"
_MAX_PHOTOS = 5


async def _process_post_photos(user_id: str, photos: list[str]) -> list[str]:
    """
    게시물 사진 목록을 처리해서 최종 공개 URL 목록을 반환합니다.
    review_service._process_review_photos와 동일한 방식입니다 — 개별 사진
    업로드가 실패해도 나머지는 계속 시도하고, 실패한 사진은 결과에서 빠집니다.
    """
    if _client is None or not photos:
        return []

    urls: list[str] = []
    timestamp = int(time.time())
    for idx, photo in enumerate(photos[:_MAX_PHOTOS]):
        if photo.startswith("http"):
            urls.append(photo)
            continue
        try:
            raw = photo.split(",", 1)[1] if photo.startswith("data:") else photo
            file_bytes = base64.b64decode(raw)
            path = f"{user_id}/{timestamp}_{idx}.jpg"
            _client.storage.from_(_PHOTOS_BUCKET).upload(
                path, file_bytes, {"content-type": "image/jpeg", "upsert": "true"}
            )
            public_url_result = _client.storage.from_(_PHOTOS_BUCKET).get_public_url(path)
            public_url = (
                public_url_result
                if isinstance(public_url_result, str)
                else public_url_result.get("publicUrl", "")
            )
            if public_url:
                urls.append(public_url)
        except Exception as e:
            print(f"[post] 게시물 사진 업로드 실패({idx}): {e}")
    return urls


async def _attach_authors(rows: list[dict]) -> list[dict]:
    """각 행에 user_id로 profiles를 조회해 username/avatar_url을 붙입니다
    (review_service와 동일하게 PostgREST 조인 대신 Python에서 병합)."""
    if _client is None or not rows:
        return rows
    user_ids = list({r["user_id"] for r in rows})
    usernames: dict[str, str] = {}
    avatar_urls: dict[str, Optional[str]] = {}
    try:
        profile_result = (
            _client.table("profiles").select("id, username, avatar_url").in_("id", user_ids).execute()
        )
        for p in profile_result.data or []:
            usernames[p["id"]] = p.get("username") or "익명"
            avatar_urls[p["id"]] = p.get("avatar_url") or None
    except Exception as e:
        print(f"[post] 작성자 정보 조회 실패: {e}")
    for r in rows:
        r["username"] = usernames.get(r["user_id"], "익명")
        r["avatar_url"] = avatar_urls.get(r["user_id"])
    return rows


async def _attach_comment_counts(rows: list[dict]) -> list[dict]:
    """각 게시물 행에 댓글 수(comment_count)를 붙입니다 (review_service의
    get_average_ratings처럼 배치 조회 후 파이썬에서 집계)."""
    if _client is None or not rows:
        return rows
    post_ids = [r["id"] for r in rows]
    counts: dict[str, int] = {pid: 0 for pid in post_ids}
    try:
        result = _client.table(_COMMENTS_TABLE).select("post_id").in_("post_id", post_ids).execute()
        for c in result.data or []:
            counts[c["post_id"]] = counts.get(c["post_id"], 0) + 1
    except Exception as e:
        print(f"[post] 댓글 수 조회 실패: {e}")
    for r in rows:
        r["comment_count"] = counts.get(r["id"], 0)
    return rows


async def create_post(
    user_id: str, content_id: str, place_name: str, body: str, photos: Optional[list[str]] = None
) -> tuple[bool, Optional[dict] | str]:
    """게시물을 작성합니다. 리뷰와 달리 한 사용자가 한 장소에 여러 번 쓸 수
    있어요(upsert 없이 항상 새 행)."""
    if _client is None:
        return False, "서버 설정 오류로 게시물을 저장할 수 없어요."
    if not body.strip():
        return False, "내용을 입력해주세요."
    try:
        photo_urls = await _process_post_photos(user_id, photos or [])
        payload = {
            "user_id": user_id,
            "content_id": content_id,
            "place_name": place_name,
            "body": body.strip(),
            "photo_urls": photo_urls,
        }
        result = _client.table(_POSTS_TABLE).insert(payload).execute()
        saved_rows = result.data or []
        if not saved_rows:
            return False, "게시물을 저장하지 못했어요. 잠시 후 다시 시도해주세요."
        row = (await _attach_authors([saved_rows[0]]))[0]
        row["comment_count"] = 0
        row["is_mine"] = True
        return True, row
    except Exception as e:
        print(f"[post] 게시물 저장 실패: {e}")
        return False, "게시물을 저장하지 못했어요. 잠시 후 다시 시도해주세요."


async def list_posts_feed(
    limit: int = 20, before: Optional[str] = None, viewer_user_id: Optional[str] = None
) -> list[dict]:
    """전체 공개 피드 (최신순). before는 이전 페이지 마지막 게시물의
    created_at(ISO 문자열)을 넣으면 그 이전 게시물만 더 가져옵니다(간단한
    커서 방식 페이지네이션 — 이 코드베이스엔 offset 페이지네이션이 없어서
    같은 스타일로 맞췄습니다)."""
    if _client is None:
        return []
    try:
        query = _client.table(_POSTS_TABLE).select("*").order("created_at", desc=True).limit(limit)
        if before:
            query = query.lt("created_at", before)
        result = query.execute()
        rows = result.data or []
        if not rows:
            return []
        rows = await _attach_authors(rows)
        rows = await _attach_comment_counts(rows)
        for r in rows:
            r["is_mine"] = bool(viewer_user_id) and r["user_id"] == viewer_user_id
        return rows
    except Exception as e:
        print(f"[post] 피드 조회 실패: {e}")
        return []


async def list_my_posts(user_id: str, limit: int = 100) -> list[dict]:
    """'게시물 관리' 화면용, 이 사용자가 작성한 게시물 전체를 최신순으로
    반환합니다 (review_service.list_reviews_by_user와 동일한 패턴)."""
    if _client is None:
        return []
    try:
        result = (
            _client.table(_POSTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return []
        rows = await _attach_authors(rows)
        rows = await _attach_comment_counts(rows)
        for r in rows:
            r["is_mine"] = True
        return rows
    except Exception as e:
        print(f"[post] 내 게시물 목록 조회 실패: {e}")
        return []


async def get_post(post_id: str, viewer_user_id: Optional[str] = None) -> Optional[dict]:
    """게시물 단건 조회 (작성자/댓글 수 포함)."""
    if _client is None:
        return None
    try:
        result = _client.table(_POSTS_TABLE).select("*").eq("id", post_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return None
        rows = await _attach_authors(rows)
        rows = await _attach_comment_counts(rows)
        row = rows[0]
        row["is_mine"] = bool(viewer_user_id) and row["user_id"] == viewer_user_id
        return row
    except Exception as e:
        print(f"[post] 게시물 조회 실패: {e}")
        return None


async def delete_post(user_id: str, post_id: str) -> bool:
    """본인 게시물만 삭제합니다 (필터 자체로 소유권을 강제). 댓글/답글은 DB
    on delete cascade로 함께 삭제됩니다."""
    if _client is None:
        return False
    try:
        result = _client.table(_POSTS_TABLE).delete().eq("id", post_id).eq("user_id", user_id).execute()
        return bool(result.data)
    except Exception as e:
        print(f"[post] 게시물 삭제 실패: {e}")
        return False


async def list_comments_for_post(post_id: str, viewer_user_id: Optional[str] = None) -> list[dict]:
    """게시물의 댓글 전체를 오래된 순(대화 흐름)으로 반환합니다 — flat list이고,
    parent_comment_id가 있으면 답글입니다. 이 코드베이스엔 재귀/중첩 쿼리 패턴이
    없어서, 최상위/답글 그룹핑은 클라이언트에서 parent_comment_id로 합니다."""
    if _client is None:
        return []
    try:
        result = (
            _client.table(_COMMENTS_TABLE)
            .select("*")
            .eq("post_id", post_id)
            .order("created_at", desc=False)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return []
        rows = await _attach_authors(rows)
        for r in rows:
            r["is_mine"] = bool(viewer_user_id) and r["user_id"] == viewer_user_id
        return rows
    except Exception as e:
        print(f"[post] 댓글 목록 조회 실패: {e}")
        return []


async def create_comment(
    user_id: str, post_id: str, body: str, parent_comment_id: Optional[str] = None
) -> tuple[bool, Optional[dict] | str]:
    """댓글(또는 답글)을 작성합니다. parent_comment_id가 있으면 그 댓글이 같은
    게시물의 '최상위' 댓글인지 확인해서, 답글에 다시 답글 다는 것(2단계 이상
    중첩)을 서버에서도 막습니다 — 클라이언트에서 '답글' 버튼을 최상위 댓글에만
    보여주는 것과 이중으로 방어합니다."""
    if _client is None:
        return False, "서버 설정 오류로 댓글을 저장할 수 없어요."
    if not body.strip():
        return False, "댓글 내용을 입력해주세요."
    try:
        if parent_comment_id:
            parent_result = (
                _client.table(_COMMENTS_TABLE)
                .select("id, post_id, parent_comment_id")
                .eq("id", parent_comment_id)
                .limit(1)
                .execute()
            )
            parent_rows = parent_result.data or []
            if not parent_rows or parent_rows[0]["post_id"] != post_id:
                return False, "답글을 달려는 댓글을 찾을 수 없어요."
            if parent_rows[0].get("parent_comment_id"):
                return False, "답글에는 답글을 달 수 없어요."

        payload = {
            "post_id": post_id,
            "user_id": user_id,
            "parent_comment_id": parent_comment_id,
            "body": body.strip(),
        }
        result = _client.table(_COMMENTS_TABLE).insert(payload).execute()
        saved_rows = result.data or []
        if not saved_rows:
            return False, "댓글을 저장하지 못했어요. 잠시 후 다시 시도해주세요."
        row = (await _attach_authors([saved_rows[0]]))[0]
        row["is_mine"] = True
        return True, row
    except Exception as e:
        print(f"[post] 댓글 저장 실패: {e}")
        return False, "댓글을 저장하지 못했어요. 잠시 후 다시 시도해주세요."


async def delete_comment(user_id: str, comment_id: str) -> bool:
    """본인 댓글만 삭제합니다. 최상위 댓글을 지우면 그 답글들도 DB on delete
    cascade로 함께 삭제됩니다."""
    if _client is None:
        return False
    try:
        result = (
            _client.table(_COMMENTS_TABLE).delete().eq("id", comment_id).eq("user_id", user_id).execute()
        )
        return bool(result.data)
    except Exception as e:
        print(f"[post] 댓글 삭제 실패: {e}")
        return False
