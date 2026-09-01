import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../services/api";
import { useCourseContext } from "../services/CourseContext";
import { useTheme } from "../services/ThemeContext";
import { ThemeColors } from "../constants/theme";
import { SavedCourseSummary } from "../types";

/**
 * mypage(여행 목록)에서 여행 하나를 눌렀을 때 들어오는 화면입니다.
 * 그 여행에 저장된 코스(예: 1일차, 2일차)들을 보여주고, 눌러서 다시 열거나 삭제할 수 있습니다.
 */
export default function TripDetailScreen() {
  const router = useRouter();
  const { tripId, tripName } = useLocalSearchParams<{ tripId: string; tripName: string }>();
  const { setCourse } = useCourseContext();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [courses, setCourses] = useState<SavedCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<SavedCourseSummary | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

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

  const openEditTitle = (course: SavedCourseSummary) => {
    setEditingCourse(course);
    setEditingTitle(course.title);
  };

  const handleSaveTitle = async () => {
    if (!editingCourse) return;
    if (!editingTitle.trim()) {
      Alert.alert("이름을 입력해주세요");
      return;
    }
    setIsSavingTitle(true);
    try {
      const updated = await api.updateCourse(editingCourse.course_id, { title: editingTitle.trim() });
      setCourses((prev) =>
        prev.map((c) => (c.course_id === updated.course_id ? { ...c, title: updated.title } : c))
      );
      setEditingCourse(null);
    } catch (err) {
      Alert.alert("수정 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSavingTitle(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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
    <>
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
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => openEditTitle(item)} hitSlop={10}>
                  <Text style={styles.editText}>수정</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item.course_id)} hitSlop={10}>
                  <Text style={styles.deleteText}>삭제</Text>
                </TouchableOpacity>
              </View>
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
              <ActivityIndicator style={{ marginTop: 8 }} size="small" color={colors.primary} />
            )}
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={!!editingCourse}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingCourse(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>코스 이름 수정</Text>
              <TouchableOpacity onPress={() => setEditingCourse(null)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={editingTitle}
              onChangeText={setEditingTitle}
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.confirmButton, isSavingTitle && styles.confirmButtonDisabled]}
              onPress={handleSaveTitle}
              disabled={isSavingTitle}
            >
              {isSavingTitle ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmButtonText}>저장하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  emptyText: { fontSize: 15, color: colors.textTertiary, textAlign: "center" },
  list: { padding: 20, gap: 12, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardActions: { flexDirection: "row", gap: 14 },
  editText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  dayBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  deleteText: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 2 },
  summary: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  meta: { fontSize: 12, color: colors.textTertiary },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  });
}
