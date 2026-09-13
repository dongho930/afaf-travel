"""
순서를 바꾸면 방문 시각도 다시 매기는지.

예전에는 시각이 장소에 붙어 그대로 따라다녔습니다. 그래서 드래그로 순서만
바꾸면 1번이 13:00, 2번이 09:00처럼 거꾸로 뒤집힌 코스가 저장됐습니다.
반대로 '방문일에 쉬는 날'이라는 경고는 어느 날 가는지에 달린 정보라 순서를
바꿔도 그대로 남아야 합니다.

DB를 건드리지 않는 순수 계산 부분(_rebuild_arrival_times)만 검사합니다.
"""
from app.services import supabase_service


def _stop(order: int, content_id: str, time: str, hours: str | None = None, closed: str | None = None) -> dict:
    """저장된 코스(stops jsonb) 한 항목과 같은 모양의 딕셔너리."""
    extra_info = [{"label": "이용시간", "value": hours}] if hours else []
    return {
        "order": order,
        "recommended_arrival_time": time,
        "reason": "이유",
        "time_note": None,
        "closed_note": closed,
        "attraction": {
            "content_id": content_id,
            "name": f"장소{content_id}",
            "address": "경기도 수원시",
            "latitude": 37.28,
            "longitude": 127.01,
            "category": "관광지",
            "extra_info": extra_info,
        },
    }


def test_순서를_바꾸면_시각이_앞에서부터_다시_매겨진다():
    stops = [_stop(1, "B", "13:00"), _stop(2, "A", "09:00")]

    supabase_service._rebuild_arrival_times(stops)

    assert stops[0]["recommended_arrival_time"] == "09:00"
    assert stops[1]["recommended_arrival_time"] > stops[0]["recommended_arrival_time"]


def test_다시_매길_때도_영업시간을_지킨다():
    stops = [_stop(1, "A", "09:00", hours="11:00~18:00")]

    supabase_service._rebuild_arrival_times(stops)

    assert stops[0]["recommended_arrival_time"] == "11:00"
    assert "11:00" in (stops[0]["time_note"] or "")


def test_방문일_휴무_경고는_순서를_바꿔도_남는다():
    """어느 날 가는지는 순서와 무관하므로, 이 경고까지 지우면 정보가 사라집니다."""
    stops = [_stop(1, "A", "09:00", closed="방문일(9월 14일 월요일)은 쉬는 날이에요")]

    supabase_service._rebuild_arrival_times(stops)

    assert stops[0]["closed_note"] == "방문일(9월 14일 월요일)은 쉬는 날이에요"


def test_형식이_다른_옛날_코스는_시각을_건드리지_않는다():
    """순서 저장이 통째로 실패하는 것보다, 시각만 예전 값으로 두는 편이 낫습니다."""
    stops = [{"order": 1, "recommended_arrival_time": "10:00", "attraction": {"content_id": "A"}}]

    supabase_service._rebuild_arrival_times(stops)

    assert stops[0]["recommended_arrival_time"] == "10:00"
