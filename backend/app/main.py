from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.routers import account, courses, map_view, posts, reports, reviews, route, tourism

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


@app.get("/health")
async def health_check():
    return {"status": "ok"}
