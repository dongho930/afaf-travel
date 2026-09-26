"""
AI 플래너 선택률 — 추천한 장소 중 사용자가 실제로 고른 비율 (읽기 전용).

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python -m eval.selection_rate [--days 30]

planner_selection_logs(sql/create_planner_selection_logs.sql)를 읽어서 봅니다.
  - 코스까지 간 비율: 추천 세션 중 코스를 만든 비율 (selected_ids가 채워진 추천)
  - 선택률: 코스를 만든 세션에서 보여준 장소 중 고른 비율
  - 순위별 선택률: 위쪽 추천일수록 더 고르는지 (순위가 제 역할을 하는지)
"""
from __future__ import annotations

import argparse
import datetime
import os
from collections import Counter

from supabase import create_client

_BANDS = [(1, 3), (4, 6), (7, 9), (10, 12)]


def _rows(client, since: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        page = (client.table("planner_selection_logs")
                .select("user_id, user_type, recommended_ids, selected_ids")
                .gte("created_at", since)
                .range(offset, offset + 999).execute().data) or []
        rows += page
        if len(page) < 1000:
            return rows
        offset += 1000


def _pct(num: int, den: int) -> str:
    return f"{num / den * 100:.0f}% ({num}/{den})" if den else "-"


def main(days: int) -> None:
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()
    rows = _rows(client, since)
    chosen = [r for r in rows if r.get("selected_ids") is not None]
    print(f"최근 {days}일 추천 {len(rows)}회 (로그인 {sum(bool(r.get('user_id')) for r in rows)}회)")
    print(f"  코스까지 간 추천   {_pct(len(chosen), len(rows))}")
    shown = sum(len(r["recommended_ids"]) for r in chosen)
    picked = sum(len(r["selected_ids"]) for r in chosen)
    print(f"  선택률            {_pct(picked, shown)}")

    shown_at, picked_at = Counter(), Counter()
    for r in chosen:
        selected = set(r["selected_ids"])
        for rank, cid in enumerate(r["recommended_ids"], start=1):
            shown_at[rank] += 1
            picked_at[rank] += cid in selected
    print("  순위별 선택률")
    for lo, hi in _BANDS:
        s = sum(shown_at[k] for k in range(lo, hi + 1))
        p = sum(picked_at[k] for k in range(lo, hi + 1))
        print(f"    {lo:>2}~{hi:<2}위  {_pct(p, s)}")

    by_type: dict[str, list[dict]] = {}
    for r in chosen:
        by_type.setdefault(r["user_type"], []).append(r)
    print("  유형별 선택률")
    for user_type, items in sorted(by_type.items()):
        s = sum(len(r["recommended_ids"]) for r in items)
        p = sum(len(r["selected_ids"]) for r in items)
        print(f"    {user_type:<11} {_pct(p, s)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    main(parser.parse_args().days)
