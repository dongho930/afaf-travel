"""
코스의 방문 시각을 실제 조건에 맞춰 계산합니다.

예전에는 방문 시각을 AI가 문자열로 그냥 만들어 냈습니다. 그래서 10시에 문을 여는
곳에 09:00이 찍히거나, 차로 40분 걸리는 두 곳이 2시간 간격으로 붙거나, 순서를
바꿔도 시각이 장소를 따라다녀 1번이 13:00, 2번이 09:00이 되는 일이 있었습니다.

이제 순서만 AI(또는 규칙 기반 대체 로직)가 정하고, 시각은 이 모듈이 계산합니다.
계산에 쓰는 것은 네 가지입니다.

1. 영업시간   — 부가정보(detailIntro2)의 '이용시간'/'영업시간'
2. 휴무일     — 부가정보의 '쉬는날' (+ 방문 날짜를 알 때만 경고)
3. 이동 시간  — 좌표 사이 거리로 추정 (외부 길찾기 API를 부르지 않습니다)
4. 체류 시간  — 카테고리별 평균값

외부 호출이 없는 순수 계산 모듈이라 그대로 테스트할 수 있고, 코스를 처음 만들 때와
순서를 바꿀 때가 똑같은 규칙을 씁니다.
"""
import datetime
import math
import re
from dataclasses import dataclass, field
from typing import Optional

from app.models.schemas import Attraction

# 하루 일정의 기본 시작 시각(09:00)과, 이보다 늦어지면 "하루에 다 돌기 어렵다"고
# 알려주는 기준(22:00). 첫 장소가 더 늦게 열면 시작 시각은 그 개장 시각이 됩니다.
_DAY_START_MIN = 9 * 60
_TOO_LATE_MIN = 22 * 60

# 이동 시간 추정. 직선거리에 도로 우회 계수를 곱하고 평균 속도로 나눕니다.
# 20km/h는 도심에서 대중교통·도보·자동차가 섞인 이동의 대략적인 값입니다 —
# 정확한 경로 시간은 지도 화면에서 실제 길찾기 API로 따로 보여줍니다.
_ROAD_DETOUR_FACTOR = 1.3
_AVERAGE_SPEED_KMH = 20.0
_MIN_TRAVEL_MIN = 10
_MAX_TRAVEL_MIN = 120

# 카테고리별 머무는 시간(분). 코스 간격을 정하는 데만 씁니다.
_DWELL_MINUTES: dict[str, int] = {
    "관광지": 90,
    "문화시설": 90,
    "레포츠": 120,
    "음식점": 60,
    "숙박": 60,
    "쇼핑": 60,
    "축제/공연/행사": 120,
}
_DEFAULT_DWELL_MINUTES = 90

# 부가정보에서 영업시간/휴무일을 찾을 때 볼 라벨 (카테고리마다 이름이 다릅니다).
_HOURS_LABELS = ("이용시간", "영업시간", "개장 시간", "이용시기")
_REST_LABELS = ("쉬는날",)

# "24시간", "상시개방"처럼 시간 제한이 없다는 표현.
_ALWAYS_OPEN_HINTS = ("24시간", "24시간개방", "상시", "연중")

# 휴무일이 없다는 표현.
_NEVER_CLOSED_HINTS = ("연중무휴", "무휴", "없음", "연중개방", "연중운영")

# "매월 첫째 월요일"처럼 특정 주에만 쉬는 경우. 매주 쉬는 것으로 잘못 경고하면
# 멀쩡한 날에 "휴무"라고 뜨므로, 이런 표현이 있으면 판단을 포기합니다(=모름).
_IRREGULAR_HINTS = ("첫째", "둘째", "셋째", "넷째", "다섯째", "마지막", "격주", "비정기", "부정기")

# 요일 이름이 아닌데 '일'/'월' 글자를 품은 말들 — 먼저 지워야 오탐이 없습니다.
_NOT_WEEKDAY_WORDS = ("매일", "평일", "주말", "공휴일", "국경일", "휴일", "명절", "당일", "익일", "말일")

_WEEKDAY_INDEX = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}
_WEEKDAY_NAME = ("월", "화", "수", "목", "금", "토", "일")

