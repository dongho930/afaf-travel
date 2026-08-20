from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import account, courses, map_view, route, tourism

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

app.include_router(tourism.router)
app.include_router(courses.router)
app.include_router(map_view.router)
app.include_router(route.router)
app.include_router(account.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
