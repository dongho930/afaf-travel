import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import (
    Attraction,
    CourseRequest,
    CourseResponse,
    CourseSplitResponse,
    CourseStop,
    GenerateFromSelectionRequest,
    ParsedQuery,
    PlaceRecommendationRequest,
    PlaceRecommendationResponse,
    SaveCourseRequest,
    SplitCourseRequest,
    SavedCourseDetail,
    SavedCourseSummary,
    TripCreateRequest,
    TripSummary,
    TripUpdateRequest,
    UpdateCourseRequest,
    UpdateVisitedDateRequest,
    UserType,
    VisitedPlace,
)
from app.services.ai_service import (
    GroqUnavailableError,
    generate_course,
    generate_course_from_selection,
    parse_query,
    recommend_places,
)
from app.services.course_validator import prefers_short_route, strip_meal_from_title
from app.services.place_intent import VenueConstraint, venue_constraint_for_query, with_josa
from app.services.route_cluster import narrow_for_short_route, prefer_confirmed_meals
from app.services.auth import get_optional_user_id
from app.services.supabase_service import (
    CacheUnavailable,
    attach_course_to_trip,
    count_visited_places,
    create_trip,
    delete_course,
    delete_trip,
    delete_visited_place,
    get_saved_course_detail,
    list_saved_courses,
    list_trip_courses,
    list_trips,
    list_visited_places,
    mark_trip_as_visited,
    row_to_course_response,
    save_course,
    split_course,
    unmark_trip_as_visited,
    update_course,
    update_trip,
    update_visited_place_date,
)
from app.services.query_preferences import extract_preferences, unmet_labels
from app.services.request_conflicts import conflict_message, find_conflicts
from app.services.schedule import is_closed_on, next_day_of
from app.services.selection_log_service import RETENTION_DAYS, log_recommendation, log_selection, purge_old_logs
from app.services.tour_api import tour_api_client

router = APIRouter(tags=["courses"])
logger = logging.getLogger(__name__)

courses_router = APIRouter(prefix="/api/courses", tags=["courses"])
trips_router = APIRouter(prefix="/api/trips", tags=["trips"])

# AI에게 넘길 후보 개수. 25곳일 땐 '맛집 위주로' 같은 질의에 음식점이 다섯 곳밖에
# 안 실려서, AI가 최대 12개를 고르고 싶어도 고를 게 없었습니다. 후보가 늘면
# 프롬프트도 커지지만 장소당 싣는 정보(이름·카테고리·편의시설 몇 필드·혼잡도)가
# 작아서 이 정도는 감당됩니다.
_CANDIDATE_LIMIT = 40
# 짧은 동선 요청은 가까이 모인 곳만 남기므로 표본을 넉넉히 뽑습니다. 40곳을 지역
# 전체에 흩어 뽑으면 서로 1.5km 안에 모인 곳이 두세 곳밖에 안 남습니다.
_SHORT_ROUTE_CANDIDATE_LIMIT = 100
# 식사 가능이 확인된 식당이 없을 때 missing_categories에 싣는 이름.
_MEAL_UNCONFIRMED_LABEL = "식사 가능 음식점"


def _required_place_gaps(
    constraint: VenueConstraint | None, places: list[Attraction]
) -> tuple[list[str], bool]:
    """여행 코스의 식사 누락은 안내하고, 다른 필수 장소 누락은 막습니다."""
    missing = constraint.missing_requirements(places) if constraint else []
    meal_gap = "음식점" in missing and any(place.category != "음식점" for place in places)
    return [label for label in missing if label != "음식점" or not meal_gap], meal_gap


def _note_missing_meal(course: CourseResponse, meal_gap: bool) -> None:
    if meal_gap:
        course.title = strip_meal_from_title(course.title)
        course.summary = (
            f"{course.summary.rstrip()} 요청하신 식사 장소가 이 코스에 포함되지 않았어요. "
            "식사 장소는 별도로 확인해 주세요."
        )


# 추천이 이보다 적으면 왜 적은지 알려줍니다 (ai_service의 최소 추천 개수와 같음).
_MIN_RESULTS_BEFORE_NOTICE = 6


