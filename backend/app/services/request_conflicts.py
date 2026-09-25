"""
AI 플래너 요청에서 '화면에서 고른 조건'과 '문장에 적은 조건'이 서로 맞지 않는지 찾습니다.

추천 우선순위는 화면에서 고른 유형·지역·일정이 먼저이고, 문장은 그 안에서 무엇을
더 원하는지를 읽는 데만 씁니다. 그런데 두 값이 어긋나면(예: '시각 장애인'을 골랐는데
문장에 "청각 장애인을 위한") 어느 쪽을 따라도 사용자가 원한 결과가 아닙니다. 그래서
추천으로 넘어가지 않고, 무엇이 맞지 않는지 알려준 뒤 다시 고르거나 고쳐 쓰게 합니다.

판단은 규칙(단어 표)으로만 합니다. AI 해석은 문장에 없는 걸 추측해 채우는 일이 있어서,
추천을 막는 판단에는 쓰지 않습니다.
"""
from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

from app.services.sigungu_codes import resolve_sigungu_codes, signgu_name

USER_TYPE_NAMES: dict[str, str] = {
    "wheelchair": "지체 장애인",
    "visual": "시각 장애인",
    "hearing": "청각 장애인",
    "stroller": "영유아 가족",
    "pregnant": "임산부",
    "senior": "고령자",
    "general": "일반",
}

# 문장에서 '누구를 위한 여행인지'를 나타내는 표현. 동행자 표현("아이랑", "부모님")은
# 유형이 아니라서 넣지 않습니다 — 휠체어 이용자가 아이와 함께 갈 수도 있습니다.
_TYPE_PATTERNS: dict[str, re.Pattern] = {
    "wheelchair": re.compile(r"휠체어|지체\s*장애|전동\s*스쿠터"),
    "visual": re.compile(r"시각\s*장애|저시력|안내견|점자|맹인"),
    "hearing": re.compile(r"청각|농인|난청|수어|수화|보청기"),
    "stroller": re.compile(r"유모차|유아차|영유아"),
    "pregnant": re.compile(r"임산부|임신|임부|태교|만삭"),
    "senior": re.compile(r"고령|노인|어르신|시니어"),
}

# 함께 언급돼도 어긋난 게 아닌 조합. 고령자는 휠체어를 빌려 쓰는 경우가 많고,
# 임산부와 영유아 가족은 한 가족 안에서 함께 나오는 경우가 흔합니다.
_COMPATIBLE: dict[str, set[str]] = {
    "senior": {"wheelchair"},
    "pregnant": {"stroller"},
    "stroller": {"pregnant"},
}

_WEEKDAYS = "월화수목금토일"


@dataclass(frozen=True)
class Conflict:
    field: str   # "user_type" | "region" | "date"
    message: str


def _mentioned_types(text: str) -> dict[str, str]:
    """문장에 나온 유형 -> 처음 나온 표현."""
    found: dict[str, str] = {}
    for user_type, pattern in _TYPE_PATTERNS.items():
        m = pattern.search(text)
        if m:
            found[user_type] = m.group(0)
    return found


def _type_conflict(text: str, user_type: str) -> Conflict | None:
    mentioned = _mentioned_types(text)
    if not mentioned:
        return None
    allowed = {user_type} | _COMPATIBLE.get(user_type, set())
    # 선택한 유형이 문장에도 있으면(여러 유형이 함께 가는 경우 포함) 어긋난 게 아닙니다.
    if user_type != "general" and allowed & set(mentioned):
        return None
    other = next(t for t in mentioned if t not in allowed)
    return Conflict(
        "user_type",
        f"유형은 '{USER_TYPE_NAMES.get(user_type, user_type)}'(으)로 골랐는데, "
        f"문장에는 '{mentioned[other]}'({USER_TYPE_NAMES[other]})이(가) 들어 있어요.",
    )


def _region_label(codes: list[int]) -> str:
    names = [n for n in (signgu_name(c) for c in codes) if n]
    cities = sorted({n.split()[0] for n in names})
    return names[0] if len(names) == 1 else (cities[0] if len(cities) == 1 else ", ".join(cities))


