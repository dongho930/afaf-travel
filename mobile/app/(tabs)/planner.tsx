import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarBlankIcon,
  CheckIcon,
  MapPinIcon,
  MicrophoneIcon,
  SparkleIcon,
  XCircleIcon,
  type Icon,
} from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { DateRangePickerModal } from "../../components/DateRangePickerModal";
import { FadeInView } from "../../components/FadeInView";
import { SelectableArea } from "../../components/SelectableArea";
import { ProfileButton } from "../../components/ProfileButton";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { userTypeIcon } from "../../constants/userTypeIcons";
import { detectUserTypeFromText } from "../../constants/userTypeKeywords";
import { api, errorMessage } from "../../services/api";
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

// 접근성 유형 탭 하나. 선택 상태가 바뀔 때 라벨 글자색과 아래 점(dot)이
// 즉시 뚝 바뀌지 않고 짧게(200ms) 보간되도록 각 탭이 자기만의 progress 값을
// 갖습니다(아이콘 자체 색은 phosphor 아이콘이 Animated 색 보간을 지원하지
// 않아 그대로 즉시 전환 — 다른 탭 화면과 동일한 처리 방식).
function TypeTabButton({
  option,
  isSelected,
  onPress,
  styles,
  colors,
}: {
  option: (typeof OPTIONS)[number];
  isSelected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const progress = useRef(new Animated.Value(isSelected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: isSelected ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [isSelected, progress]);

  const textColor = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.textTertiary, colors.primary] });
  const TypeIcon = option.icon;

  return (
    <Pressable
      style={({ pressed }) => [styles.typeTab, pressed && styles.pressedFeedback]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${USER_TYPE_LABELS[option.type]}, ${option.desc}`}
    >
      <TypeIcon size={24} color={isSelected ? colors.primary : colors.textTertiary} weight="bold" />
      <Animated.Text
        style={[styles.typeLabel, { color: textColor, fontFamily: isSelected ? fontFamily.bold : fontFamily.regular }]}
      >
        {USER_TYPE_LABELS[option.type]}
      </Animated.Text>
      <Animated.View style={[styles.typeDot, { backgroundColor: colors.primary, opacity: progress }]} />
    </Pressable>
  );
}

/**
 * 예전에 있던 '유형 선택' 화면(index.tsx)과 '여행 요청하기' 화면(input.tsx)을
 * 하나로 합친 AI 플래너 탭입니다. 유형을 고르고 지역/문구를 입력해서 바로
 * 장소 추천을 받습니다.
 */
export default function PlannerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const {
    userType,
    setUserType,
    sigunguCd,
    sigunguName,
    setRegion,
    setRecommendations,
    setPendingQueryText,
    pendingQueryText,
    queryHandoffSeq,
    setParsedQuery,
    visitDate,
    setVisitDate,
  } = useCourseContext();
  const [queryText, setQueryText] = useState(pendingQueryText || "");
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const exampleQuery = EXAMPLE_QUERY_BY_TYPE[userType];

  const selectedOption = OPTIONS.find((o) => o.type === userType);

  const [regionModalVisible, setRegionModalVisible] = useState(false);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [regionLoading, setRegionLoading] = useState(false);
  const [regionSearch, setRegionSearch] = useState("");

  useEffect(() => {
    storage.loadUserType().then((saved) => {
      if (saved) setUserType(saved);
    });
  }, []);

  useEffect(() => {
    // 홈 탭 검색창에서 넘어온 문구를 반영합니다. 값이 아니라 넘긴 횟수를 보기
    // 때문에, 지난번과 똑같은 문구를 다시 넘겨도 빠짐없이 한 번씩 반영됩니다.
    if (queryHandoffSeq === 0) return;
    setQueryText(pendingQueryText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryHandoffSeq]);

  // 이 탭은 다른 탭에 갔다 와도 화면이 살아있어서 쓰던 글이 그대로 남습니다.
  // 잠깐 다른 탭을 둘러보고 온 경우에는 그게 맞지만, 추천까지 받고 결과를 보다
  // 돌아온 경우에는 이미 처리된 문장이 남아 새 요청에 방해가 됐습니다. 그래서
  // '추천을 받으러 떠났다'는 표시를 남겨뒀다가, 이 탭이 다시 보일 때만 비웁니다.
  const submittedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!submittedRef.current) return;
      submittedRef.current = false;
      setQueryText("");
    }, [])
  );

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

  const handleSubmit = () => {
    if (!queryText.trim()) {
      Alert.alert("입력이 필요해요", "원하시는 여행 코스를 텍스트나 음성으로 입력해주세요.");
      return;
    }

    // 위에서 고른 유형은 후보를 통째로 걸러냅니다. 그래서 청각 장애인을 고른 채
    // "지체 장애인도 갈 수 있는 곳"을 물으면 문장과 상관없이 청각 편의시설이 있는
    // 곳만 나왔습니다. 문장에 다른 유형 이야기가 있으면 어느 기준으로 찾을지
    // 먼저 여쭙고, 고르신 쪽으로 진행합니다.
    const mentioned = detectUserTypeFromText(queryText);
    if (mentioned && mentioned !== userType) {
      Alert.alert(
        "어느 기준으로 찾을까요?",
        `요청에 '${USER_TYPE_LABELS[mentioned]}' 이야기가 있는데, 지금 고른 유형은 '${USER_TYPE_LABELS[userType]}'이에요. 고른 유형에 맞는 장소만 추천해드려요.`,
        [
          {
            text: `${USER_TYPE_LABELS[userType]} 그대로`,
            style: "cancel",
            onPress: () => runRecommend(userType),
          },
          {
            text: `${USER_TYPE_LABELS[mentioned]} 기준으로`,
            onPress: () => {
              // 위 유형 선택도 함께 바꿔둡니다 — 2단계(코스 생성)와 결과 화면이
              // 같은 유형을 쓰고, 무엇으로 찾았는지가 화면에 그대로 보입니다.
              void handleSelectType(mentioned);
              runRecommend(mentioned);
            },
          },
        ]
      );
      return;
    }

    runRecommend(userType);
  };

  const runRecommend = async (effectiveUserType: UserType) => {
    setIsSubmitting(true);
    try {
      const { candidates, parsed } = await api.recommendPlaces({
        queryText,
        userType: effectiveUserType,
        sigunguCd,
        visitDate,
      });
      if (candidates.length === 0) {
        Alert.alert("추천 결과 없음", "조건에 맞는 장소를 찾지 못했어요. 다른 표현으로 다시 시도해주세요.");
        return;
      }
      setRecommendations(candidates);
      // 서버가 문장에서 읽어낸 조건(지역/동행자/목적)을 다음 화면에서 보여줍니다.
      setParsedQuery(parsed ?? null);
      setPendingQueryText(queryText);
      submittedRef.current = true;
      router.push("/select");
    } catch (err) {
      Alert.alert("장소 추천 실패", errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 (홈 화면과 동일한 방식).
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <FlatList
        showsVerticalScrollIndicator={false}
        data={[1]}
        keyExtractor={() => "content"}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.container}
        renderItem={() => (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>AI 경로 플래너</Text>
              <ProfileButton />
            </View>
            <Text style={[styles.fieldLabel, styles.typeFieldLabel]}>접근성 유형</Text>
            <View style={styles.typeGrid}>
              {OPTIONS.map((opt) => (
                <TypeTabButton
                  key={opt.type}
                  option={opt}
                  isSelected={userType === opt.type}
                  styles={styles}
                  colors={colors}
                  onPress={() => handleSelectType(opt.type)}
                />
              ))}
            </View>

            {selectedOption && (
              <FadeInView key={`type-desc-${userType}`} duration={200} translateY={6}>
                <View style={styles.typeDescRow}>
                  <selectedOption.icon size={21} color={colors.primary} weight="bold" />
                  <Text style={styles.typeDescText}>{selectedOption.desc}</Text>
                </View>
              </FadeInView>
            )}

            <Text style={styles.fieldLabel}>지역</Text>
            <TouchableOpacity style={styles.regionButton} onPress={() => setRegionModalVisible(true)}>
              <MapPinIcon size={15} color={colors.text} weight="bold" />
              <Text style={styles.regionButtonText}>{sigunguName ?? "경기도 전체"}</Text>
              <Text style={styles.regionButtonChevron}>변경</Text>
            </TouchableOpacity>

            {/* 방문 예정일을 알면 그날 혼잡도 예보를 쓰고, 그날 쉬는 곳은 미리 알려줄 수 있습니다. */}
            <TouchableOpacity
              style={styles.regionButton}
              onPress={() => setDateModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`방문 예정일 ${visitDate ?? "미정"}, 변경하려면 누르세요`}
            >
              <CalendarBlankIcon size={15} color={colors.text} weight="bold" />
              <Text style={styles.regionButtonText}>{visitDate ?? "방문 예정일 미정"}</Text>
              <Text style={styles.regionButtonChevron}>{visitDate ? "변경" : "선택"}</Text>
            </TouchableOpacity>
            {visitDate && (
              <TouchableOpacity onPress={() => setVisitDate(null)} accessibilityRole="button">
                <Text style={styles.clearDateText}>날짜 지우기</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>어떤 여행을 원하세요?</Text>
            <FadeInView key={`hint-${userType}`} duration={200} translateY={4}>
              {/* 아래 입력창에 옮겨 적으려고 이 문장을 긁는 사람이 많은데, 웹에서는
                  그 드래그가 탭 넘김으로 먹혔습니다. 이 영역만 선택이 되게 합니다. */}
              <SelectableArea>
                <Text style={styles.hint}>예: "{exampleQuery}"</Text>
              </SelectableArea>
            </FadeInView>
            {/* 여러 줄 입력창이라 글을 지우려면 백스페이스를 한참 눌러야 했습니다.
                여행지 검색창과 같은 모양의 지우기 버튼을 오른쪽 위에 얹습니다. */}
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                multiline
                placeholder="여기에 입력하거나 마이크 버튼을 눌러 말씀해주세요"
                placeholderTextColor={colors.textTertiary}
                value={queryText}
                onChangeText={setQueryText}
                accessibilityLabel="여행 요청 입력창"
              />
              {queryText.length > 0 && (
                <Pressable
                  style={({ pressed }) => [styles.inputClearButton, pressed && styles.inputClearButtonPressed]}
                  onPress={() => setQueryText("")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="입력 내용 지우기"
                >
                  <XCircleIcon size={20} color={colors.textTertiary} weight="fill" />
                </Pressable>
              )}
            </View>

            {VoiceInputButton ? (
              <VoiceInputButton
                isListening={isListening}
                onListeningChange={setIsListening}
                onResult={setQueryText}
                // 말한 내용이 입력창을 새로 채우므로, 듣기 시작과 함께 비웁니다.
                onStart={() => setQueryText("")}
              />
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
      </KeyboardAvoidingView>

      {/* 방문 예정일은 하루만 고르면 되므로, 달력에서 고른 시작일만 씁니다. */}
      <DateRangePickerModal
        visible={dateModalVisible}
        initialStartDate={visitDate}
        initialEndDate={null}
        onClose={() => setDateModalVisible(false)}
        onConfirm={(startDate) => {
          setVisitDate(startDate);
          setDateModalVisible(false);
        }}
      />

      <Modal visible={regionModalVisible} animationType="slide" transparent onRequestClose={() => setRegionModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: spacing.lg + insets.bottom }]}>
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
              returnKeyType="search"
              // 검색해서 좁혀둔 상태에서 엔터를 누르면 맨 위 지역을 누른 것과 같게
              // 처리합니다. 검색어가 없을 때는 전체 목록의 첫 지역이 엉뚱하게
              // 선택되므로 아무 것도 하지 않습니다.
              onSubmitEditing={() => {
                const first = regionSearch.trim() ? filteredRegions[0] : null;
                if (!first) return;
                setRegion(first.code, first.name);
                setRegionModalVisible(false);
              }}
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
                showsVerticalScrollIndicator={false}
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { padding: spacing.xl, paddingBottom: spacing.xxl + spacing.xl + 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text },
  fieldLabel: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.sm + 2, marginTop: spacing.xs },
  typeFieldLabel: { marginBottom: spacing.xxl },

  pressedFeedback: { opacity: 0.6 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg, marginBottom: spacing.lg },
  typeTab: { width: "25%", alignItems: "center", gap: spacing.xs + 2 },
  typeLabel: { fontSize: 11.5, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center" },
  typeDot: { width: 4, height: 4, borderRadius: 2, marginTop: -4 },

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
  clearDateText: {
    alignSelf: "flex-end",
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
    fontSize: 12,
    fontFamily: fontFamily.semiBold,
    color: colors.textTertiary,
  },
  typeDescRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginBottom: spacing.xl - 4,
  },
  typeDescText: { fontSize: 20, lineHeight: 27, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },

  hint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.md },
  inputWrap: { position: "relative" },
  // 지우기 버튼이 앉을 자리만큼 오른쪽을 비워둡니다 — 안 그러면 긴 문장의
  // 첫 줄이 버튼 아래로 파고듭니다.
  inputClearButton: { position: "absolute", top: spacing.md, right: spacing.md },
  inputClearButtonPressed: { opacity: 0.5 },
  input: {
    minHeight: 110,
    backgroundColor: colors.surface,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingRight: spacing.xxl + 8,
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
