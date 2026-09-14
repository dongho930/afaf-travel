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


# ---- 표시 시간 범위(09~22시) ----

def test_추천_시간은_아홉시와_스물두시_사이에_머문다():
    """일정이 길어져 계산상 자정을 넘겨도 표시는 22:00에서 멈춰야 합니다.
    예전에는 25:00이 24시간 나머지 연산 때문에 '01:00'으로 감겨서, 새벽에
    가라는 것처럼 보였습니다."""
    far_apart = [_place(str(i), lat=37.0 + i, lng=127.0 + i) for i in range(6)]

    result = schedule.build_schedule(far_apart)

    assert all("09:00" <= s.arrival_time <= "22:00" for s in result)
    assert result[-1].arrival_time == "22:00"
    # 시각만 멈출 뿐, 하루에 못 돈다는 사실은 그대로 알려줍니다.
    assert result[-1].fits_today is False


# ---- 음식점 식사 시간대 ----

def test_음식점은_점심시간에_맞춰_당겨진다():
    """09:00에 시작해 체류+이동을 더하면 10시대에 도착하는데, 음식점이면
    점심 시간대(11:00~14:00) 시작으로 당겨져야 합니다."""
    first = _place("가", category="관광지", lat=37.28, lng=127.01)
    restaurant = _place("나", category="음식점", lat=37.28, lng=127.01)

    result = schedule.build_schedule([first, restaurant])

    assert result[1].arrival_time == "11:00"
    assert "점심" in (result[1].time_note or "")


def test_음식점이_이미_식사시간대면_그대로_둔다():
    result = schedule.build_schedule([_place("가", category="음식점")])

    assert result[0].arrival_time == "09:00"  # 아침 시간대(07:00~09:00) 안이라 그대로
    assert result[0].time_note is None


def test_음식점이_영업시간_때문에_식사시간대에_못_맞추면_포기한다():
    """15시에 문을 닫는 음식점 도착 예정이 점심과 저녁 사이(16시)로 나오면,
    저녁 시간대로 밀어붙일 경우 이미 문을 닫은 뒤라 그대로 둡니다."""
    first = _place("가", category="관광지", lat=37.28, lng=127.01)
    mid = _place("나", category="관광지", lat=38.28, lng=128.01)
    late_lunch_only = _place("다", category="음식점", lat=39.28, lng=129.01, hours="09:00~15:00")

    result = schedule.build_schedule([first, mid, late_lunch_only])

    assert result[2].arrival_time == "16:00"
    assert "저녁" not in (result[2].time_note or "")
    assert "문을 닫아" in (result[2].time_note or "")


def test_음식점이_개장_시각_때문에_밀리면_식사시간대_기준으로_다시_당긴다():
    """개장(10:30)에 맞춰 밀린 시각(10:30)이 아침·점심 시간대 사이라, 점심
    시간대 시작으로 한 번 더 당겨져야 합니다."""
    restaurant = _place("가", category="음식점", hours="10:30~21:00")

    result = schedule.build_schedule([restaurant])

    assert result[0].arrival_time == "11:00"
    assert "점심" in (result[0].time_note or "")


# ---- 음식점 순서 배치 ----

def test_음식점을_점심_시간대_자리로_옮긴다():
    """혼잡도 순으로만 정하면 음식점이 첫 순서(09:00)에 올 수 있습니다.
    관광지를 먼저 돌다가 점심때 들르도록 자리를 옮겨야 합니다."""
    restaurant = _place("밥집", category="음식점")
    spots = [_place(name) for name in ("가", "나", "다")]

    order = schedule.arrange_for_meals([restaurant, *spots])
    arranged = [[restaurant, *spots][i] for i in order]
    times = [s.arrival_time for s in schedule.build_schedule(arranged)]
    position = arranged.index(restaurant)

    assert position != 0                       # 첫 순서에서 밀려났고
    assert "11:00" <= times[position] <= "14:00"  # 점심 시간대에 들릅니다


def test_저녁에만_여는_음식점은_코스_뒤로_간다():
    restaurant = _place("저녁집", category="음식점", hours="17:00~22:00")
    spots = [_place(name) for name in ("가", "나")]
    attractions = [restaurant, *spots]

    order = schedule.arrange_for_meals(attractions)
    arranged = [attractions[i] for i in order]
    times = [s.arrival_time for s in schedule.build_schedule(arranged)]

    assert arranged[-1] is restaurant
    assert times[-1] == "17:00"


def test_아침에만_여는_음식점은_코스_앞으로_온다():
    """10시에 문을 닫는 곳은 아침 자리 말고는 갈 수가 없습니다."""
    restaurant = _place("해장국", category="음식점", hours="07:00~10:00")
    spots = [_place(name) for name in ("가", "나")]
    attractions = [*spots, restaurant]

    order = schedule.arrange_for_meals(attractions)
    arranged = [attractions[i] for i in order]
    times = [s.arrival_time for s in schedule.build_schedule(arranged)]

    assert arranged[0] is restaurant
    assert times[0] == "09:00"


def test_음식점이_둘이면_서로_다른_끼니에_배치한다():
    lunch_spot = _place("점심집", category="음식점")
    dinner_spot = _place("저녁집", category="음식점")
    spots = [_place(name) for name in ("가", "나", "다")]
    attractions = [lunch_spot, dinner_spot, *spots]

    order = schedule.arrange_for_meals(attractions)
    arranged = [attractions[i] for i in order]
    times = [s.arrival_time for s in schedule.build_schedule(arranged)]

    first = times[arranged.index(lunch_spot)]
    second = times[arranged.index(dinner_spot)]

    assert "11:00" <= first <= "14:00"
    assert "17:00" <= second <= "20:00"


def test_음식점이_없으면_순서를_건드리지_않는다():
    attractions = [_place("가"), _place("나"), _place("다")]

    assert schedule.arrange_for_meals(attractions) == [0, 1, 2]


def test_식사_시간대에_못_여는_음식점은_원래_자리에_둔다():
    """심야에만 여는 곳은 어느 끼니에도 맞출 수 없으니 순서를 흔들지 않습니다."""
    late_night = _place("야식집", category="음식점", hours="21:00~23:00")
    attractions = [_place("가"), late_night, _place("나")]

    assert schedule.arrange_for_meals(attractions) == [0, 1, 2]


def test_프롬프트용_영업조건은_값이_있을_때만_담는다():
    with_hours = schedule.hours_payload(_place("가", hours="10:00~18:00", rest="매주 월요일"))
    without = schedule.hours_payload(_place("나"))

    assert with_hours == {"opens_at": "10:00", "closes_at": "18:00", "closed_weekdays": ["월"]}
    assert without == {}
