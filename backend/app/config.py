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

    # Groq API (AI 코스 생성) — https://console.groq.com 에서 무료로 발급 가능
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

    # 카카오맵 (모바일 앱에서 직접 사용하지만, 서버측 길찾기 API 호출 시 사용)
    kakao_rest_api_key: str = os.getenv("KAKAO_REST_API_KEY", "")
    # 카카오맵 JavaScript 키 — 서버가 지도 페이지(/map-view)를 직접 내려줄 때도 필요합니다.
    kakao_js_key: str = os.getenv("KAKAO_JS_KEY", "")

    # Tmap (SK Open API) — 보행자(도보) 실제 경로 안내
    tmap_app_key: str = os.getenv("TMAP_APP_KEY", "")

    # ODsay — 대중교통 실제 경로 안내 (Server 키 사용)
    odsay_api_key: str = os.getenv("ODSAY_API_KEY", "")

    # Supabase (PostgreSQL)
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    # Supabase Auth가 발급하는 로그인 토큰(JWT)을 검증할 때 씁니다.
    # Supabase 대시보드 → Project Settings → API → JWT Settings → "JWT Secret"
    supabase_jwt_secret: str = os.getenv("SUPABASE_JWT_SECRET", "")

    # 개발 편의를 위한 모드 플래그: 실제 키가 없을 때는 목업 데이터로 동작
    use_mock_data: bool = os.getenv("USE_MOCK_DATA", "true").lower() == "true"

    # 무장애 정보(detailWithTour2) 전수조사용 일일 예산.
    # 지금 발급받은 키가 '개발계정'이라 하루 트래픽 한도가 1,000건입니다.
    # 이 한도는 소개문(overview_api_daily_fetch_budget)과 공유되므로, 둘을
    # 합쳐서 1,000을 넘지 않도록 절반씩(500/500) 나눠 잡았습니다. 운영계정으로
    # 전환하면 TOUR_API_DAILY_FETCH_BUDGET 환경변수로 더 큰 값(예: 90000)을
    # 넣어주면 됩니다.
    tour_api_daily_fetch_budget: int = int(os.getenv("TOUR_API_DAILY_FETCH_BUDGET", "500"))

    # 관광지 집중률(TatsCnctrRateService) 전수조사용 일일 예산.
    # 이 API는 장소 단위가 아니라 시/군/구 단위로 한 번에 여러 관광지 정보를
    # 받아오기 때문에(경기도 전체가 시/군/구 약 44개), 무장애 정보보다 훨씬
    # 적은 호출 수로 끝납니다 — 그래도 별도 서비스라 별도 일일 한도가 있을 수
    # 있어 안전하게 예산을 둡니다.
    congestion_api_daily_fetch_budget: int = int(
        os.getenv("CONGESTION_API_DAILY_FETCH_BUDGET", "200")
    )

    # 홈 화면 소개문 미리 채우기(예열)용 일일 예산. detailCommon2도 무장애 정보와
    # 같은 일일 한도(1,000건)를 공유하므로, tour_api_daily_fetch_budget과 합쳐서
    # 1,000을 넘지 않도록 절반씩(500/500) 나눠 잡았습니다.
    overview_api_daily_fetch_budget: int = int(
        os.getenv("OVERVIEW_API_DAILY_FETCH_BUDGET", "500")
    )

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
