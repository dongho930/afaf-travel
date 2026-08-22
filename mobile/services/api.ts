import Constants from "expo-constants";
import { supabase } from "./supabaseClient";
import {
  AccessibilitySummary,
  Attraction,
  CourseCategory,
  CourseResponse,
  PlaceCandidate,
  RegionOption,
  Review,
  SavedCourseDetail,
  SavedCourseSummary,
  TripSummary,
  UserProfile,
  UserType,
} from "../types";

const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // 로그인 상태면 토큰을 실어 보내서, 백엔드가 "누가 만든 코스인지" 알 수 있게 합니다.
  // 로그인 안 했으면 그냥 토큰 없이 보내고(기존과 동일하게 동작), 백엔드도 이를 허용합니다.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API 요청 실패 (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAttractions: (region: string, userType: UserType, sigunguCd?: number | null, limit: number = 20) =>
    request<Attraction[]>(
      `/api/tourism/attractions?region=${encodeURIComponent(region)}&user_type=${userType}&limit=${limit}` +
        (sigunguCd ? `&sigungu_cd=${sigunguCd}` : "")
    ),

  // 지역 선택 UI용: 시/도 안의 시/군/구 목록 (예: 경기도 → 수원시 팔달구, ...)
  listRegions: (province: string = "경기도") =>
    request<RegionOption[]>(`/api/tourism/regions?province=${encodeURIComponent(province)}`),

  // 1단계: 질의에 맞는 장소 후보 추천 (아직 코스 순서/시간은 정하지 않음)
  recommendPlaces: (params: {
    queryText: string;
    userType: UserType;
    region?: string;
    sigunguCd?: number | null;
  }) =>
    request<{ query_text: string; candidates: PlaceCandidate[] }>("/api/courses/recommend", {
      method: "POST",
      body: JSON.stringify({
        query_text: params.queryText,
        user_type: params.userType,
        region: params.region ?? "경기도",
        sigungu_cd: params.sigunguCd ?? null,
      }),
    }),

  // 2단계: 사용자가 고른 장소들로 최종 코스(순서/시간대) 생성
  generateCourseFromSelection: (params: {
    queryText: string;
    userType: UserType;
    region?: string;
    sigunguCd?: number | null;
    selectedContentIds: string[];
  }) =>
    request<CourseResponse>("/api/courses/generate-from-selection", {
      method: "POST",
      body: JSON.stringify({
        query_text: params.queryText,
        user_type: params.userType,
        region: params.region ?? "경기도",
        sigungu_cd: params.sigunguCd ?? null,
        selected_content_ids: params.selectedContentIds,
      }),
    }),

  generateCourse: (params: {
    queryText: string;
    userType: UserType;
    region?: string;
    maxStops?: number;
  }) =>
    request<CourseResponse>("/api/courses/generate", {
      method: "POST",
      body: JSON.stringify({
        query_text: params.queryText,
        user_type: params.userType,
        region: params.region ?? "경기도",
        max_stops: params.maxStops ?? 5,
      }),
    }),

  // 로그인 화면에서 입력한 값(이메일 또는 아이디)을 실제 이메일로 변환
  resolveLoginEmail: (identifier: string) =>
    request<{ email: string }>("/api/account/resolve-login-email", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    }),

  // 회원가입(Supabase Auth 계정 생성) 직후 아이디(username)를 등록
  createProfile: (params: { userId: string; username: string; email: string }) =>
    request<{ ok: boolean }>("/api/account/profile", {
      method: "POST",
      body: JSON.stringify({ user_id: params.userId, username: params.username, email: params.email }),
    }),

  // 로그인한 사용자의 프로필(아이디 등) 조회. 비로그인이면 null.
  getMyProfile: () => request<UserProfile | null>("/api/account/profile/me"),

  // 프로필 화면에서 아이디 수정 (프로필 사진은 uploadAvatar 사용)
  updateProfile: (params: { username?: string }) =>
    request<{ ok: boolean }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ username: params.username }),
    }),

  // 프로필 사진 업로드 (base64로 인코딩해서 보내면 백엔드가 대신 업로드)
  uploadAvatar: (imageBase64: string, fileExt: string) =>
    request<{ avatar_url: string }>("/api/account/avatar", {
      method: "POST",
      body: JSON.stringify({ image_base64: imageBase64, file_ext: fileExt }),
    }),

  // 결과 화면에서 '저장하기' — 기존 여행에 추가(tripId) 또는 새 여행 만들며 저장(newTripName+category+날짜)
  saveCourse: (
    courseId: string,
    params:
      | { tripId: string; newTripName?: never }
      | {
          tripId?: never;
          newTripName: string;
          category: CourseCategory;
          startDate?: string | null;
          endDate?: string | null;
        }
  ) =>
    request<{ ok: boolean; trip_id: string }>(`/api/courses/${courseId}/save`, {
      method: "POST",
      body: JSON.stringify(
        "tripId" in params && params.tripId
          ? { trip_id: params.tripId }
          : {
              new_trip_name: params.newTripName,
              category: params.category,
              start_date: params.startDate ?? null,
              end_date: params.endDate ?? null,
            }
      ),
    }),

  // 저장된 코스 하나를 여행에서 삭제 (여행 자체는 유지, 로그인 필요)
  deleteCourse: (courseId: string) =>
    request<{ ok: boolean }>(`/api/courses/${courseId}`, { method: "DELETE" }),

  // 저장된 코스 하나를 다시 불러오기 (지도/결과 화면 재진입용)
  getSavedCourse: (courseId: string) => request<SavedCourseDetail>(`/api/courses/saved/${courseId}`),

  // 내 여행 목록 (마이페이지)
  listTrips: () => request<TripSummary[]>("/api/trips"),

  // 새 여행을 미리 만들어두기 (보통은 저장 시 한 번에 만들지만 필요하면 따로도 가능)
  createTrip: (name: string, category: CourseCategory, startDate?: string | null, endDate?: string | null) =>
    request<TripSummary>("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name, category, start_date: startDate ?? null, end_date: endDate ?? null }),
    }),

  // 여행 이름/분류/날짜 수정
  updateTrip: (
    tripId: string,
    params: { name?: string; category?: CourseCategory; startDate?: string | null; endDate?: string | null }
  ) =>
    request<TripSummary>(`/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: params.name,
        category: params.category,
        start_date: params.startDate,
        end_date: params.endDate,
      }),
    }),

  // 여행 삭제 (그 안의 저장된 코스도 함께 삭제됨)
  deleteTrip: (tripId: string) => request<{ ok: boolean }>(`/api/trips/${tripId}`, { method: "DELETE" }),

  // 특정 여행에 저장된 코스 목록
  listTripCourses: (tripId: string) => request<SavedCourseSummary[]>(`/api/trips/${tripId}/courses`),

  // '접근성' 탭용 요약 정보
  getAccessibilitySummary: (region: string = "경기도") =>
    request<AccessibilitySummary>(`/api/tourism/accessibility-summary?region=${encodeURIComponent(region)}`),

  // 관광지 상세 (주소/혼잡도/이점 태그/소개문 포함)
  getAttractionDetail: (contentId: string) =>
    request<Attraction>(`/api/tourism/attractions/${encodeURIComponent(contentId)}`),

  // 특정 관광지의 방문자 리뷰 목록 (최신순, 로그인 불필요)
  getReviews: (contentId: string) =>
    request<Review[]>(`/api/reviews/${encodeURIComponent(contentId)}`),

  // 리뷰 작성 (로그인 필요, 이미 쓴 적 있으면 수정됨)
  submitReview: (contentId: string, rating: number, body: string) =>
    request<Review>(`/api/reviews/${encodeURIComponent(contentId)}`, {
      method: "POST",
      body: JSON.stringify({ rating, body }),
    }),

  // 내가 지금까지 작성한 리뷰 개수 (내 여행 탭 표시용, 비로그인이면 0)
  getMyReviewCount: () => request<{ count: number }>("/api/reviews/me/count"),
};
