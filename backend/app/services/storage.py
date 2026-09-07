"""
Supabase Storage 업로드/삭제를 이벤트 루프를 막지 않고 실행하기 위한 헬퍼.

db.py와 같은 이유입니다. supabase-py의 storage 호출(upload/remove/
get_public_url)은 전부 동기(blocking) 함수라, async 함수 안에서 그대로 부르면
사진이 다 올라갈 때까지 FastAPI의 이벤트 루프 전체가 멈춥니다. DB 쿼리는
db.execute()로 감싸두었는데 스토리지 호출만 빠져 있어서, 사진 5장짜리 게시물
하나를 올리는 동안 다른 사용자의 요청이 시작조차 못 하고 있었습니다.

그래서 실제로 통신하는 부분만 별도 스레드로 넘깁니다. 게시물/리뷰/프로필
사진이 모두 같은 방식이라, 중복되던 코드(공개 URL이 문자열인지 dict인지
버전마다 다른 것 포함)를 여기로 모았습니다.
"""
import asyncio
from typing import Any, Optional
from urllib.parse import urlparse


async def upload_public(
    client: Any, bucket: str, path: str, file_bytes: bytes, content_type: str = "image/jpeg"
) -> str:
    """파일을 올리고 공개 URL을 돌려줍니다. 실패하면 예외가 그대로 올라갑니다."""

    def _upload() -> str:
        client.storage.from_(bucket).upload(
            path, file_bytes, {"content-type": content_type, "upsert": "true"}
        )
        result = client.storage.from_(bucket).get_public_url(path)
        # supabase-py 버전에 따라 문자열을 바로 주기도 하고, dict로 주기도 해서 둘 다 처리
        return result if isinstance(result, str) else result.get("publicUrl", "")

    return await asyncio.to_thread(_upload)


async def remove_objects(client: Any, bucket: str, paths: list[str]) -> None:
    """올려둔 파일들을 지웁니다. 실패해도 예외를 밖으로 내보내지 않습니다 —
    이 함수를 부르는 쪽(게시물 삭제 등)은 이미 사용자에게 중요한 작업을
    끝낸 뒤라, 뒷정리가 안 됐다고 그 결과를 되돌릴 이유가 없습니다."""
    if not paths:
        return
    try:
        await asyncio.to_thread(client.storage.from_(bucket).remove, paths)
    except Exception as e:
        print(f"[storage] 파일 삭제 실패({bucket}, {len(paths)}개): {e}")


def path_from_public_url(url: str, bucket: str) -> Optional[str]:
    """공개 URL에서 버킷 안의 경로만 뽑아냅니다 — 저장해둔 건 URL인데
    지울 때 필요한 건 경로라서요.

    예) https://xxx.supabase.co/storage/v1/object/public/post-photos/<uid>/a.jpg?t=1
        -> <uid>/a.jpg
    다른 버킷이거나 형식이 다르면 None을 돌려줍니다(그런 URL은 건드리지 않습니다).
    """
    if not url:
        return None
    marker = f"/object/public/{bucket}/"
    # 쿼리스트링(프로필 사진의 캐시 무효화용 ?t=...)은 경로가 아니므로 떼어냅니다.
    without_query = urlparse(url).path
    idx = without_query.find(marker)
    if idx == -1:
        return None
    path = without_query[idx + len(marker) :]
    return path or None
