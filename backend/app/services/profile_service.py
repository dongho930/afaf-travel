"""
아이디(username) 기반 회원가입/로그인 + 프로필(아이디/프로필 사진) 관리.

Supabase Auth 자체는 이메일 기반 로그인만 지원하므로, '아이디'는 이 앱에서 만든
개념입니다. profiles 테이블에 (아이디, 이메일, 사용자 uuid, 프로필 사진 URL)를
같이 저장해두고:
- 로그인 시 입력값이 아이디 형식이면 여기서 이메일로 변환한 뒤 Supabase Auth에 넘깁니다.
- 회원가입 시 Supabase Auth 계정 생성 직후, 이 서비스로 profiles 행을 만듭니다.
- 프로필 화면에서 아이디/프로필 사진을 나중에 바꿀 수도 있습니다.

프로필 사진 파일은 앱이 base64로 인코딩해서 이 백엔드로 보내고, 이 서비스가
서비스 키(관리자 권한)로 Supabase Storage(avatars 버킷)에 대신 업로드합니다.
서비스 키는 RLS(row-level security) 정책을 무시하므로, 클라이언트가 직접
업로드할 때 정책 설정 문제로 막히는 걸 피할 수 있습니다.

profiles 테이블에 대한 insert/update는 서비스 키(관리자 권한)로 하므로, 이메일
인증이 아직 안 끝나 로그인 세션이 없는 상태(가입 직후)에도 문제없이 동작합니다.
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


async def resolve_login_email(identifier: str) -> Optional[str]:
    """
    로그인 입력값(이메일 또는 아이디)을 실제 이메일로 변환합니다.
    이메일 형식이면 그대로 반환하고, 아이디 형식이면 profiles 테이블에서 찾아봅니다.
    못 찾으면 None을 반환합니다.
    """
    identifier = identifier.strip()
    if "@" in identifier:
        return identifier

    if _client is None:
        return None
    try:
        result = (
            _client.table("profiles")
            .select("email")
            .eq("username", identifier)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0]["email"] if rows else None
    except Exception as e:
        print(f"[profile] 아이디→이메일 조회 실패: {e}")
        return None


async def create_profile(user_id: str, username: str, email: str) -> tuple[bool, Optional[str]]:
    """
    회원가입 직후 profiles 행을 생성합니다.
    성공 시 (True, None), 아이디 중복 등으로 실패 시 (False, "사용자에게 보여줄 메시지")를 반환합니다.
    """
    if _client is None:
        return False, "서버 설정 오류로 프로필을 만들 수 없습니다."

    username = username.strip()
    if not (2 <= len(username) <= 20):
        return False, "아이디는 2~20자로 입력해주세요."

    try:
        _client.table("profiles").insert(
            {"id": user_id, "username": username, "email": email}
        ).execute()
        return True, None
    except Exception as e:
        message = str(e)
        if "duplicate key" in message or "unique" in message.lower():
            return False, "이미 사용 중인 아이디예요. 다른 아이디를 입력해주세요."
        print(f"[profile] 프로필 생성 실패: {e}")
        return False, "프로필 생성 중 오류가 발생했어요."


async def get_profile_by_user_id(user_id: str) -> Optional[dict]:
    """로그인한 사용자의 프로필(아이디, 프로필 사진 URL 등)을 조회합니다. 없으면 None."""
    if _client is None:
        return None
    try:
        result = _client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[profile] 프로필 조회 실패: {e}")
        return None


async def upload_avatar(user_id: str, image_base64: str, file_ext: str) -> tuple[Optional[str], Optional[str]]:
    """
    프로필 사진을 Supabase Storage에 업로드하고, profiles.avatar_url까지 갱신합니다.
    서비스 키로 업로드하므로 RLS 정책과 무관하게 항상 성공합니다.
    성공 시 (avatar_url, None), 실패 시 (None, "사용자에게 보여줄 메시지")를 반환합니다.
    """
    if _client is None:
        return None, "서버 설정 오류로 업로드할 수 없어요."

    try:
        file_bytes = base64.b64decode(image_base64)
    except Exception:
        return None, "이미지 데이터를 읽지 못했어요."

    file_ext = (file_ext or "jpg").lower().lstrip(".")
    content_type = "image/png" if file_ext == "png" else "image/jpeg"
    path = f"{user_id}/avatar.{file_ext}"

    try:
        _client.storage.from_("avatars").upload(
            path,
            file_bytes,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as e:
        print(f"[profile] 프로필 사진 업로드 실패: {e}")
        return None, "업로드 중 오류가 발생했어요."

    public_url_result = _client.storage.from_("avatars").get_public_url(path)
    # supabase-py 버전에 따라 문자열을 바로 주기도 하고, dict로 주기도 해서 둘 다 처리
    public_url = public_url_result if isinstance(public_url_result, str) else public_url_result.get("publicUrl", "")
    avatar_url = f"{public_url}?t={int(time.time())}"  # 캐시 무효화용 타임스탬프

    ok, message = await update_profile(user_id, avatar_url=avatar_url)
    if not ok:
        return None, message
    return avatar_url, None


async def update_profile(
    user_id: str, username: Optional[str] = None, avatar_url: Optional[str] = None
) -> tuple[bool, Optional[str]]:
    """
    프로필 화면에서 아이디/프로필 사진을 수정합니다. 넘겨준 값만 반영됩니다.
    아이디를 바꿀 때는 다른 사람과 중복되지 않는지 확인합니다.
    """
    if _client is None:
        return False, "서버 설정 오류로 수정할 수 없어요."

    update_fields: dict = {}

    if username is not None:
        username = username.strip()
        if not (2 <= len(username) <= 20):
            return False, "아이디는 2~20자로 입력해주세요."
        update_fields["username"] = username

    if avatar_url is not None:
        update_fields["avatar_url"] = avatar_url

    if not update_fields:
        return True, None

    try:
        _client.table("profiles").update(update_fields).eq("id", user_id).execute()
        return True, None
    except Exception as e:
        message = str(e)
        if "duplicate key" in message or "unique" in message.lower():
            return False, "이미 사용 중인 아이디예요. 다른 아이디를 입력해주세요."
        print(f"[profile] 프로필 수정 실패: {e}")
        return False, "수정 중 오류가 발생했어요."
