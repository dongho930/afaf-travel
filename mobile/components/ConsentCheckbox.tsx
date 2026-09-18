import { CheckIcon } from "phosphor-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * 동의 체크박스. React Native에는 체크박스가 기본으로 없어서 직접 만듭니다.
 *
 * 반드시 '해제된 상태'로 시작합니다 — 미리 체크해 두면 이용자가 스스로 한 선택이
 * 아니어서 명시적 동의로 인정되지 않습니다(원스토어 검증 반려 사유이기도 합니다).
 *
 * 화면을 못 보는 이용자도 체크 여부를 알 수 있도록 role/state를 함께 전합니다.
 * 네이티브는 accessibilityState를, 웹(react-native-web)은 aria-checked를 보기
 * 때문에 두 가지를 모두 넘깁니다 (하단 탭바와 같은 이유).
 */
export function ConsentCheckbox({
  checked,
  onChange,
  label,
  required = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  required?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={required ? `필수 ${label}` : label}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked && <CheckIcon size={14} color={colors.onPrimary} weight="bold" />}
      </View>
      <Text style={styles.label}>
        {required && <Text style={styles.required}>[필수] </Text>}
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm + 2,
      // 손가락으로 누르기 좋게 줄 전체를 44px 이상으로 잡습니다.
      minHeight: 44,
      paddingVertical: spacing.xs,
    },
    rowPressed: { opacity: 0.6 },
    box: {
      width: 22,
      height: 22,
      borderRadius: radius.sm - 2,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    boxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    label: { flex: 1, fontSize: 14, fontFamily: fontFamily.semiBold, color: colors.text, lineHeight: 20 },
    required: { color: colors.primary, fontFamily: fontFamily.bold },
  });
}
