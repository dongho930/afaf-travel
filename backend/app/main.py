import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.routers import account, courses, map_view, posts, reports, reviews, route, tourism
from app.services.supabase_service import CacheUnavailable

app = FastAPI(
    title="무장애 여행 플래너 API",
    description="관광약자 맞춤형 AI 여행 코스 생성 백엔드 (모바일 앱용)",
    version="0.1.0",
)

# 모바일 앱(Expo dev server 등)에서의 접근을 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 배포 시 실제 앱 도메인/스킴으로 제한 권장
    allow_methods=["*"],
    allow_headers=["*"],
)

# 관광지 목록/소개문처럼 덩치가 큰 JSON 응답을 압축해서 보냅니다. 모바일 네트워크
# 에서는 내려받는 양이 그대로 대기 시간이라, 텍스트가 대부분인 이 응답들은 압축
# 만으로도 눈에 띄게 빨라집니다. 작은 응답은 압축해봐야 이득이 없어서
# minimum_size(1KB) 미만은 그대로 보냅니다.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# 브라우저와 앱의 네트워크 계층이 같은 응답을 잠깐 재사용하도록 Cache-Control을
# 붙입니다. 관광 데이터는 GitHub Actions가 하루 한 번 갱신하는 캐시에서 읽는 것이라,
# 화면을 다시 열 때마다 서버까지 왕복할 필요가 없습니다.
#
# 시간은 그 데이터가 실제로 바뀌는 주기에 맞췄습니다.
#   - 시/군/구 목록: 코드에 박힌 고정 표라 하루.
#   - 소개문·부가정보·혼잡도·무장애 통계·연관 관광지·지역 인기도: 하루 한 번
#     갱신되는 캐시 테이블이라 1시간.
#   - 관광지 목록·검색·상세·주변: 우리 DB의 평점/리뷰 수가 섞여 있어서 5분. 목록은
#     서버도 이미 5분간 재사용하므로(_ATTRACTIONS_CACHE) 이보다 더 낡아지지 않습니다.
# stale-while-revalidate는 기한이 지난 응답을 일단 바로 보여주고 뒤에서 새로 받아오게
# 합니다(지원하는 브라우저에서만 — 나머지는 max-age만 따릅니다).
#
# 성공(200)한 GET에만 붙입니다 — 503(잠시 불가) 같은 실패를 붙잡아두면 회복된 뒤에도
# 한동안 실패 화면이 보입니다. */refresh는 GitHub Actions가 매번 실제로 갱신하라고
# 부르는 것이라 목록에 넣지 않습니다. 로그인한 사용자별 응답(내 여행·리뷰 등)도
# 넣지 않습니다.
_DAY = "max-age=86400"
_HOURLY = "max-age=3600, stale-while-revalidate=86400"
_SHORT = "max-age=300, stale-while-revalidate=600"
_CACHE_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^/api/tourism/regions$"), _DAY),
    (re.compile(r"^/api/tourism/attractions/(overviews|extra-info)$"), _HOURLY),
    (re.compile(r"^/api/tourism/attractions/search$"), _SHORT),
    (re.compile(r"^/api/tourism/attractions/[^/]+/(congestion|related)$"), _HOURLY),
    (re.compile(r"^/api/tourism/attractions/[^/]+/nearby$"), _SHORT),
    (re.compile(r"^/api/tourism/attractions(/[^/]+)?$"), _SHORT),
    (re.compile(r"^/api/tourism/(accessibility-summary|accessibility-places|region-popularity)$"), _HOURLY),
]


def _cache_control_for(path: str) -> str | None:
    for pattern, value in _CACHE_RULES:
        if pattern.match(path):
            return value
    return None


@app.middleware("http")
async def add_cache_control(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and "cache-control" not in response.headers:
        value = _cache_control_for(request.url.path)
        if value:
            response.headers["Cache-Control"] = value
    return response

app.include_router(tourism.router)
app.include_router(courses.router)
app.include_router(map_view.router)
app.include_router(route.router)
app.include_router(account.router)
app.include_router(reviews.router)
app.include_router(reports.router)
app.include_router(posts.router)


@app.exception_handler(CacheUnavailable)
async def cache_unavailable_handler(request: Request, exc: CacheUnavailable) -> JSONResponse:
    """
    캐시 테이블을 읽지 못했을 때의 응답.

    500(서버 오류)이 아니라 503(잠시 불가)으로 답합니다 — 저장된 데이터는 멀쩡하고
    잠깐 못 읽었을 뿐이라, 앱이 조금 뒤에 다시 물어보면 되는 상황입니다. 무엇보다
    이 예외가 여기까지 왔다는 건 "못 읽은 김에 다시 계산해서 덮어쓰는" 일을 하지
    않고 멈췄다는 뜻입니다 — 무장애 여행지 수가 1232에서 539로 떨어진 그 경로입니다.
    """
    print(f"[main] 캐시를 읽지 못해 503으로 응답합니다 ({request.url.path}): {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": "데이터를 잠시 불러올 수 없어요. 잠시 후 다시 시도해 주세요."},
    )


@app.get("/health")
async def health_check():
    return {"status": "ok"}
