"""문장 조건 정확도 — 광고성 소개문 표현에 걸리지 않고, 맞는 곳이 적으면 알려주는지."""

from app.models.schemas import Attraction, PlaceCandidate
from app.routers.courses import _few_text_matches_notices
from app.services.query_preferences import _tags_from_overview, extract_preferences


def test_소개문의_힐링은_온천_휴양이_아님():
    assert "온천·휴양" not in _tags_from_overview("루프탑에서 빵과 함께 바깥 뷰로 힐링할 수 있다.")
    assert "온천·휴양" in _tags_from_overview("천연 온천수를 이용한 노천탕과 찜질방이 있다.")


def test_소개문의_반려동물_동반은_동물_보러_가는_곳이_아님():
    assert "동물" not in _tags_from_overview("야외에는 반려동물을 위한 공간이 마련되어 있다.")
    assert "동물" in _tags_from_overview("다양한 동물에게 먹이 주기 체험을 할 수 있다.")


def _item(cid, name, category="관광지"):
    return PlaceCandidate(
        attraction=Attraction(content_id=cid, name=name, category=category, address="경기도",
                              latitude=37.5, longitude=127.0),
        reason="",
    )


def test_문장_조건에_맞는_곳이_적으면_알림():
    prefs = extract_preferences("동물 보러 가고 싶어")
    selected = [_item("zoo", "작은동물원")] + [_item(f"p{i}", f"근린공원{i}") for i in range(5)]
    assert _few_text_matches_notices(selected, prefs, []) == [
        "요청하신 동물 조건에 맞는 곳은 1곳뿐이라, 나머지는 고른 지역·유형에 맞는 다른 장소예요."
    ]


def test_맞는_곳이_충분하거나_하나도_없으면_이_안내는_없음():
    prefs = extract_preferences("동물 보러 가고 싶어")
    enough = [_item(f"z{i}", f"동물원{i}") for i in range(3)] + [_item("p", "근린공원")]
    assert _few_text_matches_notices(enough, prefs, []) == []
    none = [_item(f"p{i}", f"근린공원{i}") for i in range(4)]
    assert _few_text_matches_notices(none, prefs, ["동물"]) == []
