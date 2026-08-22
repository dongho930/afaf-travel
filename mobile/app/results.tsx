import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AttractionCard } from "../components/AttractionCard";
import { DateRangePickerModal } from "../components/DateRangePickerModal";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { COURSE_CATEGORIES, CourseCategory, TripSummary } from "../types";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse } = useCourseContext();
  const { session } = useAuth();
  const [offlineNotice, setOfflineNotice] = useState(false);

  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [newTripName, setNewTripName] = useState("");
  const [newTripCategory, setNewTripCategory] = useState<CourseCategory>("가족");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    setSelectedTripId(null);
    setNewTripName(course?.title ?? "");
    setNewTripCategory("가족");
    setStartDate(null);
    setEndDate(null);
    setMode("pick");
    setSaveModalVisible(true);
    setLoadingTrips(true);
    api
      .listTrips()
      .then((list) => {
        setTrips(list);
        // 저장된 여행이 하나도 없으면 바로 '새 여행 만들기' 모드로
        if (list.length === 0) setMode("create");
      })
      .catch(() => Alert.alert("여행 목록을 불러오지 못했어요", "잠시 후 다시 시도해주세요."))
      .finally(() => setLoadingTrips(false));
  };

  const handleSave = async () => {
    if (!course) return;
    setIsSaving(true);
    try {
      if (mode === "pick") {
        if (!selectedTripId) {
          Alert.alert("여행을 선택해주세요", "저장할 여행을 목록에서 골라주세요.");
          setIsSaving(false);
          return;
        }
        await api.saveCourse(course.course_id, { tripId: selectedTripId });
      } else {
        if (!newTripName.trim()) {
          Alert.alert("이름을 입력해주세요", "새로 만들 여행 이름을 지정해주세요.");
          setIsSaving(false);
          return;
        }
        await api.saveCourse(course.course_id, {
          newTripName: newTripName.trim(),
          category: newTripCategory,
          startDate,
          endDate,
        });
      }
      setSaveModalVisible(false);
      Alert.alert("저장 완료", "마이페이지 '내 코스'에서 다시 확인할 수 있어요.");
    } catch (err) {
      Alert.alert("저장 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!course) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>아직 생성된 코스가 없어요.</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
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
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{course.title}</Text>
          <Text style={styles.summary}>{course.summary}</Text>
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={openSaveModal}>
          <Text style={styles.saveButtonText}>💾 저장</Text>
        </TouchableOpacity>
      </View>

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

      <Modal
        visible={saveModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>코스 저장하기</Text>
              <TouchableOpacity onPress={() => setSaveModalVisible(false)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>

            {trips.length > 0 && (
              <View style={styles.modeTabRow}>
                <TouchableOpacity
                  style={[styles.modeTab, mode === "pick" && styles.modeTabSelected]}
                  onPress={() => setMode("pick")}
                >
                  <Text style={[styles.modeTabText, mode === "pick" && styles.modeTabTextSelected]}>
                    기존 여행에 추가
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeTab, mode === "create" && styles.modeTabSelected]}
                  onPress={() => setMode("create")}
                >
                  <Text style={[styles.modeTabText, mode === "create" && styles.modeTabTextSelected]}>
                    새 여행 만들기
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {mode === "pick" ? (
              loadingTrips ? (
                <ActivityIndicator style={{ marginVertical: 24 }} color="#2E7D5B" />
              ) : (
                <FlatList
                  data={trips}
                  keyExtractor={(t) => t.trip_id}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.tripOption, selectedTripId === item.trip_id && styles.tripOptionSelected]}
                      onPress={() => setSelectedTripId(item.trip_id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tripOptionName}>{item.name}</Text>
                        <Text style={styles.tripOptionMeta}>
                          {item.category} · 코스 {item.course_count}개
                        </Text>
                      </View>
                      {selectedTripId === item.trip_id && <Text style={styles.tripOptionCheck}>✓</Text>}
                    </TouchableOpacity>
                  )}
                />
              )
            ) : (
              <>
                <Text style={styles.fieldLabel}>여행 이름</Text>
                <TextInput
                  style={styles.input}
                  placeholder="예: 제주도 가족여행"
                  value={newTripName}
                  onChangeText={setNewTripName}
                />

                <Text style={styles.fieldLabel}>분류</Text>
                <View style={styles.categoryRow}>
                  {COURSE_CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.categoryChip, newTripCategory === c && styles.categoryChipSelected]}
                      onPress={() => setNewTripCategory(c)}
                    >
                      <Text
                        style={[
                          styles.categoryChipText,
                          newTripCategory === c && styles.categoryChipTextSelected,
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>여행 날짜 (선택)</Text>
                <TouchableOpacity style={styles.dateButton} onPress={() => setDateModalVisible(true)}>
                  <Text style={styles.dateButtonIcon}>📅</Text>
                  <Text style={styles.dateButtonText}>
                    {startDate && endDate
                      ? `${startDate} ~ ${endDate}`
                      : startDate
                        ? startDate
                        : "날짜 선택하기"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Pressable
              style={[styles.confirmButton, isSaving && styles.confirmButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>저장하기</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <DateRangePickerModal
        visible={dateModalVisible}
        initialStartDate={startDate}
        initialEndDate={endDate}
        onClose={() => setDateModalVisible(false)}
        onConfirm={(s, e) => {
          setStartDate(s);
          setEndDate(e);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16, gap: 10 },
  title: { fontSize: 21, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  summary: { fontSize: 14, color: "#5C5C5C" },
  saveButton: {
    backgroundColor: "#EAF3EE",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveButtonText: { color: "#2E7D5B", fontWeight: "700", fontSize: 13 },
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

  modalBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#F7F9F8",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A1A" },
  modalClose: { fontSize: 14, color: "#2E7D5B", fontWeight: "600" },

  modeTabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  modeTab: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  modeTabSelected: { backgroundColor: "#2E7D5B", borderColor: "#2E7D5B" },
  modeTabText: { fontSize: 13, fontWeight: "700", color: "#5C5C5C" },
  modeTabTextSelected: { color: "#FFFFFF" },

  tripOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8E4",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  tripOptionSelected: { borderColor: "#2E7D5B", backgroundColor: "#EAF3EE" },
  tripOptionName: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
  tripOptionMeta: { fontSize: 12, color: "#8A8A8A", marginTop: 2 },
  tripOptionCheck: { fontSize: 16, color: "#2E7D5B", fontWeight: "800" },

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
