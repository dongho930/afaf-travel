"""
접근성 유형 분류 기준(accessibility_criteria)이 실제 데이터에서 의도대로 동작하는지.

fixtures/accessibility_samples_2026_09.json은 2026-09-25에 받은 경기도 무장애
여행지 948곳(관광지·문화시설·레포츠·숙박·음식점, 쇼핑 제외)의 detailWithTour2
원문입니다. 기준을 바꾸면 아래 분포 테스트가 먼저 알려줍니다 — 범위를 넘으면
바뀐 분포가 의도한 것인지 확인한 뒤 숫자를 고치세요.
"""
import json
from collections import Counter
from pathlib import Path

import pytest

from app.models.schemas import AccessibilityFeatures, Attraction
from app.services.accessibility_criteria import (
    _is_positive,
    evaluate,
    features_from_detail,
    qualifies,
)

_LABELS = {"12": "관광지", "14": "문화시설", "28": "레포츠", "32": "숙박", "39": "음식점"}
_SAMPLES = json.loads(
    (Path(__file__).parent / "fixtures" / "accessibility_samples_2026_09.json").read_text(encoding="utf-8")
)


def _evaluated(category: str):
    for sample in _SAMPLES:
        yield evaluate(features_from_detail(sample["raw"]), category, _LABELS[sample["contenttypeid"]])


# ---- 필드 값 해석 ------------------------------------------------------------

@pytest.mark.parametrize(
    "value",
    [
        "출입구까지 턱이 없어 휠체어 접근 가능함",  # '없'이 들어가도 긍정
        "장애인 전용 주차구역 주차 대수 : 4대. 주변 여유공간 없음.",  # 대수가 있으면 있음
        "손잡이 등 별도 시설은 없으나 화장실에 휠체어 접근 가능함",
        "대여가능(무료,사전문의)",
        "엘리베이터는 없으나 장애인리프트 이용가능(2층건물)",
    ],
)
def test_긍정으로_읽는다(value):
    assert _is_positive(value)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "출입구 경사로 없음",
        "화장실 2층 (계단 이용)",
        "현재 공사중으로 이용 불가",
        "출입통로가 좁아 휠체어, 전동휠체어 진입 어려움",
    ],
)
def test_부정으로_읽는다(value):
    assert not _is_positive(value)


def test_가파른_경사로는_접근로로_세지_않는다():
    features = features_from_detail({"route": "출입구까지 경사로가 설치되어 있음(가파름)"})
    assert not features.has_ramp


def test_저상버스_유무를_구분한다():
    assert features_from_detail({"publictransport": "정류장 저상버스 : 마을5번"}).has_low_floor_bus
    assert not features_from_detail({"publictransport": "대중교통 이용 가능 : 양수역 정류장저상버스 없음."}).has_low_floor_bus


def test_전용_관람석이_없다는_설명은_관람석으로_세지_않는다():
    assert features_from_detail({"auditorium": "장애인 관람석 있음(24석)"}).has_accessible_seating
    assert not features_from_detail({"auditorium": "장애인 전용 관람석은 없으나 휠체어 접근 가능한 공간 있음"}).has_accessible_seating


def test_기타상세에서_키워드를_뽑는다():
    features = features_from_detail({
        "infantsfamilyetc": "화장실 내 기저귀 교환대 있음, 임산부 주차구역 있음(3면)",
        "handicapetc": "의자식 테이블 있음, 장애인 비상벨 있음",
    })
    assert features.has_diaper_station
    assert features.has_pregnant_parking
    assert features.has_seated_table
    assert features.has_emergency_bell


def test_유아휴게실은_고령자_휴게_공간이_아니다():
    assert not features_from_detail({"infantsfamilyetc": "유아휴게실 있음(3층)"}).has_rest_area
    assert features_from_detail({"handicapetc": "산책로 곳곳에 벤치 있음"}).has_rest_area


# ---- 유형별 분류 ---------------------------------------------------------------

def test_휠체어는_접근로와_화장실이_모두_있어야_한다():
    only_ramp = AccessibilityFeatures(has_ramp=True, has_parking=True)
    both = AccessibilityFeatures(has_exit=True, has_accessible_restroom=True)
    assert not evaluate(only_ramp, "wheelchair", "관광지").qualifies
    assert evaluate(both, "wheelchair", "관광지").qualifies


