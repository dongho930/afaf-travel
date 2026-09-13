"""
하루에 다 돌 수 없는 코스를 다음 날로 나누는 기능.

문 닫은 뒤에 도착하거나 그날 쉬는 곳이 코스에 남아 있으면, 그 지점부터 뒤를
통째로 다음 날 코스로 옮깁니다. 여기서 보는 것은:

1. 어떤 지점이 '오늘 못 감'으로 표시되는가 (fits_today)
2. 나눈 뒤 두 코스가 각자의 날짜로 시각·휴무일을 다시 계산하는가
3. 나눌 수 없는 경우(첫 장소부터 / 장소 하나뿐)를 막는가

DB를 타지 않는 계산 부분만 검사합니다.
"""
import datetime

from app.models.schemas import Attraction, InfoField
from app.services import schedule, supabase_service

MONDAY = "2026-09-14"
TUESDAY = "2026-09-15"


def _place(name: str, hours: str | None = None, rest: str | None = None, lat: float = 37.28) -> Attraction:
    extra = []
    if hours:
        extra.append(InfoField(label="이용시간", value=hours))
    if rest:
        extra.append(InfoField(label="쉬는날", value=rest))
    return Attraction(
        content_id=name,
        name=name,
        address="경기도 수원시",
        latitude=lat,
        longitude=127.01,
        category="관광지",
        extra_info=extra,
    )


def _stop(order: int, attraction: Attraction) -> dict:
    return {
        "order": order,
        "recommended_arrival_time": "09:00",
        "reason": "이유",
        "time_note": None,
        "closed_note": None,
        "fits_today": True,
        "attraction": attraction.model_dump(),
    }


# ---- '오늘 못 감' 판정 ----

def test_문_닫은_뒤_도착이면_오늘_못_간다():
    early = _place("가", hours="09:00~10:00")
    late = _place("나", hours="09:00~10:00", lat=37.9)  # 멀어서 이동 시간이 큽니다

    result = schedule.build_schedule([early, late])

    assert result[0].fits_today is True
    assert result[1].fits_today is False


def test_그날_쉬는_곳도_오늘_못_간다():
    result = schedule.build_schedule([_place("가", rest="매주 월요일")], visit_date=MONDAY)

    assert result[0].fits_today is False
    assert "쉬는 날" in (result[0].closed_note or "")


def test_문제가_없으면_모두_갈_수_있다():
    result = schedule.build_schedule([_place("가", hours="09:00~18:00"), _place("나")])

    assert [s.fits_today for s in result] == [True, True]


# ---- 나눈 뒤 다시 계산 ----

def test_떼어낸_코스는_1번부터_다시_번호를_매긴다():
    stops = [_stop(2, _place("나")), _stop(3, _place("다"))]

    result = supabase_service._reschedule_stops(stops, None)

    assert [s["order"] for s in result] == [1, 2]
    assert result[0]["recommended_arrival_time"] == "09:00"  # 다음 날 아침부터 다시 시작


def test_다음_날로_옮기면_휴무_경고가_풀린다():
    """월요일 휴관이라 못 가던 곳이 화요일로 넘어가면 갈 수 있어야 합니다."""
    stops = [_stop(2, _place("월요일휴관", rest="매주 월요일"))]

    monday_result = supabase_service._reschedule_stops(stops, MONDAY)
    tuesday_result = supabase_service._reschedule_stops(stops, TUESDAY)

    assert monday_result[0]["fits_today"] is False
    assert tuesday_result[0]["closed_note"] is None
    assert tuesday_result[0]["fits_today"] is True


def test_다음_날에도_쉬면_경고가_남는다():
    stops = [_stop(2, _place("월화휴관", rest="매주 월요일, 화요일"))]

    result = supabase_service._reschedule_stops(stops, TUESDAY)

    assert result[0]["fits_today"] is False
    assert "쉬는 날" in (result[0]["closed_note"] or "")


def test_다음_날_날짜는_하루_뒤():
    assert schedule.next_day_of(MONDAY) == TUESDAY
    assert schedule.next_day_of(None) is None
    assert schedule.next_day_of("날짜아님") is None


# ---- 제목 붙이기 ----

def test_다음_날_코스_제목에_일차를_붙인다():
    assert supabase_service._next_day_title("수원 나들이") == "수원 나들이 (2일차)"


def test_또_나누면_일차_숫자가_올라간다():
    """'(2일차) (2일차)'처럼 겹쳐 붙지 않아야 합니다."""
    assert supabase_service._next_day_title("수원 나들이 (2일차)") == "수원 나들이 (3일차)"
