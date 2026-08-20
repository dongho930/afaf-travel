"""
Google Gemini API를 이용한 자연어 질의 파싱 및 무장애 여행 코스 생성

- 사용자 질의(query_text) + 무장애 필터링된 관광지 목록 + 혼잡도 예측 데이터를
  하나의 프롬프트로 구성해 Gemini에게 코스 구성(JSON)을 요청합니다.
- Gemini API는 Google AI Studio(https://aistudio.google.com/apikey)에서
  신용카드 등록 없이 무료로 키를 발급받을 수 있고, 무료 사용량 한도 안에서는
  과금되지 않습니다.
- GEMINI_API_KEY가 없으면 규칙 기반 목업 생성기로 대체되어,
  키 발급 전에도 프론트엔드 개발이 막히지 않습니다.
"""
import json
import uuid

import httpx

from app.config import get_settings
from app.models.schemas import (
    Attraction,
    CourseRequest,
    CourseResponse,
    CourseStop,
    GenerateFromSelectionRequest,
    PlaceCandidate,
    PlaceRecommendationRequest,
)

settings = get_settings()

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

SYSTEM_PROMPT = """당신은 관광약자(휠체어 이용자, 유모차 동반 가족, 고령자, 임산부)를 위한
경기도 무장애 여행 코스를 설계하는 여행 플래너 AI입니다.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 무장애 필터링을 이미 통과한 관광지 후보 목록 (편의시설 정보 포함)
4. 관광지별 시간대별 혼잡도 예측

규칙:
- 반드시 후보 목록에 있는 관광지만 사용하세요.
- 혼잡도가 낮은 시간대를 우선 배치하세요.
- 사용자 유형에 맞는 이동/휴식 동선을 고려하세요 (예: 고령자/임산부는 휴게 공간이 있는 곳 우선).
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "title": "코스 제목",
  "summary": "1~2문장 요약",
  "stops": [
    {"content_id": "관광지 ID", "order": 1, "recommended_arrival_time": "HH:MM", "reason": "추천 이유"}
  ]
}
"""

RECOMMEND_SYSTEM_PROMPT = """당신은 관광약자(휠체어 이용자, 유모차 동반 가족, 고령자, 임산부)를 위한
경기도 무장애 여행 장소를 추천하는 여행 플래너 AI입니다.

아직 코스(순서·시간)를 정하는 단계가 아닙니다 — 사용자가 나중에 직접 고를 수 있도록,
질의에 맞는 장소 후보를 넓게 추천만 해주세요.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 무장애 필터링을 이미 통과한 관광지 후보 목록 (편의시설 정보 포함)

규칙:
- 반드시 후보 목록에 있는 관광지만 사용하세요.
- 질의와 사용자 유형에 맞는 장소를 최대 12개까지, 다양한 카테고리(관광지/음식점/문화시설 등)가
  골고루 섞이도록 선택하세요. 후보가 12개보다 적으면 있는 만큼만 반환하세요.
- 순서는 중요하지 않습니다 (사용자가 나중에 직접 고릅니다).
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "selected": [
    {"content_id": "관광지 ID", "reason": "이 질의에 맞는 이유 (한 문장)"}
  ]
}
"""

ORDER_SYSTEM_PROMPT = """당신은 관광약자(휠체어 이용자, 유모차 동반 가족, 고령자, 임산부)를 위한
경기도 무장애 여행 코스를 설계하는 여행 플래너 AI입니다.

사용자가 이미 방문하고 싶은 장소를 직접 골랐습니다. 당신의 역할은 그 장소들을
빼거나 새로 추가하지 않고, 방문 순서와 추천 시간대만 정하는 것입니다.

주어지는 정보:
1. 사용자의 자연어 질의
2. 사용자 유형
3. 사용자가 직접 선택한 관광지 목록 (편의시설 정보 포함)
4. 관광지별 시간대별 혼잡도 예측

규칙:
- candidates에 주어진 모든 관광지를 빠짐없이 포함하세요 (제외 금지, 추가 금지).
- 혼잡도가 낮은 시간대를 우선 배치하세요.
- 사용자 유형에 맞는 이동/휴식 동선을 고려해 순서를 정하세요.
- 응답은 반드시 아래 JSON 스키마로만 출력하고, 다른 설명은 절대 포함하지 마세요.

{
  "title": "코스 제목",
  "summary": "1~2문장 요약",
  "stops": [
    {"content_id": "관광지 ID", "order": 1, "recommended_arrival_time": "HH:MM", "reason": "추천 이유"}
  ]
}
"""


def _build_user_prompt(request: CourseRequest, candidates: list[Attraction]) -> str:
    candidate_payload = [
        {
            "content_id": a.content_id,
            "name": a.name,
            "category": a.category,
            "accessibility": a.accessibility.model_dump(),
            "congestion_forecast": [c.model_dump() for c in a.congestion_forecast],
        }
        for a in candidates
    ]
    return json.dumps(
        {
            "query_text": request.query_text,
            "user_type": request.user_type,
            "region": request.region,
            "max_stops": request.max_stops,
            "candidates": candidate_payload,
        },
        ensure_ascii=False,
    )


def _mock_generate(request: CourseRequest, candidates: list[Attraction]) -> dict:
    """GEMINI_API_KEY 미설정 시 사용하는 규칙 기반 대체 로직"""
    stops = []
    for i, a in enumerate(candidates[: request.max_stops], start=1):
        low_hours = [c.hour for c in a.congestion_forecast if c.congestion_level == "low"]
        hour = low_hours[0] if low_hours else 10
        stops.append(
            {
                "content_id": a.content_id,
                "order": i,
                "recommended_arrival_time": f"{hour:02d}:00",
                "reason": f"{a.name}은(는) 혼잡도가 낮은 시간대이며 요청하신 접근성 조건에 부합합니다.",
            }
        )
    return {
        "title": f"{request.region} 무장애 여행 코스",
        "summary": f"'{request.query_text}' 요청에 맞춰 구성한 {len(stops)}곳 코스입니다.",
        "stops": stops,
    }


