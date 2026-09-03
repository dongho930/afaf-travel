import {
  ArmchairIcon,
  BabyCarriageIcon,
  BabyIcon,
  BookOpenTextIcon,
  ClosedCaptioningIcon,
  CouchIcon,
  DogIcon,
  DoorOpenIcon,
  DotsSixVerticalIcon,
  ElevatorIcon,
  HandWavingIcon,
  type Icon,
  ParkIcon,
  PathIcon,
  PersonSimpleWalkIcon,
  SignpostIcon,
  SpeakerHighIcon,
  TextAaIcon,
  ToiletIcon,
  WheelchairIcon,
} from "phosphor-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";
import { AccessibilityFeatures, UserType } from "../types";

const ICON_MAP: { key: keyof AccessibilityFeatures; icon: Icon; label: string }[] = [
  // 지체장애(휠체어) 관련
  { key: "has_parking", icon: ParkIcon, label: "주차" },
  { key: "has_ramp", icon: PathIcon, label: "경사로" },
  { key: "has_exit", icon: DoorOpenIcon, label: "출입통로" },
  { key: "has_elevator", icon: ElevatorIcon, label: "엘리베이터" },
  { key: "has_accessible_restroom", icon: ToiletIcon, label: "장애인 화장실" },
  { key: "has_wheelchair_rental", icon: WheelchairIcon, label: "휠체어 대여" },
  // 영유아가족/임산부 관련
  { key: "has_stroller_accessible_path", icon: BabyCarriageIcon, label: "유모차 동선" },
  { key: "has_lactation_room", icon: BabyIcon, label: "수유실" },
  { key: "has_baby_spare_chair", icon: ArmchairIcon, label: "유아용 보조의자" },
  { key: "has_rest_area", icon: CouchIcon, label: "휴게 공간" },
  // 시각장애 관련 (접근성 탭 기준 7개 항목)
  { key: "has_braille_block", icon: DotsSixVerticalIcon, label: "점자블록" },
  { key: "has_help_dog", icon: DogIcon, label: "보조견 동반" },
  { key: "has_guide_human", icon: PersonSimpleWalkIcon, label: "안내요원" },
  { key: "has_audio_guide", icon: SpeakerHighIcon, label: "오디오가이드" },
  { key: "has_big_print", icon: TextAaIcon, label: "큰 활자 홍보물" },
  { key: "has_braille_promotion", icon: BookOpenTextIcon, label: "점자 홍보물" },
  { key: "has_guide_system", icon: SignpostIcon, label: "유도 안내설비" },
  // 청각장애 관련 (접근성 탭 기준 3개 항목)
  { key: "has_sign_guide", icon: HandWavingIcon, label: "수화 안내" },
  { key: "has_video_guide", icon: ClosedCaptioningIcon, label: "자막 비디오가이드" },
  { key: "has_hearing_room", icon: CouchIcon, label: "청각장애 편의 객실" },
];

// 이동유형별로 실제 관련 있는 편의시설 항목만 골라 보여주기 위한 매핑입니다.
// 백엔드 ai_service.py의 _RELEVANT_FIELDS_BY_USER_TYPE와 동일한 기준입니다.
// AI 코스 생성 흐름(장소 선택하기/최종 코스 결과)에서, 선택한 이동유형과
// 무관한 태그(예: 청각장애를 선택했는데 경사로가 뜨는 것)가 안 뜨게 합니다.
const RELEVANT_KEYS_BY_USER_TYPE: Partial<Record<UserType, (keyof AccessibilityFeatures)[]>> = {
  wheelchair: [
    "has_parking",
    "has_ramp",
    "has_exit",
    "has_elevator",
    "has_accessible_restroom",
    "has_wheelchair_rental",
  ],
  stroller: ["has_stroller_accessible_path", "has_lactation_room", "has_baby_spare_chair"],
  senior: ["has_rest_area", "has_ramp", "has_elevator", "has_accessible_restroom"],
  pregnant: ["has_lactation_room", "has_baby_spare_chair", "has_ramp", "has_elevator", "has_accessible_restroom"],
  visual: [
    "has_braille_block",
    "has_help_dog",
    "has_guide_human",
    "has_audio_guide",
    "has_big_print",
    "has_braille_promotion",
    "has_guide_system",
  ],
  hearing: ["has_sign_guide", "has_video_guide", "has_hearing_room"],
};

export function AccessibilityIcons({
  features,
  userType,
}: {
  features: AccessibilityFeatures;
  // 지정하면 그 이동유형과 관련된 항목만 보여줍니다. 생략하면(예: 관광지
  // 상세 페이지, 홈 화면처럼 특정 유형에 매인 화면이 아닌 곳) 전체를 보여줍니다.
  userType?: UserType;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const relevantKeys = userType ? RELEVANT_KEYS_BY_USER_TYPE[userType] : undefined;
  const iconMap = relevantKeys ? ICON_MAP.filter((item) => relevantKeys.includes(item.key)) : ICON_MAP;
  const available = iconMap.filter((item) => features[item.key]);
  if (available.length === 0) return null;

  return (
    <View style={styles.row} accessibilityLabel={`이용 가능 편의시설: ${available.map((a) => a.label).join(", ")}`}>
      {available.map((item) => {
        const IconComponent = item.icon;
        return (
          <View key={item.key} style={styles.chip}>
            <IconComponent size={13} color={colors.primary} weight="bold" />
            <Text style={styles.chipLabel}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primaryLight,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: spacing.xs,
    },
    chipLabel: { fontSize: 11, color: colors.primary, fontFamily: fontFamily.semiBold },
  });
}
