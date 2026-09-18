import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilitySummary, CourseResponse, UserType } from "../types";

const LAST_COURSE_KEY = "afaf:last_course";
const USER_TYPE_KEY = "afaf:user_type";
const ACCESSIBILITY_SUMMARY_KEY = "afaf:accessibility_summary";

export const storage = {
  async saveCourse(course: CourseResponse) {
    await AsyncStorage.setItem(LAST_COURSE_KEY, JSON.stringify(course));
  },
  async loadCourse(): Promise<CourseResponse | null> {
    const raw = await AsyncStorage.getItem(LAST_COURSE_KEY);
    return raw ? (JSON.parse(raw) as CourseResponse) : null;
  },
  async saveUserType(userType: UserType) {
    await AsyncStorage.setItem(USER_TYPE_KEY, userType);
  },
  async loadUserType(): Promise<UserType | null> {
    return (await AsyncStorage.getItem(USER_TYPE_KEY)) as UserType | null;
  },

  // 접근성 탭의 유형별 개수입니다. 서버가 잠깐 답하지 못할 때 모든 유형이
  // '-'로 비어 보이지 않도록, 마지막으로 받아온 값을 들고 있다가 먼저 보여줍니다
  // (홈 화면이 인기 여행지 목록에 쓰는 것과 같은 방식). 최신 값은 평소대로
  // 뒤에서 받아와 교체합니다.
  async saveAccessibilitySummary(summary: AccessibilitySummary) {
    await AsyncStorage.setItem(ACCESSIBILITY_SUMMARY_KEY, JSON.stringify(summary));
  },
  async loadAccessibilitySummary(): Promise<AccessibilitySummary | null> {
    const raw = await AsyncStorage.getItem(ACCESSIBILITY_SUMMARY_KEY);
    return raw ? (JSON.parse(raw) as AccessibilitySummary) : null;
  },
};
