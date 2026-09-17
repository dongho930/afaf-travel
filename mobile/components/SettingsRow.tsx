import { CaretRightIcon, type Icon } from "phosphor-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * 설정 목록의 한 줄입니다 — 왼쪽에 아이콘과 이름, 오른쪽에 현재 값과 셰브론(›).
 *
 * 프로필 화면에서 '아이디 변경' 같은 초록 글자를 눌러야 했던 자리를 대신합니다.
 * 글자만 있는 링크는 탭 영역이 글자 크기(13px)밖에 안 돼서 누르기 어려웠는데,
 * 여기서는 줄 전체가 56px 높이의 탭 영역이 됩니다(접근성 권장치 44px 이상).
 *
 * onPress가 없으면 셰브론을 그리지 않습니다 — 이메일처럼 보여주기만 하는 줄이
 * 눌리는 것처럼 보이지 않게 하려는 것입니다.
 */
export function SettingsRow({
  icon: RowIcon,
  label,
  value,
  onPress,
  divider = false,
  role = "button",
  accessibilityHint,
}: {
  icon: Icon;
  label: string;
  value?: string;
  onPress?: () => void;
  /** 카드 안에서 두 번째 줄부터 위쪽 구분선을 그립니다. */
  divider?: boolean;
  role?: "button" | "link";
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const inner = (
    <>
      {/* 아이콘은 회색입니다 — 다섯 줄이 모두 초록이면 강조가 사라져서, 초록은
          아바타 배지와 기본 버튼에만 남겨둡니다. */}
      <RowIcon size={20} color={colors.textSecondary} weight="bold" />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.spacer} />
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <CaretRightIcon size={16} color={colors.textTertiary} weight="bold" /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, divider && styles.divider]}>{inner}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityHint={accessibilityHint}
    >
      {inner}
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 56,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    rowPressed: { backgroundColor: colors.surfaceAlt },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    label: { flexShrink: 0, fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.text },
    // 이름과 값 사이를 벌려주는 빈 칸입니다. 값(flexShrink)만 줄어들게 해서
    // 긴 이메일이 들어와도 왼쪽 이름은 잘리지 않습니다.
    spacer: { flex: 1, minWidth: spacing.sm },
    value: { flexShrink: 1, fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary, textAlign: "right" },
  });
}
