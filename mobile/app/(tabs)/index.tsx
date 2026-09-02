import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
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
import { ThemeColors } from "../../constants/theme";
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

  // 카테고리 탭을 바꾸면, 그 카테고리에서 화면에 처음 보이는 항목들이
  // (전체 기준으로 미리 불러온 첫 6개와는 다른 항목일 수 있어서) 아직 소개문을
  // 못 받아온 상태일 수 있습니다. 그래서 탭이 바뀔 때마다 그 시점에 보이는
  // 항목들 중 소개문이 없는 것만 새로 불러옵니다.
  useEffect(() => {
    visiblePlacesCountRef.current = PLACES_PAGE_SIZE;
    setVisiblePlacesCount(PLACES_PAGE_SIZE);

    const filtered =
      selectedCategory === "전체" ? popularPlaces : popularPlaces.filter((p) => p.category === selectedCategory);
    const idsNeedingOverview = filtered
      .slice(0, PLACES_PAGE_SIZE)
      .filter((p) => !p.overview)
      .map((p) => p.content_id);
    if (idsNeedingOverview.length > 0) {
      api
        .getOverviews(idsNeedingOverview)
        .then((overviews) => {
          setPopularPlaces((prev) =>
            prev.map((p) => (overviews[p.content_id] ? { ...p, overview: overviews[p.content_id] } : p))
          );
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // 카테고리 필터는 서버에 다시 요청하지 않고, 이미 받아온 목록(최대 50개) 안에서
  // 화면단에서만 걸러 보여줍니다. '더보기'는 여전히 원본 목록(popularPlaces) 기준
  // 순서대로 더 불러오므로, 필터에 안 걸리는 항목이 섞여 있어도 계속 누르다 보면
  // 해당 카테고리 항목이 점점 더 드러납니다.
  const filteredPlaces =
    selectedCategory === "전체" ? popularPlaces : popularPlaces.filter((p) => p.category === selectedCategory);

  const stats = [
    { icon: "♿", value: totalAccessibleCount != null ? String(totalAccessibleCount) : "-", label: "무장애 여행지" },
    { icon: "📍", value: supportedRegionCount != null ? String(supportedRegionCount) : "-", label: "지원 지역" },
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
          <Text style={[styles.heroBadge, heroImageUrl && styles.heroBadgeOnPhoto]}>✦ AI 추천 경로</Text>
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
          {stats.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statIcon}>{s.icon}</Text>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
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
              {place.image_url ? (
                <Image source={{ uri: place.image_url }} style={styles.placeImage} />
              ) : (
                <View style={styles.placeImagePlaceholder}>
                  <Text style={styles.placeBadge}>✦ AI 추천</Text>
                </View>
              )}
              <View style={styles.placeInfo}>
                <View style={styles.placeTitleRow}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  <View style={styles.badgeGroup}>
                    {typeof place.avg_rating === "number" && (
                      <View style={styles.ratingBadge}>
                        <Text style={styles.ratingBadgeText}>
                          ★ {place.avg_rating.toFixed(1)} ({place.review_count})
                        </Text>
                      </View>
                    )}
                    {typeof place.congestion_rate === "number" && (
                      <View style={styles.congestionBadge}>
                        <Text style={styles.congestionBadgeText}>
                          혼잡도 {Math.round(place.congestion_rate)}%
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.placeCategory}>{place.category}</Text>
                <Text style={styles.placeAddress} numberOfLines={1}>
                  📍 {place.address}
                </Text>
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
  container: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoSub: { fontSize: 12, fontWeight: "500", color: colors.textTertiary },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarPlaceholderText: { fontSize: 14, fontWeight: "700", color: colors.primary },

  hero: {
    backgroundColor: colors.primaryLight,
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    overflow: "hidden", // ImageBackground의 둥근 모서리가 이미지에도 적용되도록
  },
  heroImage: { borderRadius: 20 },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay, // 사진 위 글자 가독성용 어두운 반투명 오버레이
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  heroBadgeOnPhoto: { backgroundColor: colors.primary },
  heroTitle: { fontSize: 21, fontWeight: "800", color: colors.text, marginBottom: 8, lineHeight: 28 },
  heroDesc: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  heroTextOnPhoto: { color: "#FFFFFF" }, // 사진 배경일 땐 테마와 상관없이 항상 흰 글자로(가독성용)
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  searchButtonText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: "center",
  },
  statIcon: { fontSize: 18, marginBottom: 6 },
  statValue: { fontSize: 17, fontWeight: "800", color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textTertiary, marginTop: 2, textAlign: "center" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleLabel: { fontSize: 13, color: colors.textSecondary },
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

  chipRow: { gap: 8, marginBottom: 16 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  chipTextSelected: { color: colors.onPrimary },

  emptyText: { fontSize: 13, color: colors.textTertiary, textAlign: "center", marginTop: 20 },
  moreButton: {
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  moreButtonText: { fontSize: 14, fontWeight: "700", color: colors.primary },

  placeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    overflow: "hidden",
  },
  placeImage: { height: 110, width: "100%" },
  placeImagePlaceholder: {
    height: 110,
    backgroundColor: colors.text,
    justifyContent: "flex-start",
    padding: 10,
  },
  placeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  placeInfo: { padding: 14 },
  placeTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  placeName: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  placeCategory: { fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 2 },
  placeAddress: { fontSize: 11, color: colors.textTertiary, marginTop: 3 },
  placeOverview: { fontSize: 12, color: colors.textSecondary, marginTop: 6, lineHeight: 17 },
  badgeGroup: { flexDirection: "row", gap: 6, marginLeft: 8 },
  ratingBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  ratingBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  congestionBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  congestionBadgeText: { fontSize: 11, fontWeight: "700", color: colors.warningText },
  });
}
