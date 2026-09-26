import { useRouter } from "expo-router";
import {
  ClockCounterClockwiseIcon,
  HandTapIcon,
  MapTrifoldIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../services/crossPlatformAlert";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { EXTRA_INFO_LABELS_BY_CATEGORY } from "../components/ExtraInfoList";
import { DataCreditLine } from "../components/DataCredit";
import { FadeInView } from "../components/FadeInView";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { ScreenHeader } from "../components/ScreenHeader";
import { TimelineStopItem } from "../components/TimelineStopItem";
import { useReduceMotion } from "../services/useReduceMotion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api, errorMessage } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useCourseContext } from "../services/CourseContext";
import { useTheme } from "../services/ThemeContext";
import { storage } from "../services/storage";
import { Attraction, CourseStop } from "../types";

export default function ResultsScreen() {
  const router = useRouter();
  const { course, setCourse, dayCourses, setDayCourses, visitDate } = useCourseContext();
  const { session } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  // '순서를 바꿨지만 아직 저장 안 한' 일차들(키 = 일차 번호). 하단 '순서 저장'
  // 버튼 하나가 이 일차들만 골라 서버에 반영합니다.
  const [changedDays, setChangedDays] = useState<Record<number, boolean>>({});
  // 나누는 중인 일차(그 일차의 버튼만 로딩 표시).
  const [splittingDay, setSplittingDay] = useState<number | null>(null);
  // 일차가 둘 이상일 때, 지도로 볼 날을 고르는 시트.
  const [dayPickerVisible, setDayPickerVisible] = useState(false);
  // 홈 화면 카드와 같은 부가 정보(이용시간/요금 등). 코스 생성 응답에는 안
  // 실려 있어서(별도 API 절약), 여기서 스톱 개수만큼만 따로 조회합니다.
  const [extraInfoMap, setExtraInfoMap] = useState<Record<string, Attraction["extra_info"]>>({});
  // 소개문(추천 이유)은 이미 코스와 함께 와 있지만, 부가 정보는 따로 로딩되기
  // 때문에 카드를 먼저 보여줬다가 부가 정보만 나중에 툭 튀어나오지 않도록,
  // 부가 정보까지 다 준비된 뒤에야(홈 화면과 같은 방식) 목록을 부드럽게 보여줍니다.
  const [extraInfoReady, setExtraInfoReady] = useState(false);
  // 버튼으로 방금 옮긴 장소. 해당 카드 테두리를 잠깐 강조하는 데 씁니다.
  const [lastMoved, setLastMoved] = useState<{ id: string; token: number } | null>(null);
  const reduceMotion = useReduceMotion();

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

  // 모든 일차의 장소를 한 번에 조회합니다. 코스를 나누면 장소가 일차 사이로
  // 옮겨질 뿐 집합은 그대로라, 장소 목록(아래 키)이 같으면 다시 부르지 않습니다 —
  // 나눌 때마다 목록이 사라졌다 다시 나타나지 않게 하기 위함입니다.
  const allStops = dayCourses.flatMap((d) => d.course.stops);
  const extraInfoKey = allStops
    .map((s) => s.attraction.content_id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!extraInfoKey) return;
    setExtraInfoReady(false);
    const targets = allStops
      .map((s) => s.attraction)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraInfoKey]);

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
    if (dayCourses.length === 0) return;
    // 순서를 바꿔놓고 '순서 저장'을 누르지 않은 채 여행에 저장하면 예전 순서가
    // 담겼습니다. 여행에 넣기 전에 바뀐 순서부터 서버에 반영합니다.
    const days = anyOrderChanged ? await persistOrders() : dayCourses;
    const { trip_id } = await api.saveCourse(days[0].course.course_id, params);
    // 나눠 놓은 나머지 일차도 같은 여행에 함께 넣어야 한 여행에 모입니다.
    for (const day of days.slice(1)) {
      await api.saveCourse(day.course.course_id, { tripId: trip_id });
    }
  };

  // 시간이 뒤로 계속 밀리는 구조라, 그 일차에 '못 가는' 첫 지점부터 뒤는 전부
  // 다음 날로 넘기는 게 맞습니다. 그 지점을 찾습니다(없으면 -1).
  const overflowIndexOf = (dayIndex: number) =>
    dayCourses[dayIndex]?.course.stops.findIndex((s) => s.fits_today === false) ?? -1;

  const handleSplit = async (dayIndex: number) => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "코스를 나누려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSplittingDay(dayIndex);
    try {
      // 나누기는 서버에 저장된 순서를 기준으로 합니다. 화면에서만 바꿔둔 순서가
      // 있으면 그게 사라지므로, 먼저 저장하고 그 결과로 다시 판단합니다.
      const days = anyOrderChanged ? await persistOrders() : dayCourses;
      const day = days[dayIndex];
      if (!day) return;
      const overflowIndex = day.course.stops.findIndex((s) => s.fits_today === false);
      if (overflowIndex < 1) return;

      const result = await api.splitCourse(day.course.course_id, {
        fromOrder: overflowIndex + 1,
        visitDate: day.visitDate,
      });
      // 나눈 일차는 앞쪽만 남기고, 넘어간 장소들이 바로 다음 일차가 됩니다.
      const next = [...days];
      next[dayIndex] = { course: result.today, visitDate: day.visitDate };
      next.splice(dayIndex + 1, 0, { course: result.next_day, visitDate: result.next_visit_date });
      setDayCourses(next);
      if (dayIndex === 0) await storage.saveCourse(result.today);
    } catch (err) {
      Alert.alert("코스를 나누지 못했어요", errorMessage(err));
    } finally {
      setSplittingDay(null);
    }
  };

  // 한 일차의 순서를 화면에만 먼저 반영합니다. '순서 저장' 버튼을 눌러야 서버에
  // 들어갑니다 — 실수로 살짝 끌었을 때마다 바로바로 API를 호출하지 않기 위함입니다.
  const applyReorder = (dayIndex: number, stops: CourseStop[]) => {
    const reordered = stops.map((stop, i) => ({ ...stop, order: i + 1 }));
    setDayCourses(
      dayCourses.map((d, i) => (i === dayIndex ? { ...d, course: { ...d.course, stops: reordered } } : d))
    );
    setChangedDays((prev) => ({ ...prev, [dayIndex]: true }));
  };

  // 드래그는 1일차에서만 씁니다(2일차부터는 화살표). 목록을 중첩하면 두 일차
  // 사이로 카드가 끌려가 버려서, 아래 일차들은 1일차 목록의 발치에 그립니다.
  const handleDragEnd = ({ data }: { data: CourseStop[] }) => {
    applyReorder(0, data);
  };

  // 위/아래 버튼 순서 변경은 모든 일차·모든 플랫폼에서 제공합니다(웹은 드래그
  // 제스처가 불안정해서 버튼이 유일한 수단입니다).
  const handleMoveStop = (dayIndex: number, index: number, direction: -1 | 1) => {
    const day = dayCourses[dayIndex];
    if (!day) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= day.course.stops.length) return;
    const stops = [...day.course.stops];
    [stops[index], stops[targetIndex]] = [stops[targetIndex], stops[index]];
    if (!reduceMotion) {
      LayoutAnimation.configureNext(LayoutAnimation.create(220, "easeInEaseOut", "opacity"));
    }
    applyReorder(dayIndex, stops);
    setLastMoved((prev) => ({ id: stops[targetIndex].attraction.content_id, token: (prev?.token ?? 0) + 1 }));
  };

  // 어느 일차든 바꾼 게 있으면 하단 '순서 저장' 버튼이 켜집니다.
  const anyOrderChanged = Object.values(changedDays).some(Boolean);

  // 순서를 바꾼 일차만 서버에 보내고, 서버가 다시 계산해준 코스로 교체한 목록을
  // 돌려줍니다(여행 저장·나누기가 이어서 최신 목록을 쓰기 위해).
  const persistOrders = async (): Promise<typeof dayCourses> => {
    const next = [...dayCourses];
    for (let i = 0; i < next.length; i++) {
      if (!changedDays[i]) continue;
      const stopOrder = next[i].course.stops.map((s) => s.attraction.content_id);
      // 서버가 새 순서 기준으로 방문 시각을 다시 계산해서 돌려줍니다 —
      // 그 결과로 화면을 갱신해야 시각이 순서와 어긋나지 않습니다.
      const updated = await api.updateCourse(next[i].course.course_id, { stopOrder });
      next[i] = { ...next[i], course: updated };
      if (i === 0) await storage.saveCourse(updated);
    }
    setDayCourses(next);
    setChangedDays({});
    return next;
  };

  const handleSaveOrder = async () => {
    if (!anyOrderChanged) return;
    if (!session) {
      Alert.alert("로그인이 필요해요", "순서를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSavingOrder(true);
    try {
      await persistOrders();
    } catch (err) {
      Alert.alert("순서 저장 실패", errorMessage(err));
    } finally {
      setSavingOrder(false);
    }
  };

  const openDayMap = (dayIndex: number) => {
    setDayPickerVisible(false);
    router.push(`/map?day=${dayIndex}`);
  };

  if (!course) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
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

  // 문 닫은 뒤 도착하거나 그날 쉬는 장소가 있으면 다음 날로 나누자고 제안합니다.
  // 나누기는 마지막 일차에서만 제안합니다 — 중간 일차를 나누면 그 뒤 일차들의
  // 날짜가 하루씩 밀려서 방문 시각과 휴무일을 전부 다시 계산해야 하기 때문입니다.
  const splitBannerFor = (dayIndex: number) => {
    const day = dayCourses[dayIndex];
    if (!day) return null;
    const overflowIndex = overflowIndexOf(dayIndex);
    if (overflowIndex < 0) return null;
    const stop = day.course.stops[overflowIndex];
    const isLastDay = dayIndex === dayCourses.length - 1;
    const canSplit = overflowIndex >= 1 && isLastDay;
    const splitting = splittingDay === dayIndex;

    return (
      <View style={styles.splitBanner}>
        <View style={styles.splitBannerTextGroup}>
          <Text style={styles.splitBannerTitle}>{stop.attraction.name}은(는) 이날 방문이 어려워요</Text>
          <Text style={styles.splitBannerBody}>
            {stop.closed_note ?? stop.time_note ?? "도착 예정 시간에 이용이 어렵습니다."}
          </Text>
          {!canSplit && (
            <Text style={styles.splitBannerBody}>
              {overflowIndex === 0
                ? "첫 장소부터라서 나눌 수 없어요. 순서를 바꾸거나 장소를 줄여보세요."
                : "마지막 날만 다음 날로 나눌 수 있어요. 순서를 바꾸거나 장소를 줄여보세요."}
            </Text>
          )}
        </View>
        {canSplit && (
          <TouchableOpacity
            style={[styles.splitButton, splitting && styles.splitButtonDisabled]}
            onPress={() => handleSplit(dayIndex)}
            disabled={splitting}
            accessibilityRole="button"
            accessibilityLabel={`${stop.attraction.name}부터 ${dayIndex + 2}일차로 나누기`}
          >
            {splitting ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.splitButtonText}>이 장소부터 {dayIndex + 2}일차로 나누기</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

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

      {/* 저장 버튼은 화면 아래 '지도로 전체 보기'와 같은 줄로 내려갔습니다. */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{course.title}</Text>
        <Text style={styles.summary}>{course.summary}</Text>
        {course.warnings?.map((warning) => (
          <View key={warning} style={styles.courseWarning}>
            <WarningCircleIcon size={13} color={colors.warningText} weight="bold" />
            <Text style={styles.courseWarningText}>{warning}</Text>
          </View>
        ))}
      </View>

      {splitBannerFor(0)}

      {dayCourses.length > 1 && (
        <Text style={styles.daySectionTitle}>
          1일차{dayCourses[0]?.visitDate ?? visitDate ? ` · ${dayCourses[0]?.visitDate ?? visitDate}` : ""}
        </Text>
      )}

      <View style={styles.orderHintRow}>
        <View style={styles.orderHintTextRow}>
          <HandTapIcon size={13} color={colors.textTertiary} weight="bold" />
          <Text style={styles.orderHint}>
            {Platform.OS === "web"
              ? "오른쪽 화살표로 순서를 바꿀 수 있어요"
              : "오른쪽 화살표나 카드를 길게 눌러 순서를 바꿀 수 있어요"}
          </Text>
        </View>
      </View>
      {anyOrderChanged && (
        <View style={styles.staleNotice}>
          <ClockCounterClockwiseIcon size={13} color={colors.textSecondary} weight="bold" />
          <Text style={styles.staleNoticeText}>아래 '순서 저장'을 누르면 방문 시간이 다시 계산돼요</Text>
        </View>
      )}
    </>
  );

  // 2일차부터는 1일차 목록의 발치에 이어서 그립니다. 순서는 위/아래 화살표로
  // 바꿉니다 — 드래그 목록을 겹쳐 쓰면 두 일차 사이로 카드가 끌려가 버립니다.
  // 저장은 하단 '순서 저장' 버튼이 모든 일차를 함께 맡습니다.
  const laterDaySections = dayCourses.length > 1 && (
    <>
      {dayCourses.slice(1).map((day, offset) => {
        const dayIndex = offset + 1;
        return (
          <View key={day.course.course_id} style={styles.nextDaySection}>
            <Text style={styles.daySectionTitle}>
              {dayIndex + 1}일차{day.visitDate ? ` · ${day.visitDate}` : ""}
            </Text>
            <Text style={styles.nextDayHint}>
              저장하면 1일차와 같은 여행에 함께 담겨요. 오른쪽 화살표로 순서를 바꾼 뒤 아래 '순서 저장'을 누르면 돼요.
            </Text>
            {splitBannerFor(dayIndex)}
            {day.course.stops.map((stop, i) => {
              const id = stop.attraction.content_id;
              return (
                <TimelineStopItem
                  key={id}
                  stop={stop}
                  userType={day.course.generated_for}
                  extraInfo={extraInfoMap[id]}
                  isFirst={i === 0}
                  isLast={i === day.course.stops.length - 1}
                  nextUnfit={day.course.stops[i + 1]?.fits_today === false}
                  timeStale={!!changedDays[dayIndex]}
                  onMoveUp={() => handleMoveStop(dayIndex, i, -1)}
                  onMoveDown={() => handleMoveStop(dayIndex, i, 1)}
                  highlightToken={lastMoved?.id === id ? lastMoved.token : 0}
                />
              );
            })}
          </View>
        );
      })}
    </>
  );

  return (
    // edges=["top"]로 상태표시줄(시계/배터리) 영역만 피해서 그립니다 — 홈 화면과 같습니다.
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {extraInfoReady ? (
        <FadeInView duration={250} style={{ flex: 1 }}>
          <DraggableFlatList
            style={{ flex: 1 }}
            containerStyle={{ flex: 1 }}
            data={course.stops}
            keyExtractor={(item) => item.attraction.content_id}
            ListHeaderComponent={listHeader}
            ListFooterComponent={
              <>
                {laterDaySections || null}
                <DataCreditLine />
              </>
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onDragEnd={handleDragEnd}
            renderItem={({ item, drag, isActive, getIndex }) => {
              const index = getIndex() ?? 0;
              const id = item.attraction.content_id;
              return (
                <ScaleDecorator>
                  <TimelineStopItem
                    stop={item}
                    userType={course.generated_for}
                    extraInfo={extraInfoMap[id]}
                    isFirst={index === 0}
                    isLast={index === course.stops.length - 1}
                    nextUnfit={course.stops[index + 1]?.fits_today === false}
                    timeStale={!!changedDays[0]}
                    onMoveUp={() => handleMoveStop(0, index, -1)}
                    onMoveDown={() => handleMoveStop(0, index, 1)}
                    onLongPress={Platform.OS === "web" ? undefined : drag}
                    isDragging={isActive}
                    highlightToken={lastMoved?.id === id ? lastMoved.token : 0}
                  />
                </ScaleDecorator>
              );
            }}
          />
        </FadeInView>
      ) : (
        // 부가 정보를 불러오는 동안에도 상단 바와 제목은 같은 자리에 그대로 둡니다.
        <View style={styles.listContent}>
          {listHeader}
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
        </View>
      )}

      {/* 화면을 끝낼 때 누르는 두 동작을 한 줄에 둡니다. 저장이 최종 동작이라
          채운 버튼으로 강조하고, 지도 보기는 테두리만 있는 보조 버튼입니다. */}
      <View style={styles.bottomBar}>
        {/* 일차가 여럿이면 어느 날을 볼지 먼저 고릅니다. 하나뿐이면 바로 엽니다. */}
        <Pressable
          style={({ pressed }) => [styles.mapButton, pressed && styles.outlineButtonPressed]}
          onPress={() => (dayCourses.length > 1 ? setDayPickerVisible(true) : openDayMap(0))}
          accessibilityRole="button"
          accessibilityLabel={
            dayCourses.length > 1 ? "지도로 볼 날짜 고르기" : "지도로 전체 동선 보기"
          }
        >
          <MapTrifoldIcon size={17} color={colors.primary} weight="bold" />
          <Text style={styles.mapButtonText}>지도로 전체 보기</Text>
        </Pressable>
        {/* 순서를 바꾸기 전에는 누를 게 없으니 흐리게 두고, 바꾸면 켜집니다. */}
        <Pressable
          style={({ pressed }) => [
            styles.orderSaveButton,
            !anyOrderChanged && styles.buttonDisabled,
            pressed && anyOrderChanged && styles.outlineButtonPressed,
          ]}
          onPress={handleSaveOrder}
          disabled={!anyOrderChanged || savingOrder}
          accessibilityRole="button"
          accessibilityLabel="순서 저장"
          accessibilityHint="바꾼 방문 순서를 저장합니다"
          accessibilityState={{ busy: savingOrder, disabled: !anyOrderChanged || savingOrder }}
        >
          {savingOrder ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.orderSaveButtonText}>순서 저장</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed]}
          onPress={openSaveModal}
          accessibilityRole="button"
          accessibilityLabel="저장"
          accessibilityHint="이 코스를 내 여행에 저장합니다"
        >
          <Text style={styles.saveButtonText}>저장</Text>
        </Pressable>
      </View>

      {/* 일차가 여럿일 때 지도로 볼 날을 고르는 시트. */}
      <Modal
        visible={dayPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDayPickerVisible(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setDayPickerVisible(false)}
          accessibilityLabel="닫기"
        >
          <Pressable style={[styles.pickerSheet, { paddingBottom: spacing.xl + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.pickerTitle}>어느 날을 지도로 볼까요?</Text>
            {dayCourses.map((day, i) => (
              <TouchableOpacity
                key={day.course.course_id}
                style={styles.pickerRow}
                onPress={() => openDayMap(i)}
                accessibilityRole="button"
                accessibilityLabel={`${i + 1}일차 지도로 보기, 장소 ${day.course.stops.length}곳`}
              >
                <MapTrifoldIcon size={16} color={colors.primary} weight="bold" />
                <Text style={styles.pickerRowText}>
                  {i + 1}일차{day.visitDate ? ` · ${day.visitDate}` : ""}
                </Text>
                <Text style={styles.pickerRowCount}>{day.course.stops.length}곳</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

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
  // 하단 바(52) + 아래 여백(20) + 목록과의 간격만큼 비워둬야 마지막 카드가 가리지 않습니다.
  listContent: { paddingTop: spacing.md, paddingBottom: 92 },
  listHeaderBar: { marginBottom: spacing.md },
  standaloneHeader: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.md },
  titleRow: { marginBottom: spacing.lg },
  title: { fontSize: 21, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.xs },
  summary: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary },
  orderHintRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm + 2 },
  orderHintTextRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  orderHint: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, flexShrink: 1 },
  staleNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  staleNoticeText: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },
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
  courseWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.warningLight,
  },
  courseWarningText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: fontFamily.semiBold, color: colors.warningText },
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
    flexShrink: 1,
  },
  nextDaySection: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  nextDayHint: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.textTertiary,
    marginBottom: spacing.md,
    lineHeight: 17,
  },
  bottomBar: {
    position: "absolute",
    bottom: spacing.xl - 4,
    left: spacing.xl - 4,
    right: spacing.xl - 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // 하단 바의 세 버튼은 높이를 52로 맞춥니다. 저장 버튼 둘은 글자 폭만큼만
  // 차지하고, 남는 폭은 전부 '지도로 전체 보기'가 가져갑니다 — 이 화면에서 가장
  // 자주 누르는 버튼이라 가장 크게 둡니다.
  mapButton: {
    flex: 1,
    height: 52,
    flexDirection: "row",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg - 2,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  mapButtonText: { color: colors.primary, fontSize: 16, fontFamily: fontFamily.bold },
  orderSaveButton: {
    height: 52,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  orderSaveButtonText: { color: colors.primary, fontSize: 14, fontFamily: fontFamily.bold },
  saveButton: {
    height: 52,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonPressed: { opacity: 0.75 },
  saveButtonText: { color: colors.onPrimary, fontSize: 14, fontFamily: fontFamily.bold },
  // 지도로 볼 날을 고르는 시트(일차가 둘 이상일 때만).
  pickerBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  pickerSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  pickerTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  pickerRowText: { flex: 1, fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.text },
  pickerRowCount: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary },
  outlineButtonPressed: { backgroundColor: colors.surfaceAlt },
  buttonDisabled: { opacity: 0.45 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.lg },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.md },
  emptyButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold },
  });
}
