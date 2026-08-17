"""
Claude API를 이용한 자연어 질의 파싱 및 무장애 여행 코스 생성

- 사용자 질의(query_text) + 무장애 필터링된 관광지 목록 + 혼잡도 예측 데이터를
  하나의 프롬프트로 구성해 Claude에게 코스 구성(JSON)을 요청합니다.
- ANTHROPIC_API_KEY가 없으면 규칙 기반 목업 생성기로 대체되어,
  키 발급 전에도 프론트엔드 개발이 막히지 않습니다.
"""
import json
import uuid

from app.config import get_settings
from app.models.schemas import Attraction, CourseRequest, CourseResponse, CourseStop

settings = get_settings()

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
    """ANTHROPIC_API_KEY 미설정 시 사용하는 규칙 기반 대체 로직"""
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


async def _claude_generate(request: CourseRequest, candidates: list[Attraction]) -> dict:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    message = await client.messages.create(
        model=settings.claude_model,
        max_tokens=1500,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_prompt(request, candidates)}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    return json.loads(text)


async def generate_course(request: CourseRequest, candidates: list[Attraction]) -> CourseResponse:
    if not candidates:
        raise ValueError("추천할 수 있는 무장애 관광지 후보가 없습니다.")

    if settings.anthropic_api_key:
        raw = await _claude_generate(request, candidates)
    else:
        raw = _mock_generate(request, candidates)

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

    return CourseResponse(
        course_id=str(uuid.uuid4()),
        title=raw["title"],
        summary=raw["summary"],
        stops=sorted(stops, key=lambda s: s.order),
        generated_for=request.user_type,
    )
