"""
설명과 해석이 실제 근거에만 기대는지 확인합니다.

재현 사례:
- "이렇게 이해했어요"에 요청에 없던 '친구'가 들어갔습니다 (AI가 동행자를 추측).
- 오늘의초밥 설명에 등록되지 않은 "좌석 수가 충분해"가 들어갔습니다.
- AI가 고르지 않은 필수 유형을 채운 후보에 "요청하신 산책로 장소예요" 기본 문구만 붙었습니다.
"""

import asyncio

from app.models.schemas import (
    AccessibilityFeatures, Attraction, CompanionType, InfoField, PlaceRecommendationRequest, UserType,
)
from app.services import ai_service
from app.services.course_validator import clean_reason, describe_place


def place(cid: str, category: str = "관광지", name: str | None = None, info: dict | None = None,
          rate: float | None = None, **features) -> Attraction:
    return Attraction(
        content_id=cid, name=name or cid, category=category, address="경기도 수원시",
        latitude=37.28, longitude=127.01,
        accessibility=AccessibilityFeatures(**features),
        extra_info=[InfoField(label=k, value=v) for k, v in (info or {}).items()],
        congestion_rate=rate,
    )


def clear_parse_cache():
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()


# --- 동행자 해석 -------------------------------------------------------------------

def test_문장에_없는_동행자는_AI가_채워도_버린다(monkeypatch):
    clear_parse_cache()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def fake_call(*_args, **_kwargs):
        return {"region": None, "companion": "친구", "purposes": ["자연"], "keywords": []}

    monkeypatch.setattr(ai_service, "_groq_call", fake_call)
    parsed = asyncio.run(ai_service.parse_query("휠체어로 산책로 걷고 초밥 먹는 코스"))
    assert parsed.companion == CompanionType.UNSPECIFIED


def test_문장에_근거가_있으면_AI_동행자를_쓴다(monkeypatch):
    clear_parse_cache()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def fake_call(*_args, **_kwargs):
        return {"region": None, "companion": "가족", "purposes": [], "keywords": []}

    monkeypatch.setattr(ai_service, "_groq_call", fake_call)
    parsed = asyncio.run(ai_service.parse_query("우리 애랑 갈 만한 공원"))
    assert parsed.companion == CompanionType.FAMILY


def test_AI가_틀린_동행자를_주면_문장의_근거를_따른다(monkeypatch):
    clear_parse_cache()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")

    async def fake_call(*_args, **_kwargs):
        return {"region": None, "companion": "친구", "purposes": [], "keywords": []}

    monkeypatch.setattr(ai_service, "_groq_call", fake_call)
    parsed = asyncio.run(ai_service.parse_query("부부 둘이 조용한 카페"))
    assert parsed.companion == CompanionType.COUPLE


# --- 부가정보로 확인할 수 없는 주장 -------------------------------------------------

def test_좌석_정보가_없으면_좌석_문장을_지운다():
    sushi = place("sushi", "음식점", name="오늘의초밥", info={"대표 메뉴": "모둠초밥"}, has_ramp=True)
    reason = clean_reason("경사로가 있어 들어가기 좋아요. 좌석 수가 충분해 여유롭게 식사할 수 있어요.",
                          sushi, user_type="wheelchair")
    assert "좌석" not in reason
    assert "경사로" in reason


def test_좌석_정보가_있으면_좌석_문장을_남긴다():
    sushi = place("sushi", "음식점", name="오늘의초밥", info={"대표 메뉴": "모둠초밥", "좌석 수": "40석"})
    assert "좌석" in clean_reason("좌석 수가 충분해요.", sushi)


def test_주차는_편의시설이나_부가정보가_있을_때만_남긴다():
    assert "주차" not in clean_reason("주차가 편해요. 경치가 좋아요.", place("a"))
    assert "주차" in clean_reason("주차가 가능해요.", place("a", has_parking=True))
    assert "주차" in clean_reason("주차가 가능해요.", place("a", info={"주차시설": "가능"}))
    assert "주차" not in clean_reason("주차가 가능해요.", place("a", info={"주차시설": "없음"}))


