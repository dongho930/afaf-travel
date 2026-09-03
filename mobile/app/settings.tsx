import { CheckIcon, MoonIcon, SunIcon, type Icon } from "phosphor-react-native";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";
import { ThemeMode } from "../constants/theme";

const OPTIONS: { mode: ThemeMode; icon: Icon; label: string; desc: string }[] = [
  { mode: "light", icon: SunIcon, label: "밝은", desc: "밝은 배경의 기본 화면" },
  { mode: "dark", icon: MoonIcon, label: "어두운", desc: "어두운 배경으로 눈부심 줄이기" },
];

/**
 * 프로필 화면의 '설정'을 눌러서 들어오는 화면입니다. 현재는 화면 테마(라이트/
 * 다크) 하나만 있습니다. 선택하면 즉시 앱 전체에 반영되고, 다음에 앱을 다시
 * 켜도 그대로 유지됩니다(AsyncStorage에 저장).
 */
export default function SettingsScreen() {
  const { theme, colors, setTheme } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>화면 테마</Text>
      <Text style={styles.sectionDesc}>앱 전체에 적용됩니다</Text>

      <View style={styles.optionRow}>
        {OPTIONS.map((opt) => {
          const OptionIcon = opt.icon;
          return (
            <TouchableOpacity
              key={opt.mode}
              style={[styles.optionCard, theme === opt.mode && styles.optionCardSelected]}
              onPress={() => setTheme(opt.mode)}
              accessibilityRole="button"
              accessibilityLabel={`${opt.label} 테마, ${opt.desc}`}
            >
              <OptionIcon size={28} color={colors.primary} weight="bold" />
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.optionDesc}>{opt.desc}</Text>
              {theme === opt.mode && (
                <View style={styles.checkBadge}>
                  <CheckIcon size={12} color={colors.onPrimary} weight="bold" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
    sectionTitle: { fontSize: 16, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
    sectionDesc: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.lg },
    optionRow: { flexDirection: "row", gap: spacing.md },
    optionCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg + 2,
      alignItems: "center",
      gap: spacing.sm,
    },
    optionCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight, borderWidth: 2 },
    optionLabel: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
    optionDesc: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, textAlign: "center" },
    checkBadge: {
      position: "absolute",
      top: spacing.sm + 2,
      right: spacing.sm + 2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
