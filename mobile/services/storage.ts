import AsyncStorage from "@react-native-async-storage/async-storage";
import { CourseResponse, UserType } from "../types";

const LAST_COURSE_KEY = "afaf:last_course";
const USER_TYPE_KEY = "afaf:user_type";

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
};
