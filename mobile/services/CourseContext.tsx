import React, { createContext, useContext, useState } from "react";
import { CourseResponse, ParsedQuery, PlaceCandidate, UserType } from "../types";

/** 코스를 날짜별로 나눴을 때의 하루치. 0번이 1일차입니다. */
export interface DayCourse {
  course: CourseResponse;
  visitDate: string | null;
}

interface CourseContextValue {
  userType: UserType;
  setUserType: (t: UserType) => void;
  course: CourseResponse | null;
  // "이 코스로 새로 시작" — 일차 목록을 1일차 하나로 되돌립니다.
  setCourse: (c: CourseResponse | null) => void;

  // 하루에 다 못 도는 코스를 나누면 2일차, 3일차… 로 계속 늘어납니다.
  // course는 항상 dayCourses[0]과 같게 유지됩니다(지도·다른 화면 호환).
  dayCourses: DayCourse[];
  setDayCourses: (days: DayCourse[]) => void;

  // 지역(경기도 내 시/군/구) 선택 — null이면 경기도 전체를 대상으로 추천합니다.
  sigunguCd: number | null;
  sigunguName: string | null;
  setRegion: (cd: number | null, name: string | null) => void;

  // 1단계(장소 추천)와 2단계(선택 기반 코스 생성) 화면 사이에서 공유하는 상태
  recommendations: PlaceCandidate[];
  setRecommendations: (r: PlaceCandidate[]) => void;
  missingCategories: string[];
  setMissingCategories: (categories: string[]) => void;
  pendingQueryText: string;
  setPendingQueryText: (q: string) => void;
  // 홈 탭 검색창에서 AI 플래너 입력창으로 문구를 넘길 때 씁니다. 넘길 때마다
  // 번호(queryHandoffSeq)가 올라가서, 지난번과 똑같은 문구를 넘겨도 플래너가
  // "새로 넘어온 것"으로 알아봅니다.
  queryHandoffSeq: number;
  sendQueryToPlanner: (text: string) => void;

  // 서버가 질의에서 읽어낸 조건(지역/동행자/목적). 장소 선택 화면에서 "이렇게
  // 이해했어요"로 보여주기 위해 1단계 응답에서 받아 함께 넘깁니다.
  parsedQuery: ParsedQuery | null;
  setParsedQuery: (p: ParsedQuery | null) => void;

  // 방문 예정일("YYYY-MM-DD"). 그날의 혼잡도 예보와 휴무일을 확인하는 데 쓰이며,
  // 1단계에서 고른 값을 2단계(코스 생성)까지 그대로 들고 갑니다.
  visitDate: string | null;
  setVisitDate: (d: string | null) => void;
}

const CourseContext = createContext<CourseContextValue | undefined>(undefined);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [userType, setUserType] = useState<UserType>("general");
  const [course, setCourseState] = useState<CourseResponse | null>(null);
  const [dayCourses, setDayCoursesState] = useState<DayCourse[]>([]);
  const [sigunguCd, setSigunguCd] = useState<number | null>(null);
  const [sigunguName, setSigunguName] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<PlaceCandidate[]>([]);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [pendingQueryText, setPendingQueryText] = useState("");
  const [queryHandoffSeq, setQueryHandoffSeq] = useState(0);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [visitDate, setVisitDate] = useState<string | null>(null);

  const sendQueryToPlanner = (text: string) => {
    setPendingQueryText(text);
    setQueryHandoffSeq((n) => n + 1);
  };

  const setRegion = (cd: number | null, name: string | null) => {
    setSigunguCd(cd);
    setSigunguName(name);
  };

  // 두 값이 어긋나면 지도와 목록이 서로 다른 코스를 보게 되므로, 일차 목록을
  // 바꿀 때 1일차를 course에도 그대로 반영합니다.
  const setDayCourses = (days: DayCourse[]) => {
    setDayCoursesState(days);
    setCourseState(days[0]?.course ?? null);
  };

  const setCourse = (c: CourseResponse | null) => {
    setCourseState(c);
    setDayCoursesState(c ? [{ course: c, visitDate }] : []);
  };

  return (
    <CourseContext.Provider
      value={{
        userType,
        setUserType,
        course,
        setCourse,
        dayCourses,
        setDayCourses,
        sigunguCd,
        sigunguName,
        setRegion,
        recommendations,
        setRecommendations,
        missingCategories,
        setMissingCategories,
        pendingQueryText,
        setPendingQueryText,
        queryHandoffSeq,
        sendQueryToPlanner,
        parsedQuery,
        setParsedQuery,
        visitDate,
        setVisitDate,
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
