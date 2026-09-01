import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemeColors } from "../../constants/theme";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import {
  AccessibilityPlaceScore,
  AccessibilityReport,
  AccessibilitySummary,
  AttractionSearchResult,
  ReportCategory,
} from "../../types";

type CategoryKey = "wheelchair_count" | "visual_count" | "hearing_count" | "senior_count" | "family_count" | "pregnant_count";

const CATEGORY_META: { key: CategoryKey; icon: string; label: string; isMock: boolean }[] = [
  { key: "wheelchair_count", icon: "♿", label: "지체 장애", isMock: false },
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

// 통계 필드 키(CategoryKey) ↔ 제보 API가 쓰는 카테고리 코드(ReportCategory) 매핑.
const REPORT_CATEGORY_MAP: Record<CategoryKey, ReportCategory> = {
  wheelchair_count: "wheelchair",
  visual_count: "visual",
  hearing_count: "hearing",
  senior_count: "senior",
  family_count: "family",
  pregnant_count: "pregnant",
};

const PLACES_PAGE_SIZE = 5;

function tierLabel(score: number, colors: ThemeColors): { label: string; color: string } {
  if (score >= 80) return { label: "우수", color: colors.primary };
  if (score >= 60) return { label: "보통", color: colors.warning };
  return { label: "주의", color: colors.danger };
}

/**
 * '접근성' 탭. 휠체어/고령자/시각/청각 개수 모두 실제 편의시설 데이터로 계산됩니다
 * (활용매뉴얼 v4.3 기준 점자블록/오디오가이드/수화안내/자막비디오가이드 등).
 * 카테고리 카드를 누르면 그 유형 기준 주요 여행지 목록으로 바뀝니다.
 */
export default function AccessibilityScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [summary, setSummary] = useState<AccessibilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("wheelchair_count");
  const [visiblePlacesCount, setVisiblePlacesCount] = useState(PLACES_PAGE_SIZE);

  const [reports, setReports] = useState<AccessibilityReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportCategory, setReportCategory] = useState<CategoryKey>("wheelchair_count");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<AttractionSearchResult[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<AttractionSearchResult | null>(null);
  const [reportBody, setReportBody] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    api
      .getAccessibilitySummary("경기도")
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  const loadReports = useCallback((categoryKey: CategoryKey) => {
    setLoadingReports(true);
    api
      .getAccessibilityReports(REPORT_CATEGORY_MAP[categoryKey])
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoadingReports(false));
  }, []);

  useEffect(() => {
    loadReports(selectedCategory);
  }, [selectedCategory, loadReports]);

  // 여행지 이름 검색은 디바운스(입력 멈추고 400ms 뒤에만 호출)해서, 타이핑할
  // 때마다 매번 API를 부르지 않게 합니다 — 이 검색 API도 무장애 정보와 같은
  // 일일 트래픽 한도를 공유해서 아껴 써야 합니다.
  useEffect(() => {
    if (!placeQuery.trim() || placeQuery.trim().length < 2) {
      setPlaceSearchResults([]);
      return;
    }
    setSearchingPlace(true);
    const timer = setTimeout(() => {
      api
        .searchAttractionsByName(placeQuery.trim())
        .then(setPlaceSearchResults)
        .catch(() => setPlaceSearchResults([]))
        .finally(() => setSearchingPlace(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [placeQuery]);

  const openReportModal = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "제보를 남기려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setReportCategory(selectedCategory); // 지금 보고 있는 카테고리를 기본값으로
    setPlaceQuery("");
    setPlaceSearchResults([]);
    setSelectedPlace(null);
    setReportBody("");
    setReportModalVisible(true);
  };

  const handleSubmitReport = async () => {
    if (!selectedPlace) {
      Alert.alert("여행지를 선택해주세요", "이름을 검색해서 목록에서 골라주세요.");
      return;
    }
    if (!reportBody.trim()) {
      Alert.alert("내용을 입력해주세요");
      return;
    }
    setSubmittingReport(true);
    try {
      await api.submitAccessibilityReport({
        contentId: selectedPlace.content_id,
        placeName: selectedPlace.name,
        category: REPORT_CATEGORY_MAP[reportCategory],
        body: reportBody.trim(),
      });
      setReportModalVisible(false);
      Alert.alert("제보가 등록됐어요. 감사합니다!");
      if (reportCategory === selectedCategory) {
        loadReports(selectedCategory);
      }
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmittingReport(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>접근성 정보</Text>
        <Text style={styles.subtitle}>장애 유형별 실시간 접근성 정보를 확인하세요</Text>

        <View style={styles.grid}>
          {CATEGORY_META.map((c) => {
            const isSelected = c.key === selectedCategory;
            return (
              <Pressable
                key={c.key}
                style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
                onPress={() => {
                  setSelectedCategory(c.key);
                  setVisiblePlacesCount(PLACES_PAGE_SIZE); // 카테고리를 바꾸면 다시 5개부터
                }}
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
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>우수 80+</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
            <Text style={styles.legendText}>보통 60-79</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
            <Text style={styles.legendText}>주의 ~59</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>
          {selectedMeta.icon} {selectedMeta.label} 주요 여행지
        </Text>
        {selectedPlaces.length ? (
          selectedPlaces.slice(0, visiblePlacesCount).map((place) => {
            const tier = tierLabel(place.score, colors);
            return (
              <Pressable
                key={place.content_id || place.name}
                style={styles.placeRow}
                onPress={() => {
                  if (!place.content_id) {
                    Alert.alert(
                      "잠시만요",
                      "이 목록은 아직 예전 데이터라 상세 페이지 연결 정보가 없어요. 통계를 새로고침한 뒤 다시 시도해주세요."
                    );
                    return;
                  }
                  router.push({
                    pathname: "/attraction-detail",
                    params: { contentId: place.content_id, name: place.name },
                  });
                }}
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

        {visiblePlacesCount < selectedPlaces.length && (
          <Pressable
            style={styles.moreButton}
            onPress={() => setVisiblePlacesCount((c) => c + PLACES_PAGE_SIZE)}
          >
            <Text style={styles.moreButtonText}>더보기</Text>
          </Pressable>
        )}

        <View style={styles.divider} />

        <View style={styles.reportHeaderRow}>
          <Text style={styles.sectionTitle}>📝 {selectedMeta.label} 최근 제보</Text>
          <Pressable style={styles.reportButton} onPress={openReportModal}>
            <Text style={styles.reportButtonText}>제보하기</Text>
          </Pressable>
        </View>

        {loadingReports ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
        ) : reports.length === 0 ? (
          <Text style={styles.emptyText}>아직 {selectedMeta.label} 관련 제보가 없어요. 첫 제보를 남겨보세요!</Text>
        ) : (
          reports.map((r) => (
            <View key={r.id} style={styles.reportCard}>
              <View style={styles.reportCardHeader}>
                {r.avatar_url ? (
                  <Image source={{ uri: r.avatar_url }} style={styles.reportAvatar} />
                ) : (
                  <View style={styles.reportAvatarPlaceholder}>
                    <Text style={styles.reportAvatarPlaceholderText}>
                      {r.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.reportAuthor}>{r.username}</Text>
                <Text style={styles.reportPlaceName} numberOfLines={1}>
                  · {r.place_name}
                </Text>
              </View>
              <Text style={styles.reportBody}>{r.body}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        visible={reportModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>접근성 제보하기</Text>

              <Text style={styles.fieldLabel}>어떤 여행지인가요?</Text>
              {selectedPlace ? (
                <View style={styles.selectedPlaceChip}>
                  <Text style={styles.selectedPlaceChipText}>{selectedPlace.name}</Text>
                  <Pressable onPress={() => setSelectedPlace(null)}>
                    <Text style={styles.selectedPlaceChipRemove}>✕</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="여행지 이름을 검색해주세요"
                    placeholderTextColor={colors.textTertiary}
                    value={placeQuery}
                    onChangeText={setPlaceQuery}
                  />
                  {searchingPlace && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 6 }} />}
                  {placeSearchResults.map((p) => (
                    <Pressable
                      key={p.content_id}
                      style={styles.searchResultRow}
                      onPress={() => {
                        setSelectedPlace(p);
                        setPlaceSearchResults([]);
                      }}
                    >
                      <Text style={styles.searchResultName}>{p.name}</Text>
                      <Text style={styles.searchResultAddress} numberOfLines={1}>
                        {p.address}
                      </Text>
                    </Pressable>
                  ))}
                </>
              )}

              <Text style={styles.fieldLabel}>어떤 유형인가요?</Text>
              <View style={styles.categoryChipsRow}>
                {CATEGORY_META.map((c) => (
                  <Pressable
                    key={c.key}
                    style={[styles.reportCategoryChip, reportCategory === c.key && styles.reportCategoryChipSelected]}
                    onPress={() => setReportCategory(c.key)}
                  >
                    <Text
                      style={[
                        styles.reportCategoryChipText,
                        reportCategory === c.key && styles.reportCategoryChipTextSelected,
                      ]}
                    >
                      {c.icon} {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>어떤 점이 있었나요?</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="예) 정문에 경사로가 새로 생겼어요 / 화장실 입구가 좁아 휠체어 진입이 어려워요"
                placeholderTextColor={colors.textTertiary}
                value={reportBody}
                onChangeText={setReportBody}
                multiline
              />

              <View style={styles.modalButtonRow}>
                <Pressable style={styles.modalCancelButton} onPress={() => setReportModalVisible(false)}>
                  <Text style={styles.modalCancelButtonText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSubmitButton, submittingReport && styles.buttonDisabled]}
                  onPress={handleSubmitReport}
                  disabled={submittingReport}
                >
                  {submittingReport ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.modalSubmitButtonText}>제출하기</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  categoryCard: {
    width: "47%",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryLight,
  },
  categoryIcon: { fontSize: 22, marginBottom: 6 },
  categoryCount: { fontSize: 16, fontWeight: "800", color: colors.text },
  categoryLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  mockBadge: { fontSize: 10, color: colors.warning, marginTop: 6, fontWeight: "600" },

  legendRow: { flexDirection: "row", gap: 16, marginBottom: 24 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textSecondary },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 12 },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  scoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scoreBadgeText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  placeName: { fontSize: 15, fontWeight: "700", color: colors.text },
  placeAddress: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  tierBar: { width: 4, height: 32, borderRadius: 2 },
  emptyText: { fontSize: 13, color: colors.textTertiary },
  moreButton: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  moreButtonText: { fontSize: 14, fontWeight: "700", color: colors.primary },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },

  reportHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  reportButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  reportButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },

  reportCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  reportCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 8 },
  reportAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryLight },
  reportAvatarPlaceholder: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  reportAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  reportAuthor: { fontSize: 13, fontWeight: "700", color: colors.text },
  reportPlaceName: { fontSize: 12, color: colors.textTertiary, marginLeft: 4, flexShrink: 1 },
  reportBody: { fontSize: 13, color: colors.text, lineHeight: 19 },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "85%",
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: colors.text, marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  selectedPlaceChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    gap: 8,
  },
  selectedPlaceChipText: { fontSize: 13, fontWeight: "700", color: colors.primary },
  selectedPlaceChipRemove: { fontSize: 13, color: colors.primary, fontWeight: "700" },
  searchResultRow: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultName: { fontSize: 14, fontWeight: "700", color: colors.text },
  searchResultAddress: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  categoryChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reportCategoryChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  reportCategoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  reportCategoryChipText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  reportCategoryChipTextSelected: { color: colors.onPrimary },
  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 8 },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  modalCancelButtonText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  modalSubmitButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  modalSubmitButtonText: { fontSize: 14, fontWeight: "700", color: colors.onPrimary },
  buttonDisabled: { opacity: 0.6 },
  });
}
