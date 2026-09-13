"""
코스를 짤 때 혼잡도를 실제로 보고 있는지.

프롬프트에는 예전부터 "혼잡도가 낮은 시간대를 우선 배치하라"는 지시가 있었지만,
정작 코스 생성 경로에서 예보를 채우는 코드가 없어서 AI에게는 늘 빈 배열이
넘어갔습니다. 즉 지시만 있고 근거는 없는 상태였습니다. 여기서 보는 것은:

1. 캐시에 있는 예보가 실제로 관광지에 채워지는가 (지난 날짜는 버리는가)
2. 채워진 혼잡도가 프롬프트에 실리는가 (없으면 아예 안 실리는가)
3. AI 없이 도는 규칙 기반 대체 로직도 혼잡도를 반영하는가
"""
import asyncio
import datetime
import json

import pytest

import app.services.tour_api as tour_api
from app.models.schemas import (
    Attraction,
    CongestionForecast,
    CourseRequest,
    GenerateFromSelectionRequest,
    UserType,
)
from app.services import ai_service

TODAY = datetime.date.today()
YESTERDAY = (TODAY - datetime.timedelta(days=1)).isoformat()
TOMORROW = (TODAY + datetime.timedelta(days=1)).isoformat()


def _attraction(content_id: str, name: str, congestion_rate: float | None = None) -> Attraction:
    return Attraction(
        content_id=content_id,
        name=name,
        address="경기도 수원시 팔달구",
        latitude=37.28,
        longitude=127.01,
        category="관광지",
        congestion_rate=congestion_rate,
    )


# ---- 예보 채우기 (캐시 -> 관광지) ----

@pytest.fixture(autouse=True)
def live_mode(monkeypatch):
    """목업 모드에서는 예보를 안 채우므로, 실제 동작을 보려면 꺼둡니다."""
    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", False)


def test_캐시에_있는_예보만_채운다(monkeypatch):
    async def cached(content_ids):
        return {
            "1": {"content_id": "1", "forecast": [{"date": TOMORROW, "hour": 12, "congestion_level": "high"}]}
        }

    monkeypatch.setattr(tour_api, "get_cached_forecast", cached)
    attractions = [_attraction("1", "수원화성"), _attraction("2", "광교호수공원")]

    filled = asyncio.run(tour_api.tour_api_client.fill_congestion_forecasts(attractions))

    assert filled == 1
    assert [c.congestion_level for c in attractions[0].congestion_forecast] == ["high"]
    assert attractions[1].congestion_forecast == []


def test_지난_날짜_예보는_버린다(monkeypatch):
    """예보는 날짜 데이터라, 어제 값으로 오늘 코스를 짜면 근거가 틀립니다."""
    async def cached(content_ids):
        return {
            "1": {
                "content_id": "1",
                "forecast": [
                    {"date": YESTERDAY, "hour": 12, "congestion_level": "low"},
                    {"date": TOMORROW, "hour": 12, "congestion_level": "high"},
                ],
            }
        }

    monkeypatch.setattr(tour_api, "get_cached_forecast", cached)
    attractions = [_attraction("1", "수원화성")]

    asyncio.run(tour_api.tour_api_client.fill_congestion_forecasts(attractions))

    assert [c.date for c in attractions[0].congestion_forecast] == [TOMORROW]


def test_캐시를_못_읽어도_코스_생성은_계속된다(monkeypatch):
    async def boom(content_ids):
        raise tour_api.CacheUnavailable("일시 장애")

    monkeypatch.setattr(tour_api, "get_cached_forecast", boom)
    attractions = [_attraction("1", "수원화성")]

    assert asyncio.run(tour_api.tour_api_client.fill_congestion_forecasts(attractions)) == 0
    assert attractions[0].congestion_forecast == []


def test_목업_모드에서는_캐시를_읽지_않는다(monkeypatch):
    async def forbidden(content_ids):
        raise AssertionError("목업 모드에서는 예보 캐시를 읽을 필요가 없습니다")

    monkeypatch.setattr(tour_api.tour_api_client, "use_mock", True)
    monkeypatch.setattr(tour_api, "get_cached_forecast", forbidden)

    assert asyncio.run(tour_api.tour_api_client.fill_congestion_forecasts([_attraction("1", "x")])) == 0


# ---- 프롬프트에 실리는지 ----

def _prompt_payload(candidates, include_forecast=True) -> dict:
    request = CourseRequest(query_text="가볼 만한 곳", user_type=UserType.WHEELCHAIR, max_stops=3)
    return json.loads(
        ai_service._build_user_prompt(request, candidates, None, include_forecast=include_forecast)
    )


def test_혼잡도가_프롬프트에_실린다():
    a = _attraction("1", "수원화성", congestion_rate=82.4)
    a.congestion_forecast = [CongestionForecast(date=TOMORROW, hour=12, congestion_level="high")]

    candidate = _prompt_payload([a])["candidates"][0]

    assert candidate["congestion_rate"] == 82
    assert candidate["daily_congestion"] == [{"date": TOMORROW, "level": "high"}]


def test_데이터가_없으면_혼잡도_항목_자체를_넣지_않는다():
    """None으로라도 넣으면 AI가 '정보가 있다'고 보고 근거를 지어냅니다."""
    candidate = _prompt_payload([_attraction("1", "수원화성")])["candidates"][0]

    assert "congestion_rate" not in candidate
    assert "daily_congestion" not in candidate


