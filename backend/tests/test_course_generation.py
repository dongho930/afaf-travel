"""
코스 생성 공유 헬퍼가 새 플로우에서 그대로 동작하는지.

레거시 경로(POST /api/courses/generate)와 새 플로우
(/recommend -> /generate-from-selection)는 헬퍼를 공유합니다
(_build_user_prompt, _mock_generate, _stops_from_raw,
_relevant_accessibility_payload). 레거시를 정리하다 이 헬퍼를 건드리면
코스 생성 전체가 조용히 깨지는데, 지금껏 ai_service.py에는 테스트가
하나도 없었습니다.

Groq 키가 없는 환경을 가정하므로 외부 호출이 전혀 없습니다.
"""
import asyncio
import json

import pytest

from app.models.schemas import (
    AccessibilityFeatures,
    Attraction,
    CourseRequest,
    GenerateFromSelectionRequest,
    PlaceRecommendationRequest,
    UserType,
)
from app.services import ai_service


@pytest.fixture(autouse=True)
def no_groq(monkeypatch):
    """AI 호출 없이 규칙 기반 대체 로직만 타도록 고정합니다."""
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")


def _attraction(content_id: str, name: str) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=name,
        address="경기도 수원시",
        latitude=37.0,
        longitude=127.0,
        category="관광지",
        accessibility=AccessibilityFeatures(
            has_ramp=True,
            has_elevator=True,
            has_rest_area=True,
            wheelchair_accessibility_count=4,
            visual_accessibility_count=2,
        ),
    )


@pytest.fixture
def candidates() -> list[Attraction]:
    return [_attraction("1", "수원화성"), _attraction("2", "광교호수공원"), _attraction("3", "물맑음수목원")]


# ---- _relevant_accessibility_payload ----

def test_이동유형_기준으로_갖춘_시설_이름과_등급을_넘긴다():
    place = _attraction("1", "x")

    wheelchair = ai_service._relevant_accessibility_payload(place, "wheelchair")

    assert set(wheelchair) == {"facilities", "grade"}
    assert "휠체어 접근로" in wheelchair["facilities"]
    assert "점자블록" not in wheelchair["facilities"]  # 휠체어와 무관한 시설은 빠집니다
    assert wheelchair["grade"] in {"많음", "보통", "적음"}


def test_세지_않는_시설은_넘기지_않는다():
    # 관광지는 엘리베이터를 세지 않아서, 있어도 근거로 넘기지 않습니다(접근성 탭과 같음).
    place = _attraction("1", "x")

    senior = ai_service._relevant_accessibility_payload(place, "senior")

    assert "엘리베이터" not in senior["facilities"]


def test_general은_맞는_유형_이름만_넘긴다():
    """general은 유형 이름 목록만 넘깁니다 — 프롬프트가 Groq의 분당 토큰 한도를
    넘겨 후보가 많은 지역에서 추천이 통째로 실패하던 원인이었습니다."""
    place = _attraction("1", "x")

    general = ai_service._relevant_accessibility_payload(place, "general")

    assert set(general) == {"suitable_for"}
    assert "고령자" in general["suitable_for"]


# ---- _build_user_prompt ----

def test_프롬프트에_질의와_후보가_담긴다(candidates):
    request = CourseRequest(query_text="경사 없는 산책로", user_type=UserType.WHEELCHAIR, max_stops=2)

    payload = json.loads(ai_service._build_user_prompt(request, candidates))

    assert payload["query_text"] == "경사 없는 산책로"
    assert payload["max_stops"] == 2
    assert [c["content_id"] for c in payload["candidates"]] == ["1", "2", "3"]
    # 이동유형에 맞게 추려진 편의시설만 실려야 합니다 (프롬프트 길이 = 토큰 비용)
    assert set(payload["candidates"][0]["accessibility"]) == {"facilities", "grade"}


# ---- _mock_generate ----

def test_대체_로직은_max_stops를_넘지_않는다(candidates):
    request = CourseRequest(query_text="아무거나", max_stops=2)

    raw = ai_service._mock_generate(request, candidates)

    assert raw["title"] and raw["summary"]
    assert len(raw["stops"]) == 2
    assert {s["content_id"] for s in raw["stops"]} <= {"1", "2", "3"}


# ---- _stops_from_raw ----

def test_순서대로_정렬하고_모르는_장소는_버린다(candidates):
    raw = {
        "stops": [
            {"order": 2, "content_id": "2", "recommended_arrival_time": "14:00", "reason": "b"},
            {"order": 1, "content_id": "1", "recommended_arrival_time": "10:00", "reason": "a"},
            {"order": 3, "content_id": "없는id", "recommended_arrival_time": "16:00", "reason": "c"},
        ]
    }

    stops = ai_service._stops_from_raw(raw, candidates)

    assert [s.order for s in stops] == [1, 2]
    assert [s.attraction.content_id for s in stops] == ["1", "2"]


# ---- 새 플로우 (실제로 앱이 쓰는 두 단계) ----

