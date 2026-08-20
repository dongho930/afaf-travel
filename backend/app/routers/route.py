"""
실제 도로/경로 기반 길찾기 라우터.

지원 모드:
- car     : 카카오모빌리티 길찾기 API (자동차)
- walk    : Tmap 보행자 경로 API (도보)
- transit : ODsay 길찾기 API (대중교통)

프론트엔드(모바일 앱 또는 /map-view)는 이 엔드포인트를 먼저 호출해서
실제 도로를 따라가는 좌표 배열(path)을 받은 뒤, 그 좌표로 지도에
Polyline을 그리면 됩니다. (직선 연결이 아니라 실제 길을 따라가는 경로)
"""
import httpx
from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings

router = APIRouter(tags=["route"])
settings = get_settings()


def _empty_result(mode: str) -> dict:
    return {"mode": mode, "distance_m": None, "duration_sec": None, "path": []}


async def _get_car_route(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> dict:
    """카카오모빌리티 길찾기 API (자동차)"""
    if not settings.kakao_rest_api_key:
        raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY가 설정되지 않았습니다.")

    url = "https://apis-navi.kakaomobility.com/v1/directions"
    headers = {"Authorization": f"KakaoAK {settings.kakao_rest_api_key}"}
    params = {
        "origin": f"{start_lng},{start_lat}",
        "destination": f"{end_lng},{end_lat}",
        "priority": "RECOMMEND",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=headers, params=params)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"카카오모빌리티 API 오류: {resp.status_code} {resp.text[:200]}")

    data = resp.json()
    routes = data.get("routes", [])
    if not routes:
        return _empty_result("car")

    route = routes[0]
    path: list[list[float]] = []
    for section in route.get("sections", []):
        for road in section.get("roads", []):
            vertexes = road.get("vertexes", [])
            # vertexes = [x1, y1, x2, y2, ...] (x=lng, y=lat)
            for i in range(0, len(vertexes) - 1, 2):
                lng, lat = vertexes[i], vertexes[i + 1]
                path.append([lat, lng])

    summary = route.get("summary", {})
    return {
        "mode": "car",
        "distance_m": summary.get("distance"),
        "duration_sec": summary.get("duration"),
        "path": path,
    }


async def _get_walk_route(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> dict:
    """Tmap 보행자 경로 API (도보)"""
    if not settings.tmap_app_key:
        raise HTTPException(status_code=500, detail="TMAP_APP_KEY가 설정되지 않았습니다.")

    url = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"
    headers = {
        "Accept": "application/json",
        "appKey": settings.tmap_app_key,
        "Content-Type": "application/json",
    }
    body = {
        "startX": str(start_lng),
        "startY": str(start_lat),
        "endX": str(end_lng),
        "endY": str(end_lat),
        "startName": "출발지",
        "endName": "도착지",
        "reqCoordType": "WGS84GEO",
        "resCoordType": "WGS84GEO",
        "searchOption": "0",
        "sort": "index",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Tmap API 오류: {resp.status_code} {resp.text[:200]}")

    data = resp.json()
    features = data.get("features", [])

    path: list[list[float]] = []
    total_distance = 0
    total_time = 0
    for feature in features:
        props = feature.get("properties", {})
        if "totalDistance" in props:
            total_distance = props.get("totalDistance", 0)
        if "totalTime" in props:
            total_time = props.get("totalTime", 0)

        geometry = feature.get("geometry", {})
        if geometry.get("type") == "LineString":
            for lng, lat in geometry.get("coordinates", []):
                path.append([lat, lng])
        elif geometry.get("type") == "Point" and not path:
            lng, lat = geometry.get("coordinates", [None, None])
            if lng is not None:
                path.append([lat, lng])

    return {
        "mode": "walk",
        "distance_m": total_distance or None,
        "duration_sec": total_time or None,
        "path": path,
    }


async def _get_transit_route(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> dict:
    """ODsay 길찾기 API (대중교통)"""
    if not settings.odsay_api_key:
        raise HTTPException(status_code=500, detail="ODSAY_API_KEY가 설정되지 않았습니다.")

    url = "https://api.odsay.com/v1/api/searchPubTransPathT"
    params = {
        "SX": start_lng,
        "SY": start_lat,
        "EX": end_lng,
        "EY": end_lat,
        "apiKey": settings.odsay_api_key,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ODsay API 오류: {resp.status_code} {resp.text[:200]}")

    data = resp.json()
    if "error" in data:
        # ODsay는 에러도 200으로 응답하며 error 필드에 메시지를 담습니다.
        err = data["error"]
        message = err[0].get("message") if isinstance(err, list) and err else str(err)
        raise HTTPException(status_code=502, detail=f"ODsay 응답 오류: {message}")

    result = data.get("result", {})
    paths = result.get("path", [])
    if not paths:
        return _empty_result("transit")

    # 가장 첫 번째(기본 추천) 경로를 사용
    best_path = paths[0]
    info = best_path.get("info", {})

    path: list[list[float]] = [[start_lat, start_lng]]
    for sub in best_path.get("subPath", []):
        pass_stops = sub.get("passStopList", {}).get("stations", [])
        if pass_stops:
            for st in pass_stops:
                try:
                    lat = float(st.get("y"))
                    lng = float(st.get("x"))
                    path.append([lat, lng])
                except (TypeError, ValueError):
                    continue
        else:
            # 도보 구간 등 상세 좌표가 없는 경우, 구간 시작/끝 좌표만 사용
            sx, sy = sub.get("startX"), sub.get("startY")
            ex, ey = sub.get("endX"), sub.get("endY")
            try:
                if sx is not None and sy is not None:
                    path.append([float(sy), float(sx)])
                if ex is not None and ey is not None:
                    path.append([float(ey), float(ex)])
            except (TypeError, ValueError):
                continue
    path.append([end_lat, end_lng])

    return {
        "mode": "transit",
        "distance_m": info.get("totalDistance"),
        "duration_sec": (info.get("totalTime") or 0) * 60 if info.get("totalTime") is not None else None,
        "path": path,
    }


@router.get("/route")
async def get_route(
    mode: str = Query(..., pattern="^(car|walk|transit)$", description="car | walk | transit"),
    start_lat: float = Query(...),
    start_lng: float = Query(...),
    end_lat: float = Query(...),
    end_lng: float = Query(...),
):
    """
    실제 도로/경로를 따라가는 좌표 배열을 반환합니다.
    응답: {"mode": ..., "distance_m": ..., "duration_sec": ..., "path": [[lat, lng], ...]}
    """
    if mode == "car":
        return await _get_car_route(start_lat, start_lng, end_lat, end_lng)
    if mode == "walk":
        return await _get_walk_route(start_lat, start_lng, end_lat, end_lng)
    return await _get_transit_route(start_lat, start_lng, end_lat, end_lng)