# "09:00", "9시", "9시 30분" 세 형태를 모두 잡습니다.
_TIME_PATTERN = re.compile(r"(\d{1,2})\s*(?::\s*(\d{2})|시\s*(?:(\d{1,2})\s*분)?)")
# "1월 1일"처럼 날짜로 지정된 휴무.
_MONTH_DAY_PATTERN = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일")
# "월요일", "월,화요일"의 요일 표기.
_WEEKDAY_PATTERN = re.compile(r"([월화수목금토일])\s*(?=요일|[,·/및]\s*[월화수목금토일])")


@dataclass
class ClosedDays:
    """쉬는날 정보. weekdays가 None이면 '규칙을 확신할 수 없음'(경고하지 않음)."""
    weekdays: Optional[set[int]] = None
    dates: set[tuple[int, int]] = field(default_factory=set)  # (월, 일)


@dataclass
class PlaceHours:
    """한 장소의 영업 조건. 값이 None인 항목은 '정보 없음'이라 제약을 걸지 않습니다."""
    open_min: Optional[int] = None
    close_min: Optional[int] = None
    closed: ClosedDays = field(default_factory=ClosedDays)
    hours_text: Optional[str] = None
    rest_text: Optional[str] = None


@dataclass
class StopSchedule:
    """계산 결과 — 방문 시각과, 왜 그 시각인지에 대한 안내."""
    arrival_time: str          # "HH:MM"
    time_note: Optional[str] = None    # 영업시간 때문에 조정했을 때의 안내
    closed_note: Optional[str] = None  # 방문일이 휴무일 때의 경고
    # 그날 안에 실제로 방문할 수 있는지. False면 '다음 날 코스로 나누기'를 제안합니다
    # (문 닫은 뒤 도착 / 하루를 넘김 / 그날 휴무).
    fits_today: bool = True


def _to_minutes(hour: int, minute: int) -> Optional[int]:
    if not (0 <= hour <= 24) or not (0 <= minute < 60):
        return None
    return hour * 60 + minute


def _find_times(text: str) -> list[int]:
    """문자열에서 시각을 나온 순서대로 찾습니다. '오후 6시'는 18:00으로 읽습니다."""
    found: list[int] = []
    for match in _TIME_PATTERN.finditer(text):
        hour = int(match.group(1))
        minute = int(match.group(2) or match.group(3) or 0)
        minutes = _to_minutes(hour, minute)
        if minutes is None:
            continue
        # 바로 앞에 '오후/저녁/밤'이 있으면 12시간을 더합니다 (오후 6시 -> 18:00).
        prefix = text[max(0, match.start() - 6) : match.start()]
        if any(word in prefix for word in ("오후", "저녁", "밤")) and hour < 12:
            minutes += 12 * 60
        found.append(minutes)
    return found


