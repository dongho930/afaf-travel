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
import itertools
import math
import re
from dataclasses import dataclass, field
from typing import Optional

from app.models.schemas import Attraction
from app.services.place_intent import meal_slot_indices

# 하루 일정의 기본 시작 시각(09:00)과, 이보다 늦어지면 "하루에 다 돌기 어렵다"고
# 알려주는 기준(20:00). 첫 장소가 더 늦게 열면 시작 시각은 그 개장 시각이 됩니다.
#
# 이 두 값은 화면에 보여주는 '추천 방문 시간'의 범위이기도 합니다. 계산은 20시를
# 넘겨서도 이어지지만(그래야 '하루에 못 돈다'를 판단할 수 있습니다), 표시만큼은
# 09:00~20:00 안에 머뭅니다 — 예전에는 일정이 길어지면 23:40이 그대로 찍히거나,
# 자정을 넘긴 25:00이 _format의 24시간 나머지 연산 때문에 '01:00'으로 감겨서
# 새벽에 가라는 것처럼 보였습니다.
_DAY_START_MIN = 9 * 60
_TOO_LATE_MIN = 20 * 60

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

# 음식점 방문이 걸쳐야 하는 식사 시간대. AI/대체 로직에게도 같은 문구로
# "식사 시간에 들르라"고 요청하지만, 순서만으로는 실제 도착 시각까지 맞다고
# 보장할 수 없어 여기서 한 번 더 확인해 당겨줍니다. 시간이 이미 이 범위 안이면
# 건드리지 않고, 범위 앞이면 시작 시각으로 당기고, 이미 지났으면 포기합니다
# (저녁 시간을 놓쳤다고 자정까지 미루는 것은 오히려 이상한 일정이 됩니다).
_MEAL_WINDOWS: tuple[tuple[str, int, int], ...] = (
    ("아침", 7 * 60, 9 * 60),
    ("점심", 11 * 60, 14 * 60),
    ("저녁", 17 * 60, 20 * 60),
)

# 음식점에 식사 시간대를 나눠줄 때의 우선순위. 하루 코스는 09:00에 시작하므로
# 첫 끼를 아침으로 잡으면 대부분 어색합니다 — 아침은 "영업시간상 아침밖에 안 되는
# 곳"(예: 10시에 문을 닫는 해장국집)에만 돌아가도록 맨 뒤에 둡니다.
_MEAL_PRIORITY = ("점심", "저녁", "아침")

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
    distance_km = route_distance_km(origin, destination)
    if distance_km is None:
        return _MIN_TRAVEL_MIN

    minutes = distance_km / _AVERAGE_SPEED_KMH * 60
    return max(_MIN_TRAVEL_MIN, min(_MAX_TRAVEL_MIN, round(minutes)))


def straight_distance_km(origin: Attraction, destination: Attraction) -> Optional[float]:
    """
    두 장소 사이 직선거리(km). 좌표가 없으면 None입니다.

    사용자에게 보여주는 거리는 이 값을 '직선거리'라고 밝혀서 씁니다 — 도로 우회를
    추정해 곱한 값을 보여주면 지도 화면의 실제 길찾기 거리와 또 다른 숫자가 됩니다.
    """
    if not all([origin.latitude, origin.longitude, destination.latitude, destination.longitude]):
        return None

    lat1, lon1 = math.radians(origin.latitude), math.radians(origin.longitude)
    lat2, lon2 = math.radians(destination.latitude), math.radians(destination.longitude)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def route_distance_km(origin: Attraction, destination: Attraction) -> Optional[float]:
    """이동 시간 계산용 거리 추정치(km) — 직선거리에 도로 우회 계수를 곱한 값입니다."""
    distance = straight_distance_km(origin, destination)
    return distance * _ROAD_DETOUR_FACTOR if distance is not None else None


