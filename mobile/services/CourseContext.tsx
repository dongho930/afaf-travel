import React, { createContext, useContext, useState } from "react";
import { CourseResponse, ParsedQuery, PlaceCandidate, UserType } from "../types";

interface CourseContextValue {
  userType: UserType;
  setUserType: (t: UserType) => void;
  course: CourseResponse | null;
  setCourse: (c: CourseResponse | null) => void;

  // 지역(경기도 내 시/군/구) 선택 — null이면 경기도 전체를 대상으로 추천합니다.
  sigunguCd: number | null;
  sigunguName: string | null;
  setRegion: (cd: number | null, name: string | null) => void;

  // 1단계(장소 추천)와 2단계(선택 기반 코스 생성) 화면 사이에서 공유하는 상태
  recommendations: PlaceCandidate[];
  setRecommendations: (r: PlaceCandidate[]) => void;
  pendingQueryText: string;
  setPendingQueryText: (q: string) => void;

  // 서버가 질의에서 읽어낸 조건(지역/동행자/목적). 장소 선택 화면에서 "이렇게
  // 이해했어요"로 보여주기 위해 1단계 응답에서 받아 함께 넘깁니다.
  parsedQuery: ParsedQuery | null;
  setParsedQuery: (p: ParsedQuery | null) => void;
}

const CourseContext = createContext<CourseContextValue | undefined>(undefined);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [userType, setUserType] = useState<UserType>("general");
  const [course, setCourse] = useState<CourseResponse | null>(null);
  const [sigunguCd, setSigunguCd] = useState<number | null>(null);
  const [sigunguName, setSigunguName] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<PlaceCandidate[]>([]);
  const [pendingQueryText, setPendingQueryText] = useState("");
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);

  const setRegion = (cd: number | null, name: string | null) => {
    setSigunguCd(cd);
    setSigunguName(name);
  };

  return (
    <CourseContext.Provider
      value={{
        userType,
        setUserType,
        course,
        setCourse,
        sigunguCd,
        sigunguName,
        setRegion,
        recommendations,
        setRecommendations,
        pendingQueryText,
        setPendingQueryText,
        parsedQuery,
        setParsedQuery,
      }}
    >
      {children}
    </CourseContext.Provider>
  );
}

export function useCourseContext(): CourseContextValue {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useCourseContext는 CourseProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
