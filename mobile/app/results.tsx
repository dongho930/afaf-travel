import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AttractionCard } from "../components/AttractionCard";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse } = useCourseContext();
  const [offlineNotice, setOfflineNotice] = useState(false);

  useEffect(() => {
    // 앱을 재시작해 컨텍스트가 비어 있는 경우, 마지막으로 캐싱된 코스를 오프라인으로 복원
    if (!course) {
      storage.loadCourse().then((cached) => {
        if (cached) {
          setCourse(cached);
          setOfflineNotice(true);
        }
      });
    }
  }, [course]);

  if (!course) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>아직 생성된 코스가 없어요.</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push("/input")}>
          <Text style={styles.emptyButtonText}>여행 요청하러 가기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {offlineNotice && (
        <Text style={styles.offlineBanner}>📴 오프라인 저장된 마지막 코스를 보여드리고 있어요</Text>
      )}
      <Text style={styles.title}>{course.title}</Text>
      <Text style={styles.summary}>{course.summary}</Text>

      <FlatList
        data={course.stops}
        keyExtractor={(item) => item.attraction.content_id}
        renderItem={({ item }) => <AttractionCard stop={item} />}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />

      <Pressable
        style={styles.mapButton}
        onPress={() => router.push("/map")}
        accessibilityRole="button"
        accessibilityLabel="지도로 전체 동선 보기"
      >
        <Text style={styles.mapButtonText}>🗺️ 지도로 전체 동선 보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 21, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  summary: { fontSize: 14, color: "#5C5C5C", marginBottom: 16 },
  offlineBanner: {
    backgroundColor: "#FFF6E5",
    color: "#8A6100",
    fontSize: 12,
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
    textAlign: "center",
  },
  mapButton: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  mapButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 15, color: "#8A8A8A", marginBottom: 16 },
  emptyButton: { backgroundColor: "#2E7D5B", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyButtonText: { color: "#FFFFFF", fontWeight: "700" },
});
