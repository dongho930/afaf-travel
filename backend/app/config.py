"""
환경설정 모듈
- 모든 외부 API 키는 .env 파일 (또는 배포 환경의 시크릿 매니저)에서 로드합니다.
- 클라이언트(모바일 앱)에는 어떤 키도 노출되지 않고, 반드시 이 백엔드를 프록시로 경유합니다.
"""
import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 한국관광공사 OpenAPI
    tour_api_key: str = os.getenv("TOUR_API_KEY", "")
    tour_api_base_url: str = "http://apis.data.go.kr/B551011"

    # Claude API (AI 코스 생성)
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    # 카카오맵 (모바일 앱에서 직접 사용하지만, 서버측 길찾기 API 호출 시 사용)
    kakao_rest_api_key: str = os.getenv("KAKAO_REST_API_KEY", "")

    # Supabase (PostgreSQL)
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")

    # 개발 편의를 위한 모드 플래그: 실제 키가 없을 때는 목업 데이터로 동작
    use_mock_data: bool = os.getenv("USE_MOCK_DATA", "true").lower() == "true"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
