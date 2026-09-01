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
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemeColors } from "../../constants/theme";
import { api } from "../../services/api";
import { useCourseContext } from "../../services/CourseContext";
import { storage } from "../../services/storage";
import { useTheme } from "../../services/ThemeContext";
import { RegionOption, UserType, USER_TYPE_LABELS } from "../../types";

const OPTIONS: { type: UserType; emoji: string; desc: string }[] = [
  { type: "wheelchair", emoji: "♿", desc: "경사로·엘리베이터 등 이동 편의시설 우선" },
  { type: "stroller", emoji: "🧸", desc: "유모차로 이동 가능한 평탄한 동선 우선" },
  { type: "senior", emoji: "🧓", desc: "휴게 공간이 충분한 여유로운 코스" },
  { type: "pregnant", emoji: "🤰", desc: "무리 없는 동선과 휴식 공간 우선" },
  { type: "visual", emoji: "👁️", desc: "점자블록·오디오가이드 등 시각 안내시설 우선" },
  { type: "hearing", emoji: "💡", desc: "수화안내·자막가이드 등 청각 안내시설 우선" },
  { type: "general", emoji: "🙂", desc: "접근성 조건 없이 일반적인 코스 추천" },
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
              {OPTIONS.map((opt) => (
                <Pressable
                  key={opt.type}
                  style={({ pressed }) => [
                    styles.typeCard,
                    (userType === opt.type || pressed) && styles.typeCardSelected,
                  ]}
                  onPress={() => handleSelectType(opt.type)}
                  accessibilityRole="button"
                  accessibilityLabel={`${USER_TYPE_LABELS[opt.type]}, ${opt.desc}`}
                >
                  <Text style={styles.typeEmoji}>{opt.emoji}</Text>
                  <Text style={styles.typeTitle}>{USER_TYPE_LABELS[opt.type]}</Text>
                  <Text style={styles.typeDesc}>{opt.desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>지역</Text>
            <TouchableOpacity style={styles.regionButton} onPress={() => setRegionModalVisible(true)}>
              <Text style={styles.regionButtonIcon}>📍</Text>
              <Text style={styles.regionButtonText}>{sigunguName ?? "경기도 전체"}</Text>
              <Text style={styles.regionButtonChevron}>변경</Text>
            </TouchableOpacity>

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
              <Text style={styles.voiceNotice}>
                🎙️ 음성 입력은 iOS/Android 개발 빌드(dev client)에서 활성화됩니다. 지금은 텍스트로 입력해주세요.
              </Text>
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
                <Text style={styles.submitText}>✦ AI 경로 생성하기</Text>
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
              {sigunguCd === null && <Text style={styles.regionOptionCheck}>✓</Text>}
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
                    {sigunguCd === item.code && <Text style={styles.regionOptionCheck}>✓</Text>}
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
  container: { padding: 24, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20 },
  fieldLabel: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 10, marginTop: 4 },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  typeCard: {
    width: "48%",
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeCardSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeEmoji: { fontSize: 20, marginBottom: 4 },
  typeTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  typeDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  regionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 20,
    gap: 8,
  },
  regionButtonIcon: { fontSize: 15 },
  regionButtonText: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  regionButtonChevron: { fontSize: 13, color: colors.primary, fontWeight: "600" },

  hint: { fontSize: 13, color: colors.textTertiary, marginBottom: 12 },
  input: {
    minHeight: 110,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: "top",
  },
  voiceNotice: { fontSize: 13, color: colors.textTertiary, marginTop: 16, textAlign: "center", lineHeight: 18 },
  submitButton: {
    marginTop: 24,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    minHeight: "50%",
    padding: 16,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    marginBottom: 8,
  },
  regionOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  regionOptionText: { fontSize: 15, color: colors.text },
  regionOptionCheck: { fontSize: 15, color: colors.primary, fontWeight: "800" },
  regionEmpty: { textAlign: "center", color: colors.textTertiary, marginTop: 24, fontSize: 13 },
  });
}
