"""
홈 화면 '인기 여행지' 지역 칩을 하드코딩된 5개 도시 대신, 최근 사용자 활동을
기준으로 매일 다시 계산한 상위 5개 도시로 보여주기 위한 배치 집계입니다.

기준 지표 4가지(전부 최근 _LOOKBACK_DAYS일 이내 활동만 집계):
  - 리뷰 수 (place_reviews)
  - 게시물 수 (posts)
  - 저장된 코스 수 (courses.trip_id가 채워진, 즉 실제로 '여행'에 저장된 코스의
    stops 안에 등장한 관광지 수 — 코스 하나에 여러 장소가 들어있으면 각 장소가
    속한 도시에 1씩 더합니다)
  - 평균 평점 (place_reviews.rating, 리뷰가 적은 도시가 우연히 5점 하나로
    1위가 되지 않도록 베이지안 가중평균으로 보정)

각 관광지(content_id)가 어느 도시(시/군/구가 아니라 '시' 단위로 묶음, 예:
'수원시 팔달구'와 '수원시 영통구'는 둘 다 '수원시')에 속하는지는 주소 문자열로
판단합니다. 주소는 리뷰/게시물/코스 테이블에 없어서, 이미 홈 화면 목록 조회가
채워둔 attraction_list_cache(카테고리별 관광지 목록 캐시)에서 content_id →
address 매핑을 만들어 씁니다.

무거운 계산은 이 배치(refresh_region_popularity)에서만 하고, 결과는
region_popularity_daily 테이블에 통째로 다시 씁니다. 홈 화면은 이 테이블에서
rank 순으로 상위 N개만 읽는 가벼운 조회만 합니다(read_region_popularity).
"""
import datetime

from app.config import get_settings
from app.services.sigungu_codes import find_area_signgu, signgu_name
from app.services.supabase_service import get_cached_attraction_list

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_REVIEWS_TABLE = "place_reviews"
_POSTS_TABLE = "posts"
_COURSES_TABLE = "courses"
_POPULARITY_TABLE = "region_popularity_daily"

_LOOKBACK_DAYS = 14
# 베이지안 가중평점 보정 강도 — 이 값(리뷰 개수) 만큼은 "전체 평균" 쪽으로
# 끌어당깁니다. 리뷰 1~2개짜리 도시가 우연히 5점이어도 1위로 튀지 않게 하기 위함.
_RATING_PRIOR_WEIGHT = 5
_WEIGHTS = {"review": 0.25, "post": 0.25, "save": 0.25, "rating": 0.25}
# 실제 활동 데이터가 5곳이 안 될 때(서비스 초기라 데이터가 적을 때) 나머지
# 자리를 채우는 기본 후보들 — 예전에 하드코딩돼 있던 5개 도시와 동일합니다.
_FALLBACK_CITIES = ["수원", "용인", "성남", "고양", "안양"]
# 실제 데이터 기반 지역 조회에 쓰는 시/도 — 이 앱은 경기도만 다룹니다.
_LDONG_REGN_CD = "41"
_DEFAULT_CONTENT_TYPE_IDS = [12, 39, 14, 28, 32]


def _strip_city_suffix(city_full: str) -> str:
    """'수원시' -> '수원', '가평군' -> '가평'. 화면에 보여줄 짧은 이름으로 바꿉니다."""
    if city_full.endswith("시") or city_full.endswith("군"):
        return city_full[:-1]
    return city_full