def test_1단계_추천은_후보에서만_고른다(candidates):
    request = PlaceRecommendationRequest(query_text="쉴 곳 많은 코스", user_type=UserType.SENIOR)

    result = asyncio.run(ai_service.recommend_places(request, candidates))

    assert result
    assert all(c.attraction.content_id in {"1", "2", "3"} for c in result)


def test_AI_추천에서도_식사만_요청하면_음식점만_넘긴다(monkeypatch):
    museum = _attraction("museum", "현대미술관")
    museum.category = "문화시설"
    restaurant = _attraction("food", "식당")
    restaurant.category = "음식점"
    seen_candidates = []

    async def fake_recommend(request, candidates, parsed):
        seen_candidates.extend(candidates)
        return [{"content_id": "museum"}, {"content_id": "food"}]

    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ai_service, "_groq_recommend", fake_recommend)

    result = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="점심 식사", user_type=UserType.WHEELCHAIR),
        [museum, restaurant],
    ))

    assert [a.content_id for a in seen_candidates] == ["food"]
    assert [item.attraction.content_id for item in result] == ["food"]


def test_AI_추천에서도_과학관_요청에_미술관을_섞지_않는다(monkeypatch):
    museum = _attraction("art", "현대미술관")
    museum.category = "문화시설"
    science = _attraction("science", "과천과학관")
    science.category = "문화시설"
    seen_candidates = []

    async def fake_recommend(request, candidates, parsed):
        seen_candidates.extend(candidates)
        return [{"content_id": "art"}, {"content_id": "science"}]

    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ai_service, "_groq_recommend", fake_recommend)

    result = asyncio.run(ai_service.recommend_places(
        PlaceRecommendationRequest(query_text="지체 장애인이 갈 수 있는 과학관"),
        [museum, science],
    ))

    assert [a.content_id for a in seen_candidates] == ["science"]
    assert [item.attraction.content_id for item in result] == ["science"]


def test_2단계는_고른_장소만으로_코스를_만든다(candidates):
    selected = candidates[:2]
    request = GenerateFromSelectionRequest(
        query_text="경사 없는 산책로",
        user_type=UserType.WHEELCHAIR,
        selected_content_ids=[a.content_id for a in selected],
    )

    course = asyncio.run(ai_service.generate_course_from_selection(request, selected))

    assert course.title and course.summary
    assert [s.attraction.content_id for s in course.stops] == ["1", "2"]
    assert [s.order for s in course.stops] == [1, 2]
    assert course.generated_for == UserType.WHEELCHAIR


def test_후보가_없으면_오류를_알린다():
    request = GenerateFromSelectionRequest(query_text="x", selected_content_ids=["1"])

    with pytest.raises(ValueError):
        asyncio.run(ai_service.generate_course_from_selection(request, []))

    with pytest.raises(ValueError):
        asyncio.run(ai_service.recommend_places(PlaceRecommendationRequest(query_text="x"), []))


# ---- Groq 한도 응답 처리 ----

class _FakeResponse:
    def __init__(self, status_code: int, body: dict | None = None):
        self.status_code = status_code
        self._body = body

    def raise_for_status(self):
        if self._body is None:  # pragma: no cover - 여기까지 오면 테스트 실패
            raise AssertionError("한도 응답은 raise_for_status까지 가면 안 됩니다")

    def json(self):
        if self._body is None:  # pragma: no cover - 여기까지 오면 테스트 실패
            raise AssertionError("한도 응답의 본문을 읽으려 하면 안 됩니다")
        return self._body


class _FakeClient:
    """httpx.AsyncClient 대신 끼워 넣어, 항상 같은 상태 코드를 돌려줍니다."""

    def __init__(self, status_code: int, calls: list, body: dict | None = None):
        self._status_code = status_code
        self._calls = calls
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        self._calls.append(kwargs.get("json"))
        return _FakeResponse(self._status_code, self._body)


def _patch_groq(monkeypatch, status_code: int, body: dict | None = None) -> list:
    """Groq 키가 있는 상태에서 지정한 상태 코드(와 본문)만 돌아오게 만듭니다."""
    calls: list = []
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(
        ai_service.httpx, "AsyncClient", lambda *a, **kw: _FakeClient(status_code, calls, body)
    )
    return calls


def test_요청이_토큰_한도보다_크면_재시도_없이_추천을_포기한다(monkeypatch, candidates):
    """413(요청 하나가 분당 토큰 한도 초과)은 기다려도 풀리지 않으므로 바로
    포기합니다. 규칙 기반(키워드 매칭) 목록으로 대신 채우지 않습니다 — 요청·유형과
    어긋난 목록을 그럴듯하게 내놓느니 '잠시 후 다시'라고 말하는 편이 낫습니다."""
    calls = _patch_groq(monkeypatch, 413)

    with pytest.raises(ai_service.GroqUnavailableError):
        asyncio.run(
            ai_service.recommend_places(PlaceRecommendationRequest(query_text="산책로"), candidates)
        )

    assert len(calls) == 1  # 재시도하지 않습니다


