from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.services.auth import get_optional_user_id
from app.services.profile_service import create_profile, get_profile_by_user_id, resolve_login_email

router = APIRouter(prefix="/api/account", tags=["account"])


class ResolveLoginEmailRequest(BaseModel):
    identifier: str  # 이메일 또는 아이디


class ResolveLoginEmailResponse(BaseModel):
    email: str


class CreateProfileRequest(BaseModel):
    user_id: str
    username: str
    email: str


@router.post("/resolve-login-email", response_model=ResolveLoginEmailResponse)
async def resolve_login_email_endpoint(request: ResolveLoginEmailRequest):
    """
    로그인 화면에서 입력한 값(이메일 또는 아이디)을 실제 이메일로 변환합니다.
    Supabase Auth 로그인 자체는 이메일로만 되기 때문에, 아이디를 입력했을 때
    이 엔드포인트로 먼저 이메일을 찾은 뒤 그 값으로 로그인 요청을 보내면 됩니다.
    """
    email = await resolve_login_email(request.identifier)
    if not email:
        raise HTTPException(status_code=404, detail="일치하는 계정을 찾을 수 없어요.")
    return ResolveLoginEmailResponse(email=email)


@router.post("/profile")
async def create_profile_endpoint(request: CreateProfileRequest):
    """
    회원가입(Supabase Auth 계정 생성) 직후 호출해서 아이디(username)를 등록합니다.
    이메일 인증이 아직 끝나지 않아 로그인 세션이 없는 상태에서도 호출할 수 있도록,
    인증 없이 열려있는 엔드포인트입니다 (user_id는 방금 signUp 응답에서 받은 값 사용).
    """
    ok, message = await create_profile(request.user_id, request.username, request.email)
    if not ok:
        raise HTTPException(status_code=409, detail=message)
    return {"ok": True}


@router.get("/profile/me")
async def get_my_profile(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자의 프로필(아이디 등)을 조회합니다. 비로그인이면 null."""
    if not user_id:
        return None
    return await get_profile_by_user_id(user_id)
