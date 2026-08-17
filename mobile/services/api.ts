import Constants from "expo-constants";
import { Attraction, CourseResponse, UserType } from "../types";

const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API 요청 실패 (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAttractions: (region: string, userType: UserType) =>
    request<Attraction[]>(
      `/api/tourism/attractions?region=${encodeURIComponent(region)}&user_type=${userType}`
    ),

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
};
