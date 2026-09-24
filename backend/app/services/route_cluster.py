"""
'짧은 동선'·'식사' 요청을 코스를 만든 뒤 경고하는 데서 그치지 않고, 후보를 고르는
단계에서 먼저 맞춥니다.

예전에는 후보를 지역 전체에서 무작위로 뽑아 AI에게 넘기기만 해서, 5.6km 떨어진
공원 두 곳과 식사 여부를 알 수 없는 식당만 후보로 남는 일이 있었습니다. 그러면
사용자가 무엇을 고르든 요청을 만족하는 코스를 만들 수 없고, 검증은 경고만 붙입니다.

짧은 동선 필터는 중간 강도입니다.
- 서로 한도 거리(휠체어·유모차 1.5km, 그 외 2.3km) 안에 모인 가장 좋은 묶음을 모두 남기고,
- 그 묶음에서 조금 떨어진 곳(한도의 2배 이내)은 몇 곳만 뒤에 붙여 고를 여지를 남기며,
- 그보다 먼 곳은 뺍니다.
"""

from dataclasses import dataclass, field

from app.models.schemas import Attraction
from app.services.course_validator import short_route_limit_km
from app.services.place_intent import MEAL, MEAL_UNKNOWN, VenueConstraint, meal_status
from app.services.schedule import straight_distance_km

# 묶음 밖에서 함께 보여줄 '조금 떨어진 곳'의 거리 배수와 개수.
_NEARBY_FACTOR = 2.0
_NEARBY_MAX = 3


@dataclass
class ShortRouteSelection:
    places: list[Attraction]
    # 묶음 밖에서 덧붙인 곳 → 묶음에서 가장 가까운 장소까지의 직선거리(km).
    nearby_km: dict[str, float] = field(default_factory=dict)


def _has_coords(place: Attraction) -> bool:
    return bool(place.latitude and place.longitude)


def _distance(a: Attraction, b: Attraction) -> float:
    return straight_distance_km(a, b) or 0.0


def _cluster_from(anchor: Attraction, places: list[Attraction], limit_km: float) -> list[Attraction]:
    """anchor에서 가까운 순으로, 이미 넣은 모든 장소와 limit_km 안인 곳만 모읍니다."""
    members = [anchor]
    for place in sorted(places, key=lambda p: _distance(anchor, p)):
        if place is anchor:
            continue
        if _distance(anchor, place) > limit_km:
            break
        if all(_distance(place, member) <= limit_km for member in members):
            members.append(place)
    return members


def _cluster_score(
    members: list[Attraction], constraint: VenueConstraint | None, meal_required: bool
) -> tuple:
    missing = len(constraint.missing_requirements(members)) if constraint else 0
    confirmed_meal = any(p.category == "음식점" and meal_status(p) == MEAL for p in members)
    spread = sum(_distance(members[0], p) for p in members)
    return (-missing, confirmed_meal if meal_required else True, len(members), -spread)


def narrow_for_short_route(
    candidates: list[Attraction],
    user_type: str,
    constraint: VenueConstraint | None = None,
) -> ShortRouteSelection:
    """
    짧은 동선 요청에 맞게 후보를 가까이 모인 묶음 위주로 좁힙니다.

    묶음은 요청한 장소 유형을 더 많이 채우는 것, 식사 요청이면 식사가 확인된 식당이
    들어 있는 것, 그다음 장소가 많은 것을 고릅니다. 좌표가 없는 곳은 거리를 확인할
    수 없어서 뺍니다(좌표가 있는 곳이 하나도 없으면 손대지 않습니다).
    """
    located = [p for p in candidates if _has_coords(p)]
    if len(located) < 2:
        return ShortRouteSelection(list(candidates))

    limit_km = short_route_limit_km(user_type)
    meal_required = bool(constraint and constraint.meal_required)
    best = max(
        (_cluster_from(anchor, located, limit_km) for anchor in located),
        key=lambda members: _cluster_score(members, constraint, meal_required),
    )

    member_ids = {p.content_id for p in best}
    nearby: list[tuple[float, Attraction]] = []
    for place in located:
        if place.content_id in member_ids:
            continue
        gap = min(_distance(place, member) for member in best)
        if gap <= limit_km * _NEARBY_FACTOR:
            nearby.append((gap, place))
    nearby.sort(key=lambda item: item[0])
    nearby = nearby[:_NEARBY_MAX]

    return ShortRouteSelection(
        places=best + [place for _, place in nearby],
        nearby_km={place.content_id: round(gap, 1) for gap, place in nearby},
    )


def prefer_confirmed_meals(
    candidates: list[Attraction], constraint: VenueConstraint
) -> tuple[list[Attraction], bool]:
    """
    식사 요청이면 식사가 확인된 식당만 식사 후보로 남깁니다.

    확인된 곳이 하나도 없을 때만 '확인 불가'인 식당을 남기고, 두 번째 값으로 True를
    돌려줍니다(식사 가능한 식당을 찾지 못했다는 뜻). 카페·빵집을 따로 요청했다면
    그 요청을 채우는 곳은 식사 여부와 상관없이 남깁니다.
    """
    confirmed = [p for p in candidates if p.category == "음식점" and meal_status(p) == MEAL]
    if not confirmed:
        has_food = any(p.category == "음식점" for p in candidates)
        return list(candidates), has_food

    def keep(place: Attraction) -> bool:
        if place.category != "음식점" or meal_status(place) != MEAL_UNKNOWN:
            return True
        return any(req.label in ("카페", "빵집") and not req.meal_only and req.matches(place)
                   for req in constraint.requirements)

    return [p for p in candidates if keep(p)], False
