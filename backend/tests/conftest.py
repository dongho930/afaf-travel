"""
접근성 통계 테스트가 공통으로 쓰는 재료들.

이 테스트들은 전부 같은 사고에서 나왔습니다 — '무장애 여행지 수'가 1232에서
491로, 다시 539로 떨어진 일입니다. 원인은 매번 달랐지만 모양은 같았습니다:
**미완성 집계가 멀쩡한 캐시를 덮어썼다.** 그래서 여기서는 "그 상황에서 저장을
막는가"를 검사합니다.
"""
import pytest


def summary_payload(total: int, candidates: int, **debug_extra) -> dict:
    """
    tour_api.get_accessibility_summary()가 돌려주는 모양의 최소 응답.

    total     : 무장애 여행지 수 (total_accessible_count)
    candidates: 이번 집계가 놓고 센 관광지 수 (total_candidates)
    """
    debug = {
        "total_candidates_before_accessibility_fetch": candidates,
        "accessibility_fetch": {},
        "list_fetch": {},
    }
    debug.update(debug_extra)
    return {
        "wheelchair_count": total,
        "senior_count": 0,
        "total_accessible_count": total,
        "visual_count": 0,
        "hearing_count": 0,
        "family_count": 0,
        "pregnant_count": 0,
        "total_candidates": candidates,
        "top_wheelchair_places": [],
        "top_senior_places": [],
        "top_visual_places": [],
        "top_hearing_places": [],
        "top_family_places": [],
        "top_pregnant_places": [],
        "debug": debug,
    }


@pytest.fixture
def healthy_cache() -> dict:
    """목록 API가 멀쩡하던 시절의 저장값."""
    return {
        "total_accessible_count": 1232,
        "wheelchair_count": 1200,
        "total_candidates": 2500,
    }


@pytest.fixture
def damaged_cache() -> dict:
    """목록 캐시가 543건으로 줄어든 뒤 저장돼버린 값 (2026-09-06 실제 상태)."""
    return {
        "total_accessible_count": 539,
        "wheelchair_count": 536,
        "total_candidates": 543,
    }
