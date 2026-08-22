import { useFocusEffect, useRouter } from "expo-router";
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
import { DateRangePickerModal } from "../../components/DateRangePickerModal";
import { api } from "../../services/api";
import { COURSE_CATEGORIES, CourseCategory, TripSummary } from "../../types";

const CATEGORY_ICON: Record<string, string> = {
  가족: "👨‍👩‍👧",
  커플: "💑",
  친구: "👯",
  혼자: "🚶",
  기타: "📍",
};

function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}

/**
 * '내 여행' 탭. 상단 통계 카드 4개 중 '저장한 경로'만 실제 값이고, 나머지
 * (방문한 여행지/리뷰 작성/접근성 제보)는 아직 구현 안 된 기능이라 표시용
 * 목업 숫자입니다 — 실제로 방문 기록/리뷰/제보 기능이 생기면 교체해야 합니다.
 */
export default function TripsScreen() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingTrip, setEditingTrip] = useState<TripSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<CourseCategory>("가족");
  const [editStartDate, setEditStartDate] = useState<string | null>(null);
  const [editEndDate, setEditEndDate] = useState<string | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listTrips()
      .then(setTrips)
      .catch(() => Alert.alert("불러오기 실패", "여행 목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDelete = (tripId: string, name: string) => {
    Alert.alert("여행을 삭제할까요?", `"${name}"과 그 안의 저장된 코스가 모두 삭제됩니다. 되돌릴 수 없어요.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteTrip(tripId);
            setTrips((prev) => prev.filter((t) => t.trip_id !== tripId));
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  const openEdit = (trip: TripSummary) => {
    setEditingTrip(trip);
    setEditName(trip.name);
    setEditCategory(trip.category);
    setEditStartDate(trip.start_date ?? null);
    setEditEndDate(trip.end_date ?? null);
  };

  const handleSaveEdit = async () => {
    if (!editingTrip) return;
    if (!editName.trim()) {
      Alert.alert("이름을 입력해주세요");
      return;
    }
    setIsSavingEdit(true);
    try {
      const updated = await api.updateTrip(editingTrip.trip_id, {
        name: editName.trim(),
        category: editCategory,
        startDate: editStartDate,
        endDate: editEndDate,
      });
      setTrips((prev) => prev.map((t) => (t.trip_id === updated.trip_id ? { ...t, ...updated } : t)));
      setEditingTrip(null);
    } catch (err) {
      Alert.alert("수정 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const totalSavedCourses = trips.reduce((sum, t) => sum + t.course_count, 0);

  const StatsHeader = (
    <View style={styles.headerArea}>
      <Text style={styles.eyebrow}>🧳 내 여행</Text>
      <Text style={styles.title}>저장된 경로</Text>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>📍</Text>
          {/* 실제 방문 기록 기능이 없어 표시용 숫자입니다 */}
          <Text style={styles.statValue}>23</Text>
          <Text style={styles.statLabel}>방문한 여행지</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🧳</Text>
          <Text style={styles.statValue}>{totalSavedCourses}</Text>
          <Text style={styles.statLabel}>저장한 경로</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>💬</Text>
          {/* 실제 리뷰 기능이 없어 표시용 숫자입니다 */}
          <Text style={styles.statValue}>18</Text>
          <Text style={styles.statLabel}>리뷰 작성</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>♿</Text>
          {/* 실제 접근성 제보 기능이 없어 표시용 숫자입니다 */}
          <Text style={styles.statValue}>7</Text>
          <Text style={styles.statLabel}>접근성 제보</Text>
        </View>
      </View>

      {trips.length > 0 && <Text style={styles.sectionTitle}>내가 만든 여행</Text>}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D5B" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.trip_id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={StatsHeader}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>아직 저장한 여행이 없어요.</Text>
            <Text style={styles.emptyHint}>AI 플래너에서 코스를 만들고 "💾 저장"을 눌러보세요.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const dateLabel = formatDateRange(item.start_date, item.end_date);
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                router.push({ pathname: "/trip-detail", params: { tripId: item.trip_id, tripName: item.name } })
              }
            >
              <View style={styles.cardHeader}>
                <Text style={styles.categoryBadge}>
                  {CATEGORY_ICON[item.category] ?? "📍"} {item.category}
                </Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity onPress={() => openEdit(item)} hitSlop={10}>
                    <Text style={styles.editText}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(item.trip_id, item.name)} hitSlop={10}>
                    <Text style={styles.deleteText}>삭제</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {dateLabel && <Text style={styles.dateLabel}>📅 {dateLabel}</Text>}
              <Text style={styles.meta}>코스 {item.course_count}개</Text>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={!!editingTrip} animationType="slide" transparent onRequestClose={() => setEditingTrip(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>여행 수정</Text>
              <TouchableOpacity onPress={() => setEditingTrip(null)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>여행 이름</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} />

            <Text style={styles.fieldLabel}>분류</Text>
            <View style={styles.categoryRow}>
              {COURSE_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, editCategory === c && styles.categoryChipSelected]}
                  onPress={() => setEditCategory(c)}
                >
                  <Text style={[styles.categoryChipText, editCategory === c && styles.categoryChipTextSelected]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>여행 날짜 (선택)</Text>
            <TouchableOpacity style={styles.dateButton} onPress={() => setDateModalVisible(true)}>
              <Text style={styles.dateButtonIcon}>📅</Text>
              <Text style={styles.dateButtonText}>
                {editStartDate && editEndDate
                  ? `${editStartDate} ~ ${editEndDate}`
                  : editStartDate
                    ? editStartDate
                    : "날짜 선택하기"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, isSavingEdit && styles.confirmButtonDisabled]}
              onPress={handleSaveEdit}
              disabled={isSavingEdit}
            >
              {isSavingEdit ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>저장하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DateRangePickerModal
        visible={dateModalVisible}
        initialStartDate={editStartDate}
        initialEndDate={editEndDate}
        onClose={() => setDateModalVisible(false)}
        onConfirm={(s, e) => {
          setEditStartDate(s);
          setEditEndDate(e);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { padding: 20, paddingTop: 0, gap: 12 },
  headerArea: { paddingTop: 20, paddingBottom: 4 },
  eyebrow: { fontSize: 13, fontWeight: "700", color: "#2E7D5B", marginBottom: 6 },
  title: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 16 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  statCard: {
    width: "47%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 14,
  },
  statIcon: { fontSize: 20, marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: "800", color: "#2E7D5B" },
  statLabel: { fontSize: 12, color: "#5C5C5C", marginTop: 2 },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },

  emptyBox: { alignItems: "center", padding: 24 },
  emptyText: { fontSize: 15, color: "#5C5C5C", fontWeight: "600", marginBottom: 6 },
  emptyHint: { fontSize: 13, color: "#8A8A8A", textAlign: "center" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 16,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardActions: { flexDirection: "row", gap: 14 },
  categoryBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2E7D5B",
    backgroundColor: "#EAF3EE",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  editText: { fontSize: 13, color: "#2E7D5B", fontWeight: "600" },
  deleteText: { fontSize: 13, color: "#C0392B", fontWeight: "600" },
  name: { fontSize: 17, fontWeight: "700", color: "#1A1A1A", marginBottom: 2 },
  dateLabel: { fontSize: 12, color: "#5C5C5C", marginBottom: 2 },
  meta: { fontSize: 12, color: "#8A8A8A" },

  modalBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#F7F9F8",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A1A" },
  modalClose: { fontSize: 14, color: "#2E7D5B", fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#5C5C5C", marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    borderWidth: 1,
    borderColor: "#E2E8E4",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  categoryChipSelected: { backgroundColor: "#2E7D5B", borderColor: "#2E7D5B" },
  categoryChipText: { fontSize: 13, color: "#5C5C5C", fontWeight: "600" },
  categoryChipTextSelected: { color: "#FFFFFF" },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateButtonIcon: { fontSize: 15 },
  dateButtonText: { fontSize: 14, color: "#1A1A1A", fontWeight: "600" },
  confirmButton: {
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
