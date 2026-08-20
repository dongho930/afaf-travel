"""
Supabase Auth 로그인 토큰(JWT) 검증.

모바일 앱은 Supabase 클라이언트로 직접 회원가입/로그인을 처리하고, 발급받은
access_token을 이 백엔드 API 호출 시 'Authorization: Bearer <token>' 헤더로
실어 보냅니다. 이 모듈은 그 토큰을 검증해서 사용자 ID(sub)를 꺼내는 역할만 합니다.

SUPABASE_JWT_SECRET이 설정되어 있지 않으면(로컬 개발 등) 항상 로그인 안 한
상태(None)로 취급해서, 인증 없이도 기존 기능은 그대로 동작합니다.
"""
from typing import Optional

import jwt
from fastapi import Header

from app.config import get_settings

settings = get_settings()


def _decode_user_id(token: str) -> Optional[str]:
    if not settings.supabase_jwt_secret:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


async def get_optional_user_id(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    """
    로그인 상태면 사용자 ID(uuid 문자열)를, 로그인 안 했거나 토큰이 유효하지
    않으면 None을 반환합니다. 이 앱은 로그인을 강제하지 않으므로 절대 에러를
    던지지 않습니다 — 비로그인 사용자도 기존처럼 계속 쓸 수 있어야 합니다.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return _decode_user_id(token)
