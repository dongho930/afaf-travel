import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../services/api";
import { AccessibilitySummary } from "../../types";

const CATEGORY_META = [
  { key: "wheelchair_count", icon: "♿", label: "휠체어", isMock: false },
  { key: "visual_count", icon: "👁️", label: "시각 장애", isMock: false },
  { key: "hearing_count", icon: "💡", label: "청각 장애", isMock: false },
  { key: "senior_count", icon: "🧓", label: "고령자", isMock: false },
] as const;

function tierLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "우수", color: "#2E7D5B" };
  if (score >= 60) return { label: "보통", color: "#C98A1D" };
  return { label: "주의", color: "#D64545" };
}

/**
 * '접근성' 탭. 휠체어/고령자/시각/청각 개수 모두 실제 편의시설 데이터로 계산됩니다
 * (활용매뉴얼 v4.3 기준 점자블록/오디오가이드/수화안내/자막비디오가이드 등).
 */
export default function AccessibilityScreen() {
  const [summary, setSummary] = useState<AccessibilitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getAccessibilitySummary("경기도")
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D5B" />
      </View>
    );
  }

  const counts: Record<string, number> = summary
    ? {
        wheelchair_count: summary.wheelchair_count,
        visual_count: summary.visual_count,
        hearing_count: summary.hearing_count,
        senior_count: summary.senior_count,
      }
    : {};

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>♿ 무장애 정보 센터</Text>
      <Text style={styles.title}>접근성 정보</Text>
      <Text style={styles.subtitle}>장애 유형별 실시간 접근성 정보를 확인하세요</Text>

      <View style={styles.grid}>
        {CATEGORY_META.map((c) => (
          <View key={c.key} style={styles.categoryCard}>
            <Text style={styles.categoryIcon}>{c.icon}</Text>
            <Text style={styles.categoryCount}>{counts[c.key] ?? "-"}개 장소</Text>
            <Text style={styles.categoryLabel}>{c.label}</Text>
            {c.isMock && <Text style={styles.mockBadge}>참고용 수치</Text>}
          </View>
        ))}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#2E7D5B" }]} />
          <Text style={styles.legendText}>우수 80+</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#C98A1D" }]} />
          <Text style={styles.legendText}>보통 60-79</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#D64545" }]} />
          <Text style={styles.legendText}>주의 ~59</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>♿ 휠체어 주요 여행지</Text>
      {summary?.top_wheelchair_places.length ? (
        summary.top_wheelchair_places.map((place) => {
          const tier = tierLabel(place.score);
          return (
            <View key={place.name} style={styles.placeRow}>
              <View style={[styles.scoreBadge, { backgroundColor: tier.color }]}>
                <Text style={styles.scoreBadgeText}>{place.score}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.placeName}>{place.name}</Text>
                <Text style={styles.placeAddress} numberOfLines={1}>
                  {place.address}
                </Text>
              </View>
              <View style={[styles.tierBar, { backgroundColor: tier.color }]} />
            </View>
          );
        })
      ) : (
        <Text style={styles.emptyText}>표시할 장소 정보를 불러오지 못했어요.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 24, paddingBottom: 40 },
  eyebrow: { fontSize: 13, fontWeight: "700", color: "#2E7D5B", marginBottom: 6 },
  title: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#5C5C5C", marginBottom: 20 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  categoryCard: {
    width: "47%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 14,
  },
  categoryIcon: { fontSize: 22, marginBottom: 6 },
  categoryCount: { fontSize: 16, fontWeight: "800", color: "#1A1A1A" },
  categoryLabel: { fontSize: 12, color: "#5C5C5C", marginTop: 2 },
  mockBadge: { fontSize: 10, color: "#C98A1D", marginTop: 6, fontWeight: "600" },

  legendRow: { flexDirection: "row", gap: 16, marginBottom: 24 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: "#5C5C5C" },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1A1A1A", marginBottom: 12 },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  scoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scoreBadgeText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  placeName: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
  placeAddress: { fontSize: 12, color: "#8A8A8A", marginTop: 2 },
  tierBar: { width: 4, height: 32, borderRadius: 2 },
  emptyText: { fontSize: 13, color: "#8A8A8A" },
});
