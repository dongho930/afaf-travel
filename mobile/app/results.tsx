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
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert } from "../services/crossPlatformAlert";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { AttractionCard } from "../components/AttractionCard";
import { EXTRA_INFO_LABELS_BY_CATEGORY } from "../components/ExtraInfoList";
import { FadeInView } from "../components/FadeInView";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { ScreenHeader } from "../components/ScreenHeader";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useCourseContext } from "../services/CourseContext";
import { useTheme } from "../services/ThemeContext";
import { storage } from "../services/storage";
import { Attraction, CourseResponse, CourseStop } from "../types";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse, visitDate } = useCourseContext();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  // 하루에 다 못 도는 코스를 나눴을 때 생기는 '다음 날' 코스.
  const [nextDayCourse, setNextDayCourse] = useState<CourseResponse | null>(null);
  const [nextVisitDate, setNextVisitDate] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
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
    const { trip_id } = await api.saveCourse(course.course_id, params);
    // 나눠 놓은 다음 날 코스도 같은 여행에 함께 넣어야 1일차·2일차가 한 여행에 모입니다.
    if (nextDayCourse) {
      await api.saveCourse(nextDayCourse.course_id, { tripId: trip_id });
    }
  };

  // 시간이 뒤로 계속 밀리는 구조라, '오늘 못 가는' 첫 지점부터 뒤는 전부 다음 날로
  // 넘기는 게 맞습니다. 그 지점을 찾습니다(없으면 -1).
  const overflowIndex = course?.stops.findIndex((s) => s.fits_today === false) ?? -1;
  const overflowStop = overflowIndex >= 0 ? course?.stops[overflowIndex] : undefined;
  // 첫 장소부터 안 맞거나 장소가 하나뿐이면 나눌 수가 없습니다(남는 코스가 없음).
  const canSplit = overflowIndex >= 1 && !nextDayCourse;

  const handleSplit = async () => {
    if (!course || overflowIndex < 1) return;
    if (!session) {
      Alert.alert("로그인이 필요해요", "코스를 나누려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSplitting(true);
    try {
      const result = await api.splitCourse(course.course_id, {
        fromOrder: overflowIndex + 1,
        visitDate,
      });
      setCourse(result.today);
      setNextDayCourse(result.next_day);
      setNextVisitDate(result.next_visit_date);
      await storage.saveCourse(result.today);
    } catch (err) {
      Alert.alert("코스를 나누지 못했어요", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSplitting(false);
    }
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
      // 서버가 새 순서 기준으로 방문 시각을 다시 계산해서 돌려줍니다 —
      // 그 결과로 화면을 갱신해야 시각이 순서와 어긋나지 않습니다.
      const updated = await api.updateCourse(course.course_id, { stopOrder });
      setCourse(updated);
      await storage.saveCourse(updated);
      setOrderChanged(false);
    } catch (err) {
      Alert.alert("순서 저장 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSavingOrder(false);
    }
  };

  if (!course) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScreenHeader title="추천 코스" style={styles.standaloneHeader} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>표시할 코스가 없어요.</Text>
          <TouchableOpacity style={styles.emptyButton} onPress={() => router.push("/(tabs)/planner")}>
            <Text style={styles.emptyButtonText}>AI 플래너로 이동</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 상단 바와 코스 제목·안내문은 목록의 맨 위 콘텐츠로 넣습니다 — 그래야 홈
  // 화면처럼 스크롤을 내릴 때 목록과 함께 위로 밀려 사라집니다.
  const listHeader = (
    <>
      <ScreenHeader title="추천 코스" style={styles.listHeaderBar} />

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

      {/* 문 닫은 뒤 도착하거나 그날 쉬는 장소가 있으면 다음 날로 나누자고 제안합니다. */}
      {overflowStop && !nextDayCourse && (
        <View style={styles.splitBanner}>
          <View style={styles.splitBannerTextGroup}>
            <Text style={styles.splitBannerTitle}>
              {overflowStop.attraction.name}은(는) 이날 방문이 어려워요
            </Text>
            <Text style={styles.splitBannerBody}>
              {overflowStop.closed_note ?? overflowStop.time_note ?? "도착 예정 시간에 이용이 어렵습니다."}
            </Text>
            {!canSplit && (
              <Text style={styles.splitBannerBody}>
                첫 장소부터라서 나눌 수 없어요. 순서를 바꾸거나 장소를 줄여보세요.
              </Text>
            )}
          </View>
          {canSplit && (
            <TouchableOpacity
              style={[styles.splitButton, splitting && styles.splitButtonDisabled]}
              onPress={handleSplit}
              disabled={splitting}
              accessibilityRole="button"
              accessibilityLabel={`${overflowStop.attraction.name}부터 다음 날 코스로 나누기`}
            >
              {splitting ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.splitButtonText}>이 장소부터 다음 날로 나누기</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {nextDayCourse && <Text style={styles.daySectionTitle}>1일차{visitDate ? ` · ${visitDate}` : ""}</Text>}

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
    </>
  );

  // 나눈 뒤의 '2일차' 구간. 1일차 목록 아래에 이어서 보여줍니다. 순서 바꾸기는
  // 1일차에만 두고, 2일차는 저장 후 여행 상세에서 열어 조정하도록 했습니다
  // (한 화면에서 두 코스를 서로 끌어 옮기게 하면 저장 규칙이 복잡해집니다).
  const nextDaySection = nextDayCourse ? (
    <View style={styles.nextDaySection}>
      <Text style={styles.daySectionTitle}>2일차{nextVisitDate ? ` · ${nextVisitDate}` : ""}</Text>
      <Text style={styles.nextDayHint}>
        저장하면 1일차와 같은 여행에 함께 담겨요. 순서 조정은 저장 후 여행 상세에서 할 수 있어요.
      </Text>
      {nextDayCourse.stops.map((stop) => (
        <AttractionCard
          key={stop.attraction.content_id}
          stop={stop}
          userType={nextDayCourse.generated_for}
          extraInfo={extraInfoMap[stop.attraction.content_id]}
        />
      ))}
    </View>
  ) : null;

  return (
    // edges=["top"]로 상태표시줄(시계/배터리) 영역만 피해서 그립니다 — 홈 화면과 같습니다.
    <SafeAreaView style={styles.container} edges={["top"]}>
      {extraInfoReady ? (
        <FadeInView duration={250} style={{ flex: 1 }}>
          <DraggableFlatList
            style={{ flex: 1 }}
            containerStyle={{ flex: 1 }}
            data={course.stops}
            keyExtractor={(item) => item.attraction.content_id}
            ListHeaderComponent={listHeader}
            ListFooterComponent={nextDaySection}
            contentContainerStyle={styles.listContent}
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
        // 부가 정보를 불러오는 동안에도 상단 바와 제목은 같은 자리에 그대로 둡니다.
        <View style={styles.listContent}>
          {listHeader}
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
        </View>
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
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // 위쪽 여백만 목록 안(listContent)으로 옮겨서, 스크롤한 콘텐츠가 화면 맨 위까지
  // 올라갔다가 사라지게 합니다. 좌우/아래 여백은 그대로 둬야 하단 버튼 위치가 유지됩니다.
  container: { flex: 1, paddingHorizontal: spacing.xl - 4, paddingBottom: spacing.xl - 4, backgroundColor: colors.background },
  listContent: { paddingTop: spacing.md, paddingBottom: 90 },
  listHeaderBar: { marginBottom: spacing.md },
  standaloneHeader: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.md },
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
  // '이날 방문이 어려워요' 안내와 다음 날로 나누기 버튼
  splitBanner: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  splitBannerTextGroup: { gap: 2 },
  splitBannerTitle: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.warningText },
  splitBannerBody: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.warningText, lineHeight: 17 },
  splitButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 3,
  },
  splitButtonDisabled: { opacity: 0.6 },
  splitButtonText: { color: colors.onPrimary, fontSize: 12, fontFamily: fontFamily.bold },
  daySectionTitle: {
    fontSize: 15,
    fontFamily: fontFamily.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  nextDaySection: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  nextDayHint: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.textTertiary,
    marginBottom: spacing.md,
    lineHeight: 17,
  },
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
