import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { spacing } from "../constants/tokens";
import { Attraction } from "../types";

// 카테고리별로 카드에 보여줄 부가 정보 라벨(순서 그대로 표시). 라벨 문자열은
// 백엔드 _INTRO_FIELDS_BY_TYPE(backend/app/services/tour_api.py)이 실제로 채우는
// InfoField.label과 정확히 일치해야 골라낼 수 있습니다.
export const EXTRA_INFO_LABELS_BY_CATEGORY: Record<string, string[]> = {
  관광지: ["이용시간", "쉬는날", "개장일"],
  문화시설: ["이용요금", "이용시간", "쉬는날"],
  레포츠: ["이용요금", "이용시간", "개장 시간", "쉬는날", "체험 가능 연령", "수용 인원"],
  숙박: ["입실 시간", "퇴실 시간", "취사 가능 여부", "객실 수", "인증 등급"],
  음식점: ["대표 메뉴", "영업시간", "쉬는날"],
};

/**
 * 카드 소개문 아래에 카테고리별로 정해둔 부가 정보(이용시간/요금 등)만 골라
 * 정해진 순서대로 보여줍니다. 해당 카테고리에 대한 항목 정의가 없거나, 아직
 * 부가 정보를 못 받아왔거나(로딩 전), 그 항목이 실제로 없는 곳이면 null을
 * 반환합니다(호출한 쪽에서 이 값의 유무로 위/아래에 구분선을 넣을지 판단할
 * 수 있도록 컴포넌트가 아니라 함수로 둡니다). 홈 화면 인기 여행지 카드에서
 * 쓰던 표시 방식을 장소 선택하기/추천 코스 화면에서도 그대로 재사용합니다.
 */
export function renderExtraInfo(place: Attraction, colors: ThemeColors): React.ReactNode {
  const labels = EXTRA_INFO_LABELS_BY_CATEGORY[place.category];
  if (!labels || !place.extra_info?.length) return null;
  const entries = labels
    .map((label) => place.extra_info!.find((info) => info.label === label))
    .filter((info): info is { label: string; value: string } => !!info);
  if (entries.length === 0) return null;

  const styles = makeStyles(colors);
  return (
    <View style={styles.container}>
      {entries.map((info) => (
        <View key={info.label} style={styles.row}>
          <Text style={styles.label}>{info.label}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {info.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // 라벨 칸을 고정 너비로 잡아서 값이 항목마다 같은 위치에서 시작합니다.
    container: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: spacing.xs,
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    label: { width: 64, fontSize: 11, fontFamily: fontFamily.semiBold, color: colors.textTertiary },
    value: { flex: 1, fontSize: 11, fontFamily: fontFamily.regular, color: colors.textSecondary },
  });
}
