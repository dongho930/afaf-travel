from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class UserType(str, Enum):
    WHEELCHAIR = "wheelchair"          # 휠체어 이용자
    STROLLER = "stroller"              # 유모차 동반 가족
    SENIOR = "senior"                  # 고령자
    PREGNANT = "pregnant"              # 임산부
    GENERAL = "general"                # 일반 (참고용 기본값)


class AccessibilityFeatures(BaseModel):
    """무장애 여행 정보 API 응답을 매핑한 편의시설 정보"""
    has_ramp: bool = False                  # 경사로
    has_elevator: bool = False              # 엘리베이터
    has_accessible_restroom: bool = False   # 장애인 화장실
    has_wheelchair_rental: bool = False     # 휠체어 대여
    has_stroller_accessible_path: bool = False  # 유모차 이동 가능 동선
    has_rest_area: bool = False             # 임산부/고령자용 휴게 공간
    # 활용매뉴얼(v4.3) 기준 실제 응답 필드로 계산 — 더 이상 목업이 아닙니다.
    # 시각장애: braileblock(점자블록)/helpdog(보조견동반)/guidehuman(안내요원)/
    #   audioguide(오디오가이드)/bigprint(큰활자홍보물)/brailepromotion(점자홍보물)/
    #   guidesystem(유도안내설비) 중 하나라도 있으면 True (기타상세 제외)
    has_visual_accessibility: bool = False
    # 청각장애: signguide(수화안내)/videoguide(자막비디오가이드)/hearingroom(객실)
    #   중 하나라도 있으면 True (기타상세 제외)
    has_hearing_accessibility: bool = False
    # 지체장애/시각장애/청각장애 세부 편의시설이 몇 개나 있는지(개수).
    # 지체장애는 주차/접근로/휠체어대여/출입통로/엘리베이터/화장실 중 몇 개
    # (0~6), 시각장애는 점자블록/보조견동반/안내요원/오디오가이드/큰활자홍보물/
    # 점자홍보물/유도안내설비 중 몇 개(0~7), 청각장애는 수화안내/자막비디오가이드/
    # 객실 중 몇 개(0~3)인지를 세서, 단순 있음/없음보다 세분화된 점수를 매길 때
    # 씁니다. '기타상세'(자유서술 텍스트)는 정형화된 유무 정보가 아니라서 제외합니다.
    wheelchair_accessibility_count: int = 0
    visual_accessibility_count: int = 0
    hearing_accessibility_count: int = 0


class CongestionForecast(BaseModel):
    """관광지 집중률 방문자 추이 예측 정보"""
    date: str
    hour: int
    congestion_level: str  # low / medium / high


class Attraction(BaseModel):
    content_id: str
    name: str
    address: str
    latitude: float
    longitude: float
    category: str
    image_url: Optional[str] = None
    accessibility: AccessibilityFeatures = AccessibilityFeatures()
    congestion_forecast: list[CongestionForecast] = Field(default_factory=list)
    related_attraction_ids: list[str] = Field(default_factory=list)
    nearby_medical_info: Optional[str] = None
    # 캐시된 관광지 집중률(congestion_cache, 0~100%). 캐시에 없으면 None —
    # "데이터 없음"과 "0%"를 구분하기 위해 0이 아니라 None을 씁니다.
    congestion_rate: Optional[float] = None
    # 짧은 소개문 (detailCommon2의 overview를 간략화, attraction_overview_cache 경유)
    overview: Optional[str] = None
    # AccessibilityFeatures를 사람이 읽는 한글 라벨로 풀어낸 목록 (예: ["경사로", "휠체어 대여"])
    accessibility_benefits: list[str] = Field(default_factory=list)
    # 방문자 리뷰 평균 별점(1~5)과 리뷰 수. 리뷰가 없으면 avg_rating은 None.
    avg_rating: Optional[float] = None
    review_count: int = 0


class RegionOption(BaseModel):
    """지역 선택 UI용 시/군/구 옵션"""
    code: int   # 법정동 시군구코드 (예: 41115 = 수원시 팔달구)
    name: str   # 예: "수원시 팔달구"


class CourseRequest(BaseModel):
    query_text: str = Field(..., description="사용자의 자연어 질의 (STT 변환 결과 또는 직접 입력)")
    user_type: UserType = UserType.GENERAL
    region: str = "경기도"
    preferred_date: Optional[str] = None
    max_stops: int = Field(default=5, ge=1, le=10)


class PlaceRecommendationRequest(BaseModel):
    """1단계: 질의에 맞는 장소 후보를 추천받기 위한 요청 (아직 코스를 확정 짓지 않음)"""
    query_text: str = Field(..., description="사용자의 자연어 질의 (STT 변환 결과 또는 직접 입력)")
    user_type: UserType = UserType.GENERAL
    region: str = "경기도"
    sigungu_cd: Optional[int] = Field(default=None, description="특정 시/군/구로 좁혀서 추천 (선택, /api/tourism/regions 참고)")


class PlaceCandidate(BaseModel):
    """추천 후보 장소 1건 + 왜 이 질의에 맞는지에 대한 짧은 이유"""
    attraction: Attraction
    reason: str


