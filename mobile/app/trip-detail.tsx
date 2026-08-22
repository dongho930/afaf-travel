import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../services/api";
import { useCourseContext } from "../services/CourseContext";
import { SavedCourseSummary } from "../types";

/**
 * mypage(여행 목록)에서 여행 하나를 눌렀을 때 들어오는 화면입니다.
 * 그 여행에 저장된 코스(예: 1일차, 2일차)들을 보여주고, 눌러서 다시 열거나 삭제할 수 있습니다.
 */
export default function TripDetailScreen() {
  const router = useRouter();
  const { tripId, tripName } = useLocalSearchParams<{ tripId: string; tripName: string }>();
  const { setCourse } = useCourseContext();
  const [courses, setCourses] = useState<SavedCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!tripId) return;
    setLoading(true);
    api
      .listTripCourses(tripId)
      .then(setCourses)
      .catch(() => Alert.alert("불러오기 실패", "코스 목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleOpen = async (courseId: string) => {
    setOpeningId(courseId);
    try {
      const detail = await api.getSavedCourse(courseId);
      setCourse(detail.course);
      router.push("/results");
    } catch (err) {
      Alert.alert("불러오기 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = (courseId: string) => {
    Alert.alert("코스를 삭제할까요?", "이 코스만 삭제되고 여행은 유지돼요.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteCourse(courseId);
            setCourses((prev) => prev.filter((c) => c.course_id !== courseId));
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D5B" />
      </View>
    );
  }

  if (courses.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>"{tripName}"에 저장된 코스가 없어요.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={courses}
      keyExtractor={(item) => item.course_id}
      contentContainerStyle={styles.list}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleOpen(item.course_id)}
          disabled={openingId === item.course_id}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.dayBadge}>{index + 1}번째 코스</Text>
            <TouchableOpacity onPress={() => handleDelete(item.course_id)} hitSlop={10}>
              <Text style={styles.deleteText}>삭제</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {item.summary}
          </Text>
          <Text style={styles.meta}>
            {item.region} · 관광지 {item.stop_count}곳
          </Text>
          {openingId === item.course_id && (
            <ActivityIndicator style={{ marginTop: 8 }} size="small" color="#2E7D5B" />
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 15, color: "#8A8A8A", textAlign: "center" },
  list: { padding: 20, gap: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 16,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  dayBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2E7D5B",
    backgroundColor: "#EAF3EE",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  deleteText: { fontSize: 13, color: "#C0392B", fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: 2 },
  summary: { fontSize: 13, color: "#5C5C5C", marginBottom: 4 },
  meta: { fontSize: 12, color: "#8A8A8A" },
});
