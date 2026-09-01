import { useRouter } from "expo-router";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ThemeColors } from "../constants/theme";
import { useTheme } from "../services/ThemeContext";
import { CourseStop, UserType } from "../types";
import { AccessibilityIcons } from "./AccessibilityIcons";

export function AttractionCard({ stop, userType }: { stop: CourseStop; userType?: UserType }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const CONGESTION_LABEL: Record<string, { label: string; color: string }> = {
    low: { label: "여유", color: colors.primary },
    medium: { label: "보통", color: colors.warning },
    high: { label: "혼잡", color: colors.danger },
  };
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

      <View style={[styles.body, !attraction.image_url && styles.bodyNoImage]}>
        <View style={styles.headerRow}>
          <Text style={styles.name}>{attraction.name}</Text>
          <View style={styles.badgeGroup}>
            {typeof attraction.avg_rating === "number" && (
              <View style={styles.ratingBadge}>
                <Text style={styles.ratingBadgeText}>
                  ★ {attraction.avg_rating.toFixed(1)} ({attraction.review_count})
                </Text>
              </View>
            )}
            {typeof attraction.congestion_rate === "number" && (
              <View style={styles.congestionRateBadge}>
                <Text style={styles.congestionRateBadgeText}>
                  혼잡도 {Math.round(attraction.congestion_rate)}%
                </Text>
              </View>
            )}
            {congestionInfo && (
              <View style={[styles.congestionBadge, { backgroundColor: congestionInfo.color }]}>
                <Text style={styles.congestionText}>{congestionInfo.label}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.address}>{attraction.address}</Text>
        <Text style={styles.time}>🕐 추천 방문 시간: {stop.recommended_arrival_time}</Text>
        <Text style={styles.reason}>{stop.reason}</Text>

        <AccessibilityIcons features={attraction.accessibility} userType={userType} />

        {attraction.nearby_medical_info && (
          <Text style={styles.medical}>🏥 {attraction.nearby_medical_info}</Text>
        )}

        <Pressable
          style={styles.detailButton}
          onPress={() =>
            router.push({
              pathname: "/attraction-detail",
              params: { contentId: attraction.content_id, name: attraction.name },
            })
          }
        >
          <Text style={styles.detailButtonText}>상세 페이지 보기 →</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    overflow: "hidden",
  },
  orderBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 1,
    backgroundColor: colors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: colors.onPrimary, fontWeight: "700", fontSize: 13 },
  image: { width: "100%", height: 140 },
  body: { padding: 16 },
  bodyNoImage: { paddingTop: 40 }, // 사진이 없으면 순번 배지가 body 위에 바로 겹치니, 배지 높이만큼 위쪽 여백을 줌
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 17, fontWeight: "700", color: colors.text, flexShrink: 1 },
  badgeGroup: { flexDirection: "row", gap: 6, marginLeft: 8 },
  ratingBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ratingBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  congestionRateBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  congestionRateBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  congestionBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  congestionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  address: { fontSize: 13, color: colors.textTertiary, marginTop: 4 },
  time: { fontSize: 13, color: colors.text, marginTop: 8, fontWeight: "600" },
  reason: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  medical: { fontSize: 12, color: colors.textSecondary, marginTop: 8 },
  detailButton: { alignSelf: "flex-start", marginTop: 10 },
  detailButtonText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  });
}
