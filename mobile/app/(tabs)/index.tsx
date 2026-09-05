import { useRouter } from "expo-router";
import { MapPinIcon, SparkleIcon, WheelchairIcon, type Icon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccessibilityIcons } from "../../components/AccessibilityIcons";
import { AnimatedChip } from "../../components/AnimatedChip";
import { AppLogo } from "../../components/AppLogo";
import { EXTRA_INFO_LABELS_BY_CATEGORY, renderExtraInfo as renderExtraInfoRow } from "../../components/ExtraInfoList";
import { FadeInView } from "../../components/FadeInView";
import { HorizontalScrollWeb } from "../../components/HorizontalScrollWeb";
import { PhotoCardHeader } from "../../components/PhotoCardHeader";
import { ProfileButton } from "../../components/ProfileButton";
import { getCongestionDisplay } from "../../constants/congestion";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { api } from "../../services/api";
import { useCourseContext } from "../../services/CourseContext";
import { useTheme } from "../../services/ThemeContext";
import { Attraction, RegionOption } from "../../types";

const REGION_CHIPS = ["전체", "수원", "용인", "성남", "고양", "안양"];
const CATEGORY_CHIPS = ["전체", "관광지", "문화시설", "레포츠", "숙박", "음식점"];
// 인기 여행지 목록에서 아예 제외할 카테고리 (필터 칩으로도 고를 수 없고, '전체'를
// 선택해도 안 보입니다). 나중에 다시 보이게 하려면 이 배열을 비우면 됩니다.
const EXCLUDED_CATEGORIES = ["축제/공연/행사", "여행코스", "쇼핑"];

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { setPendingQueryText } = useCourseContext();
  const [searchText, setSearchText] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("전체");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [wheelchairOnly, setWheelchairOnly] = useState(false);

  const [totalAccessibleCount, setTotalAccessibleCount] = useState<number | null>(null);
  const [supportedRegionCount, setSupportedRegionCount] = useState<number | null>(null);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [popularPlaces, setPopularPlaces] = useState<Attraction[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  // 스크롤로 다음 묶음을 자동으로 불러오는 동안, 카드가 소개문 없이 먼저
  // 나타났다가 나중에 소개문이 따로 튀어나오지 않도록 그 짧은 대기 상태를
  // 보여주는 데 씁니다.
  const [loadingMore, setLoadingMore] = useState(false);
  // 히어로 배경 사진을 깜빡임 없이 부드럽게(크로스페이드) 바꾸기 위해, 두 장을
  // 겹쳐두고 하나씩 번갈아 투명도를 애니메이션합니다(둘 다 같은 실제 사진칸
  // 자리에 절대 위치로 겹쳐 있고, opacity만 서로 반대로 움직입니다).
  const [heroImageCandidates, setHeroImageCandidates] = useState<string[]>([]);
  const [hero, setHero] = useState<{ a: string | null; b: string | null; visible: "a" | "b" }>({
    a: null,
    b: null,
    visible: "a",
  });
  const heroRef = useRef(hero);
  useEffect(() => {
    heroRef.current = hero;
  }, [hero]);
  // 지역 목록이 뒤늦게 도착하면 여행지 목록 조회 useEffect가 한 번 더
  // 실행되는데, 그때마다 배경 사진을 즉시(애니메이션 없이) 다시 뽑아버리면
  // "첫 사진 → 뚝 끊기고 다음 사진 → 그 이후부터 부드러움" 현상이 생깁니다.
  // 배경 사진은 최초 1회만 즉시 세팅하고, 그 뒤로는 3초 크로스페이드
  // 인터벌만 사진을 바꾸도록 이 플래그로 막습니다.
  const heroInitializedRef = useRef(false);
  const heroOpacityA = useRef(new Animated.Value(1)).current;
  const heroOpacityB = useRef(new Animated.Value(0)).current;
  // 배지/제목/설명/검색창 묶음은 배경 사진이 아예 없을 때는 숨겨뒀다가, 첫
  // 사진이 크로스페이드로 나타나는 타이밍에 맞춰 함께 부드럽게 나타납니다.
  const heroContentOpacity = useRef(new Animated.Value(0)).current;
  // 인기 여행지 지역/카테고리 칩은 앱 진입 후 첫 여행지 카드 묶음이 준비되기
  // 전까지 숨겨뒀다가, 카드가 처음 나타날 때 함께 보여줍니다. 이후 사용자가
  // 칩을 눌러 필터를 바꿔 재조회하는 동안에는(loadingPlaces가 다시 true여도)
  // 계속 보이게 하기 위해 "최초 1회"만 이 값을 true로 바꿉니다.
  const firstLoadDoneRef = useRef(false);
  const [chipsReady, setChipsReady] = useState(false);
  // 히어로 문구 → 통계(무장애 여행지/지원 지역) → 인기 여행지 순서로 등장시키기
  // 위한 단계값입니다. 각 데이터는 원래대로 전부 동시에 미리 불러오되, "화면에
  // 보여주는 시점"만 이 값으로 강제 순서를 매깁니다(0: 아직 아무것도 안 보임,
  // 1: 히어로 등장 완료 → 통계 표시 허용, 2: 통계까지 등장 → 인기 여행지 섹션 표시 허용).
  const [revealStage, setRevealStage] = useState(0);
  // 통계 두 API가 성공하든 실패하든(둘 다 "값 없음"으로 끝날 수도 있음) 일단
  // 결론이 나야 다음 단계로 넘어갈 수 있습니다. 값이 나오는지 여부가 아니라
  // "두 요청이 다 끝났는지"로 판단해서, 둘 다 실패해도 순서가 영영 안 막히게 합니다.
  const statsSettledCountRef = useRef(0);
  const [statsSettled, setStatsSettled] = useState(false);
  const markStatSettled = () => {
    statsSettledCountRef.current += 1;
    if (statsSettledCountRef.current >= 2) setStatsSettled(true);
  };
  const PLACES_PAGE_SIZE = 6;
  const [visiblePlacesCount, setVisiblePlacesCount] = useState(PLACES_PAGE_SIZE);
  // '더보기'를 빠르게 여러 번 눌러도 안전하게 순서대로 진행되도록, 화면이 아직
  // 리렌더링하기 전이라도 항상 최신 값을 즉시 참조할 수 있는 ref를 같이 둡니다.
  // (state만 쓰면, 리렌더링 전에 또 누를 때 예전 값을 기준으로 계산해서
  // 같은 구간을 중복 조회하거나 건너뛰는 문제가 있었습니다.)
  const visiblePlacesCountRef = React.useRef(PLACES_PAGE_SIZE);
  // 스크롤로 하단 근처에 도달할 때마다 자동으로 다음 묶음을 불러오는데, 그
  // 짧은 순간 onScroll이 여러 번 연달아 발생해도 한 번에 여러 묶음이 확
  // 늘어나지 않도록 막는 잠금 플래그입니다.
  const isLoadingMoreRef = React.useRef(false);

  React.useEffect(() => {
    // '무장애 여행지' 개수는 휠체어/유모차/고령자·임산부를 모두 합친(중복 제거) 실제 계산값입니다.
    api
      .getAccessibilitySummary("경기도")
      .then((s) => setTotalAccessibleCount(s.total_accessible_count))
      .catch(() => setTotalAccessibleCount(null))
      .finally(markStatSettled);

    // '지원 지역' 개수는 실제 시/군/구 목록의 개수이자, 지역 칩(수원/용인/...)을
    // 실제 시군구 코드로 변환하는 데도 이 목록을 그대로 씁니다.
    api
      .listRegions("경기도")
      .then((regions) => {
        setRegionOptions(regions);
        setSupportedRegionCount(regions.length);
      })
      .catch(() => setSupportedRegionCount(null))
      .finally(markStatSettled);
  }, []);

  // 히어로가 먼저 등장한 뒤(revealStage 1) 통계까지 결론이 나면, 통계 카드가
  // 실제로 페이드인할 시간(FadeInView 기본 300ms)만큼 살짝 기다렸다가 다음
  // 단계(인기 여행지 섹션 표시 허용)로 넘어갑니다.
  React.useEffect(() => {
    if (revealStage !== 1 || !statsSettled) return;
    const timer = setTimeout(() => setRevealStage(2), 350);
    return () => clearTimeout(timer);
  }, [revealStage, statsSettled]);

  React.useEffect(() => {
    // 선택된 지역 칩("수원" 등)에 해당하는 시/군/구 코드를 찾아서 필터링합니다.
    // "전체"거나 아직 지역 목록을 못 받아왔으면 코드 없이(경기도 전체) 조회합니다.
    const matchedRegion =
      selectedRegion !== "전체" ? regionOptions.find((r) => r.name.includes(selectedRegion)) : null;

    setLoadingPlaces(true);
    setVisiblePlacesCount(PLACES_PAGE_SIZE);
    visiblePlacesCountRef.current = PLACES_PAGE_SIZE;
    // 목록 자체는 소개문 없이(include_overview=false) 빠르게 받되, 처음 보이는
    // 6개의 소개문까지 받아온 뒤에야 카드를 화면에 내보냅니다(그래야 카드가
    // 소개문 없이 먼저 뜨고 나중에 문구만 툭 튀어나오는 일이 없습니다). 나머지는
    // '더보기'(자동 스크롤 로드) 시점에 그때 새로 보이는 6개씩만 채워서, 한
    // 번에 50개를 다 채우려다 뒤쪽이 6초 제한에 밀리는 문제를 피합니다.
    api
      .listAttractions("경기도", wheelchairOnly ? "wheelchair" : "general", matchedRegion?.code ?? null, 1500, false)
      .then((places) => {
        // 축제/공연/행사, 여행코스, 쇼핑은 인기 여행지 목록에서 아예 제외합니다.
        const filtered = places.filter((p) => !EXCLUDED_CATEGORIES.includes(p.category));
        // 사진이 있는 관광지들의 사진 URL을 후보 목록으로 저장해두고, 그중
        // 하나를 무작위로 골라 상단 배너 배경으로 씁니다. 아래 useEffect가 이
        // 후보 목록에서 3초마다 다시 무작위로 골라 배경을 크로스페이드로 바꿉니다.
        const imageUrls = filtered.map((p) => p.image_url).filter((url): url is string => !!url);
        setHeroImageCandidates(imageUrls);
        if (!heroInitializedRef.current) {
          heroInitializedRef.current = true;
          // 사진이 하나도 없는 경우(전부 이미지 URL 없음)에도 히어로 문구
          // 자체는 떠야 합니다 — 안 그러면 통계/인기 여행지 등장 순서가
          // 영영 다음 단계로 못 넘어갑니다. 이때는 사진 레이어 없이 배경색만으로 보여집니다.
          if (imageUrls.length > 0) {
            // 히어로 박스 전체(사진+글자)를 아래 heroContentOpacity로 한 번에
            // 나타내므로, 사진 레이어 자체는 처음부터 바로 보이는 상태(1)로
            // 둡니다 — 안 그러면 박스가 나타난 뒤 사진이 한 번 더 페이드인되어
            // 두 단계로 나뉘어 보입니다.
            heroOpacityA.setValue(1);
            heroOpacityB.setValue(0);
            setHero({
              a: imageUrls[Math.floor(Math.random() * imageUrls.length)],
              b: null,
              visible: "a",
            });
          }
          Animated.timing(heroContentOpacity, { toValue: 1, duration: 900, useNativeDriver: true }).start(() => {
            // 통계는 히어로가 다 나타난 뒤에만 등장 허용(이미 2단계 이상이면 유지).
            setRevealStage((s) => Math.max(s, 1));
          });
        }

        const firstBatch = filtered.slice(0, PLACES_PAGE_SIZE);
        const firstIds = firstBatch.map((p) => p.content_id);
        if (firstIds.length === 0) {
          setPopularPlaces(filtered);
          return;
        }
        return Promise.all([
          api.getOverviews(firstIds).catch(() => ({}) as Record<string, string | null>),
          fetchExtraInfoMap(firstBatch),
        ]).then(([overviews, extraInfoMap]) => {
          setPopularPlaces(mergeOverviewAndExtraInfo(filtered, overviews, extraInfoMap));
        }); // 소개문/부가 정보를 못 받아와도 카드는 그냥 보여줍니다(각 헬퍼가 실패 시 빈 맵을 돌려줌).
      })
      .catch(() => setPopularPlaces([]))
      .finally(() => {
        setLoadingPlaces(false);
        if (!firstLoadDoneRef.current) {
          firstLoadDoneRef.current = true;
          setChipsReady(true);
        }
      });
  }, [wheelchairOnly, selectedRegion, regionOptions]);

  // 히어로 배경 사진을 3초마다 후보 목록에서 무작위로 다시 골라 바꿉니다.
  // 지금 보이지 않는(opacity 0) 레이어에 다음 사진을 미리 얹어두고, 두
  // 레이어의 opacity를 동시에 서로 반대로 애니메이션해서 깜빡임 없이
  // 크로스페이드되게 합니다(바로 직전 사진은 후보에서 빼서 연달아 나오지 않게 함).
  React.useEffect(() => {
    if (heroImageCandidates.length <= 1) return;
    const timer = setInterval(() => {
      const prev = heroRef.current;
      const currentUrl = prev.visible === "a" ? prev.a : prev.b;
      const pool = heroImageCandidates.filter((url) => url !== currentUrl);
      if (pool.length === 0) return;
      const nextUrl = pool[Math.floor(Math.random() * pool.length)];
      const nextLayer: "a" | "b" = prev.visible === "a" ? "b" : "a";
      const fadeOut = prev.visible === "a" ? heroOpacityA : heroOpacityB;
      const fadeIn = nextLayer === "a" ? heroOpacityA : heroOpacityB;
      setHero({ ...prev, [nextLayer]: nextUrl, visible: nextLayer });
      Animated.parallel([
        Animated.timing(fadeOut, { toValue: 0, duration: 900, useNativeDriver: true }),
        Animated.timing(fadeIn, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]).start();
    }, 3000);
    return () => clearInterval(timer);
  }, [heroImageCandidates, heroOpacityA, heroOpacityB]);

  // 주어진 카드들 중 아직 부가 정보(이용시간/요금 등)가 없는 것만 골라 따로
  // 불러와서 채웁니다. 카테고리 탭 전환(아래 useEffect)처럼 이미 화면에 나와
  // 있는 카드에 부가 정보만 나중에 채워 넣어도 되는 경우에 씁니다.
  const loadExtraInfoFor = (places: Attraction[]) => {
    fetchExtraInfoMap(places).then((result) => {
      if (Object.keys(result).length === 0) return;
      setPopularPlaces((prev) =>
        prev.map((p) => (result[p.content_id] ? { ...p, extra_info: result[p.content_id] } : p))
      );
    });
  };

  // 부가 정보만 따로 받아와서 맵으로 돌려줍니다(state는 직접 건드리지 않음).
  // 초기 로딩/더보기처럼 "부가 정보까지 다 받아온 뒤에 카드를 보여주기"가
  // 필요한 곳에서, 소개문 조회와 Promise.all로 같이 기다리는 데 씁니다.
  const fetchExtraInfoMap = (
    places: Attraction[]
  ): Promise<Record<string, { label: string; value: string }[]>> => {
    // extra_info는 목록 조회 시에도 항상 배열로 채워져서 오는데(정보가 없으면
    // undefined가 아니라 빈 배열 []), !p.extra_info는 빈 배열을 truthy로 보고
    // "이미 불러왔음"으로 오판합니다. 그래서 배열이 비어있는지(length)로 판단합니다.
    const targets = places.filter(
      (p) => (p.extra_info?.length ?? 0) === 0 && EXTRA_INFO_LABELS_BY_CATEGORY[p.category]
    );
    if (targets.length === 0) return Promise.resolve({});
    return api
      .getExtraInfo(targets.map((p) => ({ contentId: p.content_id, category: p.category })))
      .catch(() => ({})); // 못 받아와도 카드는(부가 정보 없이) 그냥 보여줍니다.
  };

  // 소개문/부가 정보 맵을 원본 목록에 병합합니다. 카드를 보여주기 전에 둘 다
  // 기다렸다가 한 번에 합쳐 넣을 때 씁니다.
  const mergeOverviewAndExtraInfo = (
    places: Attraction[],
    overviews: Record<string, string | null>,
    extraInfoMap: Record<string, { label: string; value: string }[]>
  ): Attraction[] =>
    places.map((p) => {
      const overview = overviews[p.content_id];
      const extraInfo = extraInfoMap[p.content_id];
      if (!overview && !extraInfo) return p;
      return {
        ...p,
        ...(overview ? { overview } : {}),
        ...(extraInfo ? { extra_info: extraInfo } : {}),
      };
    });

  // 다음 묶음도 소개문까지 다 받아온 뒤에야 visiblePlacesCount를 늘려서 화면에
  // 내보냅니다 — 카드가 먼저 뜨고 소개문이 나중에 튀어나오는 걸 막기 위함입니다.
  const handleShowMorePlaces = async () => {
    // '더보기'도 카테고리 필터가 적용된 목록(filteredPlaces) 기준으로 다음
    // 항목들을 계산해야 합니다. 필터링 전(원본 50개) 기준으로 계산하면, 화면에
    // 실제로 새로 나타나는 카드(필터링된 목록 기준)와 소개문을 요청하는 카드
    // (필터링 전 목록 기준)가 서로 어긋나서 — 필터가 좁을수록 화면엔 보이는데
    // 소개문은 영영 요청조차 안 되는 카드가 생겼습니다.
    const filtered =
      selectedCategory === "전체" ? popularPlaces : popularPlaces.filter((p) => p.category === selectedCategory);
    const start = visiblePlacesCountRef.current;
    const nextCount = Math.min(start + PLACES_PAGE_SIZE, filtered.length);
    if (nextCount <= start) return; // 이미 이 카테고리를 끝까지 다 보여준 상태면 아무것도 안 함

    const newlyRevealed = filtered.slice(start, nextCount);
    const newlyRevealedIds = newlyRevealed.filter((p) => !p.overview).map((p) => p.content_id);

    // 소개문과 부가 정보를 둘 다 받아온 뒤에야 이 묶음을 화면에 내보냅니다
    // (visiblePlacesCount를 그 다음에 늘림) — 부가 정보만 나중에 툭 튀어나오는
    // 걸 막기 위함입니다.
    setLoadingMore(true);
    try {
      const [overviews, extraInfoMap] = await Promise.all([
        newlyRevealedIds.length > 0
          ? api.getOverviews(newlyRevealedIds)
          : Promise.resolve({} as Record<string, string | null>),
        fetchExtraInfoMap(newlyRevealed),
      ]);
      if (Object.keys(overviews).length > 0 || Object.keys(extraInfoMap).length > 0) {
        setPopularPlaces((prev) => mergeOverviewAndExtraInfo(prev, overviews, extraInfoMap));
      }
    } catch {
      // 소개문/부가 정보를 못 받아와도 카드는 그냥 보여줍니다.
    } finally {
      setLoadingMore(false);
    }

    visiblePlacesCountRef.current = nextCount;
    setVisiblePlacesCount(nextCount);
  };

  // 스크롤이 하단에서 300px 이내로 들어오면 '더보기'와 같은 동작을 자동으로
  // 실행해서, 버튼을 누르지 않아도 카드가 계속 이어서 나타나게 합니다. 다음
  // 묶음의 소개문 요청이 실제로 끝날 때까지 잠금을 유지해서, 느린 네트워크에서도
  // 같은 구간을 중복으로 이어받지 않게 합니다.
  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (loadingPlaces || isLoadingMoreRef.current) return;
    if (visiblePlacesCountRef.current >= filteredPlaces.length) return;
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom > 300) return;

    isLoadingMoreRef.current = true;
    handleShowMorePlaces().finally(() => {
      isLoadingMoreRef.current = false;
    });
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
    const firstVisible = filtered.slice(0, PLACES_PAGE_SIZE);
    loadExtraInfoFor(firstVisible);

    const idsNeedingOverview = firstVisible.filter((p) => !p.overview).map((p) => p.content_id);
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

  const stats: { icon: Icon; value: number | null; label: string }[] = [
    { icon: WheelchairIcon, value: totalAccessibleCount, label: "무장애 여행지" },
    { icon: MapPinIcon, value: supportedRegionCount, label: "지원 지역" },
  ];

  // 카드 소개문 아래에 카테고리별로 정해둔 부가 정보(이용시간/요금 등)를 보여줍니다.
  // 장소 선택하기/추천 코스 화면과 표시 방식을 공유하기 위해 components/ExtraInfoList로 뽑아뒀습니다.
  const renderExtraInfo = (place: Attraction) => renderExtraInfoRow(place, colors);

  return (
    // edges=["top"]로 화면 상단만 안전영역 처리합니다 — 스크롤을 위로 당겨도
    // 콘텐츠가 상태표시줄(시계/배터리) 영역까지 밀려 올라가지 않게 막아줍니다.
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <AppLogo size={30} />
            <Text style={styles.logoSub}>당신만을 위한 여행 가이드</Text>
          </View>
          <ProfileButton />
        </View>

        <Animated.View style={[styles.hero, { opacity: heroContentOpacity }]}>
          <Animated.Image
            source={hero.a ? { uri: hero.a } : undefined}
            style={[styles.heroImageLayer, { opacity: heroOpacityA }]}
            resizeMode="cover"
          />
          <Animated.Image
            source={hero.b ? { uri: hero.b } : undefined}
            style={[styles.heroImageLayer, { opacity: heroOpacityB }]}
            resizeMode="cover"
          />
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.heroBadge}>
              <SparkleIcon size={11} color={colors.onPrimary} weight="fill" />
              <Text style={styles.heroBadgeText}>AI 추천 경로</Text>
            </View>
            <Text style={styles.heroTitle}>나만의 완벽한{"\n"}무장애 여행을 계획하세요</Text>
            <Text style={styles.heroDesc}>AI가 이동 제약 없이 즐길 수 있는 최적 경로를 추천해드립니다</Text>

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
          </View>
        </Animated.View>

        {revealStage >= 1 && (
          <View style={styles.statsRow}>
            {stats
              .filter((s) => s.value !== null)
              .map((s) => {
                const StatIcon = s.icon;
                return (
                  <FadeInView key={s.label} style={styles.statCard}>
                    <StatIcon size={26} color={colors.primary} weight="bold" />
                    <AnimatedCountUpText value={s.value} style={styles.statValue} />
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </FadeInView>
                );
              })}
          </View>
        )}

        {revealStage >= 2 && chipsReady && (
          <FadeInView>
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

            <HorizontalScrollWeb contentContainerStyle={styles.chipRow}>
              {REGION_CHIPS.map((chip) => (
                <AnimatedChip
                  key={chip}
                  selected={selectedRegion === chip}
                  onPress={() => setSelectedRegion(chip)}
                  label={chip}
                  style={styles.chip}
                  textStyle={styles.chipText}
                  backgroundColor={colors.surface}
                  selectedBackgroundColor={colors.primary}
                  borderColor={colors.border}
                  selectedBorderColor={colors.primary}
                  textColor={colors.textSecondary}
                  selectedTextColor={colors.onPrimary}
                />
              ))}
            </HorizontalScrollWeb>

            <HorizontalScrollWeb contentContainerStyle={styles.chipRow}>
              {CATEGORY_CHIPS.map((chip) => (
                <AnimatedChip
                  key={chip}
                  selected={selectedCategory === chip}
                  onPress={() => setSelectedCategory(chip)}
                  label={chip}
                  style={styles.chip}
                  textStyle={styles.chipText}
                  backgroundColor={colors.surface}
                  selectedBackgroundColor={colors.primary}
                  borderColor={colors.border}
                  selectedBorderColor={colors.primary}
                  textColor={colors.textSecondary}
                  selectedTextColor={colors.onPrimary}
                />
              ))}
            </HorizontalScrollWeb>
          </FadeInView>
        )}

        {revealStage >= 2 && (loadingPlaces ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
        ) : filteredPlaces.length === 0 ? (
          <Text style={styles.emptyText}>표시할 여행지를 찾지 못했어요.</Text>
        ) : (
          <>
            {filteredPlaces.slice(0, visiblePlacesCount).map((place) => (
              <FadeInView key={place.content_id} duration={350}>
                <TouchableOpacity
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
                    {(() => {
                      const extraInfoNode = renderExtraInfo(place);
                      return (
                        <>
                          {extraInfoNode}
                          {!!place.accessibility && (
                            <View style={extraInfoNode ? styles.placeAccessibility : undefined}>
                              <AccessibilityIcons features={place.accessibility} />
                            </View>
                          )}
                        </>
                      );
                    })()}
                  </View>
                </TouchableOpacity>
              </FadeInView>
            ))}
            {loadingMore && <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} />}
          </>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// 상단 통계 카드 숫자용 — 값이 없을 때는 아무것도 보여주지 않다가(대시 "-" 없이),
// 실제 값이 도착하면 0에서 그 값까지 세어 올라가며 부드럽게 나타납니다. 값이
// 나중에 다시 바뀌는 경우(지역 필터 변경 등)에도 그 시점 값에서 새 값까지 이어서 세어갑니다.
function AnimatedCountUpText({ value, style }: { value: number | null; style: TextStyle }) {
  const animated = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (value == null) return;
    animated.setValue(fromRef.current);
    const listenerId = animated.addListener(({ value: v }) => setDisplay(Math.round(v)));
    Animated.timing(animated, {
      toValue: value,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      fromRef.current = value;
    });
    return () => animated.removeListener(listenerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <Text style={style}>{display == null ? "" : String(display)}</Text>;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl - 2 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoSub: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textTertiary },

  hero: {
    // 사진이 로드되기 전에도 항상 오버레이+흰 글자와 어울리는 어두운 배경을 써서,
    // 사진이 도착하는 순간 배경/글자색이 갑자기 바뀌며 깜빡이는 문제를 없앱니다.
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl - 4,
    marginBottom: spacing.xl - 6,
    overflow: "hidden", // 둥근 모서리가 아래 겹쳐진 사진 레이어들에도 적용되도록
  },
  // 크로스페이드용 사진 두 장이 이 자리에 절대 위치로 겹쳐서, opacity만 서로
  // 반대로 움직이며 부드럽게 넘어갑니다.
  heroImageLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.xl,
  },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay, // 사진 위 글자 가독성용 어두운 반투명 오버레이
  },
  // 웹(react-native-web)에서는 static 요소보다 absolute 요소(heroOverlay)가
  // DOM 순서와 무관하게 항상 위에 그려지는 CSS 규칙 때문에, 검색창 등 실제
  // 콘텐츠가 오버레이 밑에 깔려 안 보이는 문제가 있었습니다. 콘텐츠를 명시적
  // position+zIndex로 오버레이보다 위 레이어에 두어 해결합니다(네이티브 앱은
  // 원래도 정상 동작이라 영향 없음).
  heroContent: { position: "relative", zIndex: 1 },
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
  heroTitle: { fontSize: 21, fontFamily: fontFamily.extraBold, color: "#FFFFFF", marginBottom: spacing.sm, lineHeight: 28 },
  heroDesc: { fontSize: 13, fontFamily: fontFamily.regular, color: "#FFFFFF", marginBottom: spacing.lg, lineHeight: 18 },
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

  // 부가 정보 아래 접근성 아이콘 — 부가 정보가 실제로 표시될 때만(renderExtraInfo가
  // 뭔가를 그렸을 때만) placeExtraInfo와 같은 방식의 구분선을 넣어 섹션을 나눕니다.
  placeAccessibility: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  });
}
