"""
문장 조건은 거르지 않고 점수로 순서만 정하는지, 같은 점수면 접근성 등급이 높은 곳이
앞인지, 문장 조건에 맞는 곳이 없으면 무엇을 못 찾았는지 알리는지.
"""
import asyncio

import pytest

from app.models.schemas import AccessibilityFeatures, Attraction
from app.services import tour_api
from app.services.accessibility_criteria import PARSE_VERSION
from app.services.query_preferences import extract_preferences, text_matches, unmet_labels

# 휠체어 기준: 접근로 + 장애인 화장실이면 목록에 들어갑니다.
WHEELCHAIR_LOW = {"has_ramp": True, "has_accessible_restroom": True}
WHEELCHAIR_HIGH = {**WHEELCHAIR_LOW, "has_parking": True, "has_exit": True, "has_wheelchair_rental": True}


def _place(cid: str, name: str, category: str = "관광지") -> Attraction:
    return Attraction(content_id=cid, name=name, address="경기도 수원시", latitude=37.28,
                      longitude=127.01, category=category)


def _run(monkeypatch, places, rows, query, user_type="wheelchair", limit=4):
    client = tour_api.tour_api_client
    monkeypatch.setattr(client, "use_mock", False)

    async def region(_code="41"):
        return places

    async def cached(ids):
        return {cid: {**rows[cid], "parse_version": PARSE_VERSION} for cid in ids if cid in rows}

    async def no_display(_candidates):
        return None

    monkeypatch.setattr(client, "_region_attractions", region)
    monkeypatch.setattr(tour_api, "get_cached_place_accessibility", cached)
    monkeypatch.setattr(client, "_fill_display_info", no_display)

    async def no_fallback(**_kwargs):  # 후보가 적을 때의 보충 경로(실시간 조회)는 막아둡니다
        return []

    monkeypatch.setattr(client, "search_accessible_attractions", no_fallback)
    return asyncio.run(client.sample_accessible_candidates(
        region="경기도", user_type=user_type, limit=limit, query_text=query,
    ))


# ---- 문장 읽기 ----

def test_문장에서_특성과_편의시설을_읽는다():
    prefs = extract_preferences("호수 근처 산책로인데 화장실이랑 엘리베이터 있는 곳")
    assert {c.label for c in prefs.concepts} == {"산책로", "호수·물가"}
    assert {f.label for f in prefs.facilities} == {"장애인 화장실이 있는", "엘리베이터가 있는"}


def test_박물관은_물가로_잡지_않는다():
    prefs = extract_preferences("호수 보러 가고 싶어")
    assert text_matches(_place("1", "수원박물관", "문화시설"), prefs)[0] == 0
    assert text_matches(_place("2", "광교호수공원"), prefs)[0] > 0


# ---- 후보 순서 ----

def test_문장_조건에_맞는_곳이_앞에_온다(monkeypatch):
    places = [_place(str(i), f"평범한 관광지{i}") for i in range(10)] + [_place("lake", "광교호수공원")]
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}

    result = _run(monkeypatch, places, rows, "호수 보러 가고 싶어")

    assert result[0].content_id == "lake"


def test_유형_조건은_문장보다_먼저다(monkeypatch):
    """문장에 딱 맞아도 고른 유형(휠체어) 기준을 못 넘으면 후보가 아닙니다."""
    places = [_place("lake", "광교호수공원"), _place("ok", "평범한 관광지")]
    rows = {"lake": {"has_parking": True}, "ok": WHEELCHAIR_LOW}

    result = _run(monkeypatch, places, rows, "호수 보러 가고 싶어")

    assert [a.content_id for a in result] == ["ok"]


def test_문장_조건이_같으면_등급이_높은_곳이_앞이다(monkeypatch):
    places = [_place(str(i), f"평범한 관광지{i}") for i in range(8)] + [_place("best", "평범한 관광지 best")]
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}
    rows["best"] = WHEELCHAIR_HIGH

    result = _run(monkeypatch, places, rows, "좋은 곳 추천해줘", limit=3)

    assert result[0].content_id == "best"


def test_편의시설_표현은_그_시설을_갖춘_곳에_점수를_준다(monkeypatch):
    places = [_place(str(i), f"평범한 관광지{i}") for i in range(8)] + [_place("elev", "평범한 관광지 elev")]
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}
    rows["elev"] = {**WHEELCHAIR_LOW, "has_elevator": True}

    result = _run(monkeypatch, places, rows, "엘리베이터 있는 곳", limit=3)

    assert result[0].content_id == "elev"


# ---- 찾지 못한 조건 안내 ----

def test_문장_조건에_맞는_곳이_없으면_무엇을_못_찾았는지_알려준다():
    candidates = [_place("1", "평범한 관광지")]
    candidates[0].accessibility = AccessibilityFeatures(**WHEELCHAIR_LOW)
    prefs = extract_preferences("호수 근처인데 수유실 있는 곳")

    assert unmet_labels(candidates, prefs) == ["호수·물가", "수유실이 있는"]


@pytest.mark.parametrize("query", ["맛있는 거 먹고 싶어", "좋은 곳 추천해줘"])
def test_특성이_없는_문장은_안내할_것도_없다(query):
    assert unmet_labels([_place("1", "평범한 관광지")], extract_preferences(query)) == []
