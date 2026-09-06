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
