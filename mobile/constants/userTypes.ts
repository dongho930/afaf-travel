import { type Icon } from "phosphor-react-native";
import { UserType } from "../types";
import { userTypeIcon } from "./userTypeIcons";

/**
 * 접근성 유형 선택지. AI 플래너와 첫 실행 온보딩이 같은 목록·설명을 씁니다 —
 * 두 곳에 따로 적어두면 한쪽만 고쳐져 어긋납니다.
 */
export const USER_TYPE_OPTIONS: { type: UserType; icon: Icon; desc: string }[] = [
  { type: "wheelchair", icon: userTypeIcon.wheelchair, desc: "턱 없는 출입구와 장애인 화장실이 있는 곳 우선" },
  { type: "stroller", icon: userTypeIcon.stroller, desc: "유모차 대여·수유실·기저귀 교환대가 있는 곳 우선" },
  { type: "senior", icon: userTypeIcon.senior, desc: "휠체어 접근로·엘리베이터·장애인 화장실이 있는 곳 우선" },
  { type: "pregnant", icon: userTypeIcon.pregnant, desc: "수유실·임산부 주차구역이 있는 곳 우선" },
  { type: "visual", icon: userTypeIcon.visual, desc: "점자블록·오디오가이드 등 시각 안내시설 우선" },
  { type: "hearing", icon: userTypeIcon.hearing, desc: "수어 안내·자막 안내 등 청각 안내시설 우선" },
  { type: "general", icon: userTypeIcon.general, desc: "접근성 조건 없이 일반적인 코스 추천" },
];

// 이용자 유형마다 실제로 마주하는 이동 제약이 다르므로, 입력 예시도 유형에 맞게 다르게 보여줍니다.
export const EXAMPLE_QUERY_BY_TYPE: Record<UserType, string> = {
  wheelchair: "지체 장애인도 갈 수 있는 경사 없는 산책로와 맛집 추천해줘",
  stroller: "유모차 밀고 다니기 편한 평지 산책로와 아이랑 갈 만한 맛집 추천해줘",
  senior: "계단 없이 다닐 수 있고 많이 걷지 않아도 되는 코스와 맛집 추천해줘",
  pregnant: "화장실 가깝고 오래 걷지 않아도 되는 편안한 코스와 맛집 추천해줘",
  visual: "점자블록이나 음성 안내가 있는 곳 위주로 코스와 맛집 추천해줘",
  hearing: "수화 안내나 자막 가이드가 있는 곳 위주로 코스와 맛집 추천해줘",
  general: "가족과 함께 가기 좋은 산책로와 맛집 추천해줘",
};