def parse_open_close(text: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """
    '09:00~18:00' 같은 문자열에서 (여는 시각, 닫는 시각)을 분 단위로 뽑습니다.

    - '24시간', '상시개방'처럼 제한이 없으면 (None, None)
    - 시각이 하나만 있으면 여는 시각으로만 봅니다
    - 닫는 시각이 여는 시각보다 이르면('9:00~6:00') 오후로 해석해 봅니다
    - 읽지 못하면 (None, None) — 제약 없이 넘어갑니다
    """
    if not text:
        return None, None
    compact = text.replace(" ", "")
    if any(hint in compact for hint in _ALWAYS_OPEN_HINTS):
        return None, None

    times = _find_times(text)
    if not times:
        return None, None
    if len(times) == 1:
        return times[0], None

    open_min, close_min = times[0], times[1]
    if close_min <= open_min:
        # "9:00~6:00"처럼 오후 표기가 빠진 경우를 살려봅니다.
        if close_min + 12 * 60 > open_min and close_min < 12 * 60:
            close_min += 12 * 60
        else:
            return open_min, None
    return open_min, close_min


def parse_closed_days(text: Optional[str]) -> ClosedDays:
    """
    '매주 월요일', '연중무휴', '1월 1일' 같은 문자열에서 쉬는 날을 읽습니다.

    '매월 첫째 월요일'처럼 특정 주에만 쉬는 경우는 매주 쉬는 것으로 오해하지 않도록
    weekdays=None(모름)으로 두고 경고하지 않습니다 — 잘못된 휴무 경고는 멀쩡한
    일정을 포기하게 만들기 때문에, 확신할 수 있을 때만 알려줍니다.
    """
    if not text:
        return ClosedDays()

    compact = text.replace(" ", "")
    if any(hint in compact for hint in _NEVER_CLOSED_HINTS):
        return ClosedDays(weekdays=set())

    dates = {
        (int(m.group(1)), int(m.group(2)))
        for m in _MONTH_DAY_PATTERN.finditer(text)
        if 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31
    }

    if any(hint in compact for hint in _IRREGULAR_HINTS):
        return ClosedDays(weekdays=None, dates=dates)

    cleaned = compact
    for word in _NOT_WEEKDAY_WORDS:
        cleaned = cleaned.replace(word, "·")
    cleaned = _MONTH_DAY_PATTERN.sub("·", cleaned)

    weekdays = {_WEEKDAY_INDEX[m.group(1)] for m in _WEEKDAY_PATTERN.finditer(cleaned)}
    return ClosedDays(weekdays=weekdays, dates=dates)


def place_hours(attraction: Attraction) -> PlaceHours:
    """관광지의 부가정보(extra_info)에서 영업시간·휴무일을 읽어옵니다."""
    hours_text: Optional[str] = None
    rest_text: Optional[str] = None
    for info in attraction.extra_info or []:
        if hours_text is None and info.label in _HOURS_LABELS and info.value.strip():
            hours_text = info.value.strip()
        if rest_text is None and info.label in _REST_LABELS and info.value.strip():
            rest_text = info.value.strip()

    open_min, close_min = parse_open_close(hours_text)
    return PlaceHours(
        open_min=open_min,
        close_min=close_min,
        closed=parse_closed_days(rest_text),
        hours_text=hours_text,
        rest_text=rest_text,
    )


def dwell_minutes(category: Optional[str]) -> int:
    """그 장소에서 머무는 시간(분). 카테고리를 모르면 기본값을 씁니다."""
    return _DWELL_MINUTES.get(category or "", _DEFAULT_DWELL_MINUTES)


def travel_minutes(origin: Attraction, destination: Attraction) -> int:
    """
    두 장소 사이 이동 시간을 좌표로 추정합니다(분).

    실제 길찾기 API를 부르지 않는 이유는, 코스 하나에 구간이 여러 개라 생성할
    때마다 외부 호출이 그만큼 늘어나기 때문입니다. 정확한 경로·소요시간은 지도
    화면에서 이동수단을 고른 뒤 따로 보여줍니다. 여기서는 "두 시간 간격 고정"보다
    현실에 가까운 간격을 잡는 것이 목적입니다.
    """
    if not all([origin.latitude, origin.longitude, destination.latitude, destination.longitude]):
        return _MIN_TRAVEL_MIN

    lat1, lon1 = math.radians(origin.latitude), math.radians(origin.longitude)
    lat2, lon2 = math.radians(destination.latitude), math.radians(destination.longitude)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    distance_km = 6371.0 * 2 * math.asin(math.sqrt(a))

    minutes = distance_km * _ROAD_DETOUR_FACTOR / _AVERAGE_SPEED_KMH * 60
    return max(_MIN_TRAVEL_MIN, min(_MAX_TRAVEL_MIN, round(minutes)))


def _format(minutes: int) -> str:
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def _parse_visit_date(visit_date: Optional[str]) -> Optional[datetime.date]:
    if not visit_date:
        return None
    try:
        return datetime.date.fromisoformat(visit_date.strip())
    except ValueError:
        return None


def _closed_note(hours: PlaceHours, day: Optional[datetime.date]) -> Optional[str]:
    """방문일에 쉬는 곳이면 알려줍니다. 날짜를 모르면 아무 말도 하지 않습니다."""
    if day is None:
        return None
    if hours.closed.weekdays and day.weekday() in hours.closed.weekdays:
        return f"방문일({day.month}월 {day.day}일 {_WEEKDAY_NAME[day.weekday()]}요일)은 쉬는 날이에요"
    if (day.month, day.day) in hours.closed.dates:
        return f"방문일({day.month}월 {day.day}일)은 쉬는 날이에요"
    return None


def build_schedule(
    attractions: list[Attraction], visit_date: Optional[str] = None
) -> list[StopSchedule]:
    """
    정해진 순서대로 방문 시각을 계산합니다.

    첫 장소는 09:00(또는 그보다 늦게 연다면 개장 시각)에 도착하는 것으로 잡고,
    다음 장소부터는 '앞 장소 체류 시간 + 이동 시간'을 더해 나갑니다. 도착 예정
    시각이 개장 전이면 개장 시각으로 미루고, 영업 종료 이후면 그대로 두되 안내를
    붙입니다 — 시간을 조용히 바꾸면 사용자가 잘못된 계획을 세우게 됩니다.
    """
    day = _parse_visit_date(visit_date)
    schedules: list[StopSchedule] = []
    current = _DAY_START_MIN

    for index, attraction in enumerate(attractions):
        hours = place_hours(attraction)
        if index > 0:
            previous = attractions[index - 1]
            current += dwell_minutes(previous.category) + travel_minutes(previous, attraction)

        note: Optional[str] = None
        if hours.open_min is not None and current < hours.open_min:
            note = f"{_format(hours.open_min)} 문을 열어서 그 시간에 맞췄어요"
            current = hours.open_min

        # 그날 안에 실제로 갈 수 있는지 — 셋 중 하나라도 걸리면 다음 날로 넘기는
        # 편이 낫습니다. 휴무일도 포함하는 이유는, 다음 날이면 요일이 바뀌어
        # 해결되는 경우가 많기 때문입니다(연속 휴무면 그때 다시 경고합니다).
        fits_today = True
        if hours.close_min is not None and current >= hours.close_min:
            note = f"{_format(hours.close_min)}에 문을 닫아 도착 예정 시간에는 이용이 어려울 수 있어요"
            fits_today = False
        elif current > _TOO_LATE_MIN:
            note = "앞 일정이 길어 하루 안에 모두 방문하기는 어려울 수 있어요"
            fits_today = False

        closed_note = _closed_note(hours, day)
        if closed_note is not None:
            fits_today = False

        schedules.append(
            StopSchedule(
                arrival_time=_format(current),
                time_note=note,
                closed_note=closed_note,
                fits_today=fits_today,
            )
        )

    return schedules


def next_day_of(visit_date: Optional[str]) -> Optional[str]:
    """방문 예정일의 다음 날("YYYY-MM-DD"). 날짜를 모르거나 형식이 이상하면 None."""
    day = _parse_visit_date(visit_date)
    return (day + datetime.timedelta(days=1)).isoformat() if day else None


def is_closed_on(attraction: Attraction, visit_date: Optional[str]) -> bool:
    """
    그 날짜에 확실히 쉬는 곳인지. 날짜를 모르거나 휴무 규칙이 불확실하면 False입니다.

    "아마 쉴 것 같다"까지 True로 잡으면 멀쩡한 후보가 추천에서 빠지므로,
    확신할 수 있을 때만 True를 돌려줍니다.
    """
    day = _parse_visit_date(visit_date)
    if day is None:
        return False
    return _closed_note(place_hours(attraction), day) is not None


def hours_payload(attraction: Attraction) -> dict:
    """
    AI 프롬프트에 실을 영업 조건. 값이 없으면 항목 자체를 넣지 않습니다.

    시각 자체는 시스템이 계산하지만, AI가 순서를 정할 때 "문 닫는 곳을 마지막에
    두지 않기", "점심시간에 음식점 배치하기" 같은 판단을 하려면 이 정보가 필요합니다.
    """
    hours = place_hours(attraction)
    payload: dict = {}
    if hours.open_min is not None:
        payload["opens_at"] = _format(hours.open_min)
    if hours.close_min is not None:
        payload["closes_at"] = _format(hours.close_min)
    if hours.closed.weekdays:
        payload["closed_weekdays"] = [_WEEKDAY_NAME[w] for w in sorted(hours.closed.weekdays)]
    elif hours.rest_text and hours.closed.weekdays is None:
        # 규칙을 확신할 수 없는 표현(예: '매월 첫째 월요일')은 원문 그대로 넘겨
        # AI가 필요하면 설명에 녹일 수 있게 합니다.
        payload["rest_day_note"] = hours.rest_text[:40]
    return payload
