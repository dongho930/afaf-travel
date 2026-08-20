"""
아이디(username) 기반 회원가입/로그인 지원.

Supabase Auth 자체는 이메일 기반 로그인만 지원하므로, '아이디'는 이 앱에서 만든
개념입니다. profiles 테이블에 (아이디, 이메일, 사용자 uuid)를 같이 저장해두고:
- 로그인 시 입력값이 아이디 형식이면 여기서 이메일로 변환한 뒤 Supabase Auth에 넘깁니다.
- 회원가입 시 Supabase Auth 계정 생성 직후, 이 서비스로 profiles 행을 만듭니다.

profiles 테이블에 대한 insert는 서비스 키(관리자 권한)로 하므로, 이메일 인증이
아직 안 끝나 로그인 세션이 없는 상태(가입 직후)에도 문제없이 동작합니다.
"""
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
    """로그인한 사용자의 프로필(아이디 등)을 조회합니다. 없으면 None."""
    if _client is None:
        return None
    try:
        result = _client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"[profile] 프로필 조회 실패: {e}")
        return None