async def _gemini_call(system_prompt: str, user_prompt: str) -> dict:
    url = GEMINI_ENDPOINT.format(model=settings.gemini_model)
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        # JSON 형식으로만 응답하도록 강제 (Gemini의 구조화된 출력 기능)
        "generationConfig": {"responseMimeType": "application/json"},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, params={"key": settings.gemini_api_key}, json=payload)
        resp.raise_for_status()
        data = resp.json()

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


async def _gemini_generate(request: CourseRequest, candidates: list[Attraction]) -> dict:
    return await _gemini_call(SYSTEM_PROMPT, _build_user_prompt(request, candidates))


def _stops_from_raw(raw: dict, candidates: list[Attraction]) -> list[CourseStop]:
    by_id = {a.content_id: a for a in candidates}
    stops = []
    for s in raw["stops"]:
        attraction = by_id.get(s["content_id"])
        if not attraction:
            continue
        stops.append(
            CourseStop(
                order=s["order"],
                attraction=attraction,
                recommended_arrival_time=s["recommended_arrival_time"],
                reason=s["reason"],
            )
        )
    return sorted(stops, key=lambda s: s.order)


async def generate_course(request: CourseRequest, candidates: list[Attraction]) -> CourseResponse:
    if not candidates:
        raise ValueError("추천할 수 있는 무장애 관광지 후보가 없습니다.")

    if settings.gemini_api_key:
        raw = await _gemini_generate(request, candidates)
    else:
        raw = _mock_generate(request, candidates)

    return CourseResponse(
        course_id=str(uuid.uuid4()),
        title=raw["title"],
        summary=raw["summary"],
        stops=_stops_from_raw(raw, candidates),
        generated_for=request.user_type,
    )


def _mock_recommend(request: PlaceRecommendationRequest, candidates: list[Attraction]) -> list[dict]:
    """GEMINI_API_KEY 미설정 시 사용하는 규칙 기반 대체 로직 (질의 키워드로 단순 매칭)"""
    keywords = [w for w in request.query_text.replace(",", " ").split() if len(w) >= 2]

    def score(a: Attraction) -> int:
        haystack = f"{a.name} {a.category} {a.address}"
        return sum(1 for k in keywords if k in haystack)

    ranked = sorted(candidates, key=score, reverse=True)
    top = ranked[:12] if any(score(a) > 0 for a in ranked) else candidates[:12]
    return [
        {"content_id": a.content_id, "reason": f"'{request.query_text}' 요청과 관련된 {a.category} 장소입니다."}
        for a in top
    ]


async def _gemini_recommend(request: PlaceRecommendationRequest, candidates: list[Attraction]) -> list[dict]:
    user_prompt = json.dumps(
        {
            "query_text": request.query_text,
            "user_type": request.user_type,
            "region": request.region,
            "candidates": [
                {
                    "content_id": a.content_id,
                    "name": a.name,
                    "category": a.category,
                    "accessibility": a.accessibility.model_dump(),
                }
                for a in candidates
            ],
        },
        ensure_ascii=False,
    )
    raw = await _gemini_call(RECOMMEND_SYSTEM_PROMPT, user_prompt)
    return raw["selected"]


async def recommend_places(
    request: PlaceRecommendationRequest, candidates: list[Attraction]
) -> list[PlaceCandidate]:
    """
    1단계: 질의에 맞는 장소 후보를 넓게 추천 (코스 순서/시간은 아직 정하지 않음).
    사용자가 이 목록 중에서 실제로 갈 곳을 골라야 2단계(generate_course_from_selection)로 넘어갑니다.
    """
    if not candidates:
        raise ValueError("추천할 수 있는 무장애 관광지 후보가 없습니다.")

    if settings.gemini_api_key:
        selected = await _gemini_recommend(request, candidates)
    else:
        selected = _mock_recommend(request, candidates)

    by_id = {a.content_id: a for a in candidates}
    result = []
    for item in selected:
        attraction = by_id.get(item.get("content_id"))
        if not attraction:
            continue
        result.append(PlaceCandidate(attraction=attraction, reason=item.get("reason", "")))
    return result


async def generate_course_from_selection(
    request: GenerateFromSelectionRequest, selected_attractions: list[Attraction]
) -> CourseResponse:
    """
    2단계: 사용자가 1단계 추천 목록에서 직접 고른 장소들로만 코스를 구성합니다.
    AI는 이 장소들을 빼거나 새로 추가하지 않고, 방문 순서와 추천 시간대만 정합니다.
    """
    if not selected_attractions:
        raise ValueError("선택된 관광지가 없습니다.")

    course_request = CourseRequest(
        query_text=request.query_text,
        user_type=request.user_type,
        region=request.region,
        max_stops=len(selected_attractions),
    )

    if settings.gemini_api_key:
        raw = await _gemini_call(
            ORDER_SYSTEM_PROMPT, _build_user_prompt(course_request, selected_attractions)
        )
    else:
        raw = _mock_generate(course_request, selected_attractions)

    return CourseResponse(
        course_id=str(uuid.uuid4()),
        title=raw["title"],
        summary=raw["summary"],
        stops=_stops_from_raw(raw, selected_attractions),
        generated_for=request.user_type,
    )
