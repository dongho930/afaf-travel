import { LightbulbIcon, XIcon } from "phosphor-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { TipKey, useOnboarding } from "../services/OnboardingContext";
import { useTheme } from "../services/ThemeContext";

/**
 * 화면에 처음 들어왔을 때 한 번 보여주는 도움말 카드입니다.
 *
 * 떠 있는 말풍선 대신, 설명하려는 버튼·목록 바로 옆에 끼워 넣는 카드로 둡니다.
 * 위치를 재서 덮는 말풍선은 화면 크기·큰 글씨·웹에서 자주 어긋나고, 스크린리더가
 * 읽는 순서도 엉킵니다. 카드는 화면 흐름 안에 있어서 설명 대상 바로 앞에서 읽힙니다.
 * 한 화면에 하나만 두고, 닫으면 다시 뜨지 않습니다(설정에서 다시 켤 수 있음).
 */
export function FirstVisitTip({
  tipKey,
  text,
  style,
}: {
  tipKey: TipKey;
  text: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { isTipSeen, dismissTip, onboardingVisible } = useOnboarding();
  if (onboardingVisible || isTipSeen(tipKey)) return null;

  return (
    <View style={[styles.card, style]} accessibilityRole="summary" accessibilityLabel={`도움말: ${text}`}>
      <LightbulbIcon size={18} color={colors.primary} weight="fill" />
      <Text style={styles.text}>{text}</Text>
      <Pressable
        onPress={() => dismissTip(tipKey)}
        hitSlop={10}
        style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="도움말 닫기"
      >
        <XIcon size={16} color={colors.textSecondary} weight="bold" />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      backgroundColor: colors.primaryLight,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
    },
    text: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium, color: colors.text },
    close: { padding: spacing.xs },
  });
}