def test_순간적인_한도_초과는_재시도한_뒤_추천을_포기한다(monkeypatch, candidates):
    """429는 잠깐 기다리면 풀리는 경우가 많아 재시도합니다 (413과 다른 처리)."""
    calls = _patch_groq(monkeypatch, 429)

    async def _no_sleep(_seconds):
        return None

    monkeypatch.setattr(ai_service.asyncio, "sleep", _no_sleep)

    with pytest.raises(ai_service.GroqUnavailableError):
        asyncio.run(
            ai_service.recommend_places(PlaceRecommendationRequest(query_text="산책로"), candidates)
        )

    assert len(calls) == 3  # 최초 1회 + 재시도 2회


def test_서버_오류나_깨진_응답도_같은_실패로_모은다(monkeypatch, candidates):
    """Groq 쪽 5xx, 연결 실패, JSON이 아닌 응답 — 예전에는 전부 그대로 터져서
    앱에 '서버에 문제가 생겼어요'(500)가 떴습니다. 이제 한도 초과와 같은 예외로
    모여서, 라우터가 안내 문구로 바꿀 수 있습니다."""
    request = PlaceRecommendationRequest(query_text="산책로")

    _patch_groq(monkeypatch, 500)
    with pytest.raises(ai_service.GroqUnavailableError):
        asyncio.run(ai_service.recommend_places(request, candidates))

    # selected 없이 엉뚱한 JSON만 돌아온 경우
    _patch_groq(monkeypatch, 200, {"choices": [{"message": {"content": '{"nope": 1}'}}]})
    with pytest.raises(ai_service.GroqUnavailableError):
        asyncio.run(ai_service.recommend_places(request, candidates))

    # JSON이 아예 아닌 경우
    _patch_groq(monkeypatch, 200, {"choices": [{"message": {"content": "죄송합니다"}}]})
    with pytest.raises(ai_service.GroqUnavailableError):
        asyncio.run(ai_service.recommend_places(request, candidates))


def test_코스_순서_정하기는_실패해도_규칙_기반으로_이어간다(monkeypatch, candidates):
    """2단계는 사용자가 이미 고른 장소들의 '순서'만 정하는 단계라, AI가 없어도
    엉뚱한 장소가 끼어들 여지가 없습니다. 그래서 여기서는 그대로 대체 로직을 씁니다."""
    _patch_groq(monkeypatch, 500)
    request = GenerateFromSelectionRequest(
        query_text="산책로", selected_content_ids=[c.content_id for c in candidates]
    )

    course = asyncio.run(
        ai_service.generate_course_from_selection(request, candidates)
    )

    assert len(course.stops) == len(candidates)


# ---- 최소 추천 개수 ----

def _candidate(cid: str) -> Attraction:
    return Attraction(content_id=cid, name=f"장소{cid}", address="경기도 수원시",
                      latitude=37.0, longitude=127.0, category="관광지")


@pytest.mark.parametrize("ai_picks, expected", [
    ([], ["1", "2", "3", "4", "5", "6"]),                                # AI가 하나도 안 고름
    ([{"content_id": "5", "reason": "호수 옆이에요."}], ["5", "1", "2", "3", "4", "6"]),  # AI 선택이 앞
])
def test_AI가_적게_고르면_후보_순서대로_채운다(monkeypatch, ai_picks, expected):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")

    async def fake_groq(_request, _candidates, _parsed=None):
        return ai_picks

    monkeypatch.setattr(ai_service, "_groq_recommend", fake_groq)
    request = PlaceRecommendationRequest(query_text="동물 보러 가고 싶어", user_type=UserType.STROLLER)
    candidates = [_candidate(str(i)) for i in range(1, 10)]

    result = asyncio.run(ai_service.recommend_places(request, candidates))

    assert [item.attraction.content_id for item in result] == expected
    assert all(item.reason for item in result)


def test_후보가_적으면_있는_만큼만_보여준다(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")

    async def fake_groq(_request, _candidates, _parsed=None):
        return []

    monkeypatch.setattr(ai_service, "_groq_recommend", fake_groq)
    request = PlaceRecommendationRequest(query_text="수어 해설", user_type=UserType.HEARING)

    result = asyncio.run(ai_service.recommend_places(request, [_candidate("1"), _candidate("2")]))

    assert [item.attraction.content_id for item in result] == ["1", "2"]


def test_JSON_검증_실패_400은_한_번_더_시도한다(monkeypatch):
    import httpx

    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    responses = [
        httpx.Response(400, text='{"error":{"code":"json_validate_failed"}}'),
        httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}]}),
    ]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            response = responses.pop(0)
            response.request = httpx.Request("POST", ai_service.GROQ_ENDPOINT)
            return response

    monkeypatch.setattr(ai_service.httpx, "AsyncClient", FakeClient)

    assert asyncio.run(ai_service._groq_call("sys", "user")) == {"ok": True}
