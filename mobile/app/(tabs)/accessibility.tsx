import { useRouter } from "expo-router";
import { NotePencilIcon, XIcon, type Icon } from "phosphor-react-native";
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
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { userTypeIcon } from "../../constants/userTypeIcons";
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

const CATEGORY_META: { key: CategoryKey; icon: Icon; label: string; isMock: boolean }[] = [
  { key: "wheelchair_count", icon: userTypeIcon.wheelchair, label: "지체 장애", isMock: false },
  { key: "visual_count", icon: userTypeIcon.visual, label: "시각 장애", isMock: false },
  { key: "hearing_count", icon: userTypeIcon.hearing, label: "청각 장애", isMock: false },
  { key: "senior_count", icon: userTypeIcon.senior, label: "고령자", isMock: false },
  { key: "family_count", icon: userTypeIcon.family, label: "영유아 가족", isMock: false },
  { key: "pregnant_count", icon: userTypeIcon.pregnant, label: "임산부", isMock: false },
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
            const CategoryIcon = c.icon;
            return (
              <Pressable
                key={c.key}
                style={styles.categoryTab}
                onPress={() => {
                  setSelectedCategory(c.key);
                  setVisiblePlacesCount(PLACES_PAGE_SIZE); // 카테고리를 바꾸면 다시 5개부터
                }}
              >
                <CategoryIcon size={24} color={isSelected ? colors.primary : colors.textTertiary} weight="bold" />
                <Text style={[styles.categoryCount, isSelected && styles.categoryCountActive]}>
                  {counts[c.key] ?? "-"}개
                </Text>
                <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelActive]}>{c.label}</Text>
                {c.isMock && <Text style={styles.mockBadge}>참고용</Text>}
                <View style={[styles.categoryDot, isSelected && styles.categoryDotActive]} />
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

        <View style={styles.sectionTitleRow}>
          <selectedMeta.icon size={16} color={colors.text} weight="bold" />
          <Text style={styles.sectionTitle}>{selectedMeta.label} 주요 여행지</Text>
        </View>
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
          <View style={styles.reportTitleRow}>
            <NotePencilIcon size={16} color={colors.text} weight="bold" />
            <Text style={styles.sectionTitle}>{selectedMeta.label} 최근 제보</Text>
          </View>
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
                    <XIcon size={13} color={colors.primary} weight="bold" />
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
                {CATEGORY_META.map((c) => {
                  const ChipIcon = c.icon;
                  const chipSelected = reportCategory === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      style={[styles.reportCategoryChip, chipSelected && styles.reportCategoryChipSelected]}
                      onPress={() => setReportCategory(c.key)}
                    >
                      <ChipIcon size={12} color={chipSelected ? colors.onPrimary : colors.textSecondary} weight="bold" />
                      <Text
                        style={[
                          styles.reportCategoryChipText,
                          chipSelected && styles.reportCategoryChipTextSelected,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
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
  container: { padding: spacing.xl, paddingBottom: spacing.xxl + spacing.sm },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.xl },

  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg, marginBottom: spacing.xl - 4 },
  categoryTab: { width: "33.33%", alignItems: "center", gap: spacing.xs + 2 },
  categoryCount: { fontSize: 13, fontFamily: fontFamily.extraBold, color: colors.textTertiary, fontVariant: ["tabular-nums"] },
  categoryCountActive: { color: colors.primary },
  categoryLabel: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary },
  categoryLabelActive: { color: colors.primary, fontFamily: fontFamily.bold },
  categoryDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent", marginTop: -4 },
  categoryDotActive: { backgroundColor: colors.primary },
  mockBadge: { fontSize: 10, color: colors.warning, fontFamily: fontFamily.semiBold },

  legendRow: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.xl },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary },

  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginBottom: spacing.md },
  reportTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  sectionTitle: { fontSize: 16, fontFamily: fontFamily.extraBold, color: colors.text },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    gap: spacing.md,
  },
  scoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scoreBadgeText: { color: "#FFFFFF", fontFamily: fontFamily.extraBold, fontSize: 14 },
  placeName: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
  placeAddress: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },
  tierBar: { width: 4, height: 32, borderRadius: 2 },
  emptyText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary },
  moreButton: {
    marginTop: spacing.xs,
    paddingVertical: spacing.md + 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  moreButtonText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.primary },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xl - 4 },

  reportHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  reportButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  reportButtonText: { color: colors.onPrimary, fontSize: 13, fontFamily: fontFamily.bold },

  reportCard: {
    paddingVertical: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reportCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs + 2, gap: spacing.sm },
  reportAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryLight },
  reportAvatarPlaceholder: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  reportAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 12, fontFamily: fontFamily.bold },
  reportAuthor: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
  reportPlaceName: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginLeft: spacing.xs, flexShrink: 1 },
  reportBody: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 19 },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  modalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl - 4,
    maxHeight: "85%",
  },
  modalTitle: { fontSize: 18, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.lg },
  fieldLabel: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text, marginTop: spacing.md + 2, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.text,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  selectedPlaceChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    gap: spacing.sm,
  },
  selectedPlaceChipText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.primary },
  searchResultRow: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
  searchResultAddress: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },
  categoryChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reportCategoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
  },
  reportCategoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  reportCategoryChipText: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  reportCategoryChipTextSelected: { color: colors.onPrimary },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm + 2, marginTop: spacing.xl - 4, marginBottom: spacing.sm },
  modalCancelButton: {
    flex: 1,
    paddingVertical: spacing.md + 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  modalCancelButtonText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.textSecondary },
  modalSubmitButton: {
    flex: 1,
    paddingVertical: spacing.md + 1,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  modalSubmitButtonText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.onPrimary },
  buttonDisabled: { opacity: 0.6 },
  });
}
