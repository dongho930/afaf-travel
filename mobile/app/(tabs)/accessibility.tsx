import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../services/api";
import { AccessibilityPlaceScore, AccessibilitySummary } from "../../types";

type CategoryKey = "wheelchair_count" | "visual_count" | "hearing_count" | "senior_count" | "family_count" | "pregnant_count";

const CATEGORY_META: { key: CategoryKey; icon: string; label: string; isMock: boolean }[] = [
  { key: "wheelchair_count", icon: "♿", label: "휠체어", isMock: false },
  { key: "visual_count", icon: "👁️", label: "시각 장애", isMock: false },
  { key: "hearing_count", icon: "💡", label: "청각 장애", isMock: false },
  { key: "senior_count", icon: "🧓", label: "고령자", isMock: false },
  { key: "family_count", icon: "👶", label: "영유아 가족", isMock: false },
  { key: "pregnant_count", icon: "🤰", label: "임산부", isMock: false },
];

// 각 카테고리를 선택했을 때 어떤 필드의 목록을 보여줄지 매핑합니다.
const TOP_PLACES_FIELD: Record<CategoryKey, keyof AccessibilitySummary> = {
  wheelchair_count: "top_wheelchair_places",
  visual_count: "top_visual_places",
  hearing_count: "top_hearing_places",
  senior_count: "top_senior_places",
  family_count: "top_family_places",
  pregnant_count: "top_pregnant_places",
};

function tierLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "우수", color: "#2E7D5B" };
  if (score >= 60) return { label: "보통", color: "#C98A1D" };
  return { label: "주의", color: "#D64545" };
}

/**
 * '접근성' 탭. 휠체어/고령자/시각/청각 개수 모두 실제 편의시설 데이터로 계산됩니다
 * (활용매뉴얼 v4.3 기준 점자블록/오디오가이드/수화안내/자막비디오가이드 등).
 * 카테고리 카드를 누르면 그 유형 기준 주요 여행지 목록으로 바뀝니다.
 */
export default function AccessibilityScreen() {
  const router = useRouter();
  const [summary, setSummary] = useState<AccessibilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("wheelchair_count");

  useEffect(() => {
    api
      .getAccessibilitySummary("경기도")
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2E7D5B" />
        </View>
      </SafeAreaView>
    );
  }

  const counts: Record<CategoryKey, number> = summary
    ? {
        wheelchair_count: summary.wheelchair_count,
        visual_count: summary.visual_count,
        hearing_count: summary.hearing_count,
        senior_count: summary.senior_count,
        family_count: summary.family_count,
        pregnant_count: summary.pregnant_count,
      }
    : ({} as Record<CategoryKey, number>);

  const selectedMeta = CATEGORY_META.find((c) => c.key === selectedCategory)!;
  const selectedPlaces: AccessibilityPlaceScore[] =
    (summary?.[TOP_PLACES_FIELD[selectedCategory]] as AccessibilityPlaceScore[] | undefined) ?? [];

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 (홈 화면과 동일한 방식).
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>♿ 무장애 정보 센터</Text>
        <Text style={styles.title}>접근성 정보</Text>
        <Text style={styles.subtitle}>장애 유형별 실시간 접근성 정보를 확인하세요</Text>

        <View style={styles.grid}>
          {CATEGORY_META.map((c) => {
            const isSelected = c.key === selectedCategory;
            return (
              <Pressable
                key={c.key}
                style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
                onPress={() => setSelectedCategory(c.key)}
              >
                <Text style={styles.categoryIcon}>{c.icon}</Text>
                <Text style={styles.categoryCount}>{counts[c.key] ?? "-"}개 장소</Text>
                <Text style={styles.categoryLabel}>{c.label}</Text>
                {c.isMock && <Text style={styles.mockBadge}>참고용 수치</Text>}
              </Pressable>
            );
          })}
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

        <Text style={styles.sectionTitle}>
          {selectedMeta.icon} {selectedMeta.label} 주요 여행지
        </Text>
        {selectedPlaces.length ? (
          selectedPlaces.map((place) => {
            const tier = tierLabel(place.score);
            return (
              <Pressable
                key={place.content_id}
                style={styles.placeRow}
                onPress={() =>
                  router.push({
                    pathname: "/attraction-detail",
                    params: { contentId: place.content_id, name: place.name },
                  })
                }
              >
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
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.emptyText}>
            {selectedMeta.label} 관련 편의시설 정보가 있는 장소가 아직 없어요.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
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
  categoryCardSelected: {
    borderColor: "#2E7D5B",
    borderWidth: 2,
    backgroundColor: "#F3FAF6",
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
