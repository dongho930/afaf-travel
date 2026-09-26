"""스냅샷 파일을 읽어, 추천 흐름이 쓰는 캐시 조회 함수를 스냅샷으로 바꿔 끼웁니다."""
from __future__ import annotations

import json
from pathlib import Path

from app.services import ai_service, place_popularity_service, query_preferences, review_service, tour_api


def _load(folder: Path, name: str) -> list[dict]:
    path = folder / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


class Snapshot:
    def __init__(self, folder: str | Path):
        folder = Path(folder)
        self.lists: dict[int, list[dict]] = {
            int(r["content_type_id"]): r.get("items") or []
            for r in _load(folder, "attraction_list_cache")
        }
        self.accessibility = {r["content_id"]: r for r in _load(folder, "place_accessibility_cache")}
        self.overviews = {r["content_id"]: r.get("overview") or "" for r in _load(folder, "attraction_overview_cache")}
        self.intro = {r["content_id"]: r for r in _load(folder, "attraction_intro_cache")}
        self.congestion: dict[tuple[int, str], dict] = {
            (int(r["signgu_cd"]), r["tats_nm"]): r for r in _load(folder, "congestion_cache")
        }
        self.popularity = {r["content_id"]: float(r.get("score") or 0) for r in _load(folder, "place_popularity_daily")}

    def install(self, monkeypatch) -> None:
        """monkeypatch는 pytest의 것이든 eval.run의 간이 구현이든 setattr만 있으면 됩니다."""
        snap = self

        async def attraction_list(_ldong, content_type_id, max_age_hours=24.0):
            return snap.lists.get(int(content_type_id))

        async def place_accessibility(ids):
            return {i: snap.accessibility[i] for i in ids if i in snap.accessibility}

        async def overview_texts(ids):
            return {i: snap.overviews[i] for i in ids if i in snap.overviews}

        async def intro_batch(ids):
            return {i: snap.intro[i] for i in ids if i in snap.intro}

        async def intro_one(content_id):
            return snap.intro.get(content_id)

        async def congestion(signgu_cds):
            wanted = set(signgu_cds)
            return {k: v for k, v in snap.congestion.items() if k[0] in wanted}

        async def popularity():
            return dict(snap.popularity)

        async def no_ratings(_ids):
            return {}  # 리뷰는 사용자 데이터라 스냅샷에 넣지 않습니다

        async def nothing(*_args, **_kwargs):
            return {}

        # 로컬 .env에 운영 Supabase 키가 있어도 평가는 절대 운영 DB에 닿지 않게 합니다.
        import importlib
        for module_name in ("supabase_service", "place_popularity_service", "review_service",
                            "post_service", "report_service", "region_popularity_service",
                            "profile_service", "selection_log_service"):
            try:
                module = importlib.import_module(f"app.services.{module_name}")
            except ImportError:
                continue
            if hasattr(module, "_client"):
                monkeypatch.setattr(module, "_client", None)
        monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)
        monkeypatch.setattr(tour_api, "get_cached_attraction_list", attraction_list)
        monkeypatch.setattr(tour_api, "get_cached_place_accessibility", place_accessibility)
        monkeypatch.setattr(tour_api, "get_cached_overviews", overview_texts)
        monkeypatch.setattr(tour_api, "get_cached_intro_info_batch", intro_batch)
        monkeypatch.setattr(tour_api, "get_cached_intro_info", intro_one)
        monkeypatch.setattr(tour_api, "get_cached_congestion_rates", congestion)
        monkeypatch.setattr(tour_api, "get_cached_forecast", nothing)
        monkeypatch.setattr(tour_api, "get_average_ratings", no_ratings)
        monkeypatch.setattr(tour_api, "read_place_popularity", popularity)
        monkeypatch.setattr(place_popularity_service, "read_place_popularity", popularity)
        monkeypatch.setattr(review_service, "get_average_ratings", no_ratings)
        monkeypatch.setattr(query_preferences, "get_cached_overview_texts", overview_texts)
        # 실시간 조회 경로는 막습니다 (캐시에 없으면 없는 대로 평가합니다).
        monkeypatch.setattr(tour_api.TourApiClient, "_fetch_all_by_content_type", _no_live)
        monkeypatch.setattr(tour_api.TourApiClient, "_fetch_accessibility", _no_live_accessibility)
        monkeypatch.setattr(tour_api.TourApiClient, "_fetch_intro_info", _no_live_intro)
        tour_api._REGION_ATTRACTIONS_CACHE._entries.clear()
        ai_service._PARSE_CACHE._entries.clear()
        query_preferences._OVERVIEW_TAGS.clear()


async def _no_live(*_args, **_kwargs):
    return []


async def _no_live_accessibility(*_args, **_kwargs):
    return tour_api.AccessibilityFeatures(), False


async def _no_live_intro(*_args, **_kwargs):
    return {}