def test_포장된_산책로는_포장_주문_주장이_아니다():
    assert "포장된 산책로" in clean_reason("포장된 산책로가 이어져 있어요.", place("park"))


def test_음식점_부가정보를_AI에게_넘긴다():
    sushi = place("sushi", "음식점", info={"대표 메뉴": "모둠초밥", "좌석 수": "40석"})
    plain = place("plain", "음식점", info={"대표 메뉴": "국밥"})
    request = ai_service.CourseRequest(query_text="초밥", user_type=UserType.GENERAL)
    prompt = ai_service._build_user_prompt(request, [sushi, plain])
    assert '"seats": "40석"' in prompt
    assert prompt.count('"seats"') == 1


# --- 끼워 넣은 후보의 설명 ---------------------------------------------------------

def test_데이터로_만든_설명은_기본_문구가_아니다():
    park = place("park", has_ramp=True, has_accessible_restroom=True, rate=20)
    text = describe_place(park, "wheelchair", lead="산책로 요청에 맞는 관광지예요.")
    assert text == (
        "산책로 요청에 맞는 관광지예요. 경사로·장애인 화장실 정보가 등록돼 있어요. "
        "혼잡도는 '여유'로 표시돼요."
    )


def test_음식점_설명에는_대표_메뉴가_들어간다():
    sushi = place("sushi", "음식점", info={"대표 메뉴": "모둠초밥, 연어덮밥, 우동"})
    assert "대표 메뉴는 모둠초밥, 연어덮밥이에요." in describe_place(sushi, "general")


def test_AI가_고르지_않은_필수_유형을_채울_때_구체적인_설명을_붙인다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")
    trail = place("trail", name="광교산책로", has_ramp=True, has_accessible_restroom=True)
    sushi = place("sushi", "음식점", name="오늘의초밥", info={"대표 메뉴": "모둠초밥"}, has_ramp=True)

    async def fake_recommend(*_args, **_kwargs):
        return [{"content_id": "sushi", "reason": "경사로가 있어요. 좌석 수가 충분해요."}]

    monkeypatch.setattr(ai_service, "_groq_recommend", fake_recommend)
    request = PlaceRecommendationRequest(query_text="산책로 걷고 점심 식사", user_type=UserType.WHEELCHAIR)
    result = {c.attraction.content_id: c.reason
              for c in asyncio.run(ai_service.recommend_places(request, [trail, sushi]))}

    assert "요청하신 산책로 장소예요" not in result["trail"]
    assert "경사로·장애인 화장실 정보가 등록돼 있어요." in result["trail"]
    assert "좌석" not in result["sushi"]


# --- 메뉴 이름 + '먹다'로 쓴 식사 요청 ---------------------------------------------

def test_초밥_먹기도_식사_요청으로_읽는다():
    from app.services.place_intent import venue_constraint_for_query

    for query in ("산책로 걷고 초밥 먹기", "국밥 먹으러 가는 코스", "초밥 먹는 곳"):
        constraint = venue_constraint_for_query(query)
        assert constraint is not None and constraint.meal_required, query


def test_점심_먹고_카페는_식당과_카페를_따로_요구한다():
    from app.services.place_intent import venue_constraint_for_query

    labels = {req.label for req in venue_constraint_for_query("점심 먹고 카페").requirements}
    assert labels == {"음식점", "카페"}


def test_초밥_먹기_요청이면_초밥집이_후보에_남는다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test")
    trail = place("trail", name="광교산책로", has_ramp=True)
    sushi = place("sushi", "음식점", name="오늘의초밥", info={"대표 메뉴": "모둠초밥"}, has_ramp=True)

    async def fake_recommend(*_args, **_kwargs):
        return [{"content_id": "trail", "reason": "경사로가 있어요."}]

    monkeypatch.setattr(ai_service, "_groq_recommend", fake_recommend)
    request = PlaceRecommendationRequest(query_text="산책로 걷고 초밥 먹기", user_type=UserType.WHEELCHAIR)
    ids = {c.attraction.content_id for c in asyncio.run(ai_service.recommend_places(request, [trail, sushi]))}
    assert ids == {"trail", "sushi"}
