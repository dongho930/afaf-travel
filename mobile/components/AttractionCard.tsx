import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { CourseStop } from "../types";
import { AccessibilityIcons } from "./AccessibilityIcons";

const CONGESTION_LABEL: Record<string, { label: string; color: string }> = {
  low: { label: "여유", color: "#2E7D5B" },
  medium: { label: "보통", color: "#C98A1D" },
  high: { label: "혼잡", color: "#D64545" },
};

export function AttractionCard({ stop }: { stop: CourseStop }) {
  const { attraction } = stop;
  const currentCongestion = attraction.congestion_forecast[0];
  const congestionInfo = currentCongestion
    ? CONGESTION_LABEL[currentCongestion.congestion_level]
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.orderBadge}>
        <Text style={styles.orderText}>{stop.order}</Text>
      </View>

      {attraction.image_url && (
        <Image source={{ uri: attraction.image_url }} style={styles.image} />
      )}

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.name}>{attraction.name}</Text>
          {congestionInfo && (
            <View style={[styles.congestionBadge, { backgroundColor: congestionInfo.color }]}>
              <Text style={styles.congestionText}>{congestionInfo.label}</Text>
            </View>
          )}
        </View>
        <Text style={styles.address}>{attraction.address}</Text>
        <Text style={styles.time}>🕐 추천 방문 시간: {stop.recommended_arrival_time}</Text>
        <Text style={styles.reason}>{stop.reason}</Text>

        <AccessibilityIcons features={attraction.accessibility} />

        {attraction.nearby_medical_info && (
          <Text style={styles.medical}>🏥 {attraction.nearby_medical_info}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    marginBottom: 14,
    overflow: "hidden",
  },
  orderBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 1,
    backgroundColor: "#2E7D5B",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  image: { width: "100%", height: 140 },
  body: { padding: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 17, fontWeight: "700", color: "#1A1A1A", flexShrink: 1 },
  congestionBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  congestionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  address: { fontSize: 13, color: "#8A8A8A", marginTop: 4 },
  time: { fontSize: 13, color: "#1A1A1A", marginTop: 8, fontWeight: "600" },
  reason: { fontSize: 13, color: "#5C5C5C", marginTop: 4, lineHeight: 18 },
  medical: { fontSize: 12, color: "#5C5C5C", marginTop: 8 },
});