def test_1단계에서는_날짜별_예보를_빼서_프롬프트를_줄인다():
    """1단계는 후보가 25곳까지 실려서, 날짜별 예보까지 넣으면 토큰 한도에 걸립니다."""
    a = _attraction("1", "수원화성", congestion_rate=50)
    a.congestion_forecast = [CongestionForecast(date=TOMORROW, hour=12, congestion_level="low")]

    candidate = _prompt_payload([a], include_forecast=False)["candidates"][0]

    assert candidate["congestion_rate"] == 50
    assert "daily_congestion" not in candidate


def test_예보는_가까운_며칠만_싣는다():
    a = _attraction("1", "수원화성")
    a.congestion_forecast = [
        CongestionForecast(
            date=(TODAY + datetime.timedelta(days=i)).isoformat(), hour=12, congestion_level="low"
        )
        for i in range(10)
    ]

    candidate = _prompt_payload([a])["candidates"][0]

    assert len(candidate["daily_congestion"]) == ai_service._MAX_FORECAST_DAYS


def test_2단계_코스_생성_프롬프트에_혼잡도가_들어간다(monkeypatch):
    """이 테스트가 이번 작업의 핵심입니다 — 예전에는 늘 빈 배열이 넘어갔습니다."""
    sent: list = []

    class _Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "코스",
                                    "summary": "요약",
                                    "stops": [
                                        {
                                            "content_id": "1",
                                            "order": 1,
                                            "recommended_arrival_time": "09:00",
                                            "reason": "붐비기 전에",
                                        }
                                    ],
                                }
                            )
                        }
                    }
                ]
            }

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *args, **kwargs):
            sent.append(kwargs.get("json"))
            return _Response()

    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ai_service.httpx, "AsyncClient", lambda *a, **kw: _Client())

    a = _attraction("1", "수원화성", congestion_rate=90)
    a.congestion_forecast = [CongestionForecast(date=TOMORROW, hour=12, congestion_level="high")]
    request = GenerateFromSelectionRequest(query_text="가볼 만한 곳", selected_content_ids=["1"])

    asyncio.run(ai_service.generate_course_from_selection(request, [a]))

    user_prompt = json.loads(sent[0]["messages"][1]["content"])
    assert user_prompt["candidates"][0]["congestion_rate"] == 90
    assert user_prompt["candidates"][0]["daily_congestion"] == [{"date": TOMORROW, "level": "high"}]


# ---- 규칙 기반 대체 로직도 혼잡도를 본다 ----

def test_붐비는_곳을_코스_앞쪽에_놓는다():
    request = CourseRequest(query_text="아무거나", max_stops=3)
    candidates = [
        _attraction("1", "한산한곳", congestion_rate=10),
        _attraction("2", "아주붐비는곳", congestion_rate=95),
        _attraction("3", "보통인곳", congestion_rate=50),
    ]

    raw = ai_service._mock_generate(request, candidates)

    # 붐비는 곳부터 먼저 들르도록 순서를 잡습니다 (시각은 schedule 모듈이 붙입니다)
    assert [s["content_id"] for s in raw["stops"]] == ["2", "3", "1"]


def test_붐비는_곳이_결국_가장_이른_시각을_받는다():
    """순서(대체 로직) + 시각(스케줄러)이 이어져 실제 코스로 나오는지 확인합니다."""
    selected = [
        _attraction("1", "한산한곳", congestion_rate=10),
        _attraction("2", "아주붐비는곳", congestion_rate=95),
    ]
    request = GenerateFromSelectionRequest(
        query_text="아무거나", selected_content_ids=["1", "2"]
    )

    course = asyncio.run(ai_service.generate_course_from_selection(request, selected))

    assert course.stops[0].attraction.content_id == "2"
    assert course.stops[0].recommended_arrival_time == "09:00"
    assert course.stops[1].recommended_arrival_time > "09:00"


def test_혼잡도_정보가_없으면_원래_순서를_지킨다():
    """정보가 없는 곳끼리 순서를 흔들면 사용자가 고른 순서가 이유 없이 바뀝니다."""
    request = CourseRequest(query_text="아무거나", max_stops=3)
    candidates = [_attraction("1", "가"), _attraction("2", "나"), _attraction("3", "다")]

    raw = ai_service._mock_generate(request, candidates)

    assert [s["content_id"] for s in raw["stops"]] == ["1", "2", "3"]


def test_1단계가_추천할_수_있는_최대치를_모두_골라도_코스가_만들어진다():
    """1단계는 최대 12곳을 추천하는데, 상한이 10이던 시절엔 11곳부터 검증 오류로 실패했습니다."""
    selected = [_attraction(str(i), f"곳{i}") for i in range(12)]
    request = GenerateFromSelectionRequest(
        query_text="많이 고른 코스", selected_content_ids=[a.content_id for a in selected]
    )

    course = asyncio.run(ai_service.generate_course_from_selection(request, selected))

    assert len(course.stops) == 12
    assert [s.order for s in course.stops] == list(range(1, 13))


def test_혼잡도가_없는_곳에_혼잡도를_근거로_대지_않는다():
    request = CourseRequest(query_text="아무거나", max_stops=1)

    raw = ai_service._mock_generate(request, [_attraction("1", "정보없는곳")])

    assert "혼잡" not in raw["stops"][0]["reason"]
    assert "한산" not in raw["stops"][0]["reason"]
