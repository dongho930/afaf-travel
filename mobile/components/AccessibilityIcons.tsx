import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AccessibilityFeatures } from "../types";

const ICON_MAP: { key: keyof AccessibilityFeatures; icon: string; label: string }[] = [
  { key: "has_ramp", icon: "🛤️", label: "경사로" },
  { key: "has_elevator", icon: "🛗", label: "엘리베이터" },
  { key: "has_accessible_restroom", icon: "🚻", label: "장애인 화장실" },
  { key: "has_wheelchair_rental", icon: "♿", label: "휠체어 대여" },
  { key: "has_stroller_accessible_path", icon: "🧸", label: "유모차 동선" },
  { key: "has_rest_area", icon: "🪑", label: "휴게 공간" },
];

export function AccessibilityIcons({ features }: { features: AccessibilityFeatures }) {
  const available = ICON_MAP.filter((item) => features[item.key]);
  if (available.length === 0) return null;

  return (
    <View style={styles.row} accessibilityLabel={`이용 가능 편의시설: ${available.map((a) => a.label).join(", ")}`}>
      {available.map((item) => (
        <View key={item.key} style={styles.chip}>
          <Text style={styles.chipIcon}>{item.icon}</Text>
          <Text style={styles.chipLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF3EE",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  chipIcon: { fontSize: 12 },
  chipLabel: { fontSize: 11, color: "#2E7D5B", fontWeight: "600" },
});
