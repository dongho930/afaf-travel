"""코스 방문 순서를 코드가 정할 때 — 영업시간·식사 시간·동선·혼잡도를 이 순서로 지키는지."""

from app.models.schemas import Attraction, InfoField
from app.services.schedule import best_visit_order, build_schedule


def spot(cid, lng, category="관광지", hours=None, lat=37.5):
    place = Attraction(content_id=cid, name=cid, category=category, address="경기도",
                       latitude=lat, longitude=lng)
    if hours:
        place.extra_info = [InfoField(label="이용시간", value=hours)]
    return place


def names(places, order):
    return [places[i].content_id for i in order]


def test_한_줄로_놓인_곳은_끝에서_끝으로_돈다():
    places = [spot("C", 127.10), spot("A", 127.00), spot("D", 127.15), spot("B", 127.05)]
    assert names(places, best_visit_order(places)) in (["A", "B", "C", "D"], ["D", "C", "B", "A"])


def test_일찍_닫는_곳은_멀어도_먼저_간다():
    # E는 11시에 닫습니다. 동선만 보면 A-B-C-E지만 그러면 E에 못 들어갑니다.
    places = [spot("A", 127.00), spot("B", 127.05), spot("C", 127.10), spot("E", 127.15, hours="09:00~11:00")]
    order = best_visit_order(places)
    placed = [places[i] for i in order]
    assert all(s.fits_today for s in build_schedule(placed))
    assert names(places, order)[0] == "E"


def test_식당은_점심_시간에_온다():
    places = [spot("A", 127.00), spot("밥집", 127.01, category="음식점"), spot("B", 127.02), spot("C", 127.03)]
    order = best_visit_order(places)
    placed = [places[i] for i in order]
    arrivals = dict(zip(names(places, order), (s.arrival_time for s in build_schedule(placed))))
    assert "11:00" <= arrivals["밥집"] <= "14:00"


def test_동선이_거의_같으면_붐비는_곳을_앞에():
    # 두 곳뿐이면 어느 쪽으로 가도 거리가 같습니다 — 붐비는 곳(crowd 큰 값)이 먼저.
    places = [spot("한산", 127.00), spot("붐빔", 127.05)]
    assert names(places, best_visit_order(places, crowd=[10.0, 90.0])) == ["붐빔", "한산"]


def test_장소가_많으면_기존_방식에_맡긴다():
    places = [spot(str(i), 127.0 + i * 0.01) for i in range(8)]
    assert best_visit_order(places) is None
