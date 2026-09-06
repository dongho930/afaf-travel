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
    # 기본값은 false입니다 — 예전엔 true라, Render 환경변수에서 USE_MOCK_DATA가
    # 빠지기만 해도 프로덕션이 목업 관광지 몇 곳을 실제 데이터인 양 서빙했습니다.
    # 서비스키가 없으면 어차피 목업으로 넘어갑니다(TourApiClient.use_mock).
    use_mock_data: bool = os.getenv("USE_MOCK_DATA", "false").lower() == "true"

    # 두 번째 관광공사 서비스키(선택).
    #
    # 공공데이터포털 개발계정 한도는 '활용신청(키)당' 하루 1,000건이라, 키를
    # 하나 더 등록하면 하루 예산이 그대로 두 배가 됩니다. 두 키 모두 같은
    # 서비스(KorWithService2 등)에 활용신청이 돼 있어야 의미가 있습니다.
    tour_api_key_2: str = os.getenv("TOUR_API_KEY_2", "")

    # 아래 세 예산은 모두 '키 하나당' 값입니다. 실제 하루 예산은 여기에 키
    # 개수를 곱한 값이고, 곱셈은 daily_* 프로퍼티가 합니다.
    #
    # detailWithTour2(편의시설) / detailCommon2(기본정보·소개문) /
    # detailIntro2(부가정보)는 키 하나의 같은 한도 1,000건을 나눠 씁니다.
    # 그래서 200 + 300 + 500 = 1,000으로 잡았습니다. 배분 근거:
    #   - 편의시설은 이미 1,247건이 다 캐시돼 신규 조회가 거의 없습니다 (200)
    #   - 소개문은 3분의 1쯤 비어 있습니다 (300)
    #   - 부가정보는 통째로 비어 있어 가장 급합니다 (500)
    # 운영계정으로 전환하면 환경변수로 더 큰 값을 넣으면 됩니다.
    tour_api_daily_fetch_budget: int = int(os.getenv("TOUR_API_DAILY_FETCH_BUDGET", "200"))

    # 관광지 집중률(TatsCnctrRateService) 전수조사용 일일 예산.
    # 이 API는 장소 단위가 아니라 시/군/구 단위로 한 번에 여러 관광지 정보를
    # 받아오기 때문에(경기도 전체가 시/군/구 약 44개), 무장애 정보보다 훨씬
    # 적은 호출 수로 끝납니다 — 그래도 별도 서비스라 별도 일일 한도가 있을 수
    # 있어 안전하게 예산을 둡니다.
    congestion_api_daily_fetch_budget: int = int(
        os.getenv("CONGESTION_API_DAILY_FETCH_BUDGET", "200")
    )

    # 소개문(detailCommon2) 미리 채우기용 일일 예산 — 키 하나당.
    overview_api_daily_fetch_budget: int = int(
        os.getenv("OVERVIEW_API_DAILY_FETCH_BUDGET", "300")
    )

    # 부가정보(detailIntro2, 이용시간·요금·주차 등) 미리 채우기용 일일 예산 —
    # 키 하나당. 지금 이 캐시는 상세 페이지를 연 곳만 채워져 있어서 가장 큽니다.
    intro_api_daily_fetch_budget: int = int(
        os.getenv("INTRO_API_DAILY_FETCH_BUDGET", "500")
    )

    # 연관 관광지(TarRlteTarService1) / 혼잡도 예보(TatsCnctrRateService) 미리
    # 채우기용 일일 예산 — 키 하나당. 둘 다 위 세 오퍼레이션과 다른 서비스라
    # 별도 한도를 쓰므로, 1,000건 배분에 포함되지 않습니다.
    #
    # 관광지 1,300건을 전부 채우면 매일 그만큼을 쓰게 되는데 상세 페이지를
    # 여는 곳은 일부뿐이라, 목록 앞쪽(홈 화면에 실제로 노출되는 순서) 200곳만
    # 미리 채웁니다. 캐시에 없는 곳은 같은 시군구·같은 카테고리로 대신 채웁니다.
    related_api_daily_fetch_budget: int = int(os.getenv("RELATED_API_DAILY_FETCH_BUDGET", "200"))
    forecast_api_daily_fetch_budget: int = int(os.getenv("FORECAST_API_DAILY_FETCH_BUDGET", "200"))

    @property
    def tour_api_key_pool(self) -> list[str]:
        """실제로 쓸 수 있는 서비스키 목록 (빈 값은 제외)."""
        return [k for k in (self.tour_api_key, self.tour_api_key_2) if k]

    @property
    def _key_count(self) -> int:
        return max(1, len(self.tour_api_key_pool))

    @property
    def daily_accessibility_budget(self) -> int:
        return self.tour_api_daily_fetch_budget * self._key_count

    @property
    def daily_overview_budget(self) -> int:
        return self.overview_api_daily_fetch_budget * self._key_count

    @property
    def daily_intro_budget(self) -> int:
        return self.intro_api_daily_fetch_budget * self._key_count

    @property
    def daily_related_budget(self) -> int:
        return self.related_api_daily_fetch_budget * self._key_count

    @property
    def daily_forecast_budget(self) -> int:
        return self.forecast_api_daily_fetch_budget * self._key_count

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
