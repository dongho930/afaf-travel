import { useFocusEffect, useRouter } from "expo-router";
import { MapPinIcon, SparkleIcon, WheelchairIcon, type Icon } from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccessibilityIcons } from "../../components/AccessibilityIcons";
import { AppLogo } from "../../components/AppLogo";
import { PhotoCardHeader } from "../../components/PhotoCardHeader";
import { getCongestionDisplay } from "../../constants/congestion";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useCourseContext } from "../../services/CourseContext";
import { useTheme } from "../../services/ThemeContext";
import { Attraction, RegionOption, UserProfile } from "../../types";

const REGION_CHIPS = ["전체", "수원", "용인", "성남", "고양", "안양"];
const CATEGORY_CHIPS = ["전체", "관광지", "문화시설", "레포츠", "숙박", "음식점"];
// 인기 여행지 목록에서 아예 제외할 카테고리 (필터 칩으로도 고를 수 없고, '전체'를
// 선택해도 안 보입니다). 나중에 다시 보이게 하려면 이 배열을 비우면 됩니다.
const EXCLUDED_CATEGORIES = ["축제/공연/행사", "여행코스", "쇼핑"];

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { setPendingQueryText } = useCourseContext();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("전체");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [wheelchairOnly, setWheelchairOnly] = useState(false);

  const [totalAccessibleCount, setTotalAccessibleCount] = useState<number | null>(null);
  const [supportedRegionCount, setSupportedRegionCount] = useState<number | null>(null);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [popularPlaces, setPopularPlaces] = useState<Attraction[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const PLACES_PAGE_SIZE = 6;
  const [visiblePlacesCount, setVisiblePlacesCount] = useState(PLACES_PAGE_SIZE);
  // '더보기'를 빠르게 여러 번 눌러도 안전하게 순서대로 진행되도록, 화면이 아직
  // 리렌더링하기 전이라도 항상 최신 값을 즉시 참조할 수 있는 ref를 같이 둡니다.
  // (state만 쓰면, 리렌더링 전에 또 누를 때 예전 값을 기준으로 계산해서
  // 같은 구간을 중복 조회하거나 건너뛰는 문제가 있었습니다.)
  const visiblePlacesCountRef = React.useRef(PLACES_PAGE_SIZE);

  // 프로필 사진은 다른 화면(프로필 화면)에서 바뀔 수 있어서, 이 탭에 다시
  // 들어올 때마다 최신 상태로 불러옵니다.
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setProfile(null);
        return;
      }
      api
        .getMyProfile()
        .then(setProfile)
        .catch(() => setProfile(null));
    }, [session])
  );

  React.useEffect(() => {
    // '무장애 여행지' 개수는 휠체어/유모차/고령자·임산부를 모두 합친(중복 제거) 실제 계산값입니다.
    api
      .getAccessibilitySummary("경기도")
      .then((s) => setTotalAccessibleCount(s.total_accessible_count))
      .catch(() => setTotalAccessibleCount(null));

    // '지원 지역' 개수는 실제 시/군/구 목록의 개수이자, 지역 칩(수원/용인/...)을
    // 실제 시군구 코드로 변환하는 데도 이 목록을 그대로 씁니다.
    api
      .listRegions("경기도")
      .then((regions) => {
        setRegionOptions(regions);
        setSupportedRegionCount(regions.length);
      })
      .catch(() => setSupportedRegionCount(null));
  }, []);

  React.useEffect(() => {
    // 선택된 지역 칩("수원" 등)에 해당하는 시/군/구 코드를 찾아서 필터링합니다.
    // "전체"거나 아직 지역 목록을 못 받아왔으면 코드 없이(경기도 전체) 조회합니다.
    const matchedRegion =
      selectedRegion !== "전체" ? regionOptions.find((r) => r.name.includes(selectedRegion)) : null;

    setLoadingPlaces(true);
    setVisiblePlacesCount(PLACES_PAGE_SIZE);
    visiblePlacesCountRef.current = PLACES_PAGE_SIZE;
    // 목록 자체는 소개문 없이(include_overview=false) 빠르게 받고, 처음 보이는
    // 6개의 소개문만 바로 이어서 따로 채웁니다. 나머지는 '더보기' 누를 때마다
    // 그 시점에 새로 보이는 6개씩만 채워서, 한 번에 50개를 다 채우려다 뒤쪽이
    // 6초 제한에 밀리는 문제를 피합니다.
    api
      .listAttractions("경기도", wheelchairOnly ? "wheelchair" : "general", matchedRegion?.code ?? null, 50, false)
      .then((places) => {
        // 축제/공연/행사, 여행코스, 쇼핑은 인기 여행지 목록에서 아예 제외합니다.
        const filtered = places.filter((p) => !EXCLUDED_CATEGORIES.includes(p.category));
        setPopularPlaces(filtered);
        // 사진이 있는 관광지 중 하나를 무작위로 골라 상단 배너 배경으로 씁니다.
        // 새로고침(필터/지역 변경으로 목록을 다시 받아올 때)마다 다시 뽑히니
        // 매번 다른 사진이 나옵니다.
        const withImage = filtered.filter((p) => !!p.image_url);
        setHeroImageUrl(
          withImage.length > 0
            ? withImage[Math.floor(Math.random() * withImage.length)].image_url ?? null
            : null
        );
        const firstIds = filtered.slice(0, PLACES_PAGE_SIZE).map((p) => p.content_id);
        if (firstIds.length > 0) {
          api
            .getOverviews(firstIds)
            .then((overviews) => {
              setPopularPlaces((prev) =>
                prev.map((p) => (overviews[p.content_id] ? { ...p, overview: overviews[p.content_id] } : p))
              );
            })
            .catch(() => {});
        }
      })
      .catch(() => setPopularPlaces([]))
      .finally(() => setLoadingPlaces(false));
  }, [wheelchairOnly, selectedRegion, regionOptions]);

  const handleShowMorePlaces = () => {
    // ref가 항상 최신 값이라, 리렌더링을 기다리지 않고도 정확한 시작 지점을 씁니다.
    const start = visiblePlacesCountRef.current;
    const nextCount = Math.min(start + PLACES_PAGE_SIZE, popularPlaces.length);
    if (nextCount <= start) return; // 이미 끝까지 다 보여준 상태면 아무것도 안 함
    visiblePlacesCountRef.current = nextCount;
    setVisiblePlacesCount(nextCount);

    const newlyRevealedIds = popularPlaces
      .slice(start, nextCount)
      .filter((p) => !p.overview)
      .map((p) => p.content_id);
    if (newlyRevealedIds.length > 0) {
      api
        .getOverviews(newlyRevealedIds)
        .then((overviews) => {
          setPopularPlaces((prev) =>
            prev.map((p) => (overviews[p.content_id] ? { ...p, overview: overviews[p.content_id] } : p))
          );
        })
        .catch(() => {});
    }
  };

  const goToPlannerWithSearch = () => {
    if (searchText.trim()) {
      setPendingQueryText(searchText.trim());
    }
    router.push("/(tabs)/planner");
  };

  // 카테고리 필터는 서버에 다시 요청하지 않고, 이미 받아온 목록(최대 50개) 안에서
  // 화면단에서만 걸러 보여줍니다. '더보기'는 여전히 원본 목록(popularPlaces) 기준
  // 순서대로 더 불러오므로, 필터에 안 걸리는 항목이 섞여 있어도 계속 누르다 보면
  // 해당 카테고리 항목이 점점 더 드러납니다.
  const filteredPlaces =
    selectedCategory === "전체" ? popularPlaces : popularPlaces.filter((p) => p.category === selectedCategory);

  const stats: { icon: Icon; value: string; label: string }[] = [
    { icon: WheelchairIcon, value: totalAccessibleCount != null ? String(totalAccessibleCount) : "-", label: "무장애 여행지" },
    { icon: MapPinIcon, value: supportedRegionCount != null ? String(supportedRegionCount) : "-", label: "지원 지역" },
  ];

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 — 스크롤을 위로 당겨도
    // 콘텐츠가 상태표시줄(시계/배터리) 영역까지 밀려 올라가지 않게 막아줍니다.
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <AppLogo size={30} />
            <Text style={styles.logoSub}>당신만을 위한 여행 가이드</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push(session ? "/profile" : "/login")}
            accessibilityRole="button"
            accessibilityLabel="프로필"
          >
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderText}>{profile?.username?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <ImageBackground
          source={heroImageUrl ? { uri: heroImageUrl } : undefined}
          style={styles.hero}
          imageStyle={styles.heroImage}
        >
          {heroImageUrl && <View style={styles.heroOverlay} />}
          <View style={[styles.heroBadge, heroImageUrl && styles.heroBadgeOnPhoto]}>
            <SparkleIcon size={11} color={colors.onPrimary} weight="fill" />
            <Text style={styles.heroBadgeText}>AI 추천 경로</Text>
          </View>
          <Text style={[styles.heroTitle, heroImageUrl && styles.heroTextOnPhoto]}>
            나만의 완벽한{"\n"}무장애 여행을 계획하세요
          </Text>
          <Text style={[styles.heroDesc, heroImageUrl && styles.heroTextOnPhoto]}>
            AI가 이동 제약 없이 즐길 수 있는 최적 경로를 추천해드립니다
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="어디로 떠나고 싶으세요?"
              placeholderTextColor={colors.textTertiary}
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={goToPlannerWithSearch}
            />
            <Pressable style={styles.searchButton} onPress={goToPlannerWithSearch}>
              <Text style={styles.searchButtonText}>검색</Text>
            </Pressable>
          </View>
        </ImageBackground>

        <View style={styles.statsRow}>
          {stats.map((s) => {
            const StatIcon = s.icon;
            return (
              <View key={s.label} style={styles.statCard}>
                <StatIcon size={26} color={colors.primary} weight="bold" />
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>인기 여행지</Text>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setWheelchairOnly((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: wheelchairOnly }}
          >
            <Text style={styles.toggleLabel}>무장애만</Text>
            <View style={[styles.toggleTrack, wheelchairOnly && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, wheelchairOnly && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {REGION_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, selectedRegion === chip && styles.chipSelected]}
              onPress={() => setSelectedRegion(chip)}
            >
              <Text style={[styles.chipText, selectedRegion === chip && styles.chipTextSelected]}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CATEGORY_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, selectedCategory === chip && styles.chipSelected]}
              onPress={() => setSelectedCategory(chip)}
            >
              <Text style={[styles.chipText, selectedCategory === chip && styles.chipTextSelected]}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loadingPlaces ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
        ) : filteredPlaces.length === 0 ? (
          <Text style={styles.emptyText}>표시할 여행지를 찾지 못했어요.</Text>
        ) : (
          filteredPlaces.slice(0, visiblePlacesCount).map((place) => (
            <TouchableOpacity
              key={place.content_id}
              style={styles.placeCard}
              onPress={() =>
                router.push({
                  pathname: "/attraction-detail",
                  params: { contentId: place.content_id, name: place.name },
                })
              }
            >
              <PhotoCardHeader
                imageUrl={place.image_url}
                height={180}
                title={place.name}
                subtitle={place.address}
                rating={place.avg_rating}
                reviewCount={place.review_count}
                congestion={getCongestionDisplay(place, colors)}
              />
              <View style={styles.placeInfo}>
                <Text style={styles.placeCategory}>{place.category}</Text>
                {!!place.overview && (
                  <Text style={styles.placeOverview} numberOfLines={2}>
                    {place.overview}
                  </Text>
                )}
                {place.accessibility && <AccessibilityIcons features={place.accessibility} />}
              </View>
            </TouchableOpacity>
          ))
        )}

        {!loadingPlaces && visiblePlacesCount < popularPlaces.length && (
          <TouchableOpacity style={styles.moreButton} onPress={handleShowMorePlaces}>
            <Text style={styles.moreButtonText}>더보기</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl - 2 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoSub: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textTertiary },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarPlaceholderText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.primary },

  hero: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xl,
    padding: spacing.xl - 4,
    marginBottom: spacing.xl - 6,
    overflow: "hidden", // ImageBackground의 둥근 모서리가 이미지에도 적용되도록
  },
  heroImage: { borderRadius: radius.xl },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay, // 사진 위 글자 가독성용 어두운 반투명 오버레이
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.sm + 2,
  },
  heroBadgeText: { color: colors.onPrimary, fontSize: 11, fontFamily: fontFamily.bold },
  heroBadgeOnPhoto: { backgroundColor: colors.primary },
  heroTitle: { fontSize: 21, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.sm, lineHeight: 28 },
  heroDesc: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
  heroTextOnPhoto: { color: "#FFFFFF" }, // 사진 배경일 땐 테마와 상관없이 항상 흰 글자로(가독성용)
  searchRow: { flexDirection: "row", gap: spacing.sm },
  searchInput: {
    flex: 1,
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
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg + 2,
    justifyContent: "center",
  },
  searchButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 14 },

  statsRow: { flexDirection: "row", gap: spacing.xl, marginBottom: spacing.xl, paddingHorizontal: spacing.md },
  statCard: { flex: 1, alignItems: "center", gap: spacing.xs + 2 },
  statValue: { fontSize: 20, fontFamily: fontFamily.extraBold, color: colors.text, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textTertiary, textAlign: "center" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  sectionTitle: { fontSize: 18, fontFamily: fontFamily.extraBold, color: colors.text },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toggleLabel: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.border,
    padding: 2,
  },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
  toggleThumbOn: { alignSelf: "flex-end" },

  chipRow: { gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  chipTextSelected: { color: colors.onPrimary },

  emptyText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center", marginTop: spacing.xl - 4 },
  moreButton: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md + 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  moreButtonText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.primary },

  placeCard: {
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
  placeInfo: { padding: spacing.md + 2 },
  placeCategory: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.primary },
  placeOverview: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.xs + 2, lineHeight: 17 },
  });
}
