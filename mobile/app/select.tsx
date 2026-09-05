import { useRouter } from "expo-router";
import { CheckIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../services/crossPlatformAlert";

import { AccessibilityIcons } from "../components/AccessibilityIcons";
import { EXTRA_INFO_LABELS_BY_CATEGORY, renderExtraInfo } from "../components/ExtraInfoList";
import { FadeInView } from "../components/FadeInView";
import { PhotoCardHeader } from "../components/PhotoCardHeader";
import { getCongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
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
  const { userType, sigunguCd, recommendations, pendingQueryText, setCourse } = useCourseContext();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      .catch(() => {})
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
        selectedContentIds: Array.from(selectedIds),
      });
      setCourse(course);
      await storage.saveCourse(course);
      router.push("/results");
    } catch (err) {
      Alert.alert("코스 생성 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (recommendations.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>추천받은 장소가 없어요. 먼저 원하는 여행을 말씀해주세요.</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
          <Text style={styles.emptyButtonText}>여행 요청하러 가기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>마음에 드는 장소를 골라주세요</Text>
      <Text style={styles.subtitle}>
        "{pendingQueryText}" 요청에 맞춰 추천된 장소예요. 선택한 곳들로 코스를 만들어드려요.
      </Text>

      {extraInfoReady ? (
        <FadeInView duration={250} style={{ flex: 1 }}>
          <FlatList
            data={recommendations}
            keyExtractor={(item) => item.attraction.content_id}
            contentContainerStyle={{ paddingBottom: 110 }}
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
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <View style={styles.footer}>
        <Text style={styles.selectionCount}>{selectedIds.size}곳 선택됨</Text>
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleCreateCourse}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="선택한 장소로 코스 만들기"
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitText}>선택한 장소로 코스 만들기</Text>
          )}
        </Pressable>
      </View>
    </View>
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
  container: { flex: 1, padding: spacing.xl - 4, backgroundColor: colors.background },
  title: { fontSize: 21, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: "0 6px 20px rgba(0,0,0,0.08)" } as any,
      default: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
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
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.xl - 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectionCount: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.sm, textAlign: "center" },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontSize: 16, fontFamily: fontFamily.bold },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.lg, textAlign: "center", lineHeight: 20 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.md },
  emptyButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold },
  });
}
