"""
AI 플래너 2단계(고른 장소로 코스 만들기) 품질 평가.

    python -m eval.course_eval --snapshot <폴더> [--ai] [--pick 5] [--out results.json]

질의마다 1단계 추천을 받고, 사람이 고를 법하게 위쪽 --pick곳을 고릅니다. 식사를
요청한 질의면 식당이 하나는 들어가게 합니다. 그 장소들로 코스를 만들어 봅니다.
GROQ_API_KEY가 있고 --ai면 순서도 실제 AI가 정합니다 (질의당 AI 호출 2~3번).

지표 (기준값은 서비스 코드의 값을 그대로 씁니다 — schedule.py, course_validator.py)
  - 누락: 고른 장소가 코스에서 빠졌는가
  - 동선 비율: 코스 순서의 이동 거리 ÷ 같은 장소들의 가장 짧은 순서 (1.0이 최선)
  - 꼬임: 이동 경로가 스스로 교차하는 곳 수 (왔다 갔다 하는 동선)
  - 영업 종료 뒤 도착: 문 닫는 시각 이후에 도착하는 장소 수
  - 휴무: 방문일에 쉬는 장소 수
  - 식사 시간: 식사 가능한 식당이 점심(11~14시)·저녁(17~20시)에 오는 비율
  - 식당 연속: 식당·카페가 바로 이어지는 곳 수
  - 하루 초과: 20시 넘어 하루에 다 못 도는 코스
  - 설명 오류: 등록 안 된 편의시설을 근거로 든 설명 수 (검증기가 이미 거르므로 0이어야 정상)
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import random
import statistics
import sys
from dataclasses import asdict, dataclass, field

from fastapi import HTTPException

from app.models.schemas import Attraction, GenerateFromSelectionRequest, PlaceRecommendationRequest, UserType
from app.routers import courses
from app.services import ai_service
from app.services.course_validator import _FACILITY_WORDS
from app.services.place_intent import may_serve_meal, venue_constraint_for_query
from app.services.schedule import meal_window_at, straight_distance_km
from eval.queries import QUERIES, EvalQuery
from eval.run import _Patch
from eval.snapshot import Snapshot


@dataclass
class CourseResult:
    id: str
    text: str
    error: str | None = None
    picked: list[str] = field(default_factory=list)
    order: list[str] = field(default_factory=list)
    arrivals: list[str] = field(default_factory=list)
    missing: int = 0
    route_ratio: float | None = None
    crossings: int = 0
    after_close: int = 0
    closed_day: int = 0
    meal_stops: int = 0
    meal_on_time: int = 0
    food_in_a_row: int = 0
    over_day: bool = False
    false_claims: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _pick(q: EvalQuery, places: list[Attraction], count: int) -> list[Attraction]:
    picks = places[:count]
    constraint = venue_constraint_for_query(q.text)
    if constraint and constraint.meal_required and not any(may_serve_meal(p) for p in picks):
        food = next((p for p in places[count:] if may_serve_meal(p)), None)
        if food:
            picks = [*picks[:-1], food] if len(picks) >= count else [*picks, food]
    return picks


def _path_km(places: list[Attraction]) -> float | None:
    legs = [straight_distance_km(a, b) for a, b in zip(places, places[1:])]
    return None if any(leg is None for leg in legs) else sum(legs)


def _best_km(places: list[Attraction]) -> float | None:
    """열린 경로(출발·도착 자유)의 가장 짧은 거리. 7곳까지는 전부 따져봅니다."""
    if len(places) > 7:
        return None
    lengths = [_path_km(list(order)) for order in itertools.permutations(places)]
    lengths = [x for x in lengths if x is not None]
    return min(lengths) if lengths else None


def _crosses(p1, p2, p3, p4) -> bool:
    def turn(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = turn(p3, p4, p1), turn(p3, p4, p2)
    d3, d4 = turn(p1, p2, p3), turn(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def _crossings(places: list[Attraction]) -> int:
    points = [(p.longitude, p.latitude) for p in places]
    if any(x is None or y is None for x, y in points):
        return 0
    segments = list(zip(points, points[1:]))
    return sum(_crosses(*segments[i], *segments[j])
               for i in range(len(segments)) for j in range(i + 2, len(segments)))


def _false_claims(reason: str, place: Attraction) -> list[str]:
    return [word for word, fields in _FACILITY_WORDS
            if word in reason and not any(getattr(place.accessibility, f, False) for f in fields)]


async def _run_one(q: EvalQuery, count: int) -> CourseResult:
    random.seed(0)
    ai_service._PARSE_CACHE._entries.clear()
    result = CourseResult(q.id, q.text)
    try:
        response = await courses.recommend_course_places(PlaceRecommendationRequest(
            query_text=q.text, user_type=UserType(q.user_type), sigungu_cd=q.sigungu_cd, visit_date=q.visit_date,
        ), user_id=None)
    except HTTPException as e:
        result.error = f"1단계 {e.status_code}: {e.detail}"
        return result
    places = [c.attraction for c in response.candidates]
    picks = _pick(q, places, count)
    if len(picks) < 2:
        result.error = f"1단계 결과 {len(places)}곳 — 코스 평가 생략"
        return result
    result.picked = [p.name for p in picks]

    # 2단계는 장소를 다시 불러옵니다. 평가는 1단계 결과를 그대로 돌려줍니다 (운영 API 안 부름).
    by_id = {p.content_id: p for p in places}

    async def detail(content_id):
        found = by_id.get(content_id)
        return found.model_copy(deep=True) if found else None

    courses.tour_api_client.get_attraction_detail = detail
    try:
        course = await courses.create_course_from_selection(GenerateFromSelectionRequest(
            query_text=q.text, user_type=UserType(q.user_type), sigungu_cd=q.sigungu_cd, visit_date=q.visit_date,
            selected_content_ids=[p.content_id for p in picks],
        ), user_id=None)
    except HTTPException as e:
        result.error = f"2단계 {e.status_code}: {e.detail}"
        return result

    stops = sorted(course.stops, key=lambda s: s.order)
    ordered = [s.attraction for s in stops]
    result.order = [a.name for a in ordered]
    result.arrivals = [s.recommended_arrival_time for s in stops]
    result.missing = len({p.content_id for p in picks} - {a.content_id for a in ordered})
    path, best = _path_km(ordered), _best_km(ordered)
    if path is not None and best:
        result.route_ratio = path / best
    elif path is not None:
        result.route_ratio = 1.0
    result.crossings = _crossings(ordered)
    result.after_close = sum("문을 닫아" in (s.time_note or "") for s in stops)
    result.closed_day = sum(bool(s.closed_note) for s in stops)
    meal_stops = [s for s in stops if s.attraction.category == "음식점" and may_serve_meal(s.attraction)]
    result.meal_stops = len(meal_stops)
    result.meal_on_time = sum(meal_window_at(s.recommended_arrival_time) in ("점심", "저녁") for s in meal_stops)
    result.food_in_a_row = sum(a.category == "음식점" and b.category == "음식점" for a, b in zip(ordered, ordered[1:]))
    result.over_day = any("하루 안에" in (s.time_note or "") for s in stops)
    result.false_claims = [f"{s.attraction.name}: {w}" for s in stops for w in _false_claims(s.reason, s.attraction)]
    result.warnings = [*course.warnings, *(w for s in stops for w in s.warnings)]
    return result


def _mean(values):
    values = [v for v in values if v is not None]
    return statistics.mean(values) if values else None


async def main(args) -> dict:
    Snapshot(args.snapshot).install(_Patch())
    if not args.ai:
        ai_service.settings.groq_api_key = ""
    rows = [asdict(await _run_one(q, args.pick)) for q in QUERIES]
    return {"mode": "ai" if args.ai else "rule", "pick": args.pick, "rows": rows}


def report(result: dict) -> None:
    rows = result["rows"]
    ok = [r for r in rows if not r["error"]]
    print(f"[코스 생성: {'AI' if result['mode'] == 'ai' else '규칙 기반(AI 키 없음)'}, 위쪽 {result['pick']}곳 선택]")
    print(f"{'id':4} {'곳':>2} {'누락':>4} {'동선':>5} {'꼬임':>4} {'종료후':>6} {'휴무':>4} {'식사':>5} {'식당연속':>8} {'초과':>4}  순서")
    for r in rows:
        if r["error"]:
            print(f"{r['id']:4}  ⚠ {r['error']}")
            continue
        meal = f"{r['meal_on_time']}/{r['meal_stops']}" if r["meal_stops"] else "-"
        ratio = f"{r['route_ratio']:.2f}" if r["route_ratio"] is not None else "-"
        print(f"{r['id']:4} {len(r['order']):>2} {r['missing']:>4} {ratio:>5} {r['crossings']:>4} {r['after_close']:>6} "
              f"{r['closed_day']:>4} {meal:>5} {r['food_in_a_row']:>8} {'예' if r['over_day'] else '':>4}  "
              + " → ".join(f"{n}({t})" for n, t in zip(r["order"], r["arrivals"])))
    meal_total = sum(r["meal_stops"] for r in ok)
    print("\n요약")
    print(f"  코스 {len(ok)}개 평가 / 생략·오류 {len(rows) - len(ok)}개")
    print(f"  고른 장소 누락 코스          {sum(r['missing'] > 0 for r in ok)}개")
    ratio = _mean([r["route_ratio"] for r in ok])
    print(f"  동선 비율(평균, 1.0이 최선)   {ratio:.2f}" if ratio else "  동선 비율 -")
    print(f"  동선 1.2배 넘는 코스         {sum((r['route_ratio'] or 1) > 1.2 for r in ok)}개")
    print(f"  경로가 꼬인 코스             {sum(r['crossings'] > 0 for r in ok)}개")
    print(f"  영업 종료 뒤 도착 장소        {sum(r['after_close'] for r in ok)}곳")
    print(f"  방문일 휴무 장소              {sum(r['closed_day'] for r in ok)}곳")
    print(f"  식당이 식사 시간에 오는 비율  "
          + (f"{sum(r['meal_on_time'] for r in ok) / meal_total * 100:.0f}% ({sum(r['meal_on_time'] for r in ok)}/{meal_total})"
             if meal_total else "-"))
    print(f"  식당이 이어지는 코스          {sum(r['food_in_a_row'] > 0 for r in ok)}개")
    print(f"  하루에 다 못 도는 코스        {sum(r['over_day'] for r in ok)}개")
    print(f"  등록 안 된 편의시설 설명      {sum(len(r['false_claims']) for r in ok)}건")
    for r in ok:
        for claim in r["false_claims"]:
            print(f"  ✗ {r['id']} {claim}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--ai", action="store_true", help="GROQ_API_KEY로 실제 AI가 순서·설명까지")
    parser.add_argument("--pick", type=int, default=5, help="1단계 결과에서 위쪽 몇 곳을 고를지")
    parser.add_argument("--out")
    args = parser.parse_args()
    result = asyncio.run(main(args))
    report(result)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
    sys.exit(0)
