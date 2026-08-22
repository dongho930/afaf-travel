export type UserType = "wheelchair" | "stroller" | "senior" | "pregnant" | "general";

export interface AccessibilityFeatures {
  has_ramp: boolean;
  has_elevator: boolean;
  has_accessible_restroom: boolean;
  has_wheelchair_rental: boolean;
  has_stroller_accessible_path: boolean;
  has_rest_area: boolean;
  has_visual_accessibility: boolean;
  has_hearing_accessibility: boolean;
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

export interface CourseResponse {
  course_id: string;
  title: string;
  summary: string;
  stops: CourseStop[];
  generated_for: UserType;
}

export const USER_TYPE_LABELS: Record<UserType, string> = {
  wheelchair: "휠체어 이용자",
  stroller: "유모차 동반 가족",
  senior: "고령자",
  pregnant: "임산부",
  general: "일반",
};

export type CourseCategory = "가족" | "커플" | "친구" | "혼자" | "기타";

export const COURSE_CATEGORIES: CourseCategory[] = ["가족", "커플", "친구", "혼자", "기타"];

export interface TripSummary {
  trip_id: string;
  name: string;
  category: CourseCategory;
  course_count: number;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
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
  top_wheelchair_places: AccessibilityPlaceScore[];
}
