"""
방문 시각을 영업시간·휴무일·이동시간에 맞춰 계산하는지.

예전에는 AI가 시각 문자열을 그냥 만들어 냈습니다. 그래서 10시 개장인 곳에
09:00이 찍히고, 차로 40분 거리인 두 곳이 2시간 간격으로 붙고, 순서를 바꿔도
시각이 장소를 따라다녔습니다. 여기서 보는 것은 세 가지입니다.

1. 실제 공공데이터에 들어있는 형태의 문자열을 읽어내는가
2. 확신할 수 없는 표현에 잘못된 휴무 경고를 붙이지 않는가
3. 이동/체류 시간을 반영해 시각이 앞뒤로 이어지는가
"""
import datetime

from app.models.schemas import Attraction, InfoField
from app.services import schedule


def _place(
    name: str = "장소",
    category: str = "관광지",
    lat: float = 37.28,
    lng: float = 127.01,
    hours: str | None = None,
    rest: str | None = None,
) -> Attraction:
    extra = []
    if hours is not None:
        extra.append(InfoField(label="이용시간", value=hours))
    if rest is not None:
        extra.append(InfoField(label="쉬는날", value=rest))
    return Attraction(
        content_id=name,
        name=name,
        address="경기도 수원시",
        latitude=lat,
        longitude=lng,
        category=category,
        extra_info=extra,
    )


# ---- 영업시간 읽기 ----

def test_흔한_영업시간_표기를_읽는다():
    assert schedule.parse_open_close("09:00~18:00") == (9 * 60, 18 * 60)
    assert schedule.parse_open_close("10:00 ~ 19:00") == (10 * 60, 19 * 60)
    assert schedule.parse_open_close("9시~18시") == (9 * 60, 18 * 60)
    assert schedule.parse_open_close("매일 09:30-17:30") == (9 * 60 + 30, 17 * 60 + 30)


def test_오후_표기를_24시간제로_읽는다():
    assert schedule.parse_open_close("오전 9시 ~ 오후 6시") == (9 * 60, 18 * 60)


def test_괄호_안_부가_설명은_무시하고_앞의_두_시각만_쓴다():
    """'(매표 마감 17:00)'까지 시각으로 읽으면 엉뚱한 값이 나옵니다."""
    assert schedule.parse_open_close("09:00~18:00 (매표 마감 17:00)") == (9 * 60, 18 * 60)


def test_시간_제한이_없으면_제약을_걸지_않는다():
    assert schedule.parse_open_close("24시간") == (None, None)
    assert schedule.parse_open_close("상시개방") == (None, None)
    assert schedule.parse_open_close("") == (None, None)
    assert schedule.parse_open_close("연중 이용 가능") == (None, None)


def test_읽지_못하는_표기는_조용히_넘어간다():
    assert schedule.parse_open_close("문의 요망") == (None, None)


# ---- 휴무일 읽기 ----

def test_매주_쉬는_요일을_읽는다():
    assert schedule.parse_closed_days("매주 월요일").weekdays == {0}
    assert schedule.parse_closed_days("매주 월요일 휴관").weekdays == {0}
    assert schedule.parse_closed_days("월, 화요일").weekdays == {0, 1}


def test_연중무휴는_쉬는_날이_없다():
    assert schedule.parse_closed_days("연중무휴").weekdays == set()


def test_특정_주에만_쉬면_판단을_포기한다():
    """'매월 첫째 월요일'을 매주 월요일로 오해하면 멀쩡한 날에 휴무 경고가 뜹니다."""
    assert schedule.parse_closed_days("매월 첫째 월요일").weekdays is None


def test_요일이_아닌_말을_요일로_읽지_않는다():
    """'매일', '공휴일'의 '일'이 일요일로 잡히면 매주 일요일이 휴무가 됩니다."""
    assert schedule.parse_closed_days("매일 09:00~18:00 운영").weekdays == set()
    assert schedule.parse_closed_days("공휴일 정상 운영").weekdays == set()


def test_날짜로_지정된_휴무도_읽는다():
    closed = schedule.parse_closed_days("1월 1일, 설날 당일")
    assert (1, 1) in closed.dates
    assert closed.weekdays == set()  # 요일 휴무는 없습니다


# ---- 이동/체류 시간 ----