async def _build_content_id_to_city_map() -> dict[str, str]:
    """
    content_id -> 도시 이름('수원시' 등, 접미사 포함 원형) 매핑을 만듭니다.
    홈 화면이 이미 채워둔 attraction_list_cache(카테고리별 목록 캐시)를 그대로
    읽어 쓰므로, 이 배치 때문에 관광공사 API를 새로 호출하지 않습니다. 캐시가
    없거나 오래됐으면(get_cached_attraction_list가 None) 그 카테고리는 그냥
    건너뜁니다 — 다음 홈 화면 조회가 캐시를 채우면 다음 배치부터 반영됩니다.
    """
    mapping: dict[str, str] = {}
    for content_type_id in _DEFAULT_CONTENT_TYPE_IDS:
        items = await get_cached_attraction_list(_LDONG_REGN_CD, content_type_id)
        if not items:
            continue
        for item in items:
            content_id = item.get("content_id")
            address = item.get("address")
            if not content_id or not address or content_id in mapping:
                continue
            area_signgu = find_area_signgu(address)
            if not area_signgu:
                continue
            signgu_nm = signgu_name(area_signgu[1])
            if not signgu_nm:
                continue
            mapping[content_id] = signgu_nm.split(" ")[0]
    return mapping


def _normalize(values: dict[str, float]) -> dict[str, float]:
    """min-max 정규화로 0~1 범위로 맞춥니다. 값이 다 같으면(구분 안 됨) 전부 0."""
    if not values:
        return {}
    lo, hi = min(values.values()), max(values.values())
    if hi <= lo:
        return {k: 0.0 for k in values}
    return {k: (v - lo) / (hi - lo) for k, v in values.items()}


def _since_iso(days: int) -> str:
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    return cutoff.isoformat()


async def refresh_region_popularity(limit: int = 5) -> list[dict]:
    """
    최근 _LOOKBACK_DAYS일 활동을 다시 집계해서 region_popularity_daily 테이블을
    통째로 새로 씁니다. 계산된 전체 순위(활동이 있는 도시 전부, 부족하면 기본
    후보로 채워 최소 limit개)를 그대로 반환합니다.
    """
    if _client is None:
        return []

    city_map = await _build_content_id_to_city_map()
    cutoff = _since_iso(_LOOKBACK_DAYS)

    review_count: dict[str, int] = {}
    review_sum: dict[str, int] = {}
    try:
        reviews = (
            _client.table(_REVIEWS_TABLE)
            .select("content_id, rating, created_at")
            .gte("created_at", cutoff)
            .execute()
        ).data or []
    except Exception as e:
        print(f"[region_popularity] 리뷰 조회 실패: {e}")
        reviews = []
    for r in reviews:
        city = city_map.get(r.get("content_id"))
        if not city:
            continue
        review_count[city] = review_count.get(city, 0) + 1
        review_sum[city] = review_sum.get(city, 0) + (r.get("rating") or 0)

    post_count: dict[str, int] = {}
    try:
        posts = (
            _client.table(_POSTS_TABLE)
            .select("content_id, created_at")
            .gte("created_at", cutoff)
            .execute()
        ).data or []
    except Exception as e:
        print(f"[region_popularity] 게시물 조회 실패: {e}")
        posts = []
    for p in posts:
        city = city_map.get(p.get("content_id"))
        if not city:
            continue
        post_count[city] = post_count.get(city, 0) + 1

    save_count: dict[str, int] = {}
    try:
        courses = (
            _client.table(_COURSES_TABLE)
            .select("stops, trip_id, created_at")
            .not_.is_("trip_id", "null")
            .gte("created_at", cutoff)
            .execute()
        ).data or []
    except Exception as e:
        print(f"[region_popularity] 저장된 코스 조회 실패: {e}")
        courses = []
    for c in courses:
        for stop in c.get("stops") or []:
            content_id = (stop.get("attraction") or {}).get("content_id")
            city = city_map.get(content_id)
            if not city:
                continue
            save_count[city] = save_count.get(city, 0) + 1

    all_cities = set(review_count) | set(post_count) | set(save_count)
    if not all_cities:
        return await _save_fallback_only(limit)

    total_review_count = sum(review_count.values())
    total_review_sum = sum(review_sum.values())
    global_avg_rating = (total_review_sum / total_review_count) if total_review_count > 0 else 3.5

    bayesian_rating: dict[str, float] = {}
    for city in all_cities:
        v = review_count.get(city, 0)
        r = (review_sum.get(city, 0) / v) if v > 0 else 0.0
        m = _RATING_PRIOR_WEIGHT
        bayesian_rating[city] = (v / (v + m)) * r + (m / (v + m)) * global_avg_rating

    norm_review = _normalize({c: review_count.get(c, 0) for c in all_cities})
    norm_post = _normalize({c: post_count.get(c, 0) for c in all_cities})
    norm_save = _normalize({c: save_count.get(c, 0) for c in all_cities})
    norm_rating = _normalize(bayesian_rating)

    scored = []
    for city in all_cities:
        score = (
            _WEIGHTS["review"] * norm_review.get(city, 0.0)
            + _WEIGHTS["post"] * norm_post.get(city, 0.0)
            + _WEIGHTS["save"] * norm_save.get(city, 0.0)
            + _WEIGHTS["rating"] * norm_rating.get(city, 0.0)
        )
        v = review_count.get(city, 0)
        scored.append(
            {
                "city_name": _strip_city_suffix(city),
                "score": score,
                "review_count": v,
                "post_count": post_count.get(city, 0),
                "save_count": save_count.get(city, 0),
                "avg_rating": (review_sum.get(city, 0) / v) if v > 0 else None,
            }
        )
    scored.sort(key=lambda row: row["score"], reverse=True)

    # 실제 활동 데이터가 limit개보다 적으면(서비스 초기), 기본 후보 도시로
    # 나머지 자리를 채웁니다 — 홈 화면 칩이 너무 휑하게 몇 개만 뜨지 않도록.
    existing_names = {row["city_name"] for row in scored}
    for fallback in _FALLBACK_CITIES:
        if len(scored) >= limit:
            break
        if fallback in existing_names:
            continue
        scored.append(
            {
                "city_name": fallback,
                "score": 0.0,
                "review_count": 0,
                "post_count": 0,
                "save_count": 0,
                "avg_rating": None,
            }
        )
        existing_names.add(fallback)

    for i, row in enumerate(scored, start=1):
        row["rank"] = i

    await _replace_cache_table(scored)
    return scored[:limit]


