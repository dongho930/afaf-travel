import React, { createContext, useContext, useState } from "react";
import { CourseResponse, UserType } from "../types";

interface CourseContextValue {
  userType: UserType;
  setUserType: (t: UserType) => void;
  course: CourseResponse | null;
  setCourse: (c: CourseResponse | null) => void;
}

const CourseContext = createContext<CourseContextValue | undefined>(undefined);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [userType, setUserType] = useState<UserType>("general");
  const [course, setCourse] = useState<CourseResponse | null>(null);

  return (
    <CourseContext.Provider value={{ userType, setUserType, course, setCourse }}>
      {children}
    </CourseContext.Provider>
  );
}

export function useCourseContext(): CourseContextValue {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useCourseContext는 CourseProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
