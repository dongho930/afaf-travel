"""
홈 화면 '인기 여행지' 목록의 순서를 실제 사용자 활동으로 정하기 위한 배치 집계입니다.

지금까지 이 목록은 관광공사 areaBasedList2가 돌려주는 순서를 그대로 썼습니다.
그 API는 arrange 파라미터를 주지 않으면 제목순(가나다)으로 돌려주기 때문에,
'인기 여행지'인데 실제로는 '이름이 ㄱ으로 시작하는 곳'이 매번 같게 나왔습니다.

기준 지표는 region_popularity_service(도시 단위 인기도)와 똑같습니다 — 같은
활동을 놓고 도시로 묶느냐, 관광지 한 곳(content_id)으로 두느냐만 다릅니다.
최근 _LOOKBACK_DAYS일 이내 활동만 셉니다.
  - 리뷰 수 (place_reviews)
  - 게시물 수 (posts)
  - 저장된 코스 수 (courses.trip_id가 채워진 코스의 stops에 등장한 횟수)
  - 평균 평점 (리뷰 하나짜리 5점이 1위로 튀지 않도록 베이지안 가중평균으로 보정)

무거운 계산은 이 배치에서만 하고 결과를 place_popularity_daily에 통째로 다시
씁니다. 홈 화면은 이 테이블을 한 번 읽어 정렬에만 씁니다(read_place_popularity).
"""
import datetime

from app.config import get_settings
from app.services.db import execute as _execute

settings = get_settings()

_client = None
if settings.supabase_url and settings.supabase_service_key:
    from supabase import create_client

    _client = create_client(settings.supabase_url, settings.supabase_service_key)

_REVIEWS_TABLE = "place_reviews"
_POSTS_TABLE = "posts"
_COURSES_TABLE = "courses"
_POPULARITY_TABLE = "place_popularity_daily"

_LOOKBACK_DAYS = 14
# 베이지안 보정 강도 — 이 값(리뷰 개수)만큼은 "전체 평균" 쪽으로 끌어당깁니다.
# 장소 단위는 도시 단위보다 리뷰가 훨씬 적어서 이 보정이 특히 중요합니다.
_RATING_PRIOR_WEIGHT = 5
_WEIGHTS = {"review": 0.25, "post": 0.25, "save": 0.25, "rating": 0.25}


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


