import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useCourseContext } from "../../services/CourseContext";
import { Attraction, RegionOption, UserProfile } from "../../types";

const REGION_CHIPS = ["전체", "수원", "용인", "성남", "고양", "안양"];

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { setPendingQueryText } = useCourseContext();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("전체");
  const [wheelchairOnly, setWheelchairOnly] = useState(false);

  const [totalAccessibleCount, setTotalAccessibleCount] = useState<number | null>(null);
  const [supportedRegionCount, setSupportedRegionCount] = useState<number | null>(null);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [popularPlaces, setPopularPlaces] = useState<Attraction[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
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
        setPopularPlaces(places);
        const firstIds = places.slice(0, PLACES_PAGE_SIZE).map((p) => p.content_id);
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

  const stats = [
    { icon: "♿", value: totalAccessibleCount != null ? String(totalAccessibleCount) : "-", label: "무장애 여행지" },
    { icon: "📍", value: supportedRegionCount != null ? String(supportedRegionCount) : "-", label: "지원 지역" },
    { icon: "🚶", value: "4", label: "지원 이동유형" },
  ];

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 — 스크롤을 위로 당겨도
    // 콘텐츠가 상태표시줄(시계/배터리) 영역까지 밀려 올라가지 않게 막아줍니다.
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>
            경기포올 <Text style={styles.logoSub}>무장애 여행 가이드</Text>
          </Text>
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

        <View style={styles.hero}>
          <Text style={styles.heroBadge}>✦ AI 추천 경로</Text>
          <Text style={styles.heroTitle}>나만의 완벽한{"\n"}무장애 여행을 계획하세요</Text>
          <Text style={styles.heroDesc}>AI가 이동 제약 없이 즐길 수 있는 최적 경로를 추천해드립니다</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="어디로 떠나고 싶으세요?"
              placeholderTextColor="#8A8A8A"
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={goToPlannerWithSearch}
            />
            <Pressable style={styles.searchButton} onPress={goToPlannerWithSearch}>
              <Text style={styles.searchButtonText}>검색</Text>
            </Pressable>
          </View>
        </View>

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

        {loadingPlaces ? (
          <ActivityIndicator style={{ marginTop: 20 }} color="#2E7D5B" />
        ) : popularPlaces.length === 0 ? (
          <Text style={styles.emptyText}>표시할 여행지를 찾지 못했어요.</Text>
        ) : (
          popularPlaces.slice(0, visiblePlacesCount).map((place) => (
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
                {place.accessibility_benefits?.length > 0 && (
                  <View style={styles.benefitRow}>
                    {place.accessibility_benefits.map((benefit) => (
                      <View key={benefit} style={styles.benefitTag}>
                        <Text style={styles.benefitTagText}>{benefit}</Text>
                      </View>
                    ))}
                  </View>
                )}
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  logo: { fontSize: 18, fontWeight: "800", color: "#1A1A1A" },
  logoSub: { fontSize: 12, fontWeight: "500", color: "#8A8A8A" },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: { backgroundColor: "#EAF3EE", alignItems: "center", justifyContent: "center" },
  avatarPlaceholderText: { fontSize: 14, fontWeight: "700", color: "#2E7D5B" },

  hero: {
    backgroundColor: "#EAF3EE",
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#2E7D5B",
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  heroTitle: { fontSize: 21, fontWeight: "800", color: "#1A1A1A", marginBottom: 8, lineHeight: 28 },
  heroDesc: { fontSize: 13, color: "#5C5C5C", marginBottom: 16, lineHeight: 18 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  searchButton: {
    backgroundColor: "#2E7D5B",
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  searchButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 14,
    alignItems: "center",
  },
  statIcon: { fontSize: 18, marginBottom: 6 },
  statValue: { fontSize: 17, fontWeight: "800", color: "#2E7D5B" },
  statLabel: { fontSize: 11, color: "#8A8A8A", marginTop: 2, textAlign: "center" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#1A1A1A" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleLabel: { fontSize: 13, color: "#5C5C5C" },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#E2E8E4",
    padding: 2,
  },
  toggleTrackOn: { backgroundColor: "#2E7D5B" },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#FFFFFF" },
  toggleThumbOn: { alignSelf: "flex-end" },

  chipRow: { gap: 8, marginBottom: 16 },
  chip: {
    borderWidth: 1,
    borderColor: "#E2E8E4",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: "#2E7D5B", borderColor: "#2E7D5B" },
  chipText: { fontSize: 13, color: "#5C5C5C", fontWeight: "600" },
  chipTextSelected: { color: "#FFFFFF" },

  emptyText: { fontSize: 13, color: "#8A8A8A", textAlign: "center", marginTop: 20 },
  moreButton: {
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    alignItems: "center",
  },
  moreButtonText: { fontSize: 14, fontWeight: "700", color: "#2E7D5B" },

  placeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    marginBottom: 12,
    overflow: "hidden",
  },
  placeImage: { height: 110, width: "100%" },
  placeImagePlaceholder: {
    height: 110,
    backgroundColor: "#1A1A1A",
    justifyContent: "flex-start",
    padding: 10,
  },
  placeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#2E7D5B",
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  placeInfo: { padding: 14 },
  placeTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  placeName: { fontSize: 15, fontWeight: "700", color: "#1A1A1A", flexShrink: 1 },
  placeCategory: { fontSize: 12, color: "#2E7D5B", fontWeight: "600", marginTop: 2 },
  placeAddress: { fontSize: 11, color: "#8A8A8A", marginTop: 3 },
  placeOverview: { fontSize: 12, color: "#6B6B6B", marginTop: 6, lineHeight: 17 },
  badgeGroup: { flexDirection: "row", gap: 6, marginLeft: 8 },
  ratingBadge: {
    backgroundColor: "#FFF7E0",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  ratingBadgeText: { fontSize: 11, fontWeight: "700", color: "#B8860B" },
  congestionBadge: {
    backgroundColor: "#FFF1E6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  congestionBadgeText: { fontSize: 11, fontWeight: "700", color: "#C2622A" },
  benefitRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 6 },
  benefitTag: {
    backgroundColor: "#EAF3EE",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  benefitTagText: { fontSize: 11, fontWeight: "600", color: "#2E7D5B" },
});
