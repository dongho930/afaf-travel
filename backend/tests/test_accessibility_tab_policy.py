"""접근성 탭의 유형별 포함 기준과 카드 점수 검증."""

import asyncio
import unittest
from unittest.mock import patch

from app.models.schemas import AccessibilityFeatures, Attraction
from app.services import tour_api


def place(content_id: str, category: str = "관광지", **features: bool) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=content_id,
        address="경기도 수원시",
        latitude=37.0,
        longitude=127.0,
        category=category,
        accessibility=AccessibilityFeatures(**features),
    )


async def no_ratings(_ids: list[str]) -> dict:
    return {}


class AccessibilityTabPolicyTests(unittest.TestCase):
    def test_explicitly_unavailable_facility_is_not_counted(self):
        self.assertFalse(tour_api._has_facility_description("대여 불가"))
        self.assertFalse(tour_api._has_facility_description("설치되어 있지 않음"))
        self.assertFalse(tour_api._has_facility_description(""))
        self.assertTrue(tour_api._has_facility_description("출입구까지 경사로가 설치되어 있음"))

    def test_each_type_uses_relevant_facilities_and_matching_card_score(self):
        places = [
            place("entry_pair", has_ramp=True, has_exit=True),
            place("parking_only", has_parking=True),
            place("baby_only", has_baby_spare_chair=True),
            place("rental_only", has_wheelchair_rental=True),
            place("audio", has_audio_guide=True),
            place("caption", has_video_guide=True),
            place("room_tour", has_hearing_room=True),
            place("room_lodging", category="숙박", has_hearing_room=True),
            place("stroller_rental", has_stroller_accessible_path=True),
        ]
        client = tour_api.TourApiClient()
        client.use_mock = True
        with patch.object(tour_api, "_MOCK_ATTRACTIONS", places), patch.object(
            tour_api, "get_average_ratings", no_ratings
        ):
            result = asyncio.run(client.get_accessibility_summary("경기도"))

        def ids(category: str) -> set[str]:
            return {p["content_id"] for p in result[f"top_{category}_places"]}

        self.assertEqual(ids("wheelchair"), {"entry_pair"})
        self.assertEqual(ids("senior"), {"entry_pair", "rental_only"})
        self.assertEqual(ids("pregnant"), {"entry_pair"})
        self.assertEqual(ids("visual"), {"audio"})
        self.assertEqual(ids("hearing"), {"caption", "room_lodging"})
        self.assertEqual(ids("family"), {"baby_only", "stroller_rental"})

        pregnant = result["top_pregnant_places"][0]
        self.assertEqual(pregnant["score"], 67)
        self.assertEqual(pregnant["features"], ["has_ramp", "has_exit"])
        lodging = next(p for p in result["top_hearing_places"] if p["content_id"] == "room_lodging")
        self.assertEqual(lodging["features"], ["has_hearing_room"])

    def test_access_and_entrance_together_sort_before_auxiliary_facilities(self):
        places = [
            place("many_but_no_entrance", has_ramp=True, has_parking=True,
                  has_elevator=True, has_wheelchair_rental=True, has_accessible_restroom=True),
            place("access_and_entrance", has_ramp=True, has_exit=True),
        ]
        client = tour_api.TourApiClient()
        client.use_mock = True
        with patch.object(tour_api, "_MOCK_ATTRACTIONS", places), patch.object(
            tour_api, "get_average_ratings", no_ratings
        ):
            result = asyncio.run(client.get_accessibility_summary("경기도"))
        self.assertEqual(result["top_wheelchair_places"][0]["content_id"], "access_and_entrance")


if __name__ == "__main__":
    unittest.main()
