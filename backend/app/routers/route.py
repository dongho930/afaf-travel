"""
실제 도로/경로 기반 길찾기 라우터.

지원 모드:
- car     : 카카오모빌리티 길찾기 API (자동차)
- walk    : Tmap 보행자 경로 API (도보)
- transit : Tmap 대중교통 경로 API (대중교통)

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


def _linestring_to_path(linestring: str) -> list[list[float]]:
    """'경도,위도 경도,위도 ...' 문자열을 [[위도, 경도], ...]로 바꿉니다."""
    points: list[list[float]] = []
    for pair in linestring.split(" "):
        lng, _, lat = pair.partition(",")
        try:
            points.append([float(lat), float(lng)])
        except ValueError:
            continue
    return points


async def _get_transit_route(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> dict:
    """
    TMAP 대중교통 경로 API.

    예전에는 ODsay를 썼는데, ODsay의 Server 키는 '요청이 들어온 서버 IP'로
    사용자를 식별합니다. 그런데 Render의 공용 아웃바운드 IP는 리전 전체가
    공유하는 범위 안에서 그때그때 달라져서, 오늘 등록한 IP가 내일이면 달라지고
    인증이 계속 깨졌습니다. TMAP은 헤더의 appKey로만 인증해서 어디서 호출하든
    상관이 없고, 도보 경로에서 이미 같은 키를 쓰고 있습니다.
    """
    if not settings.tmap_app_key:
        raise HTTPException(status_code=500, detail="TMAP_APP_KEY가 설정되지 않았습니다.")

    url = "https://apis.openapi.sk.com/transit/routes"
    headers = {
        "Accept": "application/json",
        "appKey": settings.tmap_app_key,
        "Content-Type": "application/json",
    }
    # startX/endX가 경도, startY/endY가 위도입니다(도보 API와 같은 순서).
    body = {
        "startX": str(start_lng),
        "startY": str(start_lat),
        "endX": str(end_lng),
        "endY": str(end_lat),
        "count": 1,
        "lang": 0,
        "format": "json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"TMAP 대중교통 API 오류: {resp.status_code} {resp.text[:200]}"
        )

    data = resp.json()
    # 출발지와 도착지가 너무 가깝거나 대중교통이 닿지 않는 구간은 에러가 아니라
    # result.status로 옵니다. '경로 없음'으로 돌려줘야 앱이 도보나 자동차를
    # 대신 추천할 수 있습니다(예외로 던지면 그 구간이 통째로 비어버립니다).
    itineraries = ((data.get("metaData") or {}).get("plan") or {}).get("itineraries") or []
    if not itineraries:
        return _empty_result("transit")

    best = itineraries[0]

    path: list[list[float]] = []
    for leg in best.get("legs") or []:
        # 대중교통 구간의 좌표는 passShape에, 도보 구간의 좌표는 steps에 들어 있습니다.
        shape = (leg.get("passShape") or {}).get("linestring")
        if shape:
            path.extend(_linestring_to_path(shape))
            continue
        for step in leg.get("steps") or []:
            if step.get("linestring"):
                path.extend(_linestring_to_path(step["linestring"]))

    # 좌표가 하나도 없는 응답(환승 대기만 있는 짧은 구간 등)이면 최소한 두 끝점은
    # 이어 줍니다 — 지도에 선이 아예 안 그려지는 것보다는 낫습니다.
    if len(path) < 2:
        path = [[start_lat, start_lng], [end_lat, end_lng]]

    return {
        "mode": "transit",
        "distance_m": best.get("totalDistance"),
        "duration_sec": best.get("totalTime"),
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
