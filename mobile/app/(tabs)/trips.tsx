import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ChatCircleTextIcon,
  HeartIcon,
  type Icon,
  MapPinIcon,
  PersonSimpleWalkIcon,
  StarIcon,
  SuitcaseIcon,
  UsersIcon,
  UsersThreeIcon,
} from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { DateRangePickerModal } from "../../components/DateRangePickerModal";
import { ProfileButton } from "../../components/ProfileButton";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { userTypeIcon } from "../../constants/userTypeIcons";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import {
  COURSE_CATEGORIES,
  CourseCategory,
  MyReportItem,
  MyReviewItem,
  ReportCategory,
  TripSummary,
  VisitedPlace,
} from "../../types";

const CATEGORY_ICON: Record<string, Icon> = {
  가족: UsersThreeIcon,
  커플: HeartIcon,
  친구: UsersIcon,
  혼자: PersonSimpleWalkIcon,
  기타: MapPinIcon,
};

// 접근성 제보 카테고리 표시 라벨 (접근성 탭과 동일한 명칭/아이콘으로 맞춥니다).
const REPORT_CATEGORY_META: Record<ReportCategory, { icon: Icon; label: string }> = {
  wheelchair: { icon: userTypeIcon.wheelchair, label: "지체 장애" },
  visual: { icon: userTypeIcon.visual, label: "시각 장애" },
  hearing: { icon: userTypeIcon.hearing, label: "청각 장애" },
  senior: { icon: userTypeIcon.senior, label: "고령자" },
  family: { icon: userTypeIcon.family, label: "영유아 가족" },
  pregnant: { icon: userTypeIcon.pregnant, label: "임산부" },
};

type StatSection = "trips" | "reviews" | "reports" | "visited";

function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}

/**
 * '내 여행' 탭. 첫 화면('내가 만든 여행')은 여행별로 묶인 목록(수정/삭제
 * 가능, 각 카드에 '방문 완료' 버튼도 있음)입니다. 상단 통계 카드 4개
 * (저장한 경로/리뷰 작성/접근성 제보/방문한 여행지) 모두 실제 값입니다.
 *
 * 세 카드를 누르면 별도 화면으로 이동하는 대신, 바로 아래 목록 영역이 그
 * 카드에 맞는 내용(저장한 경로 전체 / 내가 쓴 리뷰 / 내가 쓴 접근성 제보)으로
 * 바뀝니다. 같은 카드를 다시 누르면 원래 '내가 만든 여행' 목록으로 돌아갑니다.
 */
