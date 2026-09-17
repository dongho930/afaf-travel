import React from "react";
import { StyleProp, StyleSheet, Text, TextStyle } from "react-native";
import { fontFamily } from "../constants/fonts";
import { spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/** 공모전 공식 출처 표기 문구. 형식(콜론 뒤 한 칸)을 바꾸지 말아주세요. */
export const DATA_CREDIT_TEXT = "출처: ⓒ한국관광콘텐츠랩";

/**
 * 여행지 사진이 작아서 사진 위에 출처를 얹기 어려운 목록(검색 결과, 근처 관광지,
 * 코스 타임라인)에 한 줄로 붙이는 출처 표기입니다. 카드마다 반복되는 문구라
 * 스크린리더는 건너뜁니다 — 앱 전체 출처는 설정 화면에서 읽을 수 있습니다.
 */
export function DataCreditLine({ style }: { style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[styles.line, { color: colors.textSecondary }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {DATA_CREDIT_TEXT}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: spacing.md, fontSize: 12, fontFamily: fontFamily.regular, textAlign: "center" },
});
