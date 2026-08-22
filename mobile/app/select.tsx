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
import { api } from "../services/api";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { PlaceCandidate } from "../types";

/**
 * /input에서 추천받은 장소 후보(recommendations) 중, 사용자가 실제로 가고 싶은
 * 곳만 직접 골라서 체크합니다. "선택한 장소로 코스 만들기"를 누르면 그 장소들로만
 * (AI가 순서·시간대를 정해서) 최종 코스를 생성하고 결과 화면으로 넘어갑니다.
 */
export default function SelectPlacesScreen() {
  const router = useRouter();
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
            <ActivityIndicator color="#FFFFFF" />
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
  selected,
  onToggle,
}: {
  candidate: PlaceCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
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
        <Text style={styles.category}>{attraction.category}</Text>
        <Text style={styles.address}>{attraction.address}</Text>
        <Text style={styles.reason}>{reason}</Text>
        <AccessibilityIcons features={attraction.accessibility} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 21, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#5C5C5C", marginBottom: 16, lineHeight: 18 },
  card: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    marginBottom: 14,
    overflow: "hidden",
  },
  cardSelected: { borderColor: "#2E7D5B", borderWidth: 2, backgroundColor: "#EAF3EE" },
  checkbox: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 1,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#2E7D5B",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxMark: { color: "#2E7D5B", fontWeight: "800", fontSize: 14 },
  image: { width: 96, height: "100%", minHeight: 110 },
  body: { flex: 1, padding: 14 },
  name: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  category: { fontSize: 12, color: "#2E7D5B", fontWeight: "600", marginTop: 2 },
  address: { fontSize: 12, color: "#8A8A8A", marginTop: 4 },
  reason: { fontSize: 13, color: "#5C5C5C", marginTop: 6, lineHeight: 18 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#F7F9F8",
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#E2E8E4",
  },
  selectionCount: { fontSize: 13, color: "#5C5C5C", marginBottom: 8, textAlign: "center" },
  submitButton: {
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 15, color: "#8A8A8A", marginBottom: 16, textAlign: "center", lineHeight: 20 },
  emptyButton: { backgroundColor: "#2E7D5B", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyButtonText: { color: "#FFFFFF", fontWeight: "700" },
});
