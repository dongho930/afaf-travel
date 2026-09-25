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


# ---- 소개문 ----

@pytest.fixture
def overviews(monkeypatch):
    """소개문 캐시를 흉내 냅니다. 메모리에 든 특성 표시는 테스트마다 비웁니다."""
    from app.services import query_preferences

    texts: dict[str, str] = {}
    calls: list[list[str]] = []

    async def fake_texts(ids):
        calls.append(list(ids))
        return {i: texts[i] for i in ids if i in texts}

    monkeypatch.setattr(query_preferences, "get_cached_overview_texts", fake_texts)
    query_preferences._OVERVIEW_TAGS.clear()
    yield texts, calls
    query_preferences._OVERVIEW_TAGS.clear()


def test_이름에_없어도_소개문에_있으면_찾는다(monkeypatch, overviews):
    texts, _ = overviews
    places = [_place(str(i), f"평범한 관광지{i}") for i in range(8)] + [_place("hidden", "평범한 관광지 hidden")]
    texts["hidden"] = "넓은 호수를 따라 걷는 길이 잘 정비되어 있다."
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}

    result = _run(monkeypatch, places, rows, "호수 보러 가고 싶어", limit=3)

    assert result[0].content_id == "hidden"


def test_이름에_맞는_곳이_소개문에만_맞는_곳보다_앞이다(monkeypatch, overviews):
    texts, _ = overviews
    places = [_place("named", "광교호수공원"), _place("hidden", "평범한 관광지")]
    texts["hidden"] = "호수가 보이는 전망이 좋다."
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}

    result = _run(monkeypatch, places, rows, "호수 보러 가고 싶어", limit=2)

    assert [a.content_id for a in result] == ["named", "hidden"]


def test_소개문의_짧은_말은_엉뚱하게_잡지_않는다():
    from app.services.query_preferences import _tags_from_overview

    assert "역사 유적" not in _tags_from_overview("무엇이 있을지 궁금해지는 곳")
    assert "쇼핑 장소" not in _tags_from_overview("주말이면 사람이 몰려 붐빈다")
    assert "역사 유적" in _tags_from_overview("조선 왕릉과 유적이 남아 있다")


def test_소개문은_한_번만_읽는다(monkeypatch, overviews):
    _, calls = overviews
    places = [_place(str(i), f"평범한 관광지{i}") for i in range(3)]
    rows = {p.content_id: WHEELCHAIR_LOW for p in places}

    _run(monkeypatch, places, rows, "호수 보러 가고 싶어")
    _run(monkeypatch, places, rows, "산책하고 싶어")

    assert len(calls) == 1  # 두 번째 요청은 메모리의 특성 표시를 씁니다


def test_특성_표현이_없으면_소개문을_읽지_않는다(monkeypatch, overviews):
    _, calls = overviews
    places = [_place("1", "평범한 관광지")]

    _run(monkeypatch, places, {"1": WHEELCHAIR_LOW}, "엘리베이터 있는 곳")

    assert calls == []


def test_소개문으로_맞는_곳이_있으면_못_찾았다고_하지_않는다(overviews):
    from app.services.query_preferences import _OVERVIEW_TAGS, _tags_from_overview

    _OVERVIEW_TAGS["1"] = (0.0, _tags_from_overview("호수 옆 산책길"))
    prefs = extract_preferences("호수 근처")

    assert unmet_labels([_place("1", "평범한 관광지")], prefs) == []


# ---- B단계: 분류코드·새 특성·AI가 고른 특성 ----

def test_이름에_없어도_분류코드가_맞으면_특성으로_본다():
    prefs = extract_preferences("역사 유적 둘러보기")
    haenggung = _place("hg", "화성행궁").model_copy(update={"lcls_systm": "HS010100"})
    assert text_matches(haenggung, prefs)[0] > 0


@pytest.mark.parametrize("query, label, name, lcls, category", [
    ("비 오는 날 갈 곳", "실내", "경기도어린이박물관", "VE070100", "문화시설"),
    ("비 오는 날 갈 곳", "실내", "스타필드 하남", None, "쇼핑"),
    ("동물 보러 가고 싶어", "동물", "아침고요가족동물원", "VE020300", "관광지"),
    ("도자기 만들기 해보고 싶어", "공예 체험", "도예공방 들꽃마을", None, "관광지"),
])
def test_새_특성을_알아듣는다(query, label, name, lcls, category):
    prefs = extract_preferences(query)
    place = _place("x", name, category).model_copy(update={"lcls_systm": lcls})
    assert label in {c.label for c in prefs.concepts}
    assert label in text_matches(place, prefs)[1]


def test_AI가_고른_특성은_점수에_쓰지만_못_찾았다는_안내는_하지_않는다():
    prefs = extract_preferences("시원하게 멍때리기 좋은 곳", ai_labels=["호수·물가", "없는 특성"])
    lake = _place("lk", "마장호수").model_copy(update={"lcls_systm": "NA020200"})

    assert text_matches(lake, prefs)[0] > 0            # AI 해석으로 호수를 찾고
    assert unmet_labels([_place("1", "평범한 곳")], prefs) == []  # 안내는 문장에 쓴 것만


def test_먹는_곳과_다른_활동을_함께_말하면_음식점만_남기지_않는다():
    from app.services.place_intent import venue_constraint_for_query

    constraint = venue_constraint_for_query("도자기 체험하고 쌀밥 먹기")
    assert constraint.allow_other_categories                 # 체험 장소도 추천
    assert [r.label for r in constraint.requirements] == ["음식점"]  # 식당은 여전히 필수

    only_food = venue_constraint_for_query("쌀밥 맛집 추천해줘")
    assert not only_food.allow_other_categories              # 먹는 것만 말하면 음식점만


def test_AI_해석에서_목록에_없는_특성은_버린다(monkeypatch):
    from app.services import ai_service

    async def fake_call(_system, _user, timeout=8.0):
        return {"region": None, "companion": "미지정", "purposes": [], "keywords": [],
                "concepts": ["호수·물가", "지어낸 특성"], "facilities": ["수유실이 있는", "아무거나"]}

    monkeypatch.setattr(ai_service, "_groq_call", fake_call)
    parsed = asyncio.run(ai_service._ai_parse("물멍하고 수유실"))

    assert parsed.concepts == ["호수·물가"]
    assert parsed.facilities == ["수유실이 있는"]


def test_직접_쓴_조건이_AI가_더한_조건보다_점수가_높다():
    prefs = extract_preferences("자연 속에서 쉬고 싶어", ai_labels=["호수·물가"])
    forest = _place("f", "물맑음수목원").model_copy(update={"lcls_systm": "NA040700"})
    island = _place("i", "자라섬").model_copy(update={"lcls_systm": "NA020500"})

    assert text_matches(forest, prefs)[0] > text_matches(island, prefs)[0] > 0
