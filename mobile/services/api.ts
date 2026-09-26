import Constants from "expo-constants";
import { getAccessToken, refreshAccessToken } from "./authToken";
import { bumpDataVersion } from "./dataVersion";
import {
  AccessibilityReport,
  AccessibilityPlacePage,
  AccessibilitySummary,
  Attraction,
  AttractionSearchResult,
  CourseCategory,
  CourseResponse,
  CourseSplitResult,
  CreatedPost,
  MyReportItem,
  MyReviewItem,
  NearbyAttraction,
  ParsedQuery,
  PlaceCandidate,
  PostComment,
  PostItem,
  RegionOption,
  RegionPopularityItem,
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

// 서버가 느리거나 네트워크가 끊겼을 때 화면이 영원히 로딩 상태로 남지 않도록
// 요청마다 상한을 둡니다. 백엔드가 오래 걸리는 조회를 25초에 504로 끊으므로,
// 그보다 조금 길게 잡아야 서버가 보내주는 안내 문구를 살릴 수 있습니다.
const REQUEST_TIMEOUT_MS = 30000;

/**
 * API 호출 실패. message는 그대로 사용자에게 보여줄 수 있는 한국어 문장입니다.
 *
 * 예전에는 `API 요청 실패 (503): {"detail":"..."}` 같은 문자열을 던졌고, 화면들이
 * 그걸 String(err)로 팝업에 그대로 붙였습니다. 사용자에게 상태코드와 JSON 원문이
 * 노출됐고, 정작 백엔드가 보내준 한국어 안내는 그 안에 묻혔습니다.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    // 서버가 보낸 원문(detail). 화면에 띄우지 말고 로그·디버깅용으로만 씁니다.
    readonly detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 다시 로그인해야 하는 상황인지 — 화면에서 로그인 유도에 씁니다. */
  get needsLogin(): boolean {
    return this.status === 401;
  }
}

function messageForStatus(status: number, detail?: string): string {
  if (status === 401) return "다시 로그인해주세요. 로그인이 풀렸어요.";

  // 서버 오류(5xx)의 detail은 사용자에게 보여주지 않습니다. 설정 문제나 외부
  // API 응답 원문이 섞여 있습니다("TMAP_APP_KEY가 설정되지 않았습니다",
  // "카카오모빌리티 API 오류: 429 {...}"). 원문은 ApiError.detail로 남겨 로그에서만 봅니다.
  if (status >= 500) {
    // 503만 예외입니다. 이 백엔드에서 503은 "지금은 안 되니 잠시 후에"를 사용자에게
    // 직접 말해주는 자리로만 쓰고(캐시를 못 읽음, AI가 응답하지 않음), detail에 이미
    // 사람이 읽을 한국어 문장이 들어 있습니다. 그걸 버리고 "서버가 잠시 바빠요"로
    // 뭉뚱그리면 왜 안 되는지, 다시 하면 되는지를 알 수 없었습니다.
    if (status === 503 && detail && detail.trim() && !detail.trim().startsWith("[")) return detail.trim();
    if (status === 502 || status === 503) return "서버가 잠시 바빠요. 잠시 후 다시 시도해주세요.";
    if (status === 504) return "불러오는 데 너무 오래 걸렸어요. 잠시 후 다시 시도해주세요.";
    return "서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.";
  }

  // 요청이 잘못됐다는 응답(4xx)은 백엔드가 사람이 읽을 문장으로 보냅니다
  // (예: "첫 장소부터는 나눌 수 없어요"). 그대로 쓰는 게 가장 정확합니다.
  if (detail && detail.trim() && !detail.trim().startsWith("[")) return detail.trim();
  if (status === 403) return "권한이 없어요.";
  if (status === 404) return "찾는 정보가 없어요.";
  if (status === 429) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";
}

