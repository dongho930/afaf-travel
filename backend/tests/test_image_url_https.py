"""
사진 주소는 앱으로 나갈 때 항상 https 여야 합니다.

TourAPI의 firstimage는 평문 http://tong.visitkorea.or.kr/... 로 옵니다. 그 주소를
그대로 내보내면 앱에서는 사진이 한 장도 안 보입니다 — 안드로이드는
usesCleartextTraffic=false(app.json)와 targetSdk 28+ 기본 정책으로, iOS는 ATS
기본 정책으로 평문 HTTP를 막기 때문입니다. 오류 없이 빈 칸으로만 보여서
눈치채기 어려웠던 문제라 테스트로 고정해 둡니다.
"""
import pytest

from app.models.schemas import Attraction, AccessibilityPlaceScore, NearbyAttraction


def _attraction(image_url):
    return Attraction(
        content_id="129194",
        name="가나아트파크",
        address="경기도 양주시 장흥면 권율로 117",
        latitude=37.725,
        longitude=126.949,
        category="관광지",
        image_url=image_url,
    )


def test_관광지_사진_주소의_http를_https로_올린다():
    a = _attraction("http://tong.visitkorea.or.kr/cms/resource/83/3559483_image2_1.jpg")

    assert a.image_url == "https://tong.visitkorea.or.kr/cms/resource/83/3559483_image2_1.jpg"


@pytest.mark.parametrize(
    "image_url",
    [
        "https://tong.visitkorea.or.kr/cms/resource/83/3559483_image2_1.jpg",  # 이미 https
        None,                                                                  # 사진 없음
        "",                                                                    # 빈 값
    ],
)
def test_건드릴_필요가_없는_값은_그대로_둔다(image_url):
    assert _attraction(image_url).image_url == image_url


def test_근처_장소와_접근성_목록도_같은_규칙을_따른다():
    """같은 사진이 화면마다 다른 모델로 나가므로, 셋 다 걸어 두어야 합니다."""
    nearby = NearbyAttraction(
        content_id="1", name="근처 장소", category="관광지", distance_km=1.2,
        image_url="http://tong.visitkorea.or.kr/a.jpg",
    )
    place = AccessibilityPlaceScore(
        content_id="1", name="휠체어 여행지", score=8, address="경기도",
        image_url="http://tong.visitkorea.or.kr/b.jpg",
    )

    assert nearby.image_url == "https://tong.visitkorea.or.kr/a.jpg"
    assert place.image_url == "https://tong.visitkorea.or.kr/b.jpg"
