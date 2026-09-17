import { useRouter } from "expo-router";
import { ArrowsClockwiseIcon, CheckIcon, SparkleIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert } from "../services/crossPlatformAlert";

import { AccessibilityIcons } from "../components/AccessibilityIcons";
import { EXTRA_INFO_LABELS_BY_CATEGORY, renderExtraInfo } from "../components/ExtraInfoList";
import { FadeInView } from "../components/FadeInView";
import { PhotoCardHeader } from "../components/PhotoCardHeader";
import { ScreenHeader } from "../components/ScreenHeader";
import { getCongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api, errorMessage } from "../services/api";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { useTheme } from "../services/ThemeContext";
import { Attraction, PlaceCandidate, UserType } from "../types";

/**
 * /input에서 추천받은 장소 후보(recommendations) 중, 사용자가 실제로 가고 싶은
 * 곳만 직접 골라서 체크합니다. "선택한 장소로 코스 만들기"를 누르면 그 장소들로만
 * (AI가 순서·시간대를 정해서) 최종 코스를 생성하고 결과 화면으로 넘어갑니다.
 */
export default function SelectPlacesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const {
    userType,
    sigunguCd,
    recommendations,
    setRecommendations,
    pendingQueryText,
    parsedQuery,
    setParsedQuery,
    visitDate,
    setCourse,
  } = useCourseContext();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 새로 추천받으면 목록이 통째로 바뀌므로 맨 위부터 다시 보여줍니다.
  const listRef = useRef<FlatList<PlaceCandidate>>(null);
  // 홈 화면 카드와 같은 부가 정보(이용시간/요금 등). 추천 후보 응답에는 안
  // 실려 있어서(별도 API 절약), 여기서 후보 개수만큼만 따로 조회합니다.
  const [extraInfoMap, setExtraInfoMap] = useState<Record<string, Attraction["extra_info"]>>({});
  // 소개문(추천 이유)은 이미 후보와 함께 와 있지만, 부가 정보는 따로 로딩되기
  // 때문에 카드를 먼저 보여줬다가 부가 정보만 나중에 툭 튀어나오지 않도록,
  // 부가 정보까지 다 준비된 뒤에야(홈 화면과 같은 방식) 목록을 부드럽게 보여줍니다.
  const [extraInfoReady, setExtraInfoReady] = useState(false);

  useEffect(() => {
    setExtraInfoReady(false);
    const targets = recommendations
      .map((c) => c.attraction)
      .filter((a) => (a.extra_info?.length ?? 0) === 0 && EXTRA_INFO_LABELS_BY_CATEGORY[a.category]);
    if (targets.length === 0) {
      setExtraInfoReady(true);
      return;
    }
    api
      .getExtraInfo(targets.map((a) => ({ contentId: a.content_id, category: a.category })))
      .then(setExtraInfoMap)
      .catch((err) => console.warn("[부가 정보] 불러오지 못했습니다:", err))
      .finally(() => setExtraInfoReady(true));
  }, [recommendations]);

  const toggle = (contentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  };

  // 무언가 진행 중일 때만 버튼을 잠급니다. 고른 장소가 없어도 버튼은 초록색
  // 그대로 두고(흐리게 하지 않고) 글자로 안내합니다 — 누르면 무엇을 해야 하는지
  // 알려주는 편이, 눌리지 않는 흐린 버튼보다 낫습니다.
  const isBusy = isSubmitting || isRefreshing;

  // 마음에 드는 곳이 없을 때 같은 질의로 후보를 다시 받아옵니다. 서버가 매번
  // 다른 표본을 뽑아주므로 누를 때마다 새로운 장소가 나옵니다.
  const handleRefresh = async () => {
    if (!pendingQueryText.trim()) {
      Alert.alert("다시 추천할 수 없어요", "어떤 여행을 원하는지 먼저 입력해주세요.");
      return;
    }
    setIsRefreshing(true);
    try {
      const { candidates, parsed } = await api.recommendPlaces({
        queryText: pendingQueryText,
        userType,
        sigunguCd,
        visitDate,
      });
      if (candidates.length === 0) {
        Alert.alert("추천 결과 없음", "조건에 맞는 장소를 더 찾지 못했어요. 다른 표현으로 다시 시도해주세요.");
        return;
      }
      setRecommendations(candidates);
      setParsedQuery(parsed ?? null);
      // 목록이 바뀌었으니 이전 선택은 더 이상 유효하지 않습니다.
      setSelectedIds(new Set());
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (err) {
      Alert.alert("새로 추천받지 못했어요", errorMessage(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateCourse = async () => {
    if (selectedIds.size === 0) {
      Alert.alert("장소를 선택해주세요", "코스에 포함할 장소를 하나 이상 골라주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const course = await api.generateCourseFromSelection({
        queryText: pendingQueryText,
        userType,
        sigunguCd,
        visitDate,
        selectedContentIds: Array.from(selectedIds),
      });
      setCourse(course);
      await storage.saveCourse(course);
      router.push("/results");
    } catch (err) {
      Alert.alert("코스 생성 실패", errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (recommendations.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <ScreenHeader title="장소 선택하기" style={styles.standaloneHeader} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>추천받은 장소가 없어요. 먼저 원하는 여행을 말씀해주세요.</Text>
          <Pressable style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
            <Text style={styles.emptyButtonText}>여행 요청하러 가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // 상단 바와 제목은 목록의 맨 위 콘텐츠로 넣습니다 — 그래야 홈 화면처럼
  // 스크롤을 내릴 때 목록과 함께 위로 밀려 사라집니다.
  // 문장에서 읽어낸 조건을 칩으로 보여줍니다. 특히 지역은 화면에서 고르지 않아도
  // 문장만으로 좁혀지기 때문에, 무엇으로 찾았는지 보이지 않으면 결과를 오해합니다.
  const conditionChips: string[] = [
    ...(parsedQuery?.region_text ? [parsedQuery.region_text] : []),
    ...(parsedQuery && parsedQuery.companion !== "미지정" ? [parsedQuery.companion] : []),
    ...(parsedQuery?.purposes ?? []),
  ];

  const listHeader = (
    <>
      <ScreenHeader title="장소 선택하기" style={styles.listHeaderBar} />
      <Text style={styles.title}>마음에 드는 장소를 골라주세요</Text>
      <Text style={styles.subtitle}>
        "{pendingQueryText}" 요청에 맞춰 추천된 장소예요. 선택한 곳들로 코스를 만들어드려요.
      </Text>
      {conditionChips.length > 0 && (
        <View
          style={styles.conditionRow}
          accessibilityRole="text"
          accessibilityLabel={`이렇게 이해했어요: ${conditionChips.join(", ")}`}
        >
          <Text style={styles.conditionLabel}>이렇게 이해했어요</Text>
          <View style={styles.conditionChips}>
            {conditionChips.map((chip) => (
              <View key={chip} style={styles.conditionChip}>
                <Text style={styles.conditionChipText}>{chip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </>
  );

  return (
    // edges=["top"]로 상태표시줄(시계/배터리) 영역만 피해서 그립니다 — 홈 화면과 같습니다.
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {extraInfoReady ? (
        <FadeInView duration={250} style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={recommendations}
            keyExtractor={(item) => item.attraction.content_id}
            ListHeaderComponent={listHeader}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <PlaceOptionCard
                candidate={item}
                userType={userType}
                selected={selectedIds.has(item.attraction.content_id)}
                onToggle={() => toggle(item.attraction.content_id)}
                extraInfo={extraInfoMap[item.attraction.content_id]}
              />
            )}
          />
        </FadeInView>
      ) : (
        // 부가 정보를 불러오는 동안에도 상단 바와 제목은 같은 자리에 그대로 둡니다.
        <View style={styles.listContent}>
          {listHeader}
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
        </View>
      )}

      {/* 추천 코스 화면과 같은 방식 — 띠 배경 없이 버튼만 목록 위에 떠 있습니다. */}
      <View style={styles.bottomBar}>
        <Pressable
          style={({ pressed }) => [
            styles.refreshButton,
            pressed && !isBusy && styles.buttonPressed,
            isBusy && styles.buttonDisabled,
          ]}
          onPress={handleRefresh}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="장소 새로고침"
          accessibilityHint="같은 조건으로 다른 장소를 다시 추천받습니다"
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <ArrowsClockwiseIcon size={17} color={colors.primary} weight="bold" />
              <Text style={styles.refreshText}>새로고침</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            pressed && !isBusy && styles.submitButtonPressed,
            isBusy && styles.buttonDisabled,
          ]}
          onPress={handleCreateCourse}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={
            selectedIds.size > 0
              ? `선택한 ${selectedIds.size}곳으로 코스 만들기`
              : "장소를 선택해주세요"
          }
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <SparkleIcon size={17} color={colors.onPrimary} weight="bold" />
              <Text style={styles.submitText}>
                {selectedIds.size > 0 ? `${selectedIds.size}곳 코스 만들기` : "장소를 선택해주세요"}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function PlaceOptionCard({
  candidate,
  userType,
  selected,
  onToggle,
  extraInfo,
}: {
  candidate: PlaceCandidate;
  userType: UserType;
  selected: boolean;
  onToggle: () => void;
  // 홈 화면 카드와 같은 형식의 부가 정보(이용시간/요금 등).
  extraInfo?: Attraction["extra_info"];
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { attraction, reason } = candidate;
  const placeWithExtraInfo = extraInfo?.length ? { ...attraction, extra_info: extraInfo } : attraction;
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${attraction.name}, ${selected ? "선택됨" : "선택 안 됨"}`}
    >
      <PhotoCardHeader
        imageUrl={attraction.image_url}
        height={180}
        title={attraction.name}
        subtitle={attraction.address}
        rating={attraction.avg_rating}
        reviewCount={attraction.review_count}
        congestion={getCongestionDisplay(attraction, colors)}
        topLeft={
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected && <CheckIcon size={14} color="#FFFFFF" weight="bold" />}
          </View>
        }
      />

      <View style={styles.body}>
        <Text style={styles.category}>{attraction.category}</Text>
        <Text style={styles.reason}>{reason}</Text>
        {(() => {
          const extraInfoNode = renderExtraInfo(placeWithExtraInfo, colors);
          return (
            <>
              {extraInfoNode}
              <View style={extraInfoNode ? styles.accessibilityDivider : undefined}>
                <AccessibilityIcons features={attraction.accessibility} userType={userType} />
              </View>
            </>
          );
        })()}
        <Pressable
          style={styles.detailButton}
          onPress={() =>
            router.push({
              pathname: "/attraction-detail",
              params: { contentId: attraction.content_id, name: attraction.name },
            })
          }
        >
          <Text style={styles.detailButtonText}>상세 페이지 보기 →</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // 위쪽 여백만 목록 안(listContent)으로 옮겨서, 스크롤한 콘텐츠가 화면 맨 위까지
  // 올라갔다가 사라지게 합니다. 좌우/아래 여백은 그대로 둬야 하단 버튼 위치가 유지됩니다.
  container: { flex: 1, paddingHorizontal: spacing.xl - 4, paddingBottom: spacing.xl - 4, backgroundColor: colors.background },
  // 하단 바(52) + 아래 여백(20) + 목록과의 간격만큼 비워둬야 마지막 카드가 가리지 않습니다.
  listContent: { paddingTop: spacing.md, paddingBottom: 92 },
  listHeaderBar: { marginBottom: spacing.md },
  standaloneHeader: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.md },
  title: { fontSize: 21, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.sm + 2, lineHeight: 18 },
  // 질의에서 읽어낸 조건(지역/동행자/목적) 표시줄
  conditionRow: { marginBottom: spacing.lg },
  conditionLabel: {
    fontSize: 11,
    fontFamily: fontFamily.semiBold,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  conditionChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  conditionChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  conditionChipText: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.primaryDark },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    overflow: "hidden",
    // 흰 배경 위에서 흰 카드의 경계가 사라지지 않도록, 짧은 접지 그림자와
    // 넓은 들어올림 그림자를 겹쳐 씁니다 (AttractionCard와 동일한 레시피).
    ...Platform.select({
      web: { boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.10)" } as any,
      default: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
      },
    }),
  },
  // 선택된 카드만 예외적으로 테두리를 둘러 "선택됨" 상태를 분명히 보여줍니다.
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { padding: spacing.md + 2 },
  category: { fontSize: 12, color: colors.primary, fontFamily: fontFamily.semiBold },
  reason: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.xs + 2, lineHeight: 18 },
  // 부가 정보 아래 접근성 아이콘 — 부가 정보가 실제로 표시될 때만 구분선을 넣어
  // 섹션을 나눕니다 (홈 화면 카드와 동일한 방식).
  accessibilityDivider: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  detailButton: { alignSelf: "flex-start", marginTop: spacing.sm + 2 },
  detailButtonText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.primary },
  // 띠 배경 없이 버튼만 목록 위에 띄웁니다(추천 코스 화면과 같은 구조).
  // 버튼 배경은 화면 배경과 같은 색으로 채워야 뒤로 지나가는 카드가 비치지 않습니다.
  bottomBar: {
    position: "absolute",
    bottom: spacing.xl - 4,
    left: spacing.xl - 4,
    right: spacing.xl - 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  refreshButton: {
    height: 52,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg - 2,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 1,
  },
  refreshText: { color: colors.primary, fontSize: 14, fontFamily: fontFamily.bold },
  // 이 화면의 주요 동작이라 초록으로 꽉 채웁니다 — 옆의 새로고침 버튼은
  // 테두리만 있는 보조 버튼으로 남겨서 둘의 역할이 한눈에 구분되게 합니다.
  // (여행 요청 화면 planner.tsx의 제출 버튼과 같은 방식)
  submitButton: {
    flex: 1,
    height: 52,
    flexDirection: "row",
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  // 채움형이라 배경색을 바꾸면(surfaceAlt) 초록이 사라져 버려서, 다른 채움형
  // 버튼들과 똑같이 투명도로만 눌린 것을 알립니다.
  submitButtonPressed: { opacity: 0.6 },
  buttonPressed: { backgroundColor: colors.surfaceAlt },
  buttonDisabled: { opacity: 0.45 },
  // 새로고침 버튼이 옆자리를 차지해서, 좁은 폰(320px)에서도 글자가 눌리지 않도록
  // 한 단계 줄였습니다.
  submitText: { color: colors.onPrimary, fontSize: 15, fontFamily: fontFamily.bold },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.lg, textAlign: "center", lineHeight: 20 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.md },
  emptyButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold },
  });
}
