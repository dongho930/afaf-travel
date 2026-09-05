import { useRouter } from "expo-router";
import {
  CaretDownIcon,
  CaretUpIcon,
  FloppyDiskIcon,
  HandTapIcon,
  MapTrifoldIcon,
  WifiSlashIcon,
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { AttractionCard } from "../components/AttractionCard";
import { EXTRA_INFO_LABELS_BY_CATEGORY } from "../components/ExtraInfoList";
import { FadeInView } from "../components/FadeInView";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useCourseContext } from "../services/CourseContext";
import { useTheme } from "../services/ThemeContext";
import { storage } from "../services/storage";
import { Attraction, CourseStop } from "../types";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse } = useCourseContext();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  // 홈 화면 카드와 같은 부가 정보(이용시간/요금 등). 코스 생성 응답에는 안
  // 실려 있어서(별도 API 절약), 여기서 스톱 개수만큼만 따로 조회합니다.
  const [extraInfoMap, setExtraInfoMap] = useState<Record<string, Attraction["extra_info"]>>({});
  // 소개문(추천 이유)은 이미 코스와 함께 와 있지만, 부가 정보는 따로 로딩되기
  // 때문에 카드를 먼저 보여줬다가 부가 정보만 나중에 툭 튀어나오지 않도록,
  // 부가 정보까지 다 준비된 뒤에야(홈 화면과 같은 방식) 목록을 부드럽게 보여줍니다.
  const [extraInfoReady, setExtraInfoReady] = useState(false);

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

  useEffect(() => {
    if (!course) return;
    setExtraInfoReady(false);
    const targets = course.stops
      .map((s) => s.attraction)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.course_id]);

  const openSaveModal = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "코스를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSaveModalVisible(true);
  };

  const handleConfirmSave = async (params: SaveCourseParams) => {
    if (!course) return;
    await api.saveCourse(course.course_id, params);
  };

  // 드래그가 끝나면 화면에는 바로 새 순서를 반영하고(로컬), '순서 저장'
  // 버튼을 눌러야 서버에 실제로 저장됩니다 — 실수로 살짝 끌었을 때마다
  // 바로바로 API를 호출하지 않기 위함입니다.
  const handleDragEnd = ({ data }: { data: CourseStop[] }) => {
    if (!course) return;
    const reordered = data.map((stop, i) => ({ ...stop, order: i + 1 }));
    setCourse({ ...course, stops: reordered });
    setOrderChanged(true);
  };

  // 웹에서는 길게 눌러 끄는 드래그 순서변경이 동작하지 않아(사용 중인 드래그
  // 라이브러리가 데스크톱 브라우저에서 제스처를 안정적으로 못 잡음), 대신
  // 카드마다 위/아래 버튼으로 순서를 바꿀 수 있게 합니다. 결과는 드래그와
  // 동일하게 로컬 반영 + '순서 저장' 버튼 노출입니다.
  const handleMoveStop = (index: number, direction: -1 | 1) => {
    if (!course) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= course.stops.length) return;
    const stops = [...course.stops];
    [stops[index], stops[targetIndex]] = [stops[targetIndex], stops[index]];
    const reordered = stops.map((stop, i) => ({ ...stop, order: i + 1 }));
    setCourse({ ...course, stops: reordered });
    setOrderChanged(true);
  };

  const handleSaveOrder = async () => {
    if (!course) return;
    if (!session) {
      Alert.alert("로그인이 필요해요", "순서를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSavingOrder(true);
    try {
      const stopOrder = course.stops.map((s) => s.attraction.content_id);
      await api.updateCourse(course.course_id, { stopOrder });
      setOrderChanged(false);
    } catch (err) {
      Alert.alert("순서 저장 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSavingOrder(false);
    }
  };

  if (!course) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>표시할 코스가 없어요.</Text>
        <TouchableOpacity style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
          <Text style={styles.emptyButtonText}>AI 플래너로 이동</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {offlineNotice && (
        <View style={styles.offlineBanner}>
          <WifiSlashIcon size={13} color={colors.warningText} weight="bold" />
          <Text style={styles.offlineBannerText}>오프라인 저장된 마지막 코스를 보여드리고 있어요</Text>
        </View>
      )}

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{course.title}</Text>
          <Text style={styles.summary}>{course.summary}</Text>
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={openSaveModal}>
          <FloppyDiskIcon size={13} color={colors.primary} weight="bold" />
          <Text style={styles.saveButtonText}>저장</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.orderHintRow}>
        <View style={styles.orderHintTextRow}>
          <HandTapIcon size={13} color={colors.textTertiary} weight="bold" />
          <Text style={styles.orderHint}>
            {Platform.OS === "web"
              ? "카드의 화살표 버튼으로 순서를 바꿀 수 있어요"
              : "카드를 길게 눌러서 순서를 바꿀 수 있어요"}
          </Text>
        </View>
        {orderChanged && (
          <TouchableOpacity
            style={[styles.saveOrderButton, savingOrder && styles.saveOrderButtonDisabled]}
            onPress={handleSaveOrder}
            disabled={savingOrder}
          >
            {savingOrder ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveOrderButtonText}>순서 저장</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {extraInfoReady ? (
        <FadeInView duration={250} style={{ flex: 1 }}>
          <DraggableFlatList
            style={{ flex: 1 }}
            containerStyle={{ flex: 1 }}
            data={course.stops}
            keyExtractor={(item) => item.attraction.content_id}
            contentContainerStyle={{ paddingBottom: 90 }}
            onDragEnd={handleDragEnd}
            renderItem={({ item, drag, isActive, getIndex }) => (
              <ScaleDecorator>
                <Pressable
                  onLongPress={Platform.OS === "web" ? undefined : drag}
                  disabled={isActive}
                  style={isActive ? styles.dragging : undefined}
                >
                  <AttractionCard
                    stop={item}
                    userType={course.generated_for}
                    extraInfo={extraInfoMap[item.attraction.content_id]}
                    actions={
                      Platform.OS === "web" ? (
                        <View style={styles.moveButtonGroup}>
                          <Pressable
                            style={styles.moveButton}
                            disabled={getIndex() === 0}
                            onPress={() => handleMoveStop(getIndex() ?? 0, -1)}
                            accessibilityLabel="위로 순서 이동"
                          >
                            <CaretUpIcon
                              size={14}
                              color={getIndex() === 0 ? colors.textTertiary : colors.primary}
                              weight="bold"
                            />
                          </Pressable>
                          <Pressable
                            style={styles.moveButton}
                            disabled={getIndex() === course.stops.length - 1}
                            onPress={() => handleMoveStop(getIndex() ?? 0, 1)}
                            accessibilityLabel="아래로 순서 이동"
                          >
                            <CaretDownIcon
                              size={14}
                              color={getIndex() === course.stops.length - 1 ? colors.textTertiary : colors.primary}
                              weight="bold"
                            />
                          </Pressable>
                        </View>
                      ) : undefined
                    }
                  />
                </Pressable>
              </ScaleDecorator>
            )}
          />
        </FadeInView>
      ) : (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <Pressable
        style={styles.mapButton}
        onPress={() => router.push("/map")}
        accessibilityLabel="지도로 전체 동선 보기"
      >
        <MapTrifoldIcon size={16} color={colors.onPrimary} weight="bold" />
        <Text style={styles.mapButtonText}>지도로 전체 동선 보기</Text>
      </Pressable>

      <SaveCourseModal
        visible={saveModalVisible}
        onClose={() => setSaveModalVisible(false)}
        defaultNewTripName={course.title}
        onConfirm={handleConfirmSave}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, padding: spacing.xl - 4, backgroundColor: colors.background },
  titleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg, gap: spacing.sm + 2 },
  title: { fontSize: 21, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.xs },
  summary: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  saveButtonText: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: 13 },
  orderHintRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm + 2 },
  orderHintTextRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  orderHint: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, flexShrink: 1 },
  saveOrderButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 3,
    marginLeft: spacing.sm,
  },
  saveOrderButtonDisabled: { opacity: 0.6 },
  saveOrderButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 12 },
  dragging: { opacity: 0.7 },
  moveButtonGroup: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  moveButton: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.warningLight,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  offlineBannerText: { color: colors.warningText, fontSize: 12, fontFamily: fontFamily.regular, textAlign: "center" },
  mapButton: {
    position: "absolute",
    bottom: spacing.xl - 4,
    left: spacing.xl - 4,
    right: spacing.xl - 4,
    flexDirection: "row",
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  mapButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fontFamily.bold },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.lg },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.md },
  emptyButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold },
  });
}
