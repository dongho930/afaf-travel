export type UserType = "wheelchair" | "stroller" | "senior" | "pregnant" | "general";

export interface AccessibilityFeatures {
  has_ramp: boolean;
  has_elevator: boolean;
  has_accessible_restroom: boolean;
  has_wheelchair_rental: boolean;
  has_stroller_accessible_path: boolean;
  has_rest_area: boolean;
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
