"""
AI 플래너 후보의 순서 정하기 — 문장 점수·등급·인기도, 거리 묶음, 근접 중복 제거.

query_preferences가 "무엇을 원하는지"를 점수로 만들고, 여기서는 그 점수로 후보를
세웁니다. 지역을 고르지 않았을 때는 한 코스로 다닐 수 있게 가까운 곳끼리 묶습니다.
(평가: 지역 미선택 질의 대부분에서 추천 장소끼리 100km 넘게 떨어져 있었습니다.)
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.models.schemas import Attraction


@dataclass
class Scored:
    place: Attraction
    text: int          # 문장 조건 점수
    grade: int         # 접근성 등급 (많음 2 / 보통 1 / 적음 0)
    popularity: float  # 실사용 인기도 (리뷰·저장·게시물 집계)
    tiebreak: float    # 같은 점수 안에서 섞기 ('다시 추천'할 때마다 다른 곳이 섞이게)
    # 문장의 특성·편의시설 조건(온천·휴양, 장애인 화장실 등)에 맞는지. text 점수에는
    # '휴식 → 관광지 전체' 같은 목적 점수도 섞여 있어서, 지역을 고를 때는 이것만 셉니다.
    hit: bool = False

    @property
    def key(self) -> tuple:
        """정렬 키: 문장 점수 > 등급 > 인기도 > 무작위."""
        return (-self.text, -self.grade, -self.popularity, self.tiebreak)


def _km(a: Attraction, b: Attraction) -> float:
    p1, p2 = math.radians(a.latitude), math.radians(b.latitude)
    dp, dl = p2 - p1, math.radians(b.longitude - a.longitude)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _located(item: Scored) -> bool:
    return bool(item.place.latitude and item.place.longitude)


# 한 코스(하루)로 다닐 만한 반경. 반경 안의 두 곳은 많아야 지름(30km)만큼 떨어집니다.
# 그 안에 후보가 너무 적으면 한 단계씩 넓힙니다.
CLUSTER_RADII_KM: tuple[float, ...] = (15.0, 25.0, 40.0)
_ANCHOR_POOL = 40  # 중심 후보로 볼 상위 장소 수 (전부 비교하면 느립니다)


def cluster_nearby(items: list[Scored], limit: int) -> list[Scored]:
    """
    가장 가치 있는 곳들이 모인 지점을 중심으로 반경 안의 후보만 남깁니다.

    중심은 '반경 안에 문장 조건에 맞고 등급 높은 곳이 가장 많이 모이는' 장소입니다.
    문장에 딱 맞는 곳 한 곳이 외딴 곳에 있으면, 그곳보다 맞는 곳이 여럿 모인 지역을
    고릅니다. 반경을 넓혀도 후보가 모자라면 묶지 않고 그대로 돌려줍니다.
    좌표가 없는 곳은 거리를 확인할 수 없어 묶음에서 뺍니다.
    """
    located = [s for s in items if _located(s)]
    if len(located) < 2:
        return items
    anchors = sorted(located, key=lambda s: s.key)[:_ANCHOR_POOL]
    enough = min(max(limit // 2, 6), len(located))

    # 문장 조건에 맞는 곳이 많이 모인 지역을 먼저, 그다음 등급 높은 곳이 모인 지역을
    # 고릅니다 (후보 순서와 같은 우선순위: 문장 > 등급). 예전엔 둘을 비슷한 무게로 더해서
    # '온천이나 휴양' 요청에 등급 좋은 도심이 뽑혀 맞는 곳이 2곳뿐이었습니다.
    # 세는 건 목적 점수가 아니라 특성·편의시설 조건입니다 (AI가 붙인 '휴식' 목적은
    # 관광지 전체에 점수를 줘서, 그걸 세면 어느 지역이나 똑같이 보였습니다).
    # 개수 비중이 크면 식당·공원이 많은 곳이 뽑혀 '많음' 등급 비율이 떨어졌습니다 (56%→45%).
    def value(members: list[Scored]) -> tuple[int, float]:
        return (sum(m.hit for m in members), sum(0.5 + 2 * m.text + 2 * m.grade for m in members))

    for radius in CLUSTER_RADII_KM:
        best: list[Scored] = []
        best_value = (0, 0.0)
        for anchor in anchors:
            members = [s for s in located if _km(anchor.place, s.place) <= radius]
            if value(members) > best_value:
                best, best_value = members, value(members)
        if len(best) >= enough:
            return best
    return items


def _base_name(name: str) -> str:
    """괄호 설명을 뗀 이름 ('수원사(수원)' -> '수원사')."""
    return re.sub(r"[\(\[].*?[\)\]]", "", name or "").replace(" ", "")


def _same_place(a: Attraction, b: Attraction, within_km: float) -> bool:
    name_a, name_b = _base_name(a.name), _base_name(b.name)
    if len(name_a) < 2 or len(name_b) < 2:
        return False
    contains = name_a in name_b or name_b in name_a
    return contains and bool(a.latitude and b.latitude) and _km(a, b) <= within_km


def drop_near_duplicates(places: list[Attraction], within_km: float = 0.5) -> list[Attraction]:
    """
    같은 곳을 두 번 추천하지 않습니다 — 500m 안에 있으면서 한쪽 이름이 다른 쪽 이름을
    통째로 품은 곳 (예: '자라섬'과 '자라섬 이화원', '일월수목원'과 '일월수목원 카페
    데이지원'). 앞에 온(순위가 높은) 곳을 남깁니다. '수원시립미술관'과 '수원시립중앙
    도서관'처럼 앞부분만 같은 곳은 다른 곳으로 봅니다.
    """
    kept: list[Attraction] = []
    for place in places:
        if not any(_same_place(place, other, within_km) for other in kept):
            kept.append(place)
    return kept