def _few_results_notice(count: int, closed_count: int, request: PlaceRecommendationRequest) -> str:
    """추천이 적을 때 이유와 할 수 있는 일을 한 문장으로 (분당 박물관 월요일 → 1곳 같은 경우)."""
    parts = [f"조건에 맞는 곳이 {count}곳뿐이에요."]
    if closed_count:
        parts.append(f"방문일에 쉬는 {closed_count}곳은 뺐어요.")
    if request.user_type.value == "hearing":
        # 청각 유형은 수어·자막·영상 안내가 등록된 곳만 추천합니다 (경기도에 몇 곳뿐).
        parts.append("청각 편의시설이 등록된 장소가 아직 많지 않아요.")
    tips = [tip for tip, on in (("지역을 넓히거나", request.sigungu_cd is not None),
                                 ("방문일을 바꾸거나", bool(closed_count))) if on]
    parts.append(f"{' '.join(tips)} 다른 표현으로 다시 요청해 보세요." if tips else "다른 표현으로 다시 요청해 보세요.")
    return " ".join(parts)


async def _candidates_with_conditions(
    query_text: str, user_type: str, region: str, sigungu_cd: Optional[int],
    visit_date: Optional[str] = None,
) -> tuple[list[Attraction], ParsedQuery, Optional[VenueConstraint]]:
    """
    질의에서 조건을 뽑아낸 뒤, 그 조건(지역·목적·키워드)에 맞는 무장애 관광지
    후보를 지역 전체에서 표본으로 뽑아 돌려줍니다.

    후보는 매번 달라집니다. 예전에는 카테고리마다 목록 맨 앞에서 여섯 개씩
    가져와서 후보가 늘 같은 25곳(전부 이름이 ㄱ으로 시작)으로 고정됐습니다.
    2단계(코스 생성)는 이제 후보 목록을 다시 만들지 않고 고른 장소만 직접
    불러오므로, 후보가 매번 달라져도 문제가 없습니다.

    질의에서 읽어낸 지역은 결과에도 그대로 적용합니다. 해당 지역에 조건에 맞는
    장소가 없다면 다른 도시의 장소를 같은 지역인 듯 추천하지 않습니다.
    """
    parsed = await parse_query(query_text, sigungu_cd, region)
    # 요청한 종류가 지역에 없으면 비슷한 종류로 넓힌 제약을 끝까지 같이 씁니다.
    venue_constraint = await tour_api_client.widen_unavailable_venues(
        venue_constraint_for_query(query_text), user_type, parsed.sigungu_cds or None, region,
    )
    short_route = parsed.prefers_short_route or prefers_short_route(query_text)

    candidates = await tour_api_client.sample_accessible_candidates(
        region=region,
        user_type=user_type,
        limit=_SHORT_ROUTE_CANDIDATE_LIMIT if short_route else _CANDIDATE_LIMIT,
        sigungu_cd=parsed.sigungu_cds or None,
        purposes=[p.value for p in parsed.purposes],
        keywords=parsed.keywords,
        venue_constraint=venue_constraint,
        query_text=query_text,
        ai_labels=[*parsed.concepts, *parsed.facilities],
        visit_date=visit_date,
    )

    return candidates, parsed, venue_constraint


