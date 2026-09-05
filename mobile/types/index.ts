export type UserType = "wheelchair" | "stroller" | "senior" | "pregnant" | "visual" | "hearing" | "general";

export interface AccessibilityFeatures {
  has_ramp: boolean;
  has_elevator: boolean;
  has_accessible_restroom: boolean;
  has_wheelchair_rental: boolean;
  has_stroller_accessible_path: boolean;
  has_rest_area: boolean;
  has_parking: boolean;
  has_exit: boolean;
  has_visual_accessibility: boolean;
  has_hearing_accessibility: boolean;
  // 시각장애 세부 항목(has_visual_accessibility를 구성하는 7개 항목 각각)
  has_braille_block: boolean;
  has_help_dog: boolean;
  has_guide_human: boolean;
  has_audio_guide: boolean;
  has_big_print: boolean;
  has_braille_promotion: boolean;
  has_guide_system: boolean;
  // 청각장애 세부 항목(has_hearing_accessibility를 구성하는 3개 항목 각각)
  has_sign_guide: boolean;
  has_video_guide: boolean;
  has_hearing_room: boolean;
  // 영유아가족/임산부 세부 항목
  has_lactation_room: boolean;
  has_baby_spare_chair: boolean;
  // 접근성 탭 점수 계산과 동일한 개수 필드
  wheelchair_accessibility_count: number;
  visual_accessibility_count: number;
  hearing_accessibility_count: number;
  family_accessibility_count: number;
  pregnant_accessibility_count: number;
}

export interface CongestionForecast {
  date: string;
  hour: number;
  congestion_level: "low" | "medium" | "high";
}

export interface Attraction {
  content_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  image_url?: string | null;
  accessibility: AccessibilityFeatures;
  congestion_forecast: CongestionForecast[];
  related_attraction_ids: string[];
  nearby_medical_info?: string | null;
  congestion_rate?: number | null;
  overview?: string | null;
  accessibility_benefits: string[];
  avg_rating?: number | null;
  review_count: number;
  extra_info?: { label: string; value: string }[];
}

export interface Review {
  id: string;
  content_id: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  rating: number;
  body: string;
  photo_urls: string[];
  created_at: string;
}

export interface CourseStop {
  order: number;
  attraction: Attraction;
  recommended_arrival_time: string;
  reason: string;
}

export interface PlaceCandidate {
  attraction: Attraction;
  reason: string;
}

export interface RegionOption {
  code: number;
  name: string;
}

// 홈 화면 '인기 여행지' 지역 칩 — 매일 다시 계산되는 인기도 순위 한 줄.
export interface RegionPopularityItem {
  city_name: string;
  rank: number;
  score: number;
  review_count: number;
  post_count: number;
  save_count: number;
  avg_rating: number | null;
}

export interface CourseResponse {
  course_id: string;
  title: string;
  summary: string;
  stops: CourseStop[];
  generated_for: UserType;
}

export const USER_TYPE_LABELS: Record<UserType, string> = {
  wheelchair: "지체 장애인",
  stroller: "유모차 동반 가족",
  senior: "고령자",
  pregnant: "임산부",
  visual: "시각 장애인",
  hearing: "청각 장애인",
  general: "일반",
};

export type CourseCategory = string;

export const COURSE_CATEGORIES: string[] = ["가족", "커플", "친구", "혼자", "기타"];

export interface TripSummary {
  trip_id: string;
  name: string;
  category: CourseCategory;
  course_count: number;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  visited: boolean;
}

export interface SavedCourseSummary {
  course_id: string;
  title: string;
  summary: string;
  region: string;
  stop_count: number;
  created_at?: string | null;
}

export interface SavedCourseDetail {
  course: CourseResponse;
  trip_id: string;
  trip_name: string;
  category: CourseCategory;
  region: string;
  created_at?: string | null;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  avatar_url?: string | null;
}

export interface AccessibilityPlaceScore {
  content_id: string;
  name: string;
  score: number;
  address: string;
}

export interface AccessibilitySummary {
  wheelchair_count: number;
  senior_count: number;
  total_accessible_count: number;
  visual_count: number;
  hearing_count: number;
  family_count: number;
  pregnant_count: number;
  top_wheelchair_places: AccessibilityPlaceScore[];
  top_senior_places: AccessibilityPlaceScore[];
  top_visual_places: AccessibilityPlaceScore[];
  top_hearing_places: AccessibilityPlaceScore[];
  top_family_places: AccessibilityPlaceScore[];
  top_pregnant_places: AccessibilityPlaceScore[];
}

export type ReportCategory = "wheelchair" | "visual" | "hearing" | "senior" | "family" | "pregnant";

export interface AccessibilityReport {
  id: string;
  content_id: string;
  place_name: string;
  category: ReportCategory;
  body: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  created_at: string;
}

export interface AttractionSearchResult {
  content_id: string;
  name: string;
  address: string;
  category: string;
}

export interface MyReviewItem {
  id: string;
  content_id: string;
  place_name: string;
  rating: number;
  body: string;
  photo_urls: string[];
  created_at: string;
}

export interface MyReportItem {
  id: string;
  content_id: string;
  place_name: string;
  category: ReportCategory;
  body: string;
  created_at: string;
}

export interface NearbyAttraction {
  content_id: string;
  name: string;
  image_url?: string | null;
  category: string;
  distance_km: number;
}

export interface VisitedPlace {
  id: string;
  content_id: string;
  place_name: string;
  visited_at: string;
}

export interface PostItem {
  id: string;
  content_id: string;
  place_name: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  body: string;
  photo_urls: string[];
  comment_count: number;
  is_mine: boolean;
  created_at: string;
}

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  parent_comment_id?: string | null;
  body: string;
  is_mine: boolean;
  created_at: string;
}