def _region_conflict(text: str, sigungu_cd: int | None, region: str) -> Conflict | None:
    if sigungu_cd is None:
        return None  # 지역을 고르지 않았으면 문장의 지역을 그대로 씁니다(충돌 아님).
    codes = resolve_sigungu_codes(text, region)
    if not codes or sigungu_cd in codes:
        return None
    return Conflict(
        "region",
        f"지역은 '{signgu_name(sigungu_cd) or sigungu_cd}'(으)로 골랐는데, "
        f"문장에는 '{_region_label(codes)}'이(가) 들어 있어요.",
    )


def _today_kst() -> datetime.date:
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()


def _week_start(day: datetime.date) -> datetime.date:
    return day - datetime.timedelta(days=day.weekday())


_RELATIVE_DAYS = {"오늘": 0, "내일": 1, "모레": 2, "글피": 3}
_WEEK_PREFIX = r"(이번\s*주|이번주|다음\s*주|다음주|담주)?\s*"


def _date_expressions(text: str, today: datetime.date) -> list[tuple[str, set[datetime.date] | None, set[int] | None, set[tuple[int, int]] | None]]:
    """
    문장에 나온 날짜 표현 -> (원문, 가능한 날짜들, 가능한 요일들, 가능한 월/일들).
    셋 중 하나만 채워집니다.
    """
    found = []
    for word, offset in _RELATIVE_DAYS.items():
        if word in text:
            found.append((word, {today + datetime.timedelta(days=offset)}, None, None))

    for m in re.finditer(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", text):
        found.append((m.group(0), None, None, {(int(m.group(1)), int(m.group(2)))}))

    def week_dates(prefix: str | None, weekdays: set[int]) -> set[datetime.date]:
        start = _week_start(today) + datetime.timedelta(days=0 if prefix.startswith("이번") else 7)
        return {start + datetime.timedelta(days=w) for w in weekdays}

    for m in re.finditer(_WEEK_PREFIX + r"([월화수목금토일])요일", text):
        prefix, weekday = m.group(1), _WEEKDAYS.index(m.group(2))
        if prefix:
            found.append((m.group(0).strip(), week_dates(prefix, {weekday}), None, None))
        else:
            found.append((m.group(0).strip(), None, {weekday}, None))

    for m in re.finditer(_WEEK_PREFIX + r"주말", text):
        prefix = m.group(1)
        if prefix:
            found.append((m.group(0).strip(), week_dates(prefix, {5, 6}), None, None))
        else:
            found.append(("주말", None, {5, 6}, None))
    if "평일" in text:
        found.append(("평일", None, {0, 1, 2, 3, 4}, None))
    return found


def _date_conflict(text: str, visit_date: str | None, today: datetime.date) -> Conflict | None:
    if not visit_date:
        return None  # 날짜를 고르지 않았으면 비교할 대상이 없습니다.
    try:
        day = datetime.date.fromisoformat(visit_date[:10])
    except ValueError:
        return None
    for expr, dates, weekdays, month_days in _date_expressions(text, today):
        ok = (
            (dates is not None and day in dates)
            or (weekdays is not None and day.weekday() in weekdays)
            or (month_days is not None and (day.month, day.day) in month_days)
        )
        if not ok:
            label = f"{day.month}월 {day.day}일({_WEEKDAYS[day.weekday()]})"
            return Conflict(
                "date",
                f"방문일은 '{label}'(으)로 골랐는데, 문장에는 '{expr}'이(가) 들어 있어요.",
            )
    return None


def find_conflicts(
    query_text: str,
    user_type: str,
    sigungu_cd: int | None,
    visit_date: str | None,
    region: str = "경기도",
    today: datetime.date | None = None,
) -> list[Conflict]:
    text = query_text or ""
    today = today or _today_kst()
    return [
        c for c in (
            _type_conflict(text, user_type),
            _region_conflict(text, sigungu_cd, region),
            _date_conflict(text, visit_date, today),
        )
        if c is not None
    ]


_FIELD_NAMES = {"user_type": "유형", "region": "지역", "date": "방문일"}


def conflict_message(conflicts: list[Conflict]) -> str:
    """앱이 알림으로 그대로 보여줄 안내 문구."""
    lines = ["고른 조건과 입력한 문장이 서로 맞지 않아요."]
    lines += [f"· {c.message}" for c in conflicts]
    fields = "·".join(dict.fromkeys(_FIELD_NAMES[c.field] for c in conflicts))
    lines.append(f"{fields}을(를) 다시 선택하거나, 문장을 고쳐서 다시 시도해주세요.")
    return "\n".join(lines)
