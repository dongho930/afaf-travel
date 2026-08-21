"""
Supabase Auth 로그인 토큰(JWT) 검증.

모바일 앱은 Supabase 클라이언트로 직접 회원가입/로그인을 처리하고, 발급받은
access_token을 이 백엔드 API 호출 시 'Authorization: Bearer <token>' 헤더로
실어 보냅니다. 이 모듈은 그 토큰을 검증해서 사용자 ID(sub)를 꺼내는 역할만 합니다.

Supabase가 2025년부터 로그인 토큰 서명 방식을 바꿨습니다:
- 예전(레거시): 고정된 비밀키(SUPABASE_JWT_SECRET)로 서명하는 HS256
- 최신: 프로젝트의 JWKS 엔드포인트(공개키)로 검증하는 비대칭 서명(ES256/RS256)

새 프로젝트는 기본적으로 최신 방식을 쓰기 때문에, 토큰 헤더의 alg 값을 보고
HS256이면 고정 비밀키로, 그 외(ES256 등)면 JWKS에서 공개키를 받아와 검증합니다.
"""
from typing import Optional

import jwt
from fastapi import Header
from jwt import PyJWKClient

from app.config import get_settings

settings = get_settings()

_jwks_client: Optional[PyJWKClient] = None
if settings.supabase_url:
    _jwks_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


def _decode_user_id(token: str) -> Optional[str]:
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            # 레거시 방식: 고정 비밀키로 서명된 토큰
            if not settings.supabase_jwt_secret:
                return None
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            # 최신 방식: 프로젝트 JWKS 엔드포인트에서 공개키를 받아와 검증
            if _jwks_client is None:
                return None
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
            )
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
    except Exception:
        # JWKS 조회 실패 등 예상 못한 오류도 로그인 안 한 것으로 안전하게 처리
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
