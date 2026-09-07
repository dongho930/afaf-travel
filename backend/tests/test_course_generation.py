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

def test_이동유형과_관련_있는_편의시설만_추린다():
    features = _attraction("1", "x").accessibility.model_dump()

    wheelchair = ai_service._relevant_accessibility_payload(features, "wheelchair")

    assert "has_ramp" in wheelchair
    assert "visual_accessibility_count" not in wheelchair  # 휠체어와 무관한 항목은 빠집니다


def test_general은_유형별_개수만_넘긴다():
    """general도 개수 5개로 추려야 합니다 — 프롬프트가 Groq의 분당 토큰 한도를
    넘겨 후보가 많은 지역에서 추천이 통째로 실패하던 원인이었습니다."""
    features = _attraction("1", "x").accessibility.model_dump()

    general = ai_service._relevant_accessibility_payload(features, "general")

    assert set(general) == {
        "wheelchair_accessibility_count", "visual_accessibility_count",
        "hearing_accessibility_count", "family_accessibility_count",
        "pregnant_accessibility_count",
    }
    assert "has_ramp" not in general  # 개별 편의시설 항목은 빠집니다


# ---- _build_user_prompt ----

def test_프롬프트에_질의와_후보가_담긴다(candidates):
    request = CourseRequest(query_text="경사 없는 산책로", user_type=UserType.WHEELCHAIR, max_stops=2)

    payload = json.loads(ai_service._build_user_prompt(request, candidates))

    assert payload["query_text"] == "경사 없는 산책로"
    assert payload["max_stops"] == 2
    assert [c["content_id"] for c in payload["candidates"]] == ["1", "2", "3"]
    # 이동유형에 맞게 추려진 편의시설만 실려야 합니다 (프롬프트 길이 = 토큰 비용)
    assert "visual_accessibility_count" not in payload["candidates"][0]["accessibility"]


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
    def __init__(self, status_code: int):
        self.status_code = status_code

    def raise_for_status(self):  # pragma: no cover - 여기까지 오면 테스트 실패
        raise AssertionError("한도 응답은 raise_for_status까지 가면 안 됩니다")

    def json(self):  # pragma: no cover - 여기까지 오면 테스트 실패
        raise AssertionError("한도 응답의 본문을 읽으려 하면 안 됩니다")


class _FakeClient:
    """httpx.AsyncClient 대신 끼워 넣어, 항상 같은 상태 코드를 돌려줍니다."""

    def __init__(self, status_code: int, calls: list):
        self._status_code = status_code
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        self._calls.append(kwargs.get("json"))
        return _FakeResponse(self._status_code)


def _patch_groq(monkeypatch, status_code: int) -> list:
    """Groq 키가 있는 상태에서 지정한 상태 코드만 돌아오게 만듭니다."""
    calls: list = []
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(
        ai_service.httpx, "AsyncClient", lambda *a, **kw: _FakeClient(status_code, calls)
    )
    return calls


def test_요청이_토큰_한도보다_크면_재시도_없이_대체_로직을_쓴다(monkeypatch, candidates):
    """413(요청 하나가 분당 토큰 한도 초과)은 기다려도 풀리지 않으므로 바로
    규칙 기반 추천으로 넘어가야 합니다 — 예전엔 그대로 터져서 앱에 '장소 추천
    실패'가 떴습니다."""
    calls = _patch_groq(monkeypatch, 413)

    result = asyncio.run(
        ai_service.recommend_places(PlaceRecommendationRequest(query_text="산책로"), candidates)
    )

    assert [c.attraction.content_id for c in result] == ["1", "2", "3"]
    assert len(calls) == 1  # 재시도하지 않습니다


def test_순간적인_한도_초과는_재시도한_뒤_대체_로직을_쓴다(monkeypatch, candidates):
    """429는 잠깐 기다리면 풀리는 경우가 많아 재시도합니다 (413과 다른 처리)."""
    calls = _patch_groq(monkeypatch, 429)

    async def _no_sleep(_seconds):
        return None

    monkeypatch.setattr(ai_service.asyncio, "sleep", _no_sleep)

    result = asyncio.run(
        ai_service.recommend_places(PlaceRecommendationRequest(query_text="산책로"), candidates)
    )

    assert [c.attraction.content_id for c in result] == ["1", "2", "3"]
    assert len(calls) == 3  # 최초 1회 + 재시도 2회