async def refresh_place_popularity() -> list[dict]:
    """
    최근 _LOOKBACK_DAYS일 활동을 다시 집계해서 place_popularity_daily 테이블을
    통째로 새로 씁니다. 활동이 있는 관광지만 담고, 계산된 전체 순위를 돌려줍니다.
    """
    if _client is None:
        return []

    cutoff = _since_iso(_LOOKBACK_DAYS)

    review_count: dict[str, int] = {}
    review_sum: dict[str, int] = {}
    try:
        reviews = (await _execute(
            _client.table(_REVIEWS_TABLE)
            .select("content_id, rating, created_at")
            .gte("created_at", cutoff)
        )).data or []
    except Exception as e:
        print(f"[place_popularity] 리뷰 조회 실패: {e}")
        reviews = []
    for r in reviews:
        content_id = r.get("content_id")
        if not content_id:
            continue
        review_count[content_id] = review_count.get(content_id, 0) + 1
        review_sum[content_id] = review_sum.get(content_id, 0) + (r.get("rating") or 0)

    post_count: dict[str, int] = {}
    try:
        posts = (await _execute(
            _client.table(_POSTS_TABLE)
            .select("content_id, created_at")
            .gte("created_at", cutoff)
        )).data or []
    except Exception as e:
        print(f"[place_popularity] 게시물 조회 실패: {e}")
        posts = []
    for p in posts:
        content_id = p.get("content_id")
        if not content_id:
            continue
        post_count[content_id] = post_count.get(content_id, 0) + 1

    save_count: dict[str, int] = {}
    try:
        courses = (await _execute(
            _client.table(_COURSES_TABLE)
            .select("stops, trip_id, created_at")
            .not_.is_("trip_id", "null")
            .gte("created_at", cutoff)
        )).data or []
    except Exception as e:
        print(f"[place_popularity] 저장된 코스 조회 실패: {e}")
        courses = []
    for c in courses:
        for stop in c.get("stops") or []:
            content_id = (stop.get("attraction") or {}).get("content_id")
            if not content_id:
                continue
            save_count[content_id] = save_count.get(content_id, 0) + 1

    all_ids = set(review_count) | set(post_count) | set(save_count)
    if not all_ids:
        # 아직 아무 활동도 없는 단계(서비스 초기)입니다. 예전 순위를 지우지 않고
        # 그대로 둡니다 — 조회가 잠깐 실패해서 빈 결과가 나온 경우와 구분할 수
        # 없는데, 멀쩡한 순위를 빈 테이블로 덮어쓰는 쪽이 훨씬 손해입니다.
        return []

    total_review_count = sum(review_count.values())
    total_review_sum = sum(review_sum.values())
    global_avg_rating = (total_review_sum / total_review_count) if total_review_count > 0 else 3.5

    bayesian_rating: dict[str, float] = {}
    for content_id in all_ids:
        v = review_count.get(content_id, 0)
        r = (review_sum.get(content_id, 0) / v) if v > 0 else 0.0
        m = _RATING_PRIOR_WEIGHT
        bayesian_rating[content_id] = (v / (v + m)) * r + (m / (v + m)) * global_avg_rating

    norm_review = _normalize({c: review_count.get(c, 0) for c in all_ids})
    norm_post = _normalize({c: post_count.get(c, 0) for c in all_ids})
    norm_save = _normalize({c: save_count.get(c, 0) for c in all_ids})
    norm_rating = _normalize(bayesian_rating)

    scored = []
    for content_id in all_ids:
        score = (
            _WEIGHTS["review"] * norm_review.get(content_id, 0.0)
            + _WEIGHTS["post"] * norm_post.get(content_id, 0.0)
            + _WEIGHTS["save"] * norm_save.get(content_id, 0.0)
            + _WEIGHTS["rating"] * norm_rating.get(content_id, 0.0)
        )
        v = review_count.get(content_id, 0)
        scored.append(
            {
                "content_id": content_id,
                "score": score,
                "review_count": v,
                "post_count": post_count.get(content_id, 0),
                "save_count": save_count.get(content_id, 0),
                "avg_rating": (review_sum.get(content_id, 0) / v) if v > 0 else None,
            }
        )
    scored.sort(key=lambda row: row["score"], reverse=True)
    for i, row in enumerate(scored, start=1):
        row["rank"] = i

    await _replace_cache_table(scored)
    return scored


async def _replace_cache_table(rows: list[dict]) -> None:
    if _client is None or not rows:
        return
    try:
        # 어제는 순위에 있었지만 오늘은 활동이 끊긴 곳이 남아있지 않도록, 매번
        # 테이블을 통째로 비우고 새로 씁니다(region_popularity_daily와 같은 방식).
        await _execute(_client.table(_POPULARITY_TABLE).delete().neq("content_id", "__never_matches__"))
        await _execute(_client.table(_POPULARITY_TABLE).insert(rows))
    except Exception as e:
        print(f"[place_popularity] 캐시 테이블 갱신 실패: {e}")


async def read_place_popularity() -> dict[str, float]:
    """
    홈 화면 목록 조회가 부르는 가벼운 읽기 — {content_id: 점수} 한 장을 돌려줍니다.
    활동이 있는 곳만 들어있어서(대개 수십~수백 건) 통째로 읽어도 부담이 없습니다.
    """
    if _client is None:
        return {}
    try:
        result = await _execute(
            _client.table(_POPULARITY_TABLE).select("content_id, score").order("rank")
        )
        return {row["content_id"]: float(row["score"]) for row in (result.data or [])}
    except Exception as e:
        print(f"[place_popularity] 인기 장소 조회 실패: {e}")
        return {}