def test_먼_곳일수록_이동_시간이_길다():
    suwon = _place("수원", lat=37.28, lng=127.01)
    near = _place("근처", lat=37.29, lng=127.02)
    far = _place("멀리", lat=37.60, lng=127.30)

    assert schedule.travel_minutes(suwon, near) < schedule.travel_minutes(suwon, far)
    assert schedule.travel_minutes(suwon, near) >= 10  # 아무리 가까워도 최소 10분


def test_음식점은_관광지보다_짧게_머문다():
    assert schedule.dwell_minutes("음식점") < schedule.dwell_minutes("관광지")


# ---- 전체 일정 계산 ----

def test_첫_장소는_아홉시부터_시작한다():
    result = schedule.build_schedule([_place("가")])

    assert result[0].arrival_time == "09:00"
    assert result[0].time_note is None


def test_개장_전이면_개장_시각으로_미룬다():
    result = schedule.build_schedule([_place("가", hours="10:00~18:00")])

    assert result[0].arrival_time == "10:00"
    assert "10:00" in (result[0].time_note or "")


def test_다음_장소는_체류와_이동_시간만큼_뒤에_온다():
    first = _place("가", lat=37.28, lng=127.01)
    second = _place("나", lat=37.29, lng=127.02)

    result = schedule.build_schedule([first, second])

    # 09:00 + 체류 90분 + 이동(최소 10분) => 10:40 이후
    assert result[0].arrival_time == "09:00"
    assert result[1].arrival_time >= "10:40"


def test_문_닫은_뒤_도착이면_알려준다():
    early = _place("가", hours="09:00~18:00")
    late = _place("나", lat=37.9, lng=127.6, hours="09:00~10:00")

    result = schedule.build_schedule([early, late])

    assert "문을 닫아" in (result[1].time_note or "")


def test_방문일이_휴무면_경고한다():
    monday = "2026-09-14"  # 월요일
    result = schedule.build_schedule([_place("가", rest="매주 월요일")], visit_date=monday)

    assert "쉬는 날" in (result[0].closed_note or "")
    assert datetime.date.fromisoformat(monday).weekday() == 0


def test_방문일을_모르면_휴무_경고를_하지_않는다():
    result = schedule.build_schedule([_place("가", rest="매주 월요일")])

    assert result[0].closed_note is None


def test_휴무가_아닌_날에는_경고하지_않는다():
    tuesday = "2026-09-15"
    result = schedule.build_schedule([_place("가", rest="매주 월요일")], visit_date=tuesday)

    assert result[0].closed_note is None


def test_순서가_바뀌면_시각도_다시_매겨진다():
    """순서를 바꿔도 시각이 장소를 따라다니면 1번이 13:00, 2번이 09:00이 됩니다."""
    a = _place("가", hours="10:00~18:00")
    b = _place("나", hours="09:00~18:00")

    forward = schedule.build_schedule([a, b])
    backward = schedule.build_schedule([b, a])

    assert forward[0].arrival_time == "10:00"   # 가가 먼저면 개장 시각부터
    assert backward[0].arrival_time == "09:00"  # 나가 먼저면 아홉시부터
    assert backward[1].arrival_time > backward[0].arrival_time


def test_그날_쉬는_곳인지_확실할_때만_알려준다():
    monday, tuesday = "2026-09-14", "2026-09-15"
    closed_monday = _place("가", rest="매주 월요일")
    irregular = _place("나", rest="매월 첫째 월요일")  # 매주 쉬는 게 아닙니다

    assert schedule.is_closed_on(closed_monday, monday) is True
    assert schedule.is_closed_on(closed_monday, tuesday) is False
    assert schedule.is_closed_on(closed_monday, None) is False   # 날짜를 모르면 판단하지 않습니다
    assert schedule.is_closed_on(irregular, monday) is False     # 확실하지 않으면 판단하지 않습니다


def test_프롬프트용_영업조건은_값이_있을_때만_담는다():
    with_hours = schedule.hours_payload(_place("가", hours="10:00~18:00", rest="매주 월요일"))
    without = schedule.hours_payload(_place("나"))

    assert with_hours == {"opens_at": "10:00", "closes_at": "18:00", "closed_weekdays": ["월"]}
    assert without == {}
