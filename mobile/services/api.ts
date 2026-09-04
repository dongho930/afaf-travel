import Constants from "expo-constants";
import { supabase } from "./supabaseClient";
import {
  AccessibilityReport,
  AccessibilitySummary,
  Attraction,
  AttractionSearchResult,
  CourseCategory,
  CourseResponse,
  MyReportItem,
  MyReviewItem,
  NearbyAttraction,
  PlaceCandidate,
  PostComment,
  PostItem,
  RegionOption,
  ReportCategory,
  Review,
  SavedCourseDetail,
  SavedCourseSummary,
  TripSummary,
  UserProfile,
  UserType,
  VisitedPlace,
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
  listAttractions: (
    region: string,
    userType: UserType,
    sigunguCd?: number | null,
    limit: number = 20,
    includeOverview: boolean = true
  ) =>
    request<Attraction[]>(
      `/api/tourism/attractions?region=${encodeURIComponent(region)}&user_type=${userType}&limit=${limit}&include_overview=${includeOverview}` +
        (sigunguCd ? `&sigungu_cd=${sigunguCd}` : "")
    ),

  // 특정 관광지들의 소개문만 따로 조회 (홈 화면 '더보기'로 새로 보이는 만큼만 채울 때 사용)
  getOverviews: (contentIds: string[]) =>
    request<Record<string, string | null>>(
      `/api/tourism/attractions/overviews?content_ids=${contentIds.map(encodeURIComponent).join(",")}`
    ),

  // 특정 관광지들의 카테고리별 부가 정보(이용시간/요금 등)만 따로 조회
  // (홈 화면 카드의 소개문 아래 표시용, '더보기'로 새로 보이는 만큼만 채울 때 사용)
  getExtraInfo: (items: { contentId: string; category: string }[]) =>
    request<Record<string, { label: string; value: string }[]>>(
      `/api/tourism/attractions/extra-info?content_ids=${items
        .map((i) => encodeURIComponent(i.contentId))
        .join(",")}&categories=${items.map((i) => encodeURIComponent(i.category)).join(",")}`
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

  // 코스 제목 수정 및/또는 관광지 순서 변경 (stopOrder: 새 순서대로 나열한 content_id 목록)
  updateCourse: (courseId: string, params: { title?: string; stopOrder?: string[] }) =>
    request<CourseResponse>(`/api/courses/${courseId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: params.title, stop_order: params.stopOrder }),
    }),

  // 저장된 코스 하나를 다시 불러오기 (지도/결과 화면 재진입용)
  getSavedCourse: (courseId: string) => request<SavedCourseDetail>(`/api/courses/saved/${courseId}`),

  // 내 여행 목록 (마이페이지)
  listTrips: () => request<TripSummary[]>("/api/trips"),

  // 저장된 코스 전체 (여행 구분 없이, 내 여행 탭 '저장한 경로' 카드용)
  getSavedCourses: () => request<SavedCourseSummary[]>("/api/courses/saved"),

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

  // '방문 완료' — 그 여행 안의 모든 관광지를 방문한 여행지로 표시
  markTripVisited: (tripId: string) =>
    request<{ visited_count: number }>(`/api/trips/${tripId}/visit`, { method: "POST" }),

  // '방문 완료' 취소 — 그 여행 기준으로 방문 처리됐던 기록을 지움
  unmarkTripVisited: (tripId: string) =>
    request<{ unvisited_count: number }>(`/api/trips/${tripId}/visit`, { method: "DELETE" }),

  // 내가 방문 완료로 표시한 여행지 총 개수
  getMyVisitedCount: () => request<{ count: number }>("/api/trips/visited/me/count"),

  // 내가 방문 완료로 표시한 여행지 전체 목록
  getMyVisitedPlaces: () => request<VisitedPlace[]>("/api/trips/visited/me/list"),

  // 방문한 여행지 삭제(방문 취소)
  deleteVisitedPlace: (visitedId: string) =>
    request<{ ok: boolean }>(`/api/trips/visited/${visitedId}`, { method: "DELETE" }),

  // 방문한 여행지의 방문 날짜 수정 (YYYY-MM-DD)
  updateVisitedDate: (visitedId: string, visitedAt: string) =>
    request<VisitedPlace>(`/api/trips/visited/${visitedId}`, {
      method: "PATCH",
      body: JSON.stringify({ visited_at: visitedAt }),
    }),

  // 특정 여행에 저장된 코스 목록
  listTripCourses: (tripId: string) => request<SavedCourseSummary[]>(`/api/trips/${tripId}/courses`),

  // '접근성' 탭용 요약 정보
  getAccessibilitySummary: (region: string = "경기도") =>
    request<AccessibilitySummary>(`/api/tourism/accessibility-summary?region=${encodeURIComponent(region)}`),

  // 관광지 상세 (주소/혼잡도/이점 태그/소개문 포함)
  getAttractionDetail: (contentId: string) =>
    request<Attraction>(`/api/tourism/attractions/${encodeURIComponent(contentId)}`),

  // 관광지 상세 페이지의 '저장' 버튼 1단계 — 이 관광지 하나만 담은 코스를
  // 만들어 course_id를 발급받습니다. 그 다음 saveCourse()로 여행에 붙입니다.
  createCourseFromAttraction: (contentId: string) =>
    request<CourseResponse>(`/api/courses/from-attraction/${encodeURIComponent(contentId)}`, {
      method: "POST",
    }),

  // 근처(기본 반경 2km) 가볼 만한 곳 — 개수 제한 없이 거리순 전체
  getNearbyAttractions: (contentId: string, radiusKm: number = 2) =>
    request<NearbyAttraction[]>(
      `/api/tourism/attractions/${encodeURIComponent(contentId)}/nearby?radius_km=${radiusKm}`
    ),

  // 특정 관광지의 방문자 리뷰 목록 (최신순, 로그인 불필요)
  getReviews: (contentId: string) =>
    request<Review[]>(`/api/reviews/${encodeURIComponent(contentId)}`),

  // 리뷰 작성 (로그인 필요, 이미 쓴 적 있으면 수정됨). photos는 base64 인코딩된 이미지 배열(최대 5장)
  submitReview: (contentId: string, rating: number, body: string, photos: string[] = []) =>
    request<Review>(`/api/reviews/${encodeURIComponent(contentId)}`, {
      method: "POST",
      body: JSON.stringify({ rating, body, photos }),
    }),

  // 내가 지금까지 작성한 리뷰 개수 (내 여행 탭 표시용, 비로그인이면 0)
  getMyReviewCount: () => request<{ count: number }>("/api/reviews/me/count"),

  // 내가 작성한 리뷰 전체 (내 여행 탭 '리뷰 작성' 카드용)
  getMyReviews: () => request<MyReviewItem[]>("/api/reviews/me/list"),

  // 여행지 이름 검색(자동완성) — 접근성 제보 작성 시 사용
  searchAttractionsByName: (q: string) =>
    request<AttractionSearchResult[]>(`/api/reports/search?q=${encodeURIComponent(q)}`),

  // 특정 카테고리(휠체어/시각/청각/고령자/영유아가족/임산부)의 접근성 제보 목록
  getAccessibilityReports: (category: ReportCategory, limit: number = 20) =>
    request<AccessibilityReport[]>(`/api/reports/${category}?limit=${limit}`),

  // 접근성 제보 작성 (로그인 필요, 같은 장소에 여러 번 가능)
  submitAccessibilityReport: (params: {
    contentId: string;
    placeName: string;
    category: ReportCategory;
    body: string;
  }) =>
    request<AccessibilityReport>("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        content_id: params.contentId,
        place_name: params.placeName,
        category: params.category,
        body: params.body,
      }),
    }),

  // 내가 지금까지 작성한 접근성 제보 개수
  getMyReportCount: () => request<{ count: number }>("/api/reports/me/count"),

  // 내가 작성한 접근성 제보 전체 (내 여행 탭 '접근성 제보' 카드용)
  getMyReports: () => request<MyReportItem[]>("/api/reports/me/list"),

  // 여행기록 전체 공개 피드 (최신순, 로그인 불필요). before는 이전 페이지
  // 마지막 게시물의 created_at을 넣으면 그 이전 게시물을 이어서 받습니다.
  getPostFeed: (limit: number = 20, before?: string) =>
    request<PostItem[]>(
      `/api/posts?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`
    ),

  getPost: (postId: string) => request<PostItem>(`/api/posts/${encodeURIComponent(postId)}`),

  // 관광지 상세 화면 '게시물' 팝업용, 이 관광지(content_id)에 대한 게시물 전체 (최신순)
  getPostsByPlace: (contentId: string, limit: number = 50) =>
    request<PostItem[]>(
      `/api/posts?content_id=${encodeURIComponent(contentId)}&limit=${limit}`
    ),

  // '게시물 관리' 화면용, 내가 작성한 게시물 전체 (최신순, 로그인 필요)
  getMyPosts: () => request<PostItem[]>("/api/posts/me/list"),

  // 여행기록 게시물 작성 (로그인 필요). photos는 base64 인코딩된 이미지 배열(최대 5장)
  createPost: (contentId: string, placeName: string, body: string, photos: string[] = []) =>
    request<PostItem>("/api/posts", {
      method: "POST",
      body: JSON.stringify({ content_id: contentId, place_name: placeName, body, photos }),
    }),

  deletePost: (postId: string) =>
    request<{ ok: boolean }>(`/api/posts/${encodeURIComponent(postId)}`, { method: "DELETE" }),

  getPostComments: (postId: string) =>
    request<PostComment[]>(`/api/posts/${encodeURIComponent(postId)}/comments`),

  // 댓글 또는 답글 작성 (로그인 필요). parentCommentId를 넣으면 그 댓글에 대한 답글입니다.
  createPostComment: (postId: string, body: string, parentCommentId?: string) =>
    request<PostComment>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, parent_comment_id: parentCommentId ?? null }),
    }),

  deletePostComment: (commentId: string) =>
    request<{ ok: boolean }>(`/api/posts/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
    }),
};
