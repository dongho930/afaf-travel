"""
평가용 캐시 스냅샷을 JSON으로 내려받습니다 (읽기 전용 — select만 합니다).

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python -m eval.export_snapshot <폴더>

공개 데이터 캐시만 받습니다. 리뷰·게시글·코스·여행·방문 기록 같은 사용자 테이블은
받지 않습니다 (eval/snapshot.py도 그 테이블 없이 동작합니다).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from supabase import create_client

_TABLES: dict[str, dict[str, object]] = {
    "attraction_list_cache": {"ldong_regn_cd": 41},  # 경기도
    "place_accessibility_cache": {},
    "attraction_overview_cache": {},
    "attraction_intro_cache": {},
    "congestion_cache": {},
    "place_popularity_daily": {},
}
_PAGE = 1000


def main(folder: str) -> None:
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    out = Path(folder)
    out.mkdir(parents=True, exist_ok=True)
    for table, filters in _TABLES.items():
        rows: list[dict] = []
        offset = 0
        while True:
            query = client.table(table).select("*")
            for column, value in filters.items():
                query = query.eq(column, value)
            page = query.range(offset, offset + _PAGE - 1).execute().data or []
            rows += page
            if len(page) < _PAGE:
                break
            offset += _PAGE
        (out / f"{table}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        print(f"{table}: {len(rows)}행")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("사용법: python -m eval.export_snapshot <폴더>")
    main(sys.argv[1])