def meal_window_at(arrival_time: str) -> Optional[str]:
    """"HH:MM" 도착 시각이 걸치는 식사 시간대 이름(아침/점심/저녁). 아니면 None."""
    try:
        hour, minute = (int(part) for part in arrival_time.split(":"))
    except (ValueError, AttributeError):
        return None
    current = hour * 60 + minute
    return next((label for label, start, end in _MEAL_WINDOWS if start <= current <= end), None)


def _format(minutes: int) -> str:
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def _parse_visit_date(visit_date: Optional[str]) -> Optional[datetime.date]:
    if not visit_date:
        return None
    try:
        return datetime.date.fromisoformat(visit_date.strip())
    except ValueError:
        return None


def _meal_time_push(current: int) -> tuple[Optional[int], Optional[str]]:
    """
    음식점이 식사 시간대(아침/점심/저녁) 안에 들도록 당길 시각을 구합니다.

    이미 어느 한 시간대 안이면 (None, None) — 그대로 두라는 뜻입니다.
    시간대 앞이면 그 시간대의 시작 시각과 안내 문구를 돌려줍니다.
    모든 시간대를 이미 지났으면 (None, None) — 자정까지 미루는 것보다는
    원래 계산된 시각 그대로 두는 편이 낫습니다.
    """
    for label, start, end in _MEAL_WINDOWS:
        if start <= current <= end:
            return None, None
        if current < start:
            return start, f"{label} 식사 시간에 맞춰 방문 시각을 조정했어요"
    return None, None


def _servable_meals(hours: PlaceHours) -> list[tuple[str, int, int]]:
    """영업시간 안에서 실제로 식사할 수 있는 시간대만 추립니다.

    영업시간 정보가 없으면 세 시간대 모두 가능한 것으로 봅니다 — 정보가 없다는
    이유로 후보에서 빼면 대부분의 음식점이 배치 대상에서 통째로 빠집니다.
    """
    servable = []
    for label, start, end in _MEAL_WINDOWS:
        opens = max(hours.open_min or 0, start)
        closes = min(hours.close_min if hours.close_min is not None else 24 * 60, end)
        if opens <= closes:
            servable.append((label, start, end))
    return servable


def _assign_meals(hours_by_index: dict[int, PlaceHours]) -> dict[int, tuple[str, int, int]]:
    """
    음식점마다 어느 식사 시간대를 맡을지 정합니다 (한 시간대에 한 곳씩).

    선택지가 적은 곳부터 자리를 고릅니다 — '점심에만 여는 곳'이 아무 때나 갈 수
    있는 곳에 자리를 뺏겨 갈 데가 없어지는 일을 막기 위해서입니다. 자리를 받지
    못한 곳(식사 시간대보다 음식점이 많거나, 어느 시간대에도 못 여는 경우)은
    배치 대상에서 빠지고 원래 순서를 지킵니다.
    """
    options = {index: _servable_meals(hours) for index, hours in hours_by_index.items()}
    assigned: dict[int, tuple[str, int, int]] = {}
    taken: set[str] = set()

    for index in sorted(options, key=lambda i: (len(options[i]), i)):
        for label in _MEAL_PRIORITY:
            if label in taken:
                continue
            window = next((w for w in options[index] if w[0] == label), None)
            if window is None:
                continue
            assigned[index] = window
            taken.add(label)
            break
    return assigned