class PlaceRecommendationResponse(BaseModel):
    query_text: str
    candidates: list[PlaceCandidate]


class GenerateFromSelectionRequest(BaseModel):
    """2단계: 사용자가 후보 중에서 직접 고른 장소들로 최종 코스(순서/시간대) 생성"""
    query_text: str = Field(..., description="1단계에서 사용한 원래 질의 (맥락 유지용)")
    user_type: UserType = UserType.GENERAL
    region: str = "경기도"
    sigungu_cd: Optional[int] = Field(default=None, description="1단계에서 사용한 시/군/구와 동일하게 넘겨주세요")
    selected_content_ids: list[str] = Field(..., min_length=1, description="사용자가 선택한 관광지 content_id 목록")


class CourseStop(BaseModel):
    order: int
    attraction: Attraction
    recommended_arrival_time: str
    reason: str  # AI가 이 장소/시간을 추천한 이유 (혼잡도 회피, 접근성 등)


class CourseResponse(BaseModel):
    course_id: str
    title: str
    summary: str
    stops: list[CourseStop]
    generated_for: UserType


# 사용자가 여행을 만들 때 고를 수 있는 분류
CourseCategory = Literal["가족", "커플", "친구", "혼자", "기타"]


class TripCreateRequest(BaseModel):
    """새 여행(그룹) 만들기 — 이름/분류/날짜를 한 번 지정하면, 그 아래에 코스를 여러 개 저장할 수 있음"""
    name: str = Field(..., min_length=1, max_length=50, description="여행 이름 (예: '제주도 가족여행')")
    category: CourseCategory = "기타"
    start_date: Optional[str] = Field(default=None, description="여행 시작일 (YYYY-MM-DD)")
    end_date: Optional[str] = Field(default=None, description="여행 종료일 (YYYY-MM-DD)")


class TripUpdateRequest(BaseModel):
    """마이페이지에서 여행 이름/분류/날짜를 수정할 때. 보낸 필드만 반영됩니다."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    category: Optional[CourseCategory] = None
    start_date: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    end_date: Optional[str] = Field(default=None, description="YYYY-MM-DD")


class TripSummary(BaseModel):
    """마이페이지 목록에 표시할 여행 요약 정보"""
    trip_id: str
    name: str
    category: CourseCategory
    course_count: int
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    created_at: Optional[str] = None


class SaveCourseRequest(BaseModel):
    """
    생성된 코스를 저장할 때, 기존 여행에 추가하거나(trip_id) 새 여행을 만들면서
    (new_trip_name + category + 날짜) 저장할 수 있습니다. 둘 중 하나만 채워주세요.
    """
    trip_id: Optional[str] = Field(default=None, description="기존 여행에 추가하려면 그 여행의 id")
    new_trip_name: Optional[str] = Field(default=None, min_length=1, max_length=50, description="새 여행을 만들며 저장하려면 이름")
    category: Optional[CourseCategory] = Field(default=None, description="새 여행을 만들 때의 분류")
    start_date: Optional[str] = Field(default=None, description="새 여행을 만들 때의 시작일 (YYYY-MM-DD)")
    end_date: Optional[str] = Field(default=None, description="새 여행을 만들 때의 종료일 (YYYY-MM-DD)")


class SavedCourseSummary(BaseModel):
    """여행 상세 화면 목록에 표시할 저장된 코스 요약 정보"""
    course_id: str
    title: str
    summary: str
    region: str
    stop_count: int
    created_at: Optional[str] = None


class SavedCourseDetail(BaseModel):
    """저장된 코스 하나를 다시 불러올 때(지도/결과 화면 재진입용) 반환하는 전체 정보"""
    course: CourseResponse
    trip_id: str
    trip_name: str
    category: CourseCategory
    region: str
    created_at: Optional[str] = None


class AccessibilityPlaceScore(BaseModel):
    """'접근성' 탭의 '휠체어 주요 여행지' 목록 항목"""
    name: str
    score: int
    address: str


class AccessibilitySummary(BaseModel):
    """'접근성' 탭 요약 정보"""
    wheelchair_count: int
    senior_count: int
    total_accessible_count: int  # 휠체어/유모차/고령자·임산부 중 하나라도 해당하는 장소를 합친(중복 제거) 개수
    visual_count: int   # 시각장애 편의시설(점자블록/오디오가이드 등) 보유 장소 수 — 실제 데이터
    hearing_count: int  # 청각장애 편의시설(수화안내/자막비디오가이드 등) 보유 장소 수 — 실제 데이터
    top_wheelchair_places: list[AccessibilityPlaceScore]
    top_senior_places: list[AccessibilityPlaceScore] = Field(default_factory=list)
    top_visual_places: list[AccessibilityPlaceScore] = Field(default_factory=list)
    top_hearing_places: list[AccessibilityPlaceScore] = Field(default_factory=list)
    # 진단용(선택): wheelchair_count 등이 왜 그렇게 나왔는지 원인 확인용 정보.
    # 카테고리별 후보 수, 무장애 정보 등록 여부(no_record/has_record), API 실패 건수 등.
    # 화면에는 표시하지 않아도 되고, 디버깅 때 응답 JSON에서 바로 확인하기 위한 용도입니다.
    debug: dict | None = None