async def _save_fallback_only(limit: int) -> list[dict]:
    """활동 데이터가 전혀 없을 때(서비스 첫날 등) 기본 후보만으로 테이블을 채웁니다."""
    scored = [
        {
            "city_name": name,
            "rank": i,
            "score": 0.0,
            "review_count": 0,
            "post_count": 0,
            "save_count": 0,
            "avg_rating": None,
        }
        for i, name in enumerate(_FALLBACK_CITIES[:limit], start=1)
    ]
    await _replace_cache_table(scored)
    return scored


async def _replace_cache_table(rows: list[dict]) -> None:
    if _client is None or not rows:
        return
    try:
        # 어제 순위에는 있었지만 오늘은 밀려난 도시가 남아있지 않도록, 매번
        # 테이블을 통째로 비우고 새로 씁니다(city_name이 PK라 실제 존재하지
        # 않을 값으로 neq를 걸어 '전부'를 지우는 흔한 방식).
        _client.table(_POPULARITY_TABLE).delete().neq("city_name", "__never_matches__").execute()
        _client.table(_POPULARITY_TABLE).insert(rows).execute()
    except Exception as e:
        print(f"[region_popularity] 캐시 테이블 갱신 실패: {e}")


async def read_region_popularity(limit: int = 5) -> list[dict]:
    """홈 화면이 부르는 가벼운 조회 — 캐시 테이블에서 rank 순 상위 N개만 읽습니다."""
    if _client is None:
        return []
    try:
        result = (
            _client.table(_POPULARITY_TABLE)
            .select("city_name, rank, score, review_count, post_count, save_count, avg_rating")
            .order("rank")
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"[region_popularity] 인기 지역 조회 실패: {e}")
        return []
