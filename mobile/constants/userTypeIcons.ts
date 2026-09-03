import {
  BabyCarriageIcon,
  BabyIcon,
  EarIcon,
  EyeIcon,
  type Icon,
  PersonSimpleWalkIcon,
  SmileyIcon,
  WheelchairIcon,
} from "phosphor-react-native";

/**
 * 이동유형(휠체어/유모차/고령자/임산부/시각/청각/일반)을 나타내는 아이콘을
 * 화면마다 다시 고르지 않도록 한 곳에 모아둡니다. 화면별로 실제 쓰는 키
 * 이름이 조금씩 달라서(family_count vs stroller 등) 느슨한 Record로
 * 둡니다 — 아래 alias들은 전부 같은 아이콘을 가리킵니다.
 */
export const userTypeIcon: Record<string, Icon> = {
  wheelchair: WheelchairIcon,
  stroller: BabyCarriageIcon,
  family: BabyCarriageIcon, // "영유아 가족" — 화면에 따라 stroller 대신 이 키를 씁니다.
  senior: PersonSimpleWalkIcon,
  pregnant: BabyIcon,
  visual: EyeIcon,
  hearing: EarIcon,
  general: SmileyIcon,
};
