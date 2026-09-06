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


def test_general은_전체를_그대로_넘긴다():
    features = _attraction("1", "x").accessibility.model_dump()

    assert ai_service._relevant_accessibility_payload(features, "general") == features


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
