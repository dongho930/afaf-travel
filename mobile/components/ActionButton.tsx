import React from "react";
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

const SIZES = {
  md: { height: 44, fontSize: 15, paddingHorizontal: spacing.lg },
  sm: { height: 36, fontSize: 13, paddingHorizontal: spacing.md + 2 },
} as const;

/**
 * 폼의 확인/취소 버튼. primary는 앱 강조색(초록) 버튼, secondary는
 * SegmentedButtonGroup과 같은 중립 회색 버튼입니다.
 */
export function ActionButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  size?: keyof typeof SIZES;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const s = SIZES[size];
  const isPrimary = variant === "primary";
  const inactive = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        { height: s.height, paddingHorizontal: s.paddingHorizontal },
        isPrimary ? styles.primary : styles.secondary,
        inactive && styles.inactive,
        pressed && !inactive && (isPrimary ? styles.primaryPressed : styles.secondaryPressed),
        style,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={isPrimary ? colors.onPrimary : colors.text} />
      ) : (
        <Text
          style={[styles.label, { fontSize: s.fontSize }, isPrimary ? styles.primaryLabel : styles.secondaryLabel]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    base: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    primary: { backgroundColor: colors.primary },
    primaryPressed: { opacity: 0.8 },
    secondary: { backgroundColor: `${colors.textTertiary}24` },
    secondaryPressed: { backgroundColor: `${colors.textTertiary}40` },
    inactive: { opacity: 0.6 },
    label: { fontFamily: fontFamily.bold },
    primaryLabel: { color: colors.onPrimary },
    secondaryLabel: { color: colors.text, fontFamily: fontFamily.semiBold },
  });
}
