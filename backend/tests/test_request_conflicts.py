"""
화면에서 고른 유형·지역·방문일과 문장이 어긋나면 추천으로 넘어가지 않는지.

우선순위는 고른 값이 먼저이고 문장은 그 안에서의 취향입니다. 둘이 어긋나면 어느
쪽을 따라도 사용자가 원한 결과가 아니라서, 무엇이 맞지 않는지 알려주고 멈춥니다.
"""
import asyncio
import datetime

import pytest
from fastapi import HTTPException

from app.models.schemas import PlaceRecommendationRequest, UserType
from app.routers.courses import recommend_course_places
from app.services.request_conflicts import conflict_message, find_conflicts
from app.services.sigungu_codes import resolve_sigungu_codes

TODAY = datetime.date(2026, 9, 25)  # 금요일
PALDAL = 41115  # 수원시 팔달구


def _fields(text, user_type="general", sigungu=None, date=None):
    return [c.field for c in find_conflicts(text, user_type, sigungu, date, today=TODAY)]


# ---- 유형 ----

def test_다른_유형을_문장에_쓰면_막는다():
    assert _fields("청각 장애인을 위한 전시 추천해줘", "visual") == ["user_type"]


@pytest.mark.parametrize("text, user_type", [
    ("점자블록 있는 박물관", "visual"),                  # 같은 유형
    ("어르신 휠체어 대여되는 곳", "senior"),              # 고령자는 휠체어 대여를 흔히 씀
    ("유모차 끌고 임산부랑 갈 곳", "pregnant"),            # 한 가족 안에서 함께 나옴
    ("휠체어 타는 아빠랑 청각장애 동생", "wheelchair"),     # 선택한 유형이 문장에도 있음
    ("아이랑 부모님 모시고 갈 곳", "wheelchair"),          # 동행자 표현은 유형이 아님
    ("시각적으로 예쁜 카페", "hearing"),                   # '시각적'은 시각장애가 아님
])
def test_어긋나지_않는_경우는_통과한다(text, user_type):
    assert _fields(text, user_type) == []


def test_일반을_골랐는데_특정_유형을_쓰면_막는다():
    assert _fields("휠체어로 갈 수 있는 곳", "general") == ["user_type"]


# ---- 지역 ----

def test_다른_지역을_문장에_쓰면_막는다():
    assert _fields("용인 에버랜드 가고 싶어", sigungu=PALDAL) == ["region"]


@pytest.mark.parametrize("text", [
    "수원에서 갈 만한 곳",          # 고른 구를 포함하는 시
    "수원화성 산책하고 싶어",       # 관광지 이름 속 '화성'
    "양평해장국 맛집 추천",         # 지역 이름이 붙은 음식
    "산책로 추천해줘",              # 지역 표현 없음
])
def test_같은_지역이거나_지역이_아니면_통과한다(text):
    assert _fields(text, sigungu=PALDAL) == []


def test_지역을_고르지_않았으면_문장의_지역은_충돌이_아니다():
    assert _fields("용인 에버랜드 가고 싶어") == []


def test_음식_이름은_지역으로_잡지_않는다():
    assert resolve_sigungu_codes("양평해장국 맛집") == []
    assert resolve_sigungu_codes("의정부 부대찌개 먹고 싶어") == []


# ---- 방문일 ----

@pytest.mark.parametrize("text, date", [
    ("토요일에 갈 곳", "2026-09-25"),          # 금요일을 골랐는데 토요일
    ("주말에 갈 곳", "2026-09-28"),            # 월요일
    ("10월 3일에 갈 곳", "2026-10-04"),
    ("내일 갈 곳", "2026-09-28"),              # 내일 = 9/26
    ("다음 주 토요일", "2026-09-26"),          # 다음 주 토요일 = 10/3
])
def test_다른_날짜를_문장에_쓰면_막는다(text, date):
    assert _fields(text, date=date) == ["date"]


@pytest.mark.parametrize("text, date", [
    ("토요일에 갈 곳", "2026-10-03"),
    ("주말에 갈 곳", "2026-09-27"),
    ("10월 3일에 갈 곳", "2026-10-03"),
    ("내일 갈 곳", "2026-09-26"),
    ("이번 주 토요일", "2026-09-26"),
    ("다음 주 토요일", "2026-10-03"),
    ("토요일에 갈 곳", None),                  # 날짜를 고르지 않음
])
def test_같은_날짜거나_고르지_않았으면_통과한다(text, date):
    assert _fields(text, date=date) == []


# ---- 안내 문구와 API ----

def test_안내_문구에_무엇이_어긋났는지와_다시_고르라는_말이_들어간다():
    conflicts = find_conflicts("청각 장애인 위한 용인 토요일 코스", "visual", PALDAL, "2026-09-25", today=TODAY)
    message = conflict_message(conflicts)

    assert [c.field for c in conflicts] == ["user_type", "region", "date"]
    assert "청각" in message and "용인" in message and "토요일" in message
    assert "다시 선택하거나" in message


def test_추천_API는_충돌이_있으면_추천하지_않고_422로_알린다():
    request = PlaceRecommendationRequest(
        query_text="청각 장애인을 위한 전시 추천해줘", user_type=UserType.VISUAL,
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(recommend_course_places(request))

    assert exc.value.status_code == 422
    assert "청각" in exc.value.detail
