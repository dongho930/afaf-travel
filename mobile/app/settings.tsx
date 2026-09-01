import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ThemeColors } from "../constants/theme";
import { useTheme } from "../services/ThemeContext";
import { ThemeMode } from "../constants/theme";

const OPTIONS: { mode: ThemeMode; icon: string; label: string; desc: string }[] = [
  { mode: "light", icon: "☀️", label: "밝은", desc: "밝은 배경의 기본 화면" },
  { mode: "dark", icon: "🌙", label: "어두운", desc: "어두운 배경으로 눈부심 줄이기" },
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
        {OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.mode}
            style={[styles.optionCard, theme === opt.mode && styles.optionCardSelected]}
            onPress={() => setTheme(opt.mode)}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label} 테마, ${opt.desc}`}
          >
            <Text style={styles.optionIcon}>{opt.icon}</Text>
            <Text style={styles.optionLabel}>{opt.label}</Text>
            <Text style={styles.optionDesc}>{opt.desc}</Text>
            {theme === opt.mode && (
              <View style={styles.checkBadge}>
                <Text style={styles.checkBadgeText}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: 24 },
    sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 4 },
    sectionDesc: { fontSize: 13, color: colors.textTertiary, marginBottom: 16 },
    optionRow: { flexDirection: "row", gap: 12 },
    optionCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      alignItems: "center",
    },
    optionCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight, borderWidth: 2 },
    optionIcon: { fontSize: 28, marginBottom: 8 },
    optionLabel: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 4 },
    optionDesc: { fontSize: 12, color: colors.textSecondary, textAlign: "center" },
    checkBadge: {
      position: "absolute",
      top: 10,
      right: 10,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    checkBadgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: "800" },
  });
}
