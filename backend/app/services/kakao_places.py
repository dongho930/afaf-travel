"""관광공사 목록에 없는 음식점을 카카오 로컬에서 찾습니다.

카카오 장소 검색은 휠체어 접근성 정보를 제공하지 않으므로, 여기서 만든 장소는
항상 접근성 미확인으로 취급합니다.
"""

import logging
from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.models.schemas import Attraction

logger = logging.getLogger(__name__)
_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"


async def search_kakao_restaurants(query: str, limit: int = 15) -> list[Attraction]:
    key = get_settings().kakao_rest_api_key
    if not key or not query.strip():
        return []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                _ENDPOINT,
                headers={"Authorization": f"KakaoAK {key}"},
                params={"query": query.strip(), "category_group_code": "FD6", "size": min(limit, 15)},
            )
            response.raise_for_status()
            documents = response.json().get("documents", [])
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("카카오 음식점 검색 실패: %s", exc)
        return []

    places: list[Attraction] = []
    for item in documents:
        try:
            place_id = str(item["id"])
            raw_url = str(item["place_url"])
            parsed_url = urlparse(raw_url)
            if parsed_url.hostname != "place.map.kakao.com" or parsed_url.scheme not in ("http", "https"):
                continue
            url = f"https://place.map.kakao.com/{place_id}"
            places.append(Attraction(
                content_id=f"kakao:{place_id}",
                name=str(item["place_name"]),
                address=str(item.get("road_address_name") or item.get("address_name") or ""),
                latitude=float(item["y"]),
                longitude=float(item["x"]),
                category="음식점",
                data_source="kakao",
                external_url=url,
            ))
        except (KeyError, ValueError, TypeError):
            continue
    return places
