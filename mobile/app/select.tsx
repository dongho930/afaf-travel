import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AccessibilityIcons } from "../components/AccessibilityIcons";
import { ThemeColors } from "../constants/theme";
import { api } from "../services/api";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { useTheme } from "../services/ThemeContext";
import { PlaceCandidate, UserType } from "../types";

/**
 * /input에서 추천받은 장소 후보(recommendations) 중, 사용자가 실제로 가고 싶은
 * 곳만 직접 골라서 체크합니다. "선택한 장소로 코스 만들기"를 누르면 그 장소들로만
 * (AI가 순서·시간대를 정해서) 최종 코스를 생성하고 결과 화면으로 넘어갑니다.
 */
export default function SelectPlacesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { userType, sigunguCd, recommendations, pendingQueryText, setCourse } = useCourseContext();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggle = (contentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  };

  const handleCreateCourse = async () => {
    if (selectedIds.size === 0) {
      Alert.alert("장소를 선택해주세요", "코스에 포함할 장소를 하나 이상 골라주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const course = await api.generateCourseFromSelection({
        queryText: pendingQueryText,
        userType,
        sigunguCd,
        selectedContentIds: Array.from(selectedIds),
      });
      setCourse(course);
      await storage.saveCourse(course);
      router.push("/results");
    } catch (err) {
      Alert.alert("코스 생성 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (recommendations.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>추천받은 장소가 없어요. 먼저 원하는 여행을 말씀해주세요.</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
          <Text style={styles.emptyButtonText}>여행 요청하러 가기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>마음에 드는 장소를 골라주세요</Text>
      <Text style={styles.subtitle}>
        "{pendingQueryText}" 요청에 맞춰 추천된 장소예요. 선택한 곳들로 코스를 만들어드려요.
      </Text>

      <FlatList
        data={recommendations}
        keyExtractor={(item) => item.attraction.content_id}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <PlaceOptionCard
            candidate={item}
            userType={userType}
            selected={selectedIds.has(item.attraction.content_id)}
            onToggle={() => toggle(item.attraction.content_id)}
          />
        )}
      />

      <View style={styles.footer}>
        <Text style={styles.selectionCount}>{selectedIds.size}곳 선택됨</Text>
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleCreateCourse}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="선택한 장소로 코스 만들기"
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitText}>선택한 장소로 코스 만들기</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function PlaceOptionCard({
  candidate,
  userType,
  selected,
  onToggle,
}: {
  candidate: PlaceCandidate;
  userType: UserType;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { attraction, reason } = candidate;
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${attraction.name}, ${selected ? "선택됨" : "선택 안 됨"}`}
    >
      <View style={styles.checkbox}>
        {selected && <Text style={styles.checkboxMark}>✓</Text>}
      </View>

      {attraction.image_url && (
        <Image source={{ uri: attraction.image_url }} style={styles.image} />
      )}

      <View style={styles.body}>
        <Text style={styles.name}>{attraction.name}</Text>
        {(typeof attraction.avg_rating === "number" || typeof attraction.congestion_rate === "number") && (
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
          </View>
        )}
        <Text style={styles.category}>{attraction.category}</Text>
        <Text style={styles.address}>{attraction.address}</Text>
        <Text style={styles.reason}>{reason}</Text>
        <AccessibilityIcons features={attraction.accessibility} userType={userType} />
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
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  title: { fontSize: 21, fontWeight: "700", color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    overflow: "hidden",
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryLight },
  checkbox: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 1,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxMark: { color: colors.primary, fontWeight: "800", fontSize: 14 },
  image: { width: 96, height: "100%", minHeight: 110 },
  body: { flex: 1, padding: 14, paddingRight: 40 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  badgeGroup: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  ratingBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ratingBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  congestionRateBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  congestionRateBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  category: { fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 6 },
  address: { fontSize: 12, color: colors.textTertiary, marginTop: 4 },
  reason: { fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  detailButton: { alignSelf: "flex-start", marginTop: 10 },
  detailButtonText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceAlt,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectionCount: { fontSize: 13, color: colors.textSecondary, marginBottom: 8, textAlign: "center" },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  emptyText: { fontSize: 15, color: colors.textTertiary, marginBottom: 16, textAlign: "center", lineHeight: 20 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyButtonText: { color: colors.onPrimary, fontWeight: "700" },
  });
}