def test_임산부는_휠체어_시설만으로는_들어가지_않는다():
    wheelchair_only = AccessibilityFeatures(has_ramp=True, has_elevator=True, has_accessible_restroom=True)
    assert not evaluate(wheelchair_only, "pregnant", "문화시설").qualifies
    assert evaluate(AccessibilityFeatures(has_lactation_room=True), "pregnant", "문화시설").qualifies


def test_고령자는_수유실이_아니라_이동_편의시설로_들어간다():
    assert not evaluate(AccessibilityFeatures(has_lactation_room=True), "senior", "관광지").qualifies
    assert evaluate(AccessibilityFeatures(has_ramp=True), "senior", "관광지").qualifies


def test_장소_종류에_맞지_않는_항목은_분모에서_뺀다():
    features = AccessibilityFeatures(has_sign_guide=True, has_video_guide=True, has_hearing_etc=True)
    # 청각 객실은 숙박에만 있어서, 관광지는 나머지 3개를 다 갖추면 '많음'이어야 합니다.
    assert evaluate(features, "hearing", "관광지").total == 3
    assert evaluate(features, "hearing", "관광지").tier == "high"
    assert evaluate(features, "hearing", "숙박").total == 4


def test_세지_않는_항목으로는_핵심_조건을_채우지_않는다():
    # 2026-09-25 운영: 엘리베이터를 세지 않는 음식점이 엘리베이터 덕분에 2/5 '많음'이 됐습니다.
    features = AccessibilityFeatures(
        has_lactation_room=True, has_accessible_restroom=True, has_elevator=True
    )
    ev = evaluate(features, "pregnant", "음식점")
    assert ev.total == 5
    assert ev.tier != "high"
    # 엘리베이터를 세는 문화시설에서는 핵심 조건을 채웁니다.
    assert evaluate(features, "pregnant", "문화시설").tier == "high"


def test_시각장애는_핵심_항목을_갖추면_많음():
    core = AccessibilityFeatures(has_braille_block=True, has_braille_promotion=True)
    assert evaluate(core, "visual", "문화시설").tier == "high"
    assert evaluate(AccessibilityFeatures(has_braille_block=True, has_help_dog=True), "visual", "관광지").tier == "mid"


def test_추천_후보_필터도_같은_기준을_쓴다():
    place = Attraction(
        content_id="1", name="x", address="", latitude=0, longitude=0, category="관광지",
        accessibility=AccessibilityFeatures(has_ramp=True),
    )
    assert not qualifies(place, "wheelchair")
    assert qualifies(place, "senior")
    assert qualifies(place, "general")


# ---- 실제 데이터 분포 ----------------------------------------------------------

# (목록에 들어가는 비율 하한, 상한) — 2026-09 표본 기준 실제 값에 여유를 둔 범위.
@pytest.mark.parametrize(
    "category, low, high",
    [
        ("wheelchair", 0.40, 0.60),  # 예전 98.5%: 거의 전부 들어가 구별이 안 됐음
        ("pregnant", 0.15, 0.35),    # 예전 96.5%: 휠체어 탭과 사실상 같았음
        ("senior", 0.80, 0.97),      # 예전 30.7%: 수유실 기준이라 대부분 빠졌음
        ("visual", 0.25, 0.45),
        ("family", 0.30, 0.50),
        ("hearing", 0.0, 0.03),      # 데이터 자체가 거의 없음
    ],
)
def test_유형별_목록_비율(category, low, high):
    rate = sum(e.qualifies for e in _evaluated(category)) / len(_SAMPLES)
    assert low <= rate <= high, f"{category} {rate:.1%}"


@pytest.mark.parametrize("category", ["wheelchair", "visual", "family", "pregnant", "senior"])
def test_등급이_한쪽으로_몰리지_않는다(category):
    tiers = Counter(e.tier for e in _evaluated(category) if e.qualifies)
    total = sum(tiers.values())
    # 세 등급이 모두 나오고, 어느 한 등급이 85%를 넘지 않아야 합니다.
    assert set(tiers) == {"high", "mid", "low"}, tiers
    assert max(tiers.values()) / total <= 0.85, tiers


def test_임산부_탭은_임산부_전용_시설이_있는_곳만():
    for sample in _SAMPLES:
        features = features_from_detail(sample["raw"])
        if evaluate(features, "pregnant", _LABELS[sample["contenttypeid"]]).qualifies:
            assert features.has_lactation_room or features.has_pregnant_parking or features.has_diaper_station
