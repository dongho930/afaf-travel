import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import { api } from "../services/api";
import { useTheme } from "../services/ThemeContext";
import { ThemeColors } from "../constants/theme";
import { COURSE_CATEGORIES, CourseCategory, TripSummary } from "../types";
import { DateRangePickerModal } from "./DateRangePickerModal";

export type SaveCourseParams =
  | { tripId: string; newTripName?: never }
  | {
      tripId?: never;
      newTripName: string;
      category: CourseCategory;
      startDate?: string | null;
      endDate?: string | null;
    };

interface Props {
  visible: boolean;
  onClose: () => void;
  defaultNewTripName?: string;
  // 실제 저장 처리는 호출한 화면이 맡습니다 — AI플래너 결과 화면은 이미 있는
  // course_id로 바로 api.saveCourse()를 부르고, 관광지 상세 페이지는 먼저
  // 1개짜리 코스를 만든 뒤 그 course_id로 api.saveCourse()를 부릅니다.
  onConfirm: (params: SaveCourseParams) => Promise<void>;
}

/**
 * '저장하기' 모달 — 기존 여행에 추가하거나 새 여행을 만들면서 저장합니다.
 * AI플래너 결과 화면과 관광지 상세 페이지의 '저장' 버튼이 공용으로 씁니다.
 */
export function SaveCourseModal({ visible, onClose, defaultNewTripName, onConfirm }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [newTripName, setNewTripName] = useState("");
  const [newTripCategory, setNewTripCategory] = useState<CourseCategory>("가족");
  const [customCategoryText, setCustomCategoryText] = useState("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 모달이 새로 열릴 때마다 여행 목록을 다시 불러오고 폼을 초기화합니다.
  React.useEffect(() => {
    if (!visible) return;
    setSelectedTripId(null);
    setNewTripName(defaultNewTripName ?? "");
    setNewTripCategory("가족");
    setCustomCategoryText("");
    setStartDate(null);
    setEndDate(null);
    setMode("pick");
    setLoadingTrips(true);
    api
      .listTrips()
      .then((list) => {
        setTrips(list);
        if (list.length === 0) setMode("create");
      })
      .catch(() => Alert.alert("여행 목록을 불러오지 못했어요", "잠시 후 다시 시도해주세요."))
      .finally(() => setLoadingTrips(false));
  }, [visible, defaultNewTripName]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (mode === "pick") {
        if (!selectedTripId) {
          Alert.alert("여행을 선택해주세요", "저장할 여행을 목록에서 골라주세요.");
          return;
        }
        await onConfirm({ tripId: selectedTripId });
      } else {
        if (!newTripName.trim()) {
          Alert.alert("이름을 입력해주세요", "새로 만들 여행 이름을 지정해주세요.");
          return;
        }
        if (newTripCategory === "기타" && !customCategoryText.trim()) {
          Alert.alert("분류를 입력해주세요", "'기타'를 선택하셨으면 원하는 분류를 직접 입력해주세요.");
          return;
        }
        const finalCategory =
          newTripCategory === "기타" && customCategoryText.trim() ? customCategoryText.trim() : newTripCategory;
        await onConfirm({
          newTripName: newTripName.trim(),
          category: finalCategory,
          startDate,
          endDate,
        });
      }
      onClose();
      Alert.alert("저장 완료", "'내 여행' 탭 '저장한 경로'에서 다시 확인할 수 있어요.");
    } catch (err) {
      Alert.alert("저장 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>코스 저장하기</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
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
                <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
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
                  placeholderTextColor={colors.textTertiary}
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
                {newTripCategory === "기타" && (
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="분류를 직접 입력해주세요 (예: 등산, 반려동물 동반)"
                    placeholderTextColor={colors.textTertiary}
                    value={customCategoryText}
                    onChangeText={setCustomCategoryText}
                    maxLength={20}
                  />
                )}

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
                <ActivityIndicator color={colors.onPrimary} />
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
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surfaceAlt,
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
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontWeight: "600" },

  modeTabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  modeTab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  modeTabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeTabText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  modeTabTextSelected: { color: colors.onPrimary },

  tripOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  tripOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tripOptionName: { fontSize: 15, fontWeight: "700", color: colors.text },
  tripOptionMeta: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  tripOptionCheck: { fontSize: 16, color: colors.primary, fontWeight: "800" },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: colors.textSecondary, marginBottom: 8, marginTop: 8 },
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
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateButtonIcon: { fontSize: 15 },
  dateButtonText: { fontSize: 14, color: colors.text, fontWeight: "600" },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  categoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  categoryChipTextSelected: { color: colors.onPrimary },
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
