import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { AttractionCard } from "../components/AttractionCard";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { ThemeColors } from "../constants/theme";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useCourseContext } from "../services/CourseContext";
import { useTheme } from "../services/ThemeContext";
import { storage } from "../services/storage";
import { CourseStop } from "../types";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse } = useCourseContext();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

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

  const openSaveModal = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "코스를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSaveModalVisible(true);
  };

  const handleConfirmSave = async (params: SaveCourseParams) => {
    if (!course) return;
    await api.saveCourse(course.course_id, params);
  };

  // 드래그가 끝나면 화면에는 바로 새 순서를 반영하고(로컬), '순서 저장'
  // 버튼을 눌러야 서버에 실제로 저장됩니다 — 실수로 살짝 끌었을 때마다
  // 바로바로 API를 호출하지 않기 위함입니다.
  const handleDragEnd = ({ data }: { data: CourseStop[] }) => {
    if (!course) return;
    const reordered = data.map((stop, i) => ({ ...stop, order: i + 1 }));
    setCourse({ ...course, stops: reordered });
    setOrderChanged(true);
  };

  const handleSaveOrder = async () => {
    if (!course) return;
    if (!session) {
      Alert.alert("로그인이 필요해요", "순서를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSavingOrder(true);
    try {
      const stopOrder = course.stops.map((s) => s.attraction.content_id);
      await api.updateCourse(course.course_id, { stopOrder });
      setOrderChanged(false);
    } catch (err) {
      Alert.alert("순서 저장 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSavingOrder(false);
    }
  };

  if (!course) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>표시할 코스가 없어요.</Text>
        <TouchableOpacity style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
          <Text style={styles.emptyButtonText}>AI 플래너로 이동</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {offlineNotice && (
        <Text style={styles.offlineBanner}>📴 오프라인 저장된 마지막 코스를 보여드리고 있어요</Text>
      )}

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{course.title}</Text>
          <Text style={styles.summary}>{course.summary}</Text>
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={openSaveModal}>
          <Text style={styles.saveButtonText}>💾 저장</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.orderHintRow}>
        <Text style={styles.orderHint}>✋ 카드를 길게 눌러서 순서를 바꿀 수 있어요</Text>
        {orderChanged && (
          <TouchableOpacity
            style={[styles.saveOrderButton, savingOrder && styles.saveOrderButtonDisabled]}
            onPress={handleSaveOrder}
            disabled={savingOrder}
          >
            {savingOrder ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveOrderButtonText}>순서 저장</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <DraggableFlatList
        data={course.stops}
        keyExtractor={(item) => item.attraction.content_id}
        contentContainerStyle={{ paddingBottom: 90 }}
        onDragEnd={handleDragEnd}
        renderItem={({ item, drag, isActive }) => (
          <ScaleDecorator>
            <Pressable onLongPress={drag} disabled={isActive} style={isActive ? styles.dragging : undefined}>
              <AttractionCard stop={item} userType={course.generated_for} />
            </Pressable>
          </ScaleDecorator>
        )}
      />

      <Pressable
        style={styles.mapButton}
        onPress={() => router.push("/map")}
        accessibilityLabel="지도로 전체 동선 보기"
      >
        <Text style={styles.mapButtonText}>🗺️ 지도로 전체 동선 보기</Text>
      </Pressable>

      <SaveCourseModal
        visible={saveModalVisible}
        onClose={() => setSaveModalVisible(false)}
        defaultNewTripName={course.title}
        onConfirm={handleConfirmSave}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  titleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16, gap: 10 },
  title: { fontSize: 21, fontWeight: "700", color: colors.text, marginBottom: 4 },
  summary: { fontSize: 14, color: colors.textSecondary },
  saveButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveButtonText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  orderHintRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  orderHint: { fontSize: 12, color: colors.textTertiary, flexShrink: 1 },
  saveOrderButton: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginLeft: 8,
  },
  saveOrderButtonDisabled: { opacity: 0.6 },
  saveOrderButtonText: { color: colors.onPrimary, fontWeight: "700", fontSize: 12 },
  dragging: { opacity: 0.7 },
  offlineBanner: {
    backgroundColor: colors.warningLight,
    color: colors.warningText,
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
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  mapButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  emptyText: { fontSize: 15, color: colors.textTertiary, marginBottom: 16 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyButtonText: { color: colors.onPrimary, fontWeight: "700" },
  });
}
