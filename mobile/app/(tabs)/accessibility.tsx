import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { NotePencilIcon, XIcon, type Icon } from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccessibilityIcons, accessibilityFeatureLabels } from "../../components/AccessibilityIcons";
import { FadeInView } from "../../components/FadeInView";
import { PhotoCardHeader } from "../../components/PhotoCardHeader";
import { ProfileButton } from "../../components/ProfileButton";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { userTypeIcon } from "../../constants/userTypeIcons";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import {
  AccessibilityFeatures,
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

// 통계 필드 키(CategoryKey) ↔ 제보 API가 쓰는 카테고리 코드(ReportCategory) 매핑.
const REPORT_CATEGORY_MAP: Record<CategoryKey, ReportCategory> = {
  wheelchair_count: "wheelchair",
  visual_count: "visual",
  hearing_count: "hearing",
  senior_count: "senior",
  family_count: "family",
  pregnant_count: "pregnant",
};

// 화면에 한 번에 더 보여주는 개수 ('더보기' 한 번에 늘어나는 양).
const PLACES_PAGE_SIZE = 5;
// 서버에 한 번에 요청하는 개수. 표시 단위(5)보다 크게 잡아서, '더보기'를 네 번
// 누를 동안은 서버를 다시 부르지 않습니다 (홈 화면의 PLACES_FETCH_PAGE_SIZE와
// 같은 방식). 예전에는 6개 카테고리 × 최대 200곳을 처음에 통째로 받아왔는데,
// 응답이 240KB나 되면서 정작 쓰이는 건 고른 카테고리의 앞 5곳뿐이었습니다.
const PLACES_FETCH_PAGE_SIZE = 20;

// 유형별 편의시설 항목 수. 서버가 점수를 매길 때 세는 항목 수와 같아야 합니다
// (backend/app/services/tour_api.py의 fields_by_category / *_score 함수 참고).
const FEATURE_TOTAL: Record<CategoryKey, number> = {
  wheelchair_count: 6,
  visual_count: 7,
  hearing_count: 3,
  senior_count: 4,
  family_count: 3,
  pregnant_count: 5,
};

/**
 * 장소 카드 하나를 스크린리더가 읽을 문구입니다.
 *
 * 카드에 보이는 걸 전부 읽으면(주소·평점·시설 6개까지) 한 곳당 15초쯤 걸려서,
 * 200곳짜리 목록을 훑는 게 사실상 불가능합니다. 그래서 "여기 갈지 말지"를
 * 판단할 수 있는 만큼만 담습니다 — 이름, 등급과 개수, 대표 시설 3개.
 * 주소·평점처럼 자세한 내용은 상세 화면에서 확인합니다.
 *
 * 예: "수원광교박물관, 편의시설 많음, 7개 중 6개, 점자블록, 보조견 동반, 안내요원 외 3개"
 */
function placeAccessibilityLabel(
  place: AccessibilityPlaceScore,
  tierLabelText: string,
  count: { have: number; total: number }
): string {
  const labels = accessibilityFeatureLabels(featuresOf(place));
  const shown = labels.slice(0, 3).join(", ");
  const rest = labels.length > 3 ? ` 외 ${labels.length - 3}개` : "";
  const facilities = labels.length > 0 ? `, ${shown}${rest}` : "";
  return `${place.name}, 편의시설 ${tierLabelText}, ${count.total}개 중 ${count.have}개${facilities}`;
}

/**
 * 그 장소가 몇 개 중 몇 개를 갖췄는지 돌려줍니다.
 *
 * 서버가 보내준 features(갖춘 항목 목록)가 있으면 그 개수를 그대로 씁니다 —
 * 카드에 찍히는 칩 개수와 숫자가 정확히 같아야 하기 때문입니다. 통계 캐시가
 * 아직 갱신되지 않아 features가 비어 있으면 점수에서 되돌려 계산합니다
 * (score = 갖춘 수 ÷ 전체 × 100 이라 나눗셈을 되돌리면 정확히 떨어집니다).
 */
function featureCount(place: AccessibilityPlaceScore, category: CategoryKey): { have: number; total: number } {
  const total = FEATURE_TOTAL[category];
  const fromFeatures = place.features?.length ?? 0;
  return { have: fromFeatures || Math.round((place.score * total) / 100), total };
}

/**
 * 서버가 보내준 "갖춘 편의시설 필드명 목록"을 AccessibilityIcons가 받는 형태
 * (필드별 true/false)로 바꿔줍니다. 서버가 이미 그 유형과 관련된 항목만 골라
 * 보내주므로, 여기서 유형별 필터를 한 번 더 걸지는 않습니다.
 */
function featuresOf(place: AccessibilityPlaceScore): Partial<AccessibilityFeatures> {
  return Object.fromEntries((place.features ?? []).map((key) => [key, true]));
}

/**
 * 그 장소가 해당 유형의 편의시설을 얼마나 갖췄는지 나타내는 등급입니다.
 *
 * score는 서버에서 "갖춘 항목 수 ÷ 그 유형의 전체 항목 수 × 100"으로 계산됩니다
 * (휠체어 6개, 시각 7개, 임산부 5개, 고령자 4개, 청각·영유아가족 3개 항목).
 * 항목 수가 유형마다 다르다 보니 나올 수 있는 점수도 띄엄띄엄 다릅니다. 그래서
 * "절반쯤 갖춘 곳"이 어느 유형에서나 같은 등급이 되도록 절반(50)을 경계로 씁니다.
 * 예전에는 경계가 60이라, 똑같이 절반을 갖춰도 청각 2/3(67)은 '보통'인데
 * 휠체어 3/6(50)과 시각 4/7(57)은 '주의'로 갈리는 문제가 있었습니다.
 *
 * 유형별로 실제 등급이 갈리는 지점은 이렇습니다.
 *   휠체어(6): 많음 5~6 / 보통 3~4 / 적음 1~2
 *   시각(7):   많음 6~7 / 보통 4~5 / 적음 1~3
 *   임산부(5): 많음 4~5 / 보통 3   / 적음 1~2
 *   고령자(4): 많음 4   / 보통 2~3 / 적음 1
 *   청각(3), 영유아가족(3): 많음 3 / 보통 2 / 적음 1
 *
 * 문구가 '우수/보통/주의'가 아닌 이유: 이 목록에 오르는 곳은 이미 해당 편의시설을
 * 하나 이상 갖춰서 걸러진 곳들입니다. 그런데 '주의'는 가면 위험한 곳처럼 읽혀서,
 * 실제 뜻(등록된 편의시설이 적음)에 맞게 '많음/보통/적음'으로 바꿨습니다.
 */
type Tier = { label: string; badgeBg: string; badgeText: string; accent: string };

function tierLabel(score: number, colors: ThemeColors): Tier {
  // 배지의 배경/글자색은 테마가 짝으로 정의해둔 조합만 씁니다. 예전에는 어떤
  // 배경이든 흰 글자를 얹었는데, 그러면 대비가 부족했습니다(라이트 '보통' 2.9:1,
  // 다크는 세 등급 모두 2~3:1로 WCAG AA 4.5:1 미달). 아래 조합은 라이트/다크
  // 양쪽 모두 5:1 이상입니다. accent는 글자가 아닌 오른쪽 색 막대에 씁니다.
  if (score >= 80) {
    return { label: "많음", badgeBg: colors.primary, badgeText: colors.onPrimary, accent: colors.primary };
  }
  if (score >= 50) {
    return {
      label: "보통",
      badgeBg: colors.warningLight,
      badgeText: colors.warningText,
      accent: colors.warning,
    };
  }
  return {
    label: "적음",
    badgeBg: colors.surfaceAlt,
    badgeText: colors.textSecondary,
    accent: colors.textTertiary,
  };
}

// 카테고리 탭 하나. 선택 상태가 바뀔 때 개수/라벨 글자색과 아래 점(dot)이
// 즉시 뚝 바뀌지 않고 짧게(200ms) 보간되도록 각 탭이 자기만의 progress 값을
// 갖습니다(아이콘 자체 색은 phosphor 아이콘이 Animated 색 보간을 지원하지
// 않아 그대로 즉시 전환).
function CategoryTabButton({
  meta,
  isSelected,
  count,
  onPress,
  styles,
  colors,
}: {
  meta: (typeof CATEGORY_META)[number];
  isSelected: boolean;
  count: number | "-";
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const progress = useRef(new Animated.Value(isSelected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: isSelected ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [isSelected, progress]);

  const textColor = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.textTertiary, colors.primary] });
  const CategoryIcon = meta.icon;

  return (
    <Pressable
      style={({ pressed }) => [styles.categoryTab, pressed && styles.pressedFeedback]}
      onPress={onPress}
      // 아이콘·개수·이름을 따로 읽지 않고 한 덩어리로 묶습니다. 예전에는
      // "1224개" "지체 장애"가 따로 읽히고 버튼인지도 알 수 없었습니다.
      accessible
      accessibilityRole="tab"
      // 선택 여부는 두 가지로 함께 넘깁니다 — 앱은 accessibilityState를,
      // 웹(react-native-web)은 aria-selected만 읽습니다.
      accessibilityState={{ selected: isSelected }}
      aria-selected={isSelected}
      accessibilityLabel={`${meta.label}, ${typeof count === "number" ? `${count}곳` : "개수 불러오는 중"}`}
      accessibilityHint={isSelected ? undefined : `${meta.label} 관련 여행지 목록을 봅니다`}
    >
      <CategoryIcon size={24} color={isSelected ? colors.primary : colors.textTertiary} weight="bold" />
      <Animated.Text style={[styles.categoryCount, { color: textColor }]}>{count}개</Animated.Text>
      <Animated.Text
        style={[styles.categoryLabel, { color: textColor, fontFamily: isSelected ? fontFamily.bold : fontFamily.regular }]}
      >
        {meta.label}
      </Animated.Text>
      {meta.isMock && <Text style={styles.mockBadge}>참고용</Text>}
      <Animated.View style={[styles.categoryDot, { backgroundColor: colors.primary, opacity: progress }]} />
    </Pressable>
  );
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

  // 고른 카테고리의 '주요 여행지'를 서버에서 조금씩 받아옵니다.
  //   places       : 지금까지 받아온 목록 (이어붙임)
  //   placesTotal  : 이 카테고리에 저장된 전체 개수 ('더보기'를 언제 감출지 판단)
  //   loadingPlaces: 첫 페이지 로딩 중 (카테고리를 막 바꿨을 때)
  const [places, setPlaces] = useState<AccessibilityPlaceScore[]>([]);
  const [placesTotal, setPlacesTotal] = useState(0);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [loadingMorePlaces, setLoadingMorePlaces] = useState(false);
  // 다음에 요청할 offset. 화면을 다시 그리게 할 필요가 없는 값이라 ref로 둡니다.
  const placesOffsetRef = useRef(0);
  // 카테고리를 빠르게 연달아 바꿀 때, 먼저 보낸 요청이 늦게 도착해서 나중 것을
  // 덮어쓰는 걸 막습니다 (응답이 올 때 아직 그 카테고리인지 확인).
  const placesRequestRef = useRef(0);

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

  // 숫자만 받아옵니다(include_places=false). 목록은 아래에서 고른 카테고리만
  // 따로 받아오므로, 여기서 6개 카테고리 목록을 다 받을 이유가 없습니다.
  useEffect(() => {
    api
      .getAccessibilitySummary("경기도", false)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  // 카테고리가 바뀌면 그 카테고리의 첫 묶음을 새로 받아옵니다.
  useEffect(() => {
    const requestId = ++placesRequestRef.current;
    const category = REPORT_CATEGORY_MAP[selectedCategory];
    setLoadingPlaces(true);
    setPlaces([]);
    setPlacesTotal(0);
    placesOffsetRef.current = 0;

    api
      .getAccessibilityPlaces(category, 0, PLACES_FETCH_PAGE_SIZE)
      .then((page) => {
        // 그 사이에 카테고리를 또 바꿨으면 이 응답은 버립니다.
        if (requestId !== placesRequestRef.current) return;
        setPlaces(page.items);
        setPlacesTotal(page.total);
        placesOffsetRef.current = page.items.length;
      })
      .catch(() => {
        if (requestId !== placesRequestRef.current) return;
        setPlaces([]);
        setPlacesTotal(0);
      })
      .finally(() => {
        if (requestId !== placesRequestRef.current) return;
        setLoadingPlaces(false);
      });
  }, [selectedCategory]);

  // '더보기': 이미 받아둔 목록으로 채울 수 있으면 그냥 더 보여주고, 다 썼으면
  // 다음 묶음을 서버에서 받아옵니다.
  const showMorePlaces = useCallback(() => {
    const next = visiblePlacesCount + PLACES_PAGE_SIZE;

    // 받아둔 것으로 충분하거나, 이미 전부 받아왔으면 서버를 부르지 않습니다.
    if (next <= places.length || places.length >= placesTotal) {
      setVisiblePlacesCount(next);
      return;
    }

    const requestId = placesRequestRef.current;
    const category = REPORT_CATEGORY_MAP[selectedCategory];
    setLoadingMorePlaces(true);
    api
      .getAccessibilityPlaces(category, placesOffsetRef.current, PLACES_FETCH_PAGE_SIZE)
      .then((page) => {
        if (requestId !== placesRequestRef.current) return;
        setPlaces((prev) => [...prev, ...page.items]);
        setPlacesTotal(page.total);
        placesOffsetRef.current += page.items.length;
        setVisiblePlacesCount(next);
      })
      .catch(() => {
        // 더 못 받아왔어도 이미 보고 있던 목록은 그대로 둡니다.
        if (requestId !== placesRequestRef.current) return;
        setVisiblePlacesCount(next);
      })
      .finally(() => {
        if (requestId !== placesRequestRef.current) return;
        setLoadingMorePlaces(false);
      });
  }, [visiblePlacesCount, places.length, placesTotal, selectedCategory]);

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
  // 목록은 이제 요약이 아니라 /accessibility-places에서 조금씩 받아옵니다.
  const selectedPlaces: AccessibilityPlaceScore[] = places;

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 (홈 화면과 동일한 방식).
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            접근성 정보
          </Text>
          <ProfileButton />
        </View>
        <View style={styles.grid} accessibilityRole="tablist">
          {CATEGORY_META.map((c) => (
            <CategoryTabButton
              key={c.key}
              meta={c}
              isSelected={c.key === selectedCategory}
              count={counts[c.key] ?? "-"}
              styles={styles}
              colors={colors}
              onPress={() => {
                setSelectedCategory(c.key);
                setVisiblePlacesCount(PLACES_PAGE_SIZE); // 카테고리를 바꾸면 다시 5개부터
              }}
            />
          ))}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
            <Text style={styles.legendText}>많음</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
            <Text style={styles.legendText}>보통</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.textTertiary }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
            <Text style={styles.legendText}>적음</Text>
          </View>
        </View>
        {/* 예전 범례는 '우수 80+ / 보통 60-79 / 주의 ~59'처럼 점수 구간을 적었는데,
            유형마다 항목 수가 달라서 실제로 나올 수 없는 점수 구간이 있었습니다
            (예: 휠체어는 50 다음이 67이라 60~66점이 존재하지 않음). 숫자 대신
            무슨 뜻인지를 한 줄로 설명합니다. */}
        <Text style={styles.legendNote}>
          아래 목록은 모두 이 유형의 편의시설을 갖춘 곳입니다. 등급 옆 숫자는 이 유형의 전체 항목
          {` ${FEATURE_TOTAL[selectedCategory]}개`} 중 몇 개를 갖췄는지를 뜻합니다.
        </Text>

        <FadeInView key={`places-title-${selectedCategory}`} duration={200} translateY={6}>
          <View style={styles.sectionTitleRow}>
            <selectedMeta.icon size={16} color={colors.text} weight="bold" />
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {selectedMeta.label} 주요 여행지
            </Text>
          </View>
        </FadeInView>
        {selectedPlaces.length ? (
          selectedPlaces.slice(0, visiblePlacesCount).map((place) => {
            const tier = tierLabel(place.score, colors);
            const count = featureCount(place, selectedCategory);
            return (
              <FadeInView key={place.content_id || place.name} duration={250}>
                <Pressable
                  style={({ pressed }) => [styles.placeCard, pressed && styles.pressedFeedback]}
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
                  // 사진·등급 배지·이름·주소·평점·시설 칩이 따로따로 읽히면 한 곳을
                  // 파악하는 데만 열 번 넘게 넘겨야 해서, 카드 하나를 한 덩어리로 묶고
                  // 판단에 필요한 만큼만 읽어줍니다.
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={placeAccessibilityLabel(place, tier.label, count)}
                  accessibilityHint="두 번 탭하면 상세 정보를 봅니다"
                >
                  <PhotoCardHeader
                    imageUrl={place.image_url}
                    height={150}
                    topLeft={
                      <View
                        style={[
                          styles.tierBadge,
                          { backgroundColor: tier.badgeBg, borderColor: tier.accent },
                        ]}
                      >
                        <Text style={[styles.tierBadgeText, { color: tier.badgeText }]}>{tier.label}</Text>
                        {/* 등급만으로는 "얼마나"가 안 보여서, 몇 개 중 몇 개인지를 함께
                            적습니다. 아래 칩 개수와 정확히 같은 숫자입니다. */}
                        <Text style={[styles.tierBadgeCount, { color: tier.badgeText }]}>
                          {count.have}/{count.total}
                        </Text>
                      </View>
                    }
                    title={place.name}
                    titleNumberOfLines={1}
                    subtitle={place.address}
                    rating={place.avg_rating}
                    reviewCount={place.review_count}
                  />
                  {/* 사진 아래에는 "이 곳이 실제로 갖춘 편의시설"을 보여줍니다. 등급
                      배지만으로는 무엇이 많은지 알 수 없어서, 상세 페이지에 들어가지
                      않아도 내게 필요한 시설이 있는지 바로 판단할 수 있게 합니다.
                      서버가 이 유형과 관련된 항목만 보내주므로 그대로 그립니다. */}
                  {!!place.features?.length && (
                    <View style={styles.placeCardBody}>
                      <AccessibilityIcons features={featuresOf(place)} />
                    </View>
                  )}
                </Pressable>
              </FadeInView>
            );
          })
        ) : loadingPlaces ? (
          // 카테고리를 막 바꿔서 아직 받아오는 중. "없어요"라고 단정하면 안 됩니다.
          <Text style={styles.emptyText} accessibilityLiveRegion="polite">
            {selectedMeta.label} 주요 여행지를 불러오는 중이에요.
          </Text>
        ) : (
          <Text style={styles.emptyText}>
            {selectedMeta.label} 관련 편의시설 정보가 있는 장소가 아직 없어요.
          </Text>
        )}

        {visiblePlacesCount < placesTotal && (
          <Pressable
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressedFeedback]}
            onPress={showMorePlaces}
            disabled={loadingMorePlaces}
            accessibilityRole="button"
            accessibilityLabel={loadingMorePlaces ? "불러오는 중" : "더보기"}
            accessibilityHint={`여행지 ${PLACES_PAGE_SIZE}곳을 더 불러옵니다`}
            accessibilityState={{ disabled: loadingMorePlaces, busy: loadingMorePlaces }}
          >
            <Text style={styles.moreButtonText}>
              {loadingMorePlaces ? "불러오는 중..." : "더보기"}
            </Text>
          </Pressable>
        )}

        <View style={styles.divider} />

        <View style={styles.reportHeaderRow}>
          <FadeInView key={`reports-title-${selectedCategory}`} duration={200} translateY={6}>
            <View style={styles.reportTitleRow}>
              <NotePencilIcon size={16} color={colors.text} weight="bold" />
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {selectedMeta.label} 최근 제보
              </Text>
            </View>
          </FadeInView>
          <Pressable
            style={({ pressed }) => [styles.reportButton, pressed && styles.pressedFeedback]}
            onPress={openReportModal}
            accessibilityRole="button"
            accessibilityLabel="제보하기"
            accessibilityHint={`${selectedMeta.label} 관련 접근성 정보를 등록합니다`}
          >
            <Text style={styles.reportButtonText}>제보하기</Text>
          </Pressable>
        </View>

        {loadingReports ? (
          <FadeInView duration={200} translateY={0}>
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          </FadeInView>
        ) : reports.length === 0 ? (
          <Text style={styles.emptyText}>아직 {selectedMeta.label} 관련 제보가 없어요. 첫 제보를 남겨보세요!</Text>
        ) : (
          reports.map((r) => (
            <FadeInView key={r.id} duration={250}>
              <View style={styles.reportCard}>
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
            </FadeInView>
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
                  <Pressable
                    style={({ pressed }) => pressed && styles.pressedFeedback}
                    onPress={() => setSelectedPlace(null)}
                  >
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
                      style={({ pressed }) => [styles.searchResultRow, pressed && styles.pressedFeedback]}
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
                      style={({ pressed }) => [
                        styles.reportCategoryChip,
                        chipSelected && styles.reportCategoryChipSelected,
                        pressed && styles.pressedFeedback,
                      ]}
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
                <Pressable
                  style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressedFeedback]}
                  onPress={() => setReportModalVisible(false)}
                >
                  <Text style={styles.modalCancelButtonText}>취소</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalSubmitButton,
                    submittingReport && styles.buttonDisabled,
                    pressed && !submittingReport && styles.pressedFeedback,
                  ]}
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
  // Pressable은 TouchableOpacity와 달리 기본 눌림 피드백이 없어서, 눌렀을 때
  // 살짝 옅어지도록 공통으로 얹어주는 스타일입니다.
  pressedFeedback: { opacity: 0.6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: spacing.xl, paddingBottom: spacing.xxl + spacing.sm },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text },

  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg, marginBottom: spacing.xl - 4 },
  categoryTab: { width: "33.33%", alignItems: "center", gap: spacing.xs + 2 },
  categoryCount: { fontSize: 13, fontFamily: fontFamily.extraBold, color: colors.textTertiary, fontVariant: ["tabular-nums"] },
  categoryLabel: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary },
  categoryDot: { width: 4, height: 4, borderRadius: 2, marginTop: -4 },
  mockBadge: { fontSize: 10, color: colors.warning, fontFamily: fontFamily.semiBold },

  legendRow: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary },
  legendNote: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.regular,
    color: colors.textTertiary,
    marginBottom: spacing.xl,
  },

  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginBottom: spacing.md },
  reportTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  sectionTitle: { fontSize: 16, fontFamily: fontFamily.extraBold, color: colors.text },
  // 홈 화면 '인기 여행지'와 같은 사진 카드 형태입니다. 사진 위에 이름/주소/등급이
  // 얹히고(PhotoCardHeader), 그 아래 본문에 갖춘 편의시설 칩이 붙습니다.
  placeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: "hidden", // 둥근 모서리가 사진에도 적용되도록
  },
  placeCardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  // 예전에는 점수(숫자)를 담은 원형 배지였는데, 숫자만으로는 그 유형에서 어느
  // 정도인지 알기 어려워 등급 문구를 그대로 보여주는 알약 모양으로 바꿨습니다.
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  tierBadgeText: { fontFamily: fontFamily.bold, fontSize: 12 },
  // 등급 문구가 주인공이고 개수는 보조 정보라 조금 작고 연하게 둡니다.
  tierBadgeCount: { fontFamily: fontFamily.semiBold, fontSize: 11, opacity: 0.8 },
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
