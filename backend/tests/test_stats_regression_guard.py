"""
_is_regression: 미완성 집계를 저장하지 않는지.

실제로 저장돼버렸던 값들을 그대로 케이스로 넣었습니다.
"""
import pytest

from app.routers.tourism import _MIN_PLAUSIBLE_CANDIDATES, _is_regression
from tests.conftest import summary_payload


def test_후보가_반토막이면_저장하지_않는다(healthy_cache):
    # 2026-09-06: 목록 API가 죽어 후보 543건으로 센 539를 저장해버렸습니다.
    assert _is_regression(healthy_cache, summary_payload(539, 543)) is True


def test_직전_값이_없어도_후보가_적으면_저장하지_않는다():
    # 캐시 조회가 실패한 직후(existing=None)에는 비교 대상이 없어서 검사가
    # 통째로 통과됐습니다 — 이 구멍으로 낮은 값이 처음부터 박혔습니다.
    assert _is_regression(None, summary_payload(539, 543)) is True


def test_후보가_0건이면_저장하지_않는다(healthy_cache):
    assert _is_regression(healthy_cache, summary_payload(0, 0)) is True


def test_직전_값이_없고_후보가_충분하면_저장한다():
    # 캐시를 처음 채우는 정상 경로까지 막으면 안 됩니다.
    assert _is_regression(None, summary_payload(1240, 2500)) is False


def test_숫자가_늘었으면_저장한다(healthy_cache):
    assert _is_regression(healthy_cache, summary_payload(1250, 2510)) is False


def test_조회_실패가_있는데_숫자가_줄었으면_저장하지_않는다(healthy_cache):
    data = summary_payload(900, 2400, accessibility_fetch={"api_error": 5})
    assert _is_regression(healthy_cache, data) is True


def test_목록이_잘렸는데_숫자가_줄었으면_저장하지_않는다(healthy_cache):
    data = summary_payload(1100, 2400, list_fetch={"list_truncated": 1})
    assert _is_regression(healthy_cache, data) is True


def test_망가진_캐시에서_되살린_값은_저장한다(damaged_cache):
    # 539/543 상태에서 편의시설 캐시로 후보를 1247건까지 되살린 경우 —
    # 이건 '복구'이므로 반드시 저장돼야 합니다.
    assert _is_regression(damaged_cache, summary_payload(1232, 1247)) is False


def test_되살리기가_실패해_그대로면_저장하지_않는다(damaged_cache):
    assert _is_regression(damaged_cache, summary_payload(539, 543)) is True


@pytest.mark.parametrize("candidates", [0, 1, _MIN_PLAUSIBLE_CANDIDATES - 1])
def test_절대_하한_미만은_직전_값과_무관하게_막는다(candidates, healthy_cache):
    for existing in (None, healthy_cache):
        assert _is_regression(existing, summary_payload(candidates, candidates)) is True
