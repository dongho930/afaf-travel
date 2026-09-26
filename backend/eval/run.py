"""
질의 세트로 AI 플래너 1단계(장소 추천)를 돌리고 품질 지표를 계산합니다.

    python -m eval.run --snapshot <폴더> [--seeds 3] [--out results.json]

GROQ_API_KEY가 있으면 실제 AI 선택까지, 없으면 규칙 기반 대체 선택으로 평가합니다.
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import math
import random
import statistics
import sys
from dataclasses import dataclass, field

from fastapi import HTTPException

from app.models.schemas import PlaceRecommendationRequest, UserType
from app.routers import courses
from app.services import accessibility_criteria, ai_service
from app.services.place_intent import venue_constraint_for_query
from app.services.query_preferences import extract_preferences, grade_rank, text_matches
from app.services.schedule import is_closed_on
from app.services.sigungu_codes import find_area_signgu, resolve_sigungu_codes
from eval.queries import QUERIES, EvalQuery
from eval.snapshot import Snapshot


class _Patch:
    def setattr(self, target, name, value):
        setattr(target, name, value)


def _km(a, b) -> float:
    if not (a.latitude and b.latitude):
        return 0.0
    p1, p2 = math.radians(a.latitude), math.radians(b.latitude)
    dp, dl = p2 - p1, math.radians(b.longitude - a.longitude)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


@dataclass
class QueryResult:
    id: str
    ok: bool
    error: str | None = None
    places: list = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    text_match: float | None = None   # 문장 특성·편의시설 조건이 있는 질의만
    high_grade: float | None = None   # 유형이 있는 질의만
    categories: int = 0
    spread_km: float = 0.0
    unmet: list[str] = field(default_factory=list)


def _evaluate(q: EvalQuery, places, unmet) -> QueryResult:
    r = QueryResult(q.id, True, places=places, unmet=unmet)
    region_codes = [q.sigungu_cd] if q.sigungu_cd else resolve_sigungu_codes(q.text)
    constraint = venue_constraint_for_query(q.text)
    for a in places:
        if not accessibility_criteria.qualifies(a, q.user_type):
            r.violations.append(f"유형 기준 미달: {a.name}")
        if region_codes:
            found = find_area_signgu(a.address or "")
            if found and found[1] not in region_codes:
                r.violations.append(f"지역 밖: {a.name}")
        if q.visit_date and is_closed_on(a, q.visit_date):
            r.violations.append(f"방문일 휴무: {a.name}")
        if constraint and not constraint.allow_other_categories and not constraint.matches(a):
            r.violations.append(f"요청하지 않은 종류: {a.name}({a.category})")
    prefs = extract_preferences(q.text)
    if places and (prefs.concepts or prefs.facilities):
        r.text_match = sum(text_matches(a, prefs)[0] > 0 for a in places) / len(places)
    if places and q.user_type != "general":
        r.high_grade = sum(grade_rank(a, q.user_type) == 2 for a in places) / len(places)
    r.categories = len({a.category for a in places})
    r.spread_km = max((_km(a, b) for a, b in itertools.combinations(places, 2)), default=0.0)
    return r


async def _run_one(q: EvalQuery, seed: int) -> QueryResult:
    random.seed(seed)
    ai_service._PARSE_CACHE._entries.clear()
    request = PlaceRecommendationRequest(
        query_text=q.text, user_type=UserType(q.user_type), sigungu_cd=q.sigungu_cd, visit_date=q.visit_date,
    )
    try:
        response = await courses.recommend_course_places(request, user_id=None)
    except HTTPException as e:
        return QueryResult(q.id, False, error=f"{e.status_code}: {e.detail}")
    places = [c.attraction for c in response.candidates]
    unmet = [m for m in response.missing_categories]
    return _evaluate(q, places, unmet)


def _mean(values):
    values = [v for v in values if v is not None]
    return statistics.mean(values) if values else None


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0


async def main(args) -> dict:
    Snapshot(args.snapshot).install(_Patch())
    if not args.ai:
        ai_service.settings.groq_api_key = ""
    rows = []
    for q in QUERIES:
        runs = [await _run_one(q, seed) for seed in range(args.seeds)]
        ok_runs = [r for r in runs if r.ok]
        sets = [{a.content_id for a in r.places} for r in ok_runs]
        rows.append({
            "id": q.id, "user_type": q.user_type, "text": q.text,
            "error": next((r.error for r in runs if not r.ok), None),
            "n": _mean([len(r.places) for r in ok_runs]),
            "violations": sorted({v for r in ok_runs for v in r.violations}),
            "text_match": _mean([r.text_match for r in ok_runs]),
            "high_grade": _mean([r.high_grade for r in ok_runs]),
            "categories": _mean([r.categories for r in ok_runs]),
            "spread_km": _mean([r.spread_km for r in ok_runs]),
            "consistency": _mean([_jaccard(a, b) for a, b in itertools.combinations(sets, 2)]),
            "unmet": sorted({u for r in ok_runs for u in r.unmet}),
            "sample": [f"{a.name}({a.category})" for a in (ok_runs[0].places if ok_runs else [])][:6],
        })
    return {"mode": "ai" if args.ai else "rule", "rows": rows}


def _fmt(v, pct=False, digits=0):
    if v is None:
        return "-"
    return f"{v * 100:.0f}%" if pct else f"{v:.{digits}f}"


def report(result: dict) -> None:
    rows = result["rows"]
    print(f"[선택 단계: {'AI' if result['mode'] == 'ai' else '규칙 기반(AI 키 없음)'}]")
    print(f"{'id':4} {'개수':>4} {'위반':>4} {'문장맞음':>8} {'많음':>6} {'종류':>4} {'최대거리':>8} {'일관성':>6}  질의")
    for r in rows:
        print(f"{r['id']:4} {_fmt(r['n']):>4} {len(r['violations']):>4} {_fmt(r['text_match'], True):>8} "
              f"{_fmt(r['high_grade'], True):>6} {_fmt(r['categories'], digits=1):>4} "
              f"{_fmt(r['spread_km']):>6}km {_fmt(r['consistency'], True):>6}  {r['text']}"
              + (f"  ⚠ {r['error']}" if r["error"] else ""))
    ok = [r for r in rows if not r["error"]]
    far = [r for r in ok if r["spread_km"] and r["spread_km"] > 30]
    print("\n요약")
    print(f"  질의 {len(rows)}개 / 오류 {len(rows) - len(ok)}개 / 조건 위반 질의 {sum(bool(r['violations']) for r in ok)}개")
    print(f"  문장 조건에 맞는 비율(평균) {_fmt(_mean([r['text_match'] for r in ok]), True)}")
    print(f"  등급 '많음' 비율(평균)      {_fmt(_mean([r['high_grade'] for r in ok]), True)}")
    print(f"  카테고리 수(평균)          {_fmt(_mean([r['categories'] for r in ok]), digits=1)}")
    print(f"  장소 간 최대거리 30km 초과  {len(far)}개 질의")
    print(f"  반복 일관성(평균)          {_fmt(_mean([r['consistency'] for r in ok]), True)}")
    for r in ok:
        if r["violations"]:
            print(f"  ✗ {r['id']} 위반: {r['violations'][:3]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--seeds", type=int, default=3)
    parser.add_argument("--ai", action="store_true", help="GROQ_API_KEY로 실제 AI 선택까지 평가")
    parser.add_argument("--out")
    args = parser.parse_args()
    result = asyncio.run(main(args))
    report(result)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
    sys.exit(0)
