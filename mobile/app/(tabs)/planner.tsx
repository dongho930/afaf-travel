import { useRouter } from "expo-router";
import { CheckIcon, MapPinIcon, MicrophoneIcon, SparkleIcon, type Icon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
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
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { userTypeIcon } from "../../constants/userTypeIcons";
import { api } from "../../services/api";
import { useCourseContext } from "../../services/CourseContext";
import { storage } from "../../services/storage";
import { useTheme } from "../../services/ThemeContext";
import { RegionOption, UserType, USER_TYPE_LABELS } from "../../types";

const OPTIONS: { type: UserType; icon: Icon; desc: string }[] = [
  { type: "wheelchair", icon: userTypeIcon.wheelchair, desc: "경사로·엘리베이터 등 이동 편의시설 우선" },
  { type: "stroller", icon: userTypeIcon.stroller, desc: "유모차로 이동 가능한 평탄한 동선 우선" },
  { type: "senior", icon: userTypeIcon.senior, desc: "휴게 공간이 충분한 여유로운 코스" },
  { type: "pregnant", icon: userTypeIcon.pregnant, desc: "무리 없는 동선과 휴식 공간 우선" },
  { type: "visual", icon: userTypeIcon.visual, desc: "점자블록·오디오가이드 등 시각 안내시설 우선" },
  { type: "hearing", icon: userTypeIcon.hearing, desc: "수화안내·자막가이드 등 청각 안내시설 우선" },
  { type: "general", icon: userTypeIcon.general, desc: "접근성 조건 없이 일반적인 코스 추천" },
];

// 이용자 유형마다 실제로 마주하는 이동 제약이 다르므로, 입력 예시도 유형에 맞게 다르게 보여줍니다.
const EXAMPLE_QUERY_BY_TYPE: Record<UserType, string> = {
  wheelchair: "지체 장애인도 갈 수 있는 경사 없는 산책로와 맛집 추천해줘",
  stroller: "유모차 밀고 다니기 편한 평지 산책로와 아이랑 갈 만한 맛집 추천해줘",
  senior: "많이 걷지 않아도 되고 중간중간 쉴 곳 많은 코스와 맛집 추천해줘",
  pregnant: "화장실 가깝고 오래 걷지 않아도 되는 편안한 코스와 맛집 추천해줘",
  visual: "점자블록이나 음성 안내가 있는 곳 위주로 코스와 맛집 추천해줘",
  hearing: "수화 안내나 자막 가이드가 있는 곳 위주로 코스와 맛집 추천해줘",
  general: "가족과 함께 가기 좋은 산책로와 맛집 추천해줘",
};

let VoiceInputButton: typeof import("../../components/VoiceInputButton").VoiceInputButton | null = null;
try {
  VoiceInputButton = require("../../components/VoiceInputButton").VoiceInputButton;
} catch {
  VoiceInputButton = null;
}

/**
 * 예전에 있던 '유형 선택' 화면(index.tsx)과 '여행 요청하기' 화면(input.tsx)을
 * 하나로 합친 AI 플래너 탭입니다. 유형을 고르고 지역/문구를 입력해서 바로
 * 장소 추천을 받습니다.
 */
export default function PlannerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { userType, setUserType, sigunguCd, sigunguName, setRegion, setRecommendations, setPendingQueryText, pendingQueryText } =
    useCourseContext();
  const [queryText, setQueryText] = useState(pendingQueryText || "");
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const exampleQuery = EXAMPLE_QUERY_BY_TYPE[userType];

  const selectedOption = OPTIONS.find((o) => o.type === userType);

  const [regionModalVisible, setRegionModalVisible] = useState(false);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [regionLoading, setRegionLoading] = useState(false);
  const [regionSearch, setRegionSearch] = useState("");

  useEffect(() => {
    storage.loadUserType().then((saved) => {
      if (saved) setUserType(saved);
    });
  }, []);

  useEffect(() => {
    // 홈 탭 검색창에서 넘어온 문구가 있으면 반영
    if (pendingQueryText) setQueryText(pendingQueryText);
  }, [pendingQueryText]);

  useEffect(() => {
    if (regionModalVisible && regionOptions.length === 0 && !regionLoading) {
      setRegionLoading(true);
      api
        .listRegions("경기도")
        .then(setRegionOptions)
        .catch(() => Alert.alert("지역 목록을 불러오지 못했어요", "잠시 후 다시 시도해주세요."))
        .finally(() => setRegionLoading(false));
    }
  }, [regionModalVisible]);

  const filteredRegions = regionSearch.trim()
    ? regionOptions.filter((r) => r.name.includes(regionSearch.trim()))
    : regionOptions;

  const handleSelectType = async (type: UserType) => {
    setUserType(type);
    await storage.saveUserType(type);
  };

  const handleSubmit = async () => {
    if (!queryText.trim()) {
      Alert.alert("입력이 필요해요", "원하시는 여행 코스를 텍스트나 음성으로 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { candidates } = await api.recommendPlaces({ queryText, userType, sigunguCd });
      if (candidates.length === 0) {
        Alert.alert("추천 결과 없음", "조건에 맞는 장소를 찾지 못했어요. 다른 표현으로 다시 시도해주세요.");
        return;
      }
      setRecommendations(candidates);
      setPendingQueryText(queryText);
      router.push("/select");
    } catch (err) {
      Alert.alert("장소 추천 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 (홈 화면과 동일한 방식).
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <FlatList
        data={[1]}
        keyExtractor={() => "content"}
        contentContainerStyle={styles.container}
        renderItem={() => (
          <>
            <Text style={styles.title}>AI 경로 플래너</Text>
            <Text style={styles.subtitle}>접근성 유형을 선택하고 조건을 입력하면 AI가 최적의 무장애 동선을 제안합니다</Text>

            <Text style={styles.fieldLabel}>접근성 유형</Text>
            <View style={styles.typeGrid}>
              {OPTIONS.map((opt) => {
                const TypeIcon = opt.icon;
                const isSelected = userType === opt.type;
                return (
                  <Pressable
                    key={opt.type}
                    style={styles.typeTab}
                    onPress={() => handleSelectType(opt.type)}
                    accessibilityRole="button"
                    accessibilityLabel={`${USER_TYPE_LABELS[opt.type]}, ${opt.desc}`}
                  >
                    <TypeIcon size={24} color={isSelected ? colors.primary : colors.textTertiary} weight="bold" />
                    <Text style={[styles.typeLabel, isSelected && styles.typeLabelActive]}>
                      {USER_TYPE_LABELS[opt.type]}
                    </Text>
                    <View style={[styles.typeDot, isSelected && styles.typeDotActive]} />
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>지역</Text>
            <TouchableOpacity style={styles.regionButton} onPress={() => setRegionModalVisible(true)}>
              <MapPinIcon size={15} color={colors.text} weight="bold" />
              <Text style={styles.regionButtonText}>{sigunguName ?? "경기도 전체"}</Text>
              <Text style={styles.regionButtonChevron}>변경</Text>
            </TouchableOpacity>

            {selectedOption && (
              <View style={styles.typeDescRow}>
                <selectedOption.icon size={14} color={colors.primary} weight="bold" />
                <Text style={styles.typeDescText}>{selectedOption.desc}</Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>어떤 여행을 원하세요?</Text>
            <Text style={styles.hint}>예: "{exampleQuery}"</Text>
            <TextInput
              style={styles.input}
              multiline
              placeholder="여기에 입력하거나 마이크 버튼을 눌러 말씀해주세요"
              placeholderTextColor={colors.textTertiary}
              value={queryText}
              onChangeText={setQueryText}
              accessibilityLabel="여행 요청 입력창"
            />

            {VoiceInputButton ? (
              <VoiceInputButton isListening={isListening} onListeningChange={setIsListening} onResult={setQueryText} />
            ) : (
              <View style={styles.voiceNoticeRow}>
                <MicrophoneIcon size={14} color={colors.textTertiary} weight="bold" />
                <Text style={styles.voiceNotice}>
                  음성 입력은 iOS/Android 개발 빌드(dev client)에서 활성화됩니다. 지금은 텍스트로 입력해주세요.
                </Text>
              </View>
            )}

            <Pressable
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="AI 경로 생성하기"
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <View style={styles.submitContentRow}>
                  <SparkleIcon size={16} color={colors.onPrimary} weight="fill" />
                  <Text style={styles.submitText}>AI 경로 생성하기</Text>
                </View>
              )}
            </Pressable>
          </>
        )}
      />

      <Modal visible={regionModalVisible} animationType="slide" transparent onRequestClose={() => setRegionModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>지역 선택</Text>
              <TouchableOpacity onPress={() => setRegionModalVisible(false)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.searchInput}
              placeholder="시/군/구 검색 (예: 수원, 분당)"
              placeholderTextColor={colors.textTertiary}
              value={regionSearch}
              onChangeText={setRegionSearch}
            />

            <TouchableOpacity
              style={styles.regionOption}
              onPress={() => {
                setRegion(null, null);
                setRegionModalVisible(false);
              }}
            >
              <Text style={styles.regionOptionText}>경기도 전체</Text>
              {sigunguCd === null && <CheckIcon size={15} color={colors.primary} weight="bold" />}
            </TouchableOpacity>

            {regionLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
            ) : (
              <FlatList
                data={filteredRegions}
                keyExtractor={(item) => String(item.code)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.regionOption}
                    onPress={() => {
                      setRegion(item.code, item.name);
                      setRegionModalVisible(false);
                    }}
                  >
                    <Text style={styles.regionOptionText}>{item.name}</Text>
                    {sigunguCd === item.code && <CheckIcon size={15} color={colors.primary} weight="bold" />}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.regionEmpty}>검색 결과가 없어요.</Text>}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { padding: spacing.xl, paddingBottom: spacing.xxl + spacing.xl + 4 },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.xl },
  fieldLabel: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.sm + 2, marginTop: spacing.xs },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg, marginBottom: spacing.lg },
  typeTab: { width: "25%", alignItems: "center", gap: spacing.xs + 2 },
  typeLabel: { fontSize: 11.5, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center" },
  typeLabelActive: { color: colors.primary, fontFamily: fontFamily.bold },
  typeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent", marginTop: -4 },
  typeDotActive: { backgroundColor: colors.primary },

  regionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  regionButtonText: { flex: 1, fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
  regionButtonChevron: { fontSize: 13, color: colors.primary, fontFamily: fontFamily.semiBold },
  typeDescRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginBottom: spacing.xl - 4,
  },
  typeDescText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },

  hint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.md },
  input: {
    minHeight: 110,
    backgroundColor: colors.surface,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: 16,
    fontFamily: fontFamily.regular,
    color: colors.text,
    textAlignVertical: "top",
  },
  voiceNoticeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginTop: spacing.lg, justifyContent: "center" },
  voiceNotice: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center", lineHeight: 18, flexShrink: 1 },
  submitButton: {
    marginTop: spacing.xl - 4,
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitContentRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  submitText: { color: colors.onPrimary, fontSize: 16, fontFamily: fontFamily.bold },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  modalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "80%",
    minHeight: "50%",
    padding: spacing.lg,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontFamily: fontFamily.semiBold },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  regionOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  regionOptionText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.text },
  regionEmpty: { textAlign: "center", color: colors.textTertiary, marginTop: spacing.xl - 4, fontSize: 13, fontFamily: fontFamily.regular },
  });
}