@courses_router.post("/recommend", response_model=PlaceRecommendationResponse)
async def recommend_course_places(
    request: PlaceRecommendationRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    1단계: 사용자의 자연어 질의에 맞는 장소 후보를 넓게 추천합니다.
    아직 코스(순서/시간)를 확정하지 않고, 사용자가 이 중에서 직접 고를 수 있게 목록만 보여줍니다.

    질의는 그대로 AI에게 넘기기만 하는 게 아니라, 먼저 지역·동행자·목적을 뽑아
    (parse_query) 지역은 후보 검색 범위로, 동행자·목적은 추천 조건으로 씁니다.
    무엇으로 이해했는지는 응답의 parsed에 담아 앱이 보여줄 수 있게 합니다.

    우선순위는 화면에서 고른 유형·지역·방문일이 먼저입니다. 문장에 적은 유형·지역·
    날짜가 고른 값과 어긋나면 추천으로 넘어가지 않고, 무엇이 맞지 않는지 알려줍니다
    (422 — 앱은 detail 문장을 그대로 알림으로 보여줍니다).
    """
    conflicts = find_conflicts(
        request.query_text, request.user_type.value, request.sigungu_cd,
        request.visit_date, request.region,
    )
    if conflicts:
        raise HTTPException(status_code=422, detail=conflict_message(conflicts))

    try:
        candidates, parsed, constraint = await _candidates_with_conditions(
            request.query_text, request.user_type.value, request.region, request.sigungu_cd,
            request.visit_date,
        )
    except CacheUnavailable as e:
        # 후보를 고르려면 편의시설 캐시를 반드시 읽어야 합니다. 못 읽었다는 건
        # 보통 조회가 몰렸다는 뜻이라, 왜 안 되는지를 사용자 말로 알려줍니다.
        logger.warning("편의시설 캐시를 읽지 못해 장소 추천을 중단합니다: %s", e)
        raise HTTPException(
            status_code=503,
            detail="지금 요청이 많아 장소 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
        )

    # 후보가 하나도 없는 건 오류가 아니라 '결과 없음'입니다. 예전에는 여기서
    # 422가 나가 앱에 "장소 추천 실패" 팝업이 떴는데, 앱에는 이미 후보 0개를 위한
    # 안내("조건에 맞는 장소를 찾지 못했어요")가 있어서 그쪽으로 보냅니다.
    #
    # 식사·짧은 동선 요청은 여기서 먼저 맞춥니다. 코스를 만든 뒤 경고만 붙이면
    # 사용자가 무엇을 고르든 요청을 만족하는 코스가 나올 수 없기 때문입니다.
    meal_unconfirmed = False
    if constraint and constraint.meal_required:
        await tour_api_client.fill_extra_info([place for place in candidates if place.category == "음식점"])
        candidates = [place for place in candidates if constraint.accepts_food_place(place)]
        candidates, meal_unconfirmed = prefer_confirmed_meals(candidates, constraint)
    nearby_km: dict[str, float] = {}
    if candidates and (parsed.prefers_short_route or prefers_short_route(request.query_text)):
        selection = narrow_for_short_route(candidates, request.user_type.value, constraint)
        candidates, nearby_km = selection.places[:_CANDIDATE_LIMIT], selection.nearby_km
    missing_categories = constraint.missing_requirements(candidates) if constraint else []
    if meal_unconfirmed and "음식점" not in missing_categories:
        missing_categories.append(_MEAL_UNCONFIRMED_LABEL)
    # 문장에서 원한 특성·편의시설(예: 호수, 장애인 화장실)에 맞는 곳이 하나도 없으면,
    # 고른 조건에 맞는 다른 곳을 추천하면서 무엇을 못 찾았는지 알려줍니다.
    # (앱은 missing_categories를 "○○ 장소를 찾지 못했어요"로 보여줍니다.)
    if candidates:
        prefs = extract_preferences(
            request.query_text, parsed.keywords, ai_labels=[*parsed.concepts, *parsed.facilities]
        )
        missing_categories += [label for label in unmet_labels(candidates, prefs)
                               if label not in missing_categories]
    if not candidates:
        logger.info("조건에 맞는 후보가 없습니다: %r", request.query_text)
        return PlaceRecommendationResponse(
            query_text=request.query_text, candidates=[], parsed=parsed,
            missing_categories=missing_categories,
        )

    # 방문 날짜를 알 때만 영업정보를 채웁니다 — 그날 쉬는 곳을 추천에서 빼기 위한
    # 것이라, 날짜가 없으면 굳이 조회할 이유가 없습니다.
    if request.visit_date:
        await tour_api_client.fill_extra_info(candidates)
        # 방문일에 쉬는 게 확인된 곳은 후보에서 뺍니다. 영업 정보가 없는 곳은 남깁니다
        # (is_closed_on은 휴무가 확실할 때만 True). 예전엔 AI에게 "고르지 마세요"라고
        # 부탁만 해서, AI가 고르면 휴무인 곳이 그대로 추천에 남았습니다.
        before = len(candidates)
        candidates = [place for place in candidates if not is_closed_on(place, request.visit_date)]
        closed_count = before - len(candidates)
        if not candidates:
            return PlaceRecommendationResponse(
                query_text=request.query_text, candidates=[], parsed=parsed,
                missing_categories=missing_categories,
            )
    else:
        closed_count = 0
    try:
        selected = await recommend_places(request, candidates, parsed, constraint) if candidates else []
    except GroqUnavailableError as e:
        # 한도 초과·지연·형식 오류 등 AI에게 답을 못 받은 모든 경우. 규칙 기반
        # 목록으로 대충 채우지 않고, 다시 시도하면 된다고 알려줍니다.
        logger.warning("AI에게 장소 추천을 받지 못했습니다: %s", e)
        raise HTTPException(
            status_code=503,
            detail="AI가 지금 응답하지 않아요. 잠시 후 다시 시도해주세요.",
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # 짧은 동선 묶음 밖에서 덧붙인 곳은 떨어진 거리를 알리고 목록 뒤로 보냅니다.
    for item in selected:
        km = nearby_km.get(item.attraction.content_id)
        if km is not None:
            item.reason = f"{item.reason} 다른 후보들과 직선 약 {km:g}km 떨어져 있어요."
    selected.sort(key=lambda item: item.attraction.content_id in nearby_km)

    recommendation_id = log_recommendation(
        query_text=request.query_text, user_type=request.user_type.value,
        sigungu_cd=request.sigungu_cd, visit_date=request.visit_date,
        recommended_ids=[item.attraction.content_id for item in selected],
        user_id=user_id,
    )
    notices = constraint.substitute_notices() if constraint else []
    if len(selected) < _MIN_RESULTS_BEFORE_NOTICE:
        notices.append(_few_results_notice(len(selected), closed_count, request))
    return PlaceRecommendationResponse(
        query_text=request.query_text, candidates=selected, parsed=parsed,
        missing_categories=missing_categories, recommendation_id=recommendation_id,
        notices=notices,
    )


@courses_router.get("/selection-logs/purge")
async def purge_selection_logs():
    """
    보관 기간이 지난 추천·선택 기록을 지웁니다. GitHub Actions가 하루 한 번 부릅니다
    (.github/workflows/selection-log-purge.yml). 기간이 지난 것만 지우므로 여러 번
    불러도 결과가 같습니다.
    """
    deleted = await purge_old_logs()
    if deleted is None:
        raise HTTPException(status_code=503, detail="추천 기록을 정리하지 못했습니다.")
    return {"deleted": deleted, "retention_days": RETENTION_DAYS}


@courses_router.post("/generate-from-selection", response_model=CourseResponse)
async def create_course_from_selection(
    request: GenerateFromSelectionRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    2단계: 1단계 추천 목록에서 사용자가 직접 고른 장소들로 최종 코스(순서/시간대)를 생성합니다.
    로그인한 사용자면 자동으로 기록되지만, 결과 화면에서 여행에 저장해야
    마이페이지 목록에 나타납니다.

    코스를 짜기 전에 두 가지를 채웁니다.
    - 질의에서 뽑아낸 조건(지역/동행자/목적) — 1단계와 같은 해석을 씁니다.
    - 고른 장소들의 날짜별 혼잡도 예보 — 붐비는 곳을 한산한 시간대로 옮기려면
      실제 혼잡도 값이 있어야 합니다.
    """
    # 후보 목록을 다시 만들지 않고, 사용자가 고른 장소만 곧바로 불러옵니다.
    #
    # 예전에는 1단계와 똑같이 후보를 다시 뽑아서 그 안에서 찾았습니다. 후보를 뽑는
    # 일 자체가 무거운 데다, 1·2단계 사이에 후보 구성이 조금만 달라져도(이제는
    # 표본이라 매번 달라집니다) 고른 장소가 빠져서 어차피 단건 조회로 떨어졌습니다.
    # 조건(parsed)은 질의만 다시 해석하면 되고, 같은 질의는 10분간 캐시되므로
    # AI를 다시 부르지 않습니다.
    parsed = await parse_query(request.query_text, request.sigungu_cd, request.region)

    details = await asyncio.gather(
        *(tour_api_client.get_attraction_detail(cid) for cid in request.selected_content_ids)
    )
    selected_attractions: list[Attraction] = []
    seen_selected_ids: set[str] = set()
    for content_id, detail in zip(request.selected_content_ids, details):
        if detail is None:
            logger.warning("선택한 관광지를 불러오지 못했습니다 (content_id=%s)", content_id)
            continue
        if detail.content_id in seen_selected_ids:
            continue
        seen_selected_ids.add(detail.content_id)
        selected_attractions.append(detail)

    if not selected_attractions:
        raise HTTPException(status_code=422, detail="선택하신 관광지 정보를 다시 불러오지 못했습니다. 다시 시도해주세요.")

    # 사용자가 고른 장소는 요청과 달라도 그대로 코스로 만듭니다. 예전엔 요청과 다른
    # 종류·빠진 종류·문장 속 지역 밖을 고르면 422로 막았는데, 추천 목록에서 직접 고른
    # 곳을 거절하는 셈이었고 목록에 그 종류가 아예 없으면 코스를 만들 방법이 없었습니다.
    # 이제는 무엇이 요청과 다른지 코스 경고(warnings)로만 알립니다.
    # 넓힌 제약(비슷한 종류로 대신 추천)을 쓰는 건, 대신 추천한 곳을 고른 사람에게
    # '요청과 다른 종류'라고 알리지 않기 위해서입니다.
    constraint = await tour_api_client.widen_unavailable_venues(
        venue_constraint_for_query(request.query_text), request.user_type.value,
        parsed.sigungu_cds or None, request.region,
    )
    if constraint and constraint.meal_required:
        await tour_api_client.fill_extra_info(selected_attractions)
    meal_gap = False
    selection_notes: list[str] = []
    if constraint:
        excluded = [place.name for place in selected_attractions if constraint.is_excluded(place)]
        different = [place.name for place in selected_attractions
                     if not constraint.is_excluded(place) and not constraint.matches(place)]
        if excluded:
            selection_notes.append(f"빼달라고 하신 종류인 {', '.join(excluded)}도 고르신 대로 코스에 넣었어요.")
        if different:
            selection_notes.append(f"요청과 다른 종류인 {', '.join(different)}도 고르신 대로 코스에 넣었어요.")
        missing, meal_gap = _required_place_gaps(constraint, selected_attractions)
        if missing:
            selection_notes.append(f"요청하신 {with_josa('·'.join(sorted(missing)), '은', '는')} 이 코스에 포함되지 않았어요.")
    if parsed.region_text and "외" not in parsed.region_text:
        region_tokens = parsed.region_text.split()
        outside = [place.name for place in selected_attractions
                   if not all(token in place.address for token in region_tokens)]
        if outside:
            selection_notes.append(
                f"요청하신 {parsed.region_text} 밖의 {', '.join(outside)}도 고르신 대로 코스에 넣었어요."
            )

    # 방문 시각을 영업시간·휴무일에 맞춰 계산하려면 부가정보가, 붐비는 곳을 앞으로
    # 당기려면 혼잡도 예보가 필요합니다. 둘 다 캐시만 읽어서 채웁니다.
    if not (constraint and constraint.meal_required):
        await tour_api_client.fill_extra_info(selected_attractions)
    await tour_api_client.fill_congestion_forecasts(selected_attractions)

    try:
        course = await generate_course_from_selection(request, selected_attractions, parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _note_missing_meal(course, meal_gap)
    course.warnings = [*selection_notes, *course.warnings]
    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    log_selection(request.recommendation_ids, [place.content_id for place in selected_attractions])
    return course


@courses_router.post("/generate", response_model=CourseResponse, deprecated=True)
async def create_course(
    request: CourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    (레거시) 질의 하나로 후보 선택 없이 바로 코스를 생성합니다.
    새 플로우는 /recommend → /generate-from-selection 두 단계를 씁니다.

    앱은 2026-08-22부터 이 경로를 쓰지 않습니다. 그래도 남겨두는 이유는, 그 전에
    설치된 네이티브 빌드가 아직 이 경로를 부를 수 있어서입니다(웹은 항상 최신이
    배포되지만 EAS/dev client 빌드는 사용자 기기에 남습니다). Render 로그는 7일치만
    보관해서 "아무도 안 쓴다"를 확인할 수가 없었습니다 — 그래서 아래 한 줄을 남깁니다.
    한 달쯤 뒤 이 로그가 한 번도 안 찍혔으면 그때 안심하고 지우면 됩니다.
    """
    print(f"[legacy] POST /api/courses/generate 호출됨 (user_id={user_id})")
    candidates, parsed, _ = await _candidates_with_conditions(
        request.query_text, request.user_type.value, request.region, None
    )
    await tour_api_client.fill_extra_info(candidates[: request.max_stops])
    await tour_api_client.fill_congestion_forecasts(candidates[: request.max_stops])
    try:
        course = await generate_course(request, candidates, parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    constraint = venue_constraint_for_query(request.query_text)
    if constraint:
        missing, meal_gap = _required_place_gaps(constraint, [stop.attraction for stop in course.stops])
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"요청하신 {'·'.join(missing)} 장소가 없어 코스를 완성할 수 없어요.",
            )
        _note_missing_meal(course, meal_gap)

    await save_course(course, query_text=request.query_text, region=request.region, user_id=user_id)
    return course


@courses_router.post("/from-attraction/{content_id}", response_model=CourseResponse)
async def create_course_from_attraction(
    content_id: str,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    관광지 상세 페이지의 '저장' 버튼용. 이 관광지 하나만 담은 1개짜리 코스를
    만들어서 course_id를 발급합니다. 이후 흐름은 AI플래너 결과 화면의 저장과
    완전히 동일합니다 — 이 course_id로 /api/courses/{course_id}/save를 불러서
    기존 여행에 붙이거나 새 여행을 만들면 됩니다.
    """
    attraction = await tour_api_client.get_attraction_detail(content_id)
    if attraction is None:
        raise HTTPException(status_code=404, detail="관광지를 찾을 수 없어요.")

    course = CourseResponse(
        course_id=str(uuid.uuid4()),
        title=attraction.name,
        summary=f"{attraction.name}을(를) 직접 저장한 코스입니다.",
        stops=[
            CourseStop(
                order=1,
                attraction=attraction,
                recommended_arrival_time="09:00",
                reason="직접 저장한 장소",
            )
        ],
        generated_for=UserType.GENERAL,
    )
    # 지역 정보는 주소 앞부분(예: '경기도 수원시')을 그대로 씁니다 — 저장 시
    # 새 여행을 만들 때 필수는 아니지만, 코스 이력에 표시되면 도움이 됩니다.
    region = " ".join(attraction.address.split(" ")[:2]) if attraction.address else ""
    await save_course(course, query_text=attraction.name, region=region, user_id=user_id)
    return course


@courses_router.get("/saved", response_model=list[SavedCourseSummary])
async def list_saved_courses_endpoint(
    limit: int = 50,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    '내 여행' 탭의 '저장한 경로' 통계 카드를 눌렀을 때 쓰는 목록입니다.
    실제로 여행에 저장된 코스만(여행 구분 없이 전부) 최신순으로 반환합니다.
    """
    if not user_id:
        return []
    rows = await list_saved_courses(user_id, limit=limit)
    return [
        SavedCourseSummary(
            course_id=row["id"],
            title=row["title"],
            summary=row["summary"],
            region=row.get("region") or "",
            stop_count=len(row.get("stops") or []),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@courses_router.post("/{course_id}/save")
async def save_course_endpoint(
    course_id: str,
    request: SaveCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    결과 화면에서 '저장하기'를 눌렀을 때 호출합니다.
    - trip_id를 주면 기존 여행에 이 코스를 추가합니다.
    - new_trip_name(+category)을 주면 새 여행을 만들면서 그 여행에 이 코스를 추가합니다.
    로그인이 필요합니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="저장하려면 로그인이 필요해요.")

    trip_id = request.trip_id
    if not trip_id:
        if not request.new_trip_name:
            raise HTTPException(status_code=422, detail="기존 여행(trip_id)을 고르거나, 새 여행 이름(new_trip_name)을 입력해주세요.")
        trip_id = await create_trip(
            user_id, request.new_trip_name, request.category or "기타", request.start_date, request.end_date
        )
        if not trip_id:
            raise HTTPException(status_code=500, detail="새 여행을 만들지 못했어요.")

    ok, message = await attach_course_to_trip(course_id, user_id, trip_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True, "trip_id": trip_id}


@courses_router.delete("/{course_id}")
async def delete_course_endpoint(
    course_id: str,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """저장된 코스 하나를 여행에서 삭제합니다 (여행 자체는 남아있어요)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")

    ok, message = await delete_course(course_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@courses_router.patch("/{course_id}", response_model=CourseResponse)
async def update_course_endpoint(
    course_id: str,
    request: UpdateCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    저장된 코스의 제목을 바꾸거나(title), 관광지 순서를 바꿉니다(stop_order).
    로그인이 필요하고, 본인 코스만 수정할 수 있습니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")

    row, error = await update_course(course_id, user_id, title=request.title, stop_order=request.stop_order)
    if row is None:
        raise HTTPException(status_code=404 if "찾을 수 없" in (error or "") else 422, detail=error)
    return row_to_course_response(row)


@courses_router.post("/{course_id}/split", response_model=CourseSplitResponse)
async def split_course_endpoint(
    course_id: str,
    request: SplitCourseRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """
    하루에 다 돌 수 없는 코스를 둘로 나눕니다 — from_order부터 끝까지를 다음 날 코스로.

    결과 화면에서 "문 닫은 뒤 도착" 또는 "그날 휴무"로 표시된 장소가 있을 때
    쓰는 기능입니다. 다음 날 코스는 하루 뒤 날짜로 시각과 휴무일을 다시 계산하므로,
    월요일 휴관이라 못 가던 곳이 화요일로 넘어가면 경고가 사라집니다.

    원본이 이미 여행에 저장돼 있으면 새 코스도 같은 여행에 들어갑니다.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="코스를 나누려면 로그인이 필요해요.")

    today_row, next_day_row, error = await split_course(
        course_id, user_id, request.from_order, request.visit_date
    )
    if today_row is None or next_day_row is None:
        raise HTTPException(status_code=404 if "찾을 수 없" in (error or "") else 422, detail=error)

    return CourseSplitResponse(
        today=row_to_course_response(today_row),
        next_day=row_to_course_response(next_day_row),
        visit_date=request.visit_date,
        next_visit_date=next_day_of(request.visit_date),
    )


@courses_router.get("/saved/{course_id}", response_model=SavedCourseDetail)
async def get_saved_course_endpoint(
    course_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """저장된 코스 하나를 다시 불러옵니다 (지도/결과 화면 재진입용)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")

    row = await get_saved_course_detail(course_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="저장된 코스를 찾을 수 없어요.")

    trip = row.get("_trip") or {}
    return SavedCourseDetail(
        course=row_to_course_response(row),
        trip_id=row.get("trip_id") or "",
        trip_name=trip.get("name") or "",
        category=trip.get("category") or "기타",
        region=row.get("region") or "",
        created_at=row.get("created_at"),
    )


@trips_router.post("", response_model=TripSummary)
async def create_trip_endpoint(
    request: TripCreateRequest, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """새 여행을 미리 만들어둡니다 (보통은 코스 저장 시 한 번에 만들지만, 필요하면 따로도 가능)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요해요.")

    trip_id = await create_trip(user_id, request.name, request.category, request.start_date, request.end_date)
    if not trip_id:
        raise HTTPException(status_code=500, detail="여행을 만들지 못했어요.")
    return TripSummary(
        trip_id=trip_id,
        name=request.name,
        category=request.category,
        course_count=0,
        start_date=request.start_date,
        end_date=request.end_date,
    )


@trips_router.get("", response_model=list[TripSummary])
async def list_trips_endpoint(user_id: Optional[str] = Depends(get_optional_user_id)):
    """마이페이지에 표시할 내 여행 목록 (여행별 저장된 코스 개수 포함)."""
    if not user_id:
        return []
    rows = await list_trips(user_id)
    return [
        TripSummary(
            trip_id=row["id"],
            name=row["name"],
            category=row.get("category") or "기타",
            course_count=row.get("course_count", 0),
            start_date=row.get("start_date"),
            end_date=row.get("end_date"),
            created_at=row.get("created_at"),
            visited=row.get("visited", False),
        )
        for row in rows
    ]


@trips_router.patch("/{trip_id}", response_model=TripSummary)
async def update_trip_endpoint(
    trip_id: str,
    request: TripUpdateRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """마이페이지에서 여행 이름/분류/날짜를 수정합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")

    ok, message = await update_trip(
        trip_id, user_id, request.name, request.category, request.start_date, request.end_date
    )
    if not ok:
        raise HTTPException(status_code=404, detail=message)

    # 수정된 최신 상태를 다시 조회해서 반환
    rows = await list_trips(user_id)
    updated = next((r for r in rows if r["id"] == trip_id), None)
    if not updated:
        raise HTTPException(status_code=404, detail="수정 후 여행 정보를 다시 불러오지 못했어요.")
    return TripSummary(
        trip_id=updated["id"],
        name=updated["name"],
        category=updated.get("category") or "기타",
        course_count=updated.get("course_count", 0),
        start_date=updated.get("start_date"),
        end_date=updated.get("end_date"),
        created_at=updated.get("created_at"),
    )


@trips_router.delete("/{trip_id}")
async def delete_trip_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """여행과 그 안에 저장된 코스들을 함께 삭제합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")

    ok, message = await delete_trip(trip_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return {"ok": True}


@trips_router.post("/{trip_id}/visit")
async def mark_trip_visited_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """'방문 완료' 버튼 — 이 여행 안의 모든 코스에 담긴 관광지들을 방문한 여행지로 표시합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="방문 완료로 표시하려면 로그인이 필요해요.")

    count = await mark_trip_as_visited(trip_id, user_id)
    if count == 0:
        raise HTTPException(status_code=404, detail="이 여행에 담긴 관광지를 찾지 못했어요.")
    return {"visited_count": count}


@trips_router.delete("/{trip_id}/visit")
async def unmark_trip_visited_endpoint(trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    """'방문 완료' 버튼을 다시 누르면(취소) — 이 여행 기준으로 방문 처리됐던 기록을 지웁니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="방문 완료를 취소하려면 로그인이 필요해요.")

    count = await unmark_trip_as_visited(trip_id, user_id)
    return {"unvisited_count": count}


@trips_router.get("/{trip_id}/courses", response_model=list[SavedCourseSummary])
async def list_trip_courses_endpoint(
    trip_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """특정 여행에 저장된 코스 목록."""
    if not user_id:
        return []
    rows = await list_trip_courses(trip_id, user_id)
    return [
        SavedCourseSummary(
            course_id=row["id"],
            title=row["title"],
            summary=row["summary"],
            region=row.get("region") or "",
            stop_count=len(row.get("stops") or []),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@trips_router.get("/visited/me/count")
async def my_visited_count(user_id: Optional[str] = Depends(get_optional_user_id)):
    """로그인한 사용자가 방문 완료로 표시한 여행지 개수. 비로그인이면 0."""
    if not user_id:
        return {"count": 0}
    return {"count": await count_visited_places(user_id)}


@trips_router.get("/visited/me/list", response_model=list[VisitedPlace])
async def my_visited_list(user_id: Optional[str] = Depends(get_optional_user_id)):
    """내가 방문 완료로 표시한 여행지 전체. '내 여행' 탭의 '방문한 여행지' 목록과
    게시물 작성 화면의 여행지 선택 목록이 함께 씁니다."""
    if not user_id:
        return []
    return await list_visited_places(user_id)


@trips_router.delete("/visited/{visited_id}")
async def delete_visited_place_endpoint(
    visited_id: str, user_id: Optional[str] = Depends(get_optional_user_id)
):
    """'방문한 여행지' 목록에서 하나를 삭제합니다(방문 취소)."""
    if not user_id:
        raise HTTPException(status_code=401, detail="삭제하려면 로그인이 필요해요.")
    ok = await delete_visited_place(visited_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="삭제할 방문 기록을 찾지 못했어요.")
    return {"ok": True}


@trips_router.patch("/visited/{visited_id}", response_model=VisitedPlace)
async def update_visited_date_endpoint(
    visited_id: str,
    request: UpdateVisitedDateRequest,
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """'방문한 여행지' 목록에서 방문 날짜를 수정합니다."""
    if not user_id:
        raise HTTPException(status_code=401, detail="수정하려면 로그인이 필요해요.")
    updated = await update_visited_place_date(visited_id, user_id, request.visited_at)
    if not updated:
        raise HTTPException(status_code=404, detail="수정할 방문 기록을 찾지 못했어요.")
    return VisitedPlace(**updated)


router.include_router(courses_router)
router.include_router(trips_router)