def arrange_for_meals(attractions: list[Attraction]) -> list[int]:
    """
    음식점이 식사 시간대에 오도록 방문 순서를 다시 잡습니다.

    돌려주는 값은 새 순서를 나타내는 '원래 목록에서의 인덱스'입니다 — 호출한 쪽이
    추천 이유처럼 장소와 나란히 들고 있는 정보도 같이 옮길 수 있어야 하기 때문입니다.

    순서를 정할 때 보는 것은 build_schedule과 같습니다(영업시간·이동·체류 시간).
    관광지만 늘어놓고 시계를 돌리다가, 배정받은 식사 시간대에 들어섰거나 관광지를
    하나 더 넣으면 그 시간대를 놓치게 되는 순간에 음식점을 끼워 넣습니다.
    음식점이 아닌 장소들끼리의 순서(혼잡도 순 등)는 그대로 지킵니다.
    """
    hours = [place_hours(a) for a in attractions]
    meal_slots = meal_slot_indices(attractions)
    assigned = _assign_meals({i: hours[i] for i in meal_slots})
    if not assigned:
        return _separate_food(attractions, list(range(len(attractions))))

    # 시간대가 이른 음식점부터 자리를 찾습니다. 나머지는 원래 순서 그대로 대기합니다.
    pending = sorted(assigned, key=lambda i: assigned[i][1])
    queue = [i for i in range(len(attractions)) if i not in assigned]

    def arrival_at(previous: Optional[int], nxt: int, clock: int) -> int:
        """앞 장소에서 출발해 nxt에 도착하는 시각 (첫 장소면 하루 시작 시각 그대로)."""
        if previous is None:
            return clock
        return (
            clock
            + dwell_minutes(attractions[previous].category)
            + travel_minutes(attractions[previous], attractions[nxt])
        )

    order: list[int] = []
    clock = _DAY_START_MIN
    previous: Optional[int] = None

    while pending or queue:
        chosen: Optional[int] = None
        for index in pending:
            _, start, end = assigned[index]
            # 여는 시각을 기다린 뒤가 아니라 '그냥 갔을 때' 도착하는 시각으로 봅니다.
            # 개장까지 기다린 시각으로 재면 17시에 여는 곳이 09시에도 "제때"로
            # 보여서, 아무 데도 안 들르고 여덟 시간을 기다리는 코스가 됩니다.
            at = arrival_at(previous, index, clock)

            if at >= start or at > end:
                # 식사 시간대에 들어섰거나(제때), 이미 지나버렸거나(더 미룰 이유 없음).
                chosen = index
                break
            if not queue:
                chosen = index
                break
            # 관광지를 하나 더 넣으면 이 식사 시간대를 놓치는지 내다봅니다.
            nxt = queue[0]
            back = arrival_at(previous, nxt, clock)
            back += dwell_minutes(attractions[nxt].category) + travel_minutes(
                attractions[nxt], attractions[index]
            )
            if back > end:
                chosen = index
                break

        if chosen is None:
            chosen = queue.pop(0)
        else:
            pending.remove(chosen)

        # 다음 장소 도착 시각을 가늠하려면 build_schedule과 같은 기준으로 시계를
        # 맞춰야 합니다 (최종 시각은 build_schedule이 다시 계산합니다).
        clock = arrival_at(previous, chosen, clock)
        if hours[chosen].open_min is not None and clock < hours[chosen].open_min:
            clock = hours[chosen].open_min
        if chosen in meal_slots:
            meal_time, _ = _meal_time_push(clock)
            if meal_time is not None and (
                hours[chosen].close_min is None or meal_time <= hours[chosen].close_min
            ):
                clock = meal_time

        order.append(chosen)
        previous = chosen

    return _separate_food(attractions, order)


def _food_adjacency(attractions: list[Attraction], order: list[int]) -> int:
    """음식점(카페 포함)이 바로 이어지는 곳의 수."""
    return sum(
        1 for a, b in zip(order, order[1:])
        if attractions[a].category == "음식점" and attractions[b].category == "음식점"
    )


def _order_quality(attractions: list[Attraction], order: list[int]) -> tuple[int, int]:
    """(식사 시간대에 도착하는 음식점 수, 그날 방문 가능한 장소 수) — 클수록 좋습니다."""
    placed = [attractions[i] for i in order]
    schedules = build_schedule(placed)
    meal_hits = sum(
        1 for place, scheduled in zip(placed, schedules)
        if place.category == "음식점" and meal_window_at(scheduled.arrival_time) is not None
    )
    return meal_hits, sum(1 for scheduled in schedules if scheduled.fits_today)