export default function TripsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewCount, setReviewCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [visitedCount, setVisitedCount] = useState(0);
  const [visitingTripId, setVisitingTripId] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<StatSection>("trips");
  const [loadedSections, setLoadedSections] = useState<Set<StatSection>>(new Set(["trips"]));
  const [sectionLoading, setSectionLoading] = useState(false);
  const [reviews, setReviews] = useState<MyReviewItem[]>([]);
  const [reports, setReports] = useState<MyReportItem[]>([]);
  const [visitedPlaces, setVisitedPlaces] = useState<VisitedPlace[]>([]);
  const [editingVisitedId, setEditingVisitedId] = useState<string | null>(null);
  const [editingVisitedDate, setEditingVisitedDate] = useState<string | null>(null);
  const [visitedDateModalVisible, setVisitedDateModalVisible] = useState(false);

  const [editingTrip, setEditingTrip] = useState<TripSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<CourseCategory>("가족");
  const [editCustomCategoryText, setEditCustomCategoryText] = useState("");
  const [editStartDate, setEditStartDate] = useState<string | null>(null);
  const [editEndDate, setEditEndDate] = useState<string | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listTrips()
      .then(setTrips)
      .catch(() => Alert.alert("불러오기 실패", "여행 목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
    api
      .getMyReviewCount()
      .then((res) => setReviewCount(res.count))
      .catch(() => setReviewCount(0));
    api
      .getMyReportCount()
      .then((res) => setReportCount(res.count))
      .catch(() => setReportCount(0));
    api
      .getMyVisitedCount()
      .then((res) => setVisitedCount(res.count))
      .catch(() => setVisitedCount(0));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // 통계 카드를 누르면 여기서 그 섹션으로 전환합니다. 이미 그 섹션을 보고
  // 있으면(같은 카드를 다시 누르면) '내가 만든 여행'으로 되돌아갑니다.
  // '저장한 경로'는 별도 목록이 아니라 '내가 만든 여행'(여행별 묶음 목록)과
  // 똑같은 내용을 보여줘서, 그냥 'trips'로 돌아가는 것과 같습니다.
  // '리뷰 작성'/'접근성 제보'는 로그인한 사용자 것만 있는 정보라, 비로그인
  // 상태면 조회 자체를 하지 않고 로그인 안내만 띄웁니다.
  const selectSection = (section: StatSection) => {
    if (section === "trips") {
      setActiveSection("trips");
      return;
    }
    if (activeSection === section) {
      setActiveSection("trips");
      return;
    }
    if (!session) {
      Alert.alert("로그인이 필요해요", "내가 쓴 내용을 보려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setActiveSection(section);
    if (loadedSections.has(section)) return;

    setSectionLoading(true);
    const finish = () => {
      setSectionLoading(false);
      setLoadedSections((prev) => new Set(prev).add(section));
    };
    if (section === "reviews") {
      api.getMyReviews().then(setReviews).catch(() => setReviews([])).finally(finish);
    } else if (section === "reports") {
      api.getMyReports().then(setReports).catch(() => setReports([])).finally(finish);
    } else if (section === "visited") {
      api.getMyVisitedPlaces().then(setVisitedPlaces).catch(() => setVisitedPlaces([])).finally(finish);
    }
  };

  const handleDelete = (tripId: string, name: string) => {
    Alert.alert("여행을 삭제할까요?", `"${name}"과 그 안의 저장된 코스가 모두 삭제됩니다. 되돌릴 수 없어요.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteTrip(tripId);
            setTrips((prev) => prev.filter((t) => t.trip_id !== tripId));
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  const handleMarkVisited = (tripId: string, name: string, isVisited: boolean) => {
    if (isVisited) {
      Alert.alert(
        "방문 완료를 취소할까요?",
        `"${name}"에 담긴 관광지들의 방문 기록을 지웁니다.`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "확인",
            onPress: async () => {
              setVisitingTripId(tripId);
              try {
                await api.unmarkTripVisited(tripId);
                setTrips((prev) => prev.map((t) => (t.trip_id === tripId ? { ...t, visited: false } : t)));
                const res = await api.getMyVisitedCount();
                setVisitedCount(res.count);
                // 이미 '방문한 여행지' 목록을 한 번 봤었다면, 방금 지워진 내용이
                // 반영되도록 다음번엔 다시 조회하게 캐시 표시를 지워둡니다.
                setLoadedSections((prev) => {
                  const next = new Set(prev);
                  next.delete("visited");
                  return next;
                });
              } catch (err) {
                Alert.alert("처리 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
              } finally {
                setVisitingTripId(null);
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      "방문 완료로 표시할까요?",
      `"${name}"에 담긴 관광지들을 방문한 여행지로 표시합니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "확인",
          onPress: async () => {
            setVisitingTripId(tripId);
            try {
              const { visited_count } = await api.markTripVisited(tripId);
              Alert.alert("완료!", `관광지 ${visited_count}곳을 방문한 여행지로 표시했어요.`);
              setTrips((prev) => prev.map((t) => (t.trip_id === tripId ? { ...t, visited: true } : t)));
              const res = await api.getMyVisitedCount();
              setVisitedCount(res.count);
              // 이미 '방문한 여행지' 목록을 한 번 봤었다면, 방금 추가된 내용이
              // 반영되도록 다음번엔 다시 조회하게 캐시 표시를 지워둡니다.
              setLoadedSections((prev) => {
                const next = new Set(prev);
                next.delete("visited");
                return next;
              });
            } catch (err) {
              Alert.alert("처리 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
            } finally {
              setVisitingTripId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeleteVisited = (visitedId: string, placeName: string) => {
    Alert.alert("방문 기록을 삭제할까요?", `"${placeName}"을(를) 방문한 여행지 목록에서 제거합니다.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteVisitedPlace(visitedId);
            setVisitedPlaces((prev) => prev.filter((v) => v.id !== visitedId));
            setVisitedCount((prev) => Math.max(0, prev - 1));
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  const openEditVisitedDate = (item: VisitedPlace) => {
    setEditingVisitedId(item.id);
    setEditingVisitedDate(item.visited_at?.slice(0, 10) ?? null);
    setVisitedDateModalVisible(true);
  };

  const handleSaveVisitedDate = async (newDate: string | null) => {
    if (!editingVisitedId || !newDate) {
      setVisitedDateModalVisible(false);
      return;
    }
    try {
      const updated = await api.updateVisitedDate(editingVisitedId, newDate);
      setVisitedPlaces((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    } catch (err) {
      Alert.alert("수정 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setVisitedDateModalVisible(false);
      setEditingVisitedId(null);
    }
  };

  const openEdit = (trip: TripSummary) => {
    setEditingTrip(trip);
    setEditName(trip.name);
    // 이미 저장된 분류가 5개 기본 항목 중 하나가 아니면(예전에 '기타'로 직접
    // 입력해둔 값), '기타'를 선택된 상태로 보여주고 그 텍스트를 입력창에 채워둡니다.
    if (COURSE_CATEGORIES.includes(trip.category)) {
      setEditCategory(trip.category);
      setEditCustomCategoryText("");
    } else {
      setEditCategory("기타");
      setEditCustomCategoryText(trip.category);
    }
    setEditStartDate(trip.start_date ?? null);
    setEditEndDate(trip.end_date ?? null);
  };

  const handleSaveEdit = async () => {
    if (!editingTrip) return;
    if (!editName.trim()) {
      Alert.alert("이름을 입력해주세요");
      return;
    }
    if (editCategory === "기타" && !editCustomCategoryText.trim()) {
      Alert.alert("분류를 입력해주세요", "'기타'를 선택하셨으면 원하는 분류를 직접 입력해주세요.");
      return;
    }
    const finalCategory =
      editCategory === "기타" && editCustomCategoryText.trim() ? editCustomCategoryText.trim() : editCategory;
    setIsSavingEdit(true);
    try {
      const updated = await api.updateTrip(editingTrip.trip_id, {
        name: editName.trim(),
        category: finalCategory,
        startDate: editStartDate,
        endDate: editEndDate,
      });
      setTrips((prev) => prev.map((t) => (t.trip_id === updated.trip_id ? { ...t, ...updated } : t)));
      setEditingTrip(null);
    } catch (err) {
      Alert.alert("수정 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const totalSavedCourses = trips.reduce((sum, t) => sum + t.course_count, 0);

  const SECTION_TITLE: Record<StatSection, string> = {
    trips: "내가 만든 여행",
    reviews: "내가 쓴 리뷰",
    reports: "내가 쓴 접근성 제보",
    visited: "방문한 여행지",
  };
  // 카드를 선택하면 맨 위 큰 제목도 그 카드 이름에 맞게 바뀝니다.
  const TOP_TITLE: Record<StatSection, string> = {
    trips: "저장한 경로",
    reviews: "리뷰 작성",
    reports: "접근성 제보",
    visited: "방문한 여행지",
  };

  const StatsHeader = (
    <View style={styles.headerArea}>
      <View style={styles.header}>
        <Text style={styles.title}>{TOP_TITLE[activeSection]}</Text>
        <ProfileButton />
      </View>

      <View style={styles.statsGrid}>
        {(() => {
          const tabs: { key: StatSection; icon: Icon; value: number; label: string }[] = [
            { key: "visited", icon: MapPinIcon, value: visitedCount, label: "방문한 여행지" },
            { key: "trips", icon: SuitcaseIcon, value: totalSavedCourses, label: "저장한 경로" },
            { key: "reviews", icon: ChatCircleTextIcon, value: reviewCount, label: "리뷰 작성" },
            { key: "reports", icon: userTypeIcon.wheelchair, value: reportCount, label: "접근성 제보" },
          ];
          return tabs.map((t) => {
            const isActive = activeSection === t.key;
            const TabIcon = t.icon;
            return (
              <TouchableOpacity key={t.key} style={styles.statTab} onPress={() => selectSection(t.key)}>
                <TabIcon size={24} color={isActive ? colors.primary : colors.textTertiary} weight="bold" />
                <View style={styles.statTextGroup}>
                  <Text style={[styles.statValue, isActive && styles.statValueActive]}>{t.value}</Text>
                  <Text style={[styles.statLabel, isActive && styles.statLabelActive]}>{t.label}</Text>
                </View>
                <View style={[styles.statDot, isActive && styles.statDotActive]} />
              </TouchableOpacity>
            );
          });
        })()}
      </View>

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{SECTION_TITLE[activeSection]}</Text>
        {activeSection !== "trips" && (
          <TouchableOpacity onPress={() => setActiveSection("trips")}>
            <Text style={styles.backLink}>← 여행 목록으로</Text>
          </TouchableOpacity>
        )}
      </View>
      {sectionLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // 섹션에 따라 FlatList에 넘길 데이터/렌더러를 고릅니다. 데이터 형태(여행/코스/
  // 리뷰/제보)가 서로 달라서, 하나의 FlatList를 재사용하되 이 부분만 바뀝니다.
  let listData: any[] = trips;
  let keyExtractor = (item: any) => item.trip_id;
  let emptyText = "아직 저장한 여행이 없어요.";
  let emptyHint: string | null = 'AI 플래너에서 코스를 만들고 "저장"을 눌러보세요.';
  let renderItem = ({ item }: { item: TripSummary }) => {
    const dateLabel = formatDateRange(item.start_date, item.end_date);
    const CatIcon = CATEGORY_ICON[item.category] ?? MapPinIcon;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push({ pathname: "/trip-detail", params: { tripId: item.trip_id, tripName: item.name } })}
      >
        <View style={styles.rowIcon}>
          <CatIcon size={16} color={colors.primary} weight="bold" />
        </View>
        <View style={styles.rowContent}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>{item.category}</Text>
              </View>
              {item.visited && (
                <View style={styles.visitedBadge}>
                  <CheckCircleIcon size={11} color={colors.onPrimary} weight="fill" />
                  <Text style={styles.visitedBadgeText}>방문 완료</Text>
                </View>
              )}
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity onPress={() => openEdit(item)} hitSlop={10}>
                <Text style={styles.editText}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item.trip_id, item.name)} hitSlop={10}>
                <Text style={styles.deleteText}>삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {dateLabel && (
            <View style={styles.dateLabelRow}>
              <CalendarBlankIcon size={11} color={colors.textSecondary} weight="bold" />
              <Text style={styles.dateLabel}>{dateLabel}</Text>
            </View>
          )}
          <Text style={styles.meta}>코스 {item.course_count}개</Text>

          <TouchableOpacity
            style={[styles.visitButton, item.visited && styles.visitButtonDone]}
            onPress={() => handleMarkVisited(item.trip_id, item.name, item.visited)}
            disabled={visitingTripId === item.trip_id}
          >
            {visitingTripId === item.trip_id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <View style={styles.visitButtonContentRow}>
                {item.visited && <CheckCircleIcon size={12} color={colors.textSecondary} weight="fill" />}
                <Text style={[styles.visitButtonText, item.visited && styles.visitButtonTextDone]}>
                  {item.visited ? "방문 완료됨 (누르면 취소)" : "방문 완료"}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (activeSection === "reviews") {
    listData = reviews;
    keyExtractor = (item: MyReviewItem) => item.id;
    emptyText = "아직 작성한 리뷰가 없어요.";
    emptyHint = null;
    renderItem = ({ item }: { item: MyReviewItem }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          router.push({ pathname: "/attraction-detail", params: { contentId: item.content_id, name: item.place_name } })
        }
      >
        <View style={styles.rowIcon}>
          <ChatCircleTextIcon size={16} color={colors.primary} weight="bold" />
        </View>
        <View style={styles.rowContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.name} numberOfLines={1}>
              {item.place_name}
            </Text>
            <View style={styles.reviewStarsRow}>
              {Array.from({ length: 5 }).map((_, i) => (
                <StarIcon key={i} size={13} color="#E0A100" weight={i < item.rating ? "fill" : "regular"} />
              ))}
            </View>
          </View>
          <Text style={styles.meta}>{item.body}</Text>
        </View>
      </TouchableOpacity>
    );
  } else if (activeSection === "reports") {
    listData = reports;
    keyExtractor = (item: MyReportItem) => item.id;
    emptyText = "아직 작성한 접근성 제보가 없어요.";
    emptyHint = null;
    renderItem = ({ item }: { item: MyReportItem }) => {
      const meta = REPORT_CATEGORY_META[item.category];
      const ReportIcon = meta?.icon ?? MapPinIcon;
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() =>
            router.push({ pathname: "/attraction-detail", params: { contentId: item.content_id, name: item.place_name } })
          }
        >
          <View style={styles.rowIcon}>
            <ReportIcon size={16} color={colors.primary} weight="bold" />
          </View>
          <View style={styles.rowContent}>
            <View style={styles.cardHeader}>
              <Text style={styles.name} numberOfLines={1}>
                {item.place_name}
              </Text>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>{meta?.label ?? item.category}</Text>
              </View>
            </View>
            <Text style={styles.meta}>{item.body}</Text>
          </View>
        </TouchableOpacity>
      );
    };
  } else if (activeSection === "visited") {
    listData = visitedPlaces;
    keyExtractor = (item: VisitedPlace) => item.id;
    emptyText = "아직 방문 완료로 표시한 여행지가 없어요.";
    emptyHint = "'내가 만든 여행' 카드의 '방문 완료' 버튼을 눌러보세요.";
    renderItem = ({ item }: { item: VisitedPlace }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          router.push({ pathname: "/attraction-detail", params: { contentId: item.content_id, name: item.place_name } })
        }
      >
        <View style={styles.rowIcon}>
          <MapPinIcon size={16} color={colors.primary} weight="bold" />
        </View>
        <View style={styles.rowContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.name} numberOfLines={1}>
              {item.place_name}
            </Text>
            <View style={styles.cardActions}>
              <TouchableOpacity onPress={() => openEditVisitedDate(item)} hitSlop={10}>
                <Text style={styles.editText}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteVisited(item.id, item.place_name)} hitSlop={10}>
                <Text style={styles.deleteText}>삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.meta}>{item.visited_at?.slice(0, 10)} 방문</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 (홈 화면과 동일한 방식).
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        ListHeaderComponent={StatsHeader}
        ListEmptyComponent={
          !sectionLoading ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{emptyText}</Text>
              {emptyHint && <Text style={styles.emptyHint}>{emptyHint}</Text>}
            </View>
          ) : null
        }
        renderItem={renderItem}
      />

      <Modal visible={!!editingTrip} animationType="slide" transparent onRequestClose={() => setEditingTrip(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>여행 수정</Text>
              <TouchableOpacity onPress={() => setEditingTrip(null)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>여행 이름</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.fieldLabel}>분류</Text>
            <View style={styles.categoryRow}>
              {COURSE_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, editCategory === c && styles.categoryChipSelected]}
                  onPress={() => setEditCategory(c)}
                >
                  <Text style={[styles.categoryChipText, editCategory === c && styles.categoryChipTextSelected]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {editCategory === "기타" && (
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="분류를 직접 입력해주세요 (예: 등산, 반려동물 동반)"
                placeholderTextColor={colors.textTertiary}
                value={editCustomCategoryText}
                onChangeText={setEditCustomCategoryText}
                maxLength={20}
              />
            )}

            <Text style={styles.fieldLabel}>여행 날짜 (선택)</Text>
            <TouchableOpacity style={styles.dateButton} onPress={() => setDateModalVisible(true)}>
              <CalendarBlankIcon size={16} color={colors.text} weight="bold" />
              <Text style={styles.dateButtonText}>
                {editStartDate && editEndDate
                  ? `${editStartDate} ~ ${editEndDate}`
                  : editStartDate
                    ? editStartDate
                    : "날짜 선택하기"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, isSavingEdit && styles.confirmButtonDisabled]}
              onPress={handleSaveEdit}
              disabled={isSavingEdit}
            >
              {isSavingEdit ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmButtonText}>저장하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DateRangePickerModal
        visible={dateModalVisible}
        initialStartDate={editStartDate}
        initialEndDate={editEndDate}
        onClose={() => setDateModalVisible(false)}
        onConfirm={(s, e) => {
          setEditStartDate(s);
          setEditEndDate(e);
        }}
      />

      {/* 방문 날짜 수정용. 원래 기간 선택 모달이지만, 시작일=종료일로 같이
          넣어서 단일 날짜 선택처럼 씁니다(시작일만 최종 반영). */}
      <DateRangePickerModal
        visible={visitedDateModalVisible}
        initialStartDate={editingVisitedDate}
        initialEndDate={editingVisitedDate}
        onClose={() => setVisitedDateModalVisible(false)}
        onConfirm={(s) => handleSaveVisitedDate(s)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.xl - 4, paddingTop: 0 },
  headerArea: { paddingTop: spacing.xl - 4, paddingBottom: spacing.xs },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text },

  statsGrid: { flexDirection: "row", marginBottom: spacing.xl },
  statTab: { flex: 1, alignItems: "center", gap: spacing.sm + 2 },
  statTextGroup: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 15, fontFamily: fontFamily.extraBold, color: colors.textTertiary, fontVariant: ["tabular-nums"] },
  statValueActive: { color: colors.primary },
  statLabel: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center" },
  statLabelActive: { color: colors.primary, fontFamily: fontFamily.bold },
  statDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent", marginTop: -2 },
  statDotActive: { backgroundColor: colors.primary },

  sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  sectionTitle: { fontSize: 16, fontFamily: fontFamily.extraBold, color: colors.text },
  backLink: { fontSize: 13, color: colors.primary, fontFamily: fontFamily.semiBold },
  reviewStarsRow: { flexDirection: "row", gap: 1, marginLeft: spacing.sm },

  emptyBox: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.textSecondary, marginBottom: spacing.xs + 2 },
  emptyHint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center" },

  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowContent: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  visitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs - 2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  visitedBadgeText: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.onPrimary },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs + 2 },
  cardActions: { flexDirection: "row", gap: spacing.md },
  categoryBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  categoryBadgeText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.primary },
  editText: { fontSize: 13, color: colors.primary, fontFamily: fontFamily.semiBold },
  deleteText: { fontSize: 13, color: colors.danger, fontFamily: fontFamily.semiBold },
  name: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text, flexShrink: 1 },
  dateLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: 2 },
  dateLabel: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary },
  meta: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary },
  visitButton: {
    marginTop: spacing.md,
    alignSelf: "flex-end",
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 3,
  },
  visitButtonContentRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  visitButtonText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.primary },
  visitButtonDone: { backgroundColor: colors.border },
  visitButtonTextDone: { color: colors.textSecondary },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  modalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl - 4,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  modalTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontFamily: fontFamily.semiBold },
  fieldLabel: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.text,
  },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  categoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  categoryChipTextSelected: { color: colors.onPrimary },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  dateButtonText: { fontSize: 14, fontFamily: fontFamily.semiBold, color: colors.text },
  confirmButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.md + 3,
    alignItems: "center",
    marginTop: spacing.xl - 4,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fontFamily.bold },
  });
}