/** 응답 본문에서 FastAPI가 보낸 detail을 꺼냅니다(JSON이 아니면 원문 그대로). */
async function readDetail(res: Response): Promise<string | undefined> {
  try {
    const body = await res.text();
    if (!body) return undefined;
    try {
      const parsed = JSON.parse(body);
      const detail = parsed?.detail;
      if (typeof detail === "string") return detail;
      // 유효성 검사 실패(422)는 detail이 배열로 옵니다 — 사용자에게 보여줄 문장이
      // 아니므로 로그용으로만 남깁니다.
      return detail ? JSON.stringify(detail) : body;
    } catch {
      return body;
    }
  } catch {
    return undefined;
  }
}

async function send(path: string, options: RequestInit | undefined, token?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // 로그인 상태면 토큰을 실어 보내서, 백엔드가 "누가 만든 코스인지" 알 수 있게 합니다.
  // 로그인 안 했으면 그냥 토큰 없이 보내고(기존과 동일하게 동작), 백엔드도 이를 허용합니다.
  // 토큰은 메모리에 들고 있다가 바로 씁니다(authToken.ts) — 예전처럼 호출할 때마다
  // 저장소에서 세션을 읽어오지 않습니다.
  const token = await getAccessToken();

  let res: Response;
  try {
    res = await send(path, options, token);
  } catch (err) {
    // 타임아웃(abort)과 네트워크 단절을 구분해서 안내합니다 — 사용자가 할 수 있는
    // 일이 다릅니다(기다렸다 재시도 / 연결 확인).
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ApiError(
      aborted
        ? "응답이 너무 늦어요. 잠시 후 다시 시도해주세요."
        : "네트워크에 연결할 수 없어요. 연결 상태를 확인해주세요.",
      null,
      errorMessage(err)
    );
  }

  // 토큰이 아직 안 만료됐다고 판단했는데 서버가 거부하는 경우(기기 시계 오차,
  // 다른 기기에서의 로그아웃 등)가 있어서, 한 번만 강제로 갱신해 다시 보냅니다.
  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      try {
        res = await send(path, options, fresh);
      } catch (err) {
        throw new ApiError("네트워크에 연결할 수 없어요. 연결 상태를 확인해주세요.", null, errorMessage(err));
      }
    }
  }

  if (!res.ok) {
    const detail = await readDetail(res);
    throw new ApiError(messageForStatus(res.status, detail), res.status, detail);
  }

  // 서버 상태를 바꾸는 요청이 성공했으면 표시를 남깁니다. 화면을 열 때마다
  // 다시 부를 필요는 없지만 이런 동작 뒤에는 갱신돼야 하는 값들(예: 내 여행
  // 탭의 리뷰/제보/방문 개수)이 이 표시를 보고 판단합니다.
  if ((options?.method ?? "GET") !== "GET") {
    bumpDataVersion();
  }

  return res.json() as Promise<T>;
}

/**
 * 오류를 사용자에게 보여줄 한 문장으로 바꿉니다.
 * 화면에서는 String(err) 대신 이걸 씁니다.
 *
 * API 오류가 아닌 것(사진 선택기, 위치 등 라이브러리 오류)은 영어 기술 문구가
 * 대부분이라 사용자에게 보여주지 않고 일반 안내로 바꿉니다. 원문은 개발자가 볼 수
 * 있게 콘솔에만 남깁니다.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.detail && err.detail !== err.message) {
      console.warn("[api]", err.status, err.detail);
    }
    return err.message;
  }
  console.warn("[error]", err);
  return "잠시 후 다시 시도해주세요.";
}

/** 코스를 어디에 저장할지 — 기존 여행에 담거나, 새 여행을 만들면서 담습니다. */
export type SaveCourseTarget =
  | { tripId: string; newTripName?: never }
  | {
      tripId?: never;
      newTripName: string;
      category: CourseCategory;
      startDate?: string | null;
      endDate?: string | null;
    };

// 두 갈래를 함수로 빼서 타입이 좁혀지게 합니다. 예전에는 삼항식 안에서
// "tripId" in params로 갈랐는데, 그 방식으로는 else 쪽이 좁혀지지 않아
// newTripName/category를 읽는 곳에서 타입 오류가 났습니다.
function saveCourseBody(params: SaveCourseTarget) {
  if ("newTripName" in params && params.newTripName) {
    return {
      new_trip_name: params.newTripName,
      category: params.category,
      start_date: params.startDate ?? null,
      end_date: params.endDate ?? null,
    };
  }
  return { trip_id: params.tripId };
}