def _separate_food(attractions: list[Attraction], order: list[int]) -> list[int]:
    """
    음식점이 연달아 오지 않도록, 음식점이 아닌 장소 하나를 그 사이로 옮깁니다.

    식사 배치(arrange_for_meals)는 관광지가 다 떨어지면 남은 음식점을 바로 뒤에
    붙여서 '10:40 식당 → 11:50 또 식당' 같은 코스가 나왔습니다. 옮겨 보는 후보마다
    시각을 다시 계산해, 식사 시간대에 도착하는 음식점 수와 그날 방문 가능한 장소
    수가 줄지 않는 경우에만 받아들입니다. 사이에 둘 장소가 없으면(음식점만 고른
    경우 등) 그대로 두고, 코스 검증이 경고를 붙입니다.
    """
    current = list(order)
    while True:
        adjacency = _food_adjacency(attractions, current)
        if adjacency == 0:
            return current
        base_meals, base_fits = _order_quality(attractions, current)

        best: Optional[tuple[tuple[int, int, int, int], list[int]]] = None
        for from_pos, index in enumerate(current):
            if attractions[index].category == "음식점":
                continue
            rest = current[:from_pos] + current[from_pos + 1:]
            for to_pos in range(len(rest) + 1):
                candidate = rest[:to_pos] + [index] + rest[to_pos:]
                candidate_adjacency = _food_adjacency(attractions, candidate)
                if candidate_adjacency >= adjacency:
                    continue
                meals, fits = _order_quality(attractions, candidate)
                if meals < base_meals or fits < base_fits:
                    continue
                # 연속을 더 많이 풀고, 식사·방문 가능 수가 많고, 덜 움직이는 쪽을 고릅니다.
                key = (-candidate_adjacency, meals, fits, -abs(from_pos - to_pos))
                if best is None or key > best[0]:
                    best = (key, candidate)
        if best is None:
            return current
        current = best[1]


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

    돌려주는 시각은 언제나 09:00~20:00 안입니다. 20시를 넘기는 장소는 이미
    fits_today=False로 표시되므로, 시각은 20:00에서 멈추고 '다음 날로 나누기'
    안내가 대신 상황을 설명합니다.
    """
    day = _parse_visit_date(visit_date)
    meal_slots = meal_slot_indices(attractions)
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

        # 음식점은 개장 시각을 반영한 뒤에도 식사 시간대 밖이면 당겨줍니다.
        # 당긴 시각이 영업 종료 이후가 되면(예: 15시에 닫는 곳을 저녁으로 당기는 경우)
        # 포기합니다 — 실제로 갈 수 없는 시각으로 밀어붙이는 것보다야 낫습니다.
        if index in meal_slots:
            meal_time, meal_note = _meal_time_push(current)
            if meal_time is not None and (hours.close_min is None or meal_time <= hours.close_min):
                current = meal_time
                note = meal_note

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
                # 표시는 20시에서 멈춥니다. 그 뒤 장소들은 위에서 이미 '하루 안에
                # 못 돈다'로 표시돼 다음 날로 나누자는 안내가 붙으므로, 시각까지
                # 밤늦게/새벽으로 찍어 혼란을 더할 이유가 없습니다.
                arrival_time=_format(min(current, _TOO_LATE_MIN)),
                time_note=note,
                closed_note=closed_note,
                fits_today=fits_today,
            )
        )

    return schedules


# 방문 순서를 전부 따져볼 최대 장소 수 (7곳이면 5,040가지 — 한 번에 수십 ms).
_EXHAUSTIVE_ORDER_LIMIT = 7
# 가장 짧은 동선보다 이만큼 안쪽이면 '거의 같은 동선'으로 보고 혼잡도로 고릅니다.
_NEAR_SHORTEST_RATIO = 1.05


def best_visit_order(
    attractions: list[Attraction], visit_date: Optional[str] = None,
    crowd: Optional[list[float]] = None,
) -> Optional[list[int]]:
    """
    고른 장소들의 방문 순서를 코드가 정합니다. 돌려주는 값은 원래 목록의 인덱스 순서.

    예전엔 AI가 순서를 정하고 식당 위치만 바로잡았는데, 평가해 보니 같은 장소를 가장
    짧게 도는 순서보다 평균 1.45배 먼 길을 돌았습니다 (36개 중 29개가 1.2배 초과).
    장소가 몇 곳 안 되니 가능한 순서를 전부 따져서 아래 순으로 고릅니다.
      1. 그날 실제로 들를 수 있는 곳이 많은 순서 (문 닫은 뒤 도착·20시 초과 줄이기)
      2. 식당이 식사 시간대에 도착하는 수가 많은 순서
      3. 식당이 연달아 오지 않는 순서
      4. 이동 거리가 짧은 순서
    이동 거리가 가장 짧은 것보다 5% 안쪽인 순서들끼리는, 붐비는 곳(crowd 값이 큰 곳)을
    사람이 몰리기 전인 앞쪽에 두는 순서를 고릅니다.

    장소가 _EXHAUSTIVE_ORDER_LIMIT보다 많으면 None — 호출한 쪽이 기존 방식을 씁니다.
    """
    count = len(attractions)
    if count > _EXHAUSTIVE_ORDER_LIMIT:
        return None
    if count <= 1:
        return list(range(count))
    # 순서마다 build_schedule을 통째로 돌리면 7곳(5,040가지)에 1초 가까이 걸려서,
    # 같은 규칙(체류·이동·개장 대기·식사 시간 당기기·영업 종료·20시)을 숫자로만 따라갑니다.
    hours = [place_hours(a) for a in attractions]
    meal_slots = meal_slot_indices(attractions)
    dwell = [dwell_minutes(a.category) for a in attractions]
    moves = [[travel_minutes(a, b) for b in attractions] for a in attractions]
    legs = [[route_distance_km(a, b) or 0.0 for b in attractions] for a in attractions]
    is_food = [a.category == "음식점" for a in attractions]
    crowd = crowd or [0.0] * count

    def simulate(order: tuple[int, ...]) -> tuple[int, int]:
        fits = meals = 0
        current = _DAY_START_MIN
        for position, i in enumerate(order):
            if position:
                previous = order[position - 1]
                current += dwell[previous] + moves[previous][i]
            h = hours[i]
            if h.open_min is not None and current < h.open_min:
                current = h.open_min
            if i in meal_slots:
                meal_time, _ = _meal_time_push(current)
                if meal_time is not None and (h.close_min is None or meal_time <= h.close_min):
                    current = meal_time
                shown = min(current, _TOO_LATE_MIN)
                meals += any(start <= shown <= end for _, start, end in _MEAL_WINDOWS)
            closes_before = h.close_min is not None and current >= h.close_min
            fits += not closes_before and current <= _TOO_LATE_MIN
        return fits, meals

    scored: list[tuple[tuple[int, int, int], float, float, tuple[int, ...]]] = []
    for order in itertools.permutations(range(count)):
        fits, meals = simulate(order)
        food_in_a_row = sum(is_food[a] and is_food[b] for a, b in zip(order, order[1:]))
        distance = sum(legs[a][b] for a, b in zip(order, order[1:]))
        # 붐비는 곳이 뒤로 갈수록 커지는 값 (작을수록 붐비는 곳이 앞에 있음).
        crowd_late = sum(position * crowd[i] for position, i in enumerate(order))
        scored.append(((-fits, -meals, food_in_a_row), distance, crowd_late, order))

    best_rules = min(item[0] for item in scored)
    finalists = [item for item in scored if item[0] == best_rules]
    shortest = min(item[1] for item in finalists)
    near = [item for item in finalists if item[1] <= shortest * _NEAR_SHORTEST_RATIO + 1e-9]
    # 혼잡도도 같으면 거리, 그래도 같으면 원래 순서에 가까운 쪽 (결과가 매번 같도록).
    return list(min(near, key=lambda item: (item[2], item[1], item[3]))[3])


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
