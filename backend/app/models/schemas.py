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
    """새 여행(그룹) 만들기 — 이름과 분류를 한 번 지정하면, 그 아래에 코스를 여러 개 저장할 수 있음"""
    name: str = Field(..., min_length=1, max_length=50, description="여행 이름 (예: '제주도 가족여행')")
    category: CourseCategory = "기타"


class TripSummary(BaseModel):
    """마이페이지 목록에 표시할 여행 요약 정보"""
    trip_id: str
    name: str
    category: CourseCategory
    course_count: int
    created_at: Optional[str] = None


class SaveCourseRequest(BaseModel):
    """
    생성된 코스를 저장할 때, 기존 여행에 추가하거나(trip_id) 새 여행을 만들면서
    (new_trip_name + category) 저장할 수 있습니다. 둘 중 하나만 채워주세요.
    """
    trip_id: Optional[str] = Field(default=None, description="기존 여행에 추가하려면 그 여행의 id")
    new_trip_name: Optional[str] = Field(default=None, min_length=1, max_length=50, description="새 여행을 만들며 저장하려면 이름")
    category: Optional[CourseCategory] = Field(default=None, description="새 여행을 만들 때의 분류")


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