export const api = {
  // detailFor: 앞의 N개는 소개문/부가정보까지 채워서 함께 받아옵니다. 목록을 받은 뒤
  // 화면에 보이는 만큼의 소개문을 다시 요청하던 왕복 한 번을 없애기 위한 것입니다.
  // sigunguCds: 시/군/구 코드 여러 개를 함께 넘길 수 있습니다 — 홈 화면 지역 칩은
  // '수원'처럼 도시 단위인데 실제 시/군/구는 구 단위라, 그 도시의 구를 전부 보냅니다.
  listAttractions: (
    region: string,
    userType: UserType,
    sigunguCds?: number[] | number | null,
    limit: number = 20,
    includeOverview: boolean = true,
    offset: number = 0,
    detailFor: number = 0
  ) => {
    const codes = sigunguCds == null ? [] : Array.isArray(sigunguCds) ? sigunguCds : [sigunguCds];
    return request<Attraction[]>(
      `/api/tourism/attractions?region=${encodeURIComponent(region)}&user_type=${userType}&limit=${limit}&include_overview=${includeOverview}&offset=${offset}&detail_for=${detailFor}` +
        (codes.length > 0 ? `&sigungu_cd=${codes.join(",")}` : "")
    );
  },

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

  // 홈 화면 지역 칩 — 최근 리뷰/게시물/저장된 코스 수 + 평점 기준으로 매일 다시
  // 계산해둔 캐시에서 상위 N개 도시만 가볍게 읽어옵니다(실시간 계산 아님).
  getRegionPopularity: (limit: number = 5) =>
    request<RegionPopularityItem[]>(`/api/tourism/region-popularity?limit=${limit}`),

  // 1단계: 질의에 맞는 장소 후보 추천 (아직 코스 순서/시간은 정하지 않음)
  recommendPlaces: (params: {
    queryText: string;
    userType: UserType;
    region?: string;
    sigunguCd?: number | null;
    visitDate?: string | null;
    excludeContentIds?: string[];
  }) =>
    request<{
      query_text: string;
      candidates: PlaceCandidate[];
      parsed: ParsedQuery | null;
      missing_categories: string[];
      recommendation_id?: string | null;
      notices?: string[];
    }>("/api/courses/recommend", {
      method: "POST",
      body: JSON.stringify({
        query_text: params.queryText,
        user_type: params.userType,
        region: params.region ?? "경기도",
        sigungu_cd: params.sigunguCd ?? null,
        visit_date: params.visitDate ?? null,
        exclude_content_ids: params.excludeContentIds ?? [],
      }),
    }),

  // 2단계: 사용자가 고른 장소들로 최종 코스(순서/시간대) 생성
  generateCourseFromSelection: (params: {
    queryText: string;
    userType: UserType;
    region?: string;
    sigunguCd?: number | null;
    visitDate?: string | null;
    selectedContentIds: string[];
    recommendationIds?: string[];
  }) =>
    request<CourseResponse>("/api/courses/generate-from-selection", {
      method: "POST",
      body: JSON.stringify({
        query_text: params.queryText,
        user_type: params.userType,
        region: params.region ?? "경기도",
        sigungu_cd: params.sigunguCd ?? null,
        visit_date: params.visitDate ?? null,
        selected_content_ids: params.selectedContentIds,
        recommendation_ids: params.recommendationIds ?? [],
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
  saveCourse: (courseId: string, params: SaveCourseTarget) =>
    request<{ ok: boolean; trip_id: string }>(`/api/courses/${courseId}/save`, {
      method: "POST",
      body: JSON.stringify(saveCourseBody(params)),
    }),

  // 저장된 코스 하나를 여행에서 삭제 (여행 자체는 유지, 로그인 필요)
  deleteCourse: (courseId: string) =>
    request<{ ok: boolean }>(`/api/courses/${courseId}`, { method: "DELETE" }),

  // 코스 제목 수정 및/또는 관광지 순서 변경 (stopOrder: 새 순서대로 나열한 content_id 목록)
  // 하루에 다 돌 수 없는 코스를 fromOrder부터 끝까지 다음 날 코스로 나눕니다.
  // 다음 날 코스는 하루 뒤 날짜로 시각·휴무일을 다시 계산해서 돌아옵니다.
  splitCourse: (courseId: string, params: { fromOrder: number; visitDate?: string | null }) =>
    request<CourseSplitResult>(`/api/courses/${courseId}/split`, {
      method: "POST",
      body: JSON.stringify({ from_order: params.fromOrder, visit_date: params.visitDate ?? null }),
    }),

  updateCourse: (courseId: string, params: { title?: string; stopOrder?: string[] }) =>
    request<CourseResponse>(`/api/courses/${courseId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: params.title, stop_order: params.stopOrder }),
    }),

  // 저장된 코스 하나를 다시 불러오기 (지도/결과 화면 재진입용)
  getSavedCourse: (courseId: string) => request<SavedCourseDetail>(`/api/courses/saved/${courseId}`),

  // 내 여행 목록 (마이페이지)
  listTrips: () => request<TripSummary[]>("/api/trips"),

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
  // includePlaces=false면 숫자만 받아옵니다(응답 약 240KB -> 0.3KB). 목록은
  // 화면에 실제로 보여줄 만큼만 getAccessibilityPlaces()로 따로 받습니다.
  // 기본값이 true인 것은 이 함수를 쓰는 다른 화면(홈 통계)이 아직 목록을
  // 기대할 수 있기 때문입니다.
  getAccessibilitySummary: (region: string = "경기도", includePlaces: boolean = true) =>
    request<AccessibilitySummary>(
      `/api/tourism/accessibility-summary?region=${encodeURIComponent(region)}` +
        (includePlaces ? "" : "&include_places=false")
    ),

  // 접근성 탭 '주요 여행지' — 카테고리 하나를 offset/limit으로 나눠서 받아옵니다
  // (홈 화면 '인기 여행지'의 서버 페이지네이션과 같은 방식).
  getAccessibilityPlaces: (
    category: ReportCategory,
    offset: number = 0,
    limit: number = 20,
    region: string = "경기도"
  ) =>
    request<AccessibilityPlacePage>(
      `/api/tourism/accessibility-places?region=${encodeURIComponent(region)}` +
        `&category=${encodeURIComponent(category)}&offset=${offset}&limit=${limit}`
    ),

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

  // 함께 가볼 만한 곳 — 한국관광공사 '관광지별 연관 관광지 정보'가 알려주는
  // 연계 관광지입니다. '근처'가 거리로만 고르는 것과 달리, 이건 테마·방문 패턴까지
  // 반영된 추천이라 거리가 멀어도 같이 묶이는 곳이 나옵니다.
  getRelatedAttractions: (contentId: string) =>
    request<Attraction[]>(`/api/tourism/attractions/${encodeURIComponent(contentId)}/related`),

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

  // 여행지 직접 검색 — 검색 화면에서 사용. 위 자동완성과 같은 자료를 쓰지만
  // 사진·평점까지 실린 Attraction을 그대로 받아 카드로 보여줍니다.
  searchAttractions: (q: string, category?: string | null, limit: number = 30) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (category) params.set("category", category);
    return request<Attraction[]>(`/api/tourism/attractions/search?${params.toString()}`);
  },

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

  // 관광지 상세 화면 '게시물' 팝업용, 이 관광지(content_id)에 대한 게시물 전체 (최신순)
  getPostsByPlace: (contentId: string, limit: number = 50) =>
    request<PostItem[]>(
      `/api/posts?content_id=${encodeURIComponent(contentId)}&limit=${limit}`
    ),

  // '게시물 관리' 화면용, 내가 작성한 게시물 전체 (최신순, 로그인 필요)
  getMyPosts: () => request<PostItem[]>("/api/posts/me/list"),

  // 여행기록 게시물 작성 (로그인 필요). photos는 base64 인코딩된 이미지 배열(최대 5장)
  createPost: (contentId: string, placeName: string, body: string, photos: string[] = []) =>
    request<CreatedPost>("/api/posts", {
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

};
