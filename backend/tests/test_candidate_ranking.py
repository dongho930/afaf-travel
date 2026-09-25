"""
지역을 고르지 않았을 때 가까운 곳끼리 묶는지, 같은 곳을 두 번 추천하지 않는지,
점수가 같으면 인기도가 높은 곳이 앞인지.
"""
from app.models.schemas import Attraction
from app.services.candidate_ranking import Scored, cluster_nearby, drop_near_duplicates

SUWON = (37.28, 127.01)
GAPYEONG = (37.83, 127.51)   # 수원에서 약 75km


def _place(cid, name, at, dlat=0.0):
    return Attraction(content_id=cid, name=name, address="경기도", latitude=at[0] + dlat,
                      longitude=at[1], category="관광지")


def _scored(place, text=0, grade=0, popularity=0.0, tiebreak=0.0):
    return Scored(place, text, grade, popularity, tiebreak)


def test_문장에_맞는_곳이_여럿_모인_지역으로_묶는다():
    # 수원에 맞는 곳 5곳, 가평에 딱 맞는 외딴 곳 1곳 → 수원 쪽으로 묶습니다.
    suwon = [_scored(_place(f"s{i}", f"수원공원{i}", SUWON, i * 0.01), text=3) for i in range(5)]
    lone = _scored(_place("g", "가평호수", GAPYEONG), text=6)
    others = [_scored(_place(f"o{i}", f"수원기타{i}", SUWON, i * 0.02)) for i in range(4)]

    result = cluster_nearby(suwon + [lone] + others, limit=12)

    ids = {s.place.content_id for s in result}
    assert "g" not in ids
    assert {f"s{i}" for i in range(5)} <= ids


def test_묶을_만큼_모이지_않으면_그대로_둔다():
    items = [_scored(_place("a", "가", SUWON), text=3), _scored(_place("b", "나", GAPYEONG), text=3)]
    assert cluster_nearby(items, limit=12) == items


def test_같은_곳을_두_번_추천하지_않는다():
    island = _place("1", "자라섬", GAPYEONG)
    garden = _place("2", "자라섬 이화원", GAPYEONG, 0.002)
    far_same_name = _place("3", "자라섬", SUWON)  # 이름이 같아도 멀면 다른 곳

    assert [p.content_id for p in drop_near_duplicates([island, garden, far_same_name])] == ["1", "3"]


def test_앞부분만_같은_이름은_다른_곳이다():
    museum = _place("1", "수원시립미술관", SUWON)
    library = _place("2", "수원시립중앙도서관", SUWON, 0.001)
    assert len(drop_near_duplicates([museum, library])) == 2


def test_점수와_등급이_같으면_인기도가_높은_곳이_앞이다():
    quiet = _scored(_place("q", "가", SUWON), text=3, grade=2, popularity=0.0, tiebreak=0.1)
    popular = _scored(_place("p", "나", SUWON), text=3, grade=2, popularity=5.0, tiebreak=0.9)
    assert sorted([quiet, popular], key=lambda s: s.key)[0].place.content_id == "p"
