import Constants from "expo-constants";
import { Stack, useLocalSearchParams } from "expo-router";
import { BusIcon, CarIcon, type Icon, NavigationArrowIcon, PersonSimpleWalkIcon } from "phosphor-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { AttractionCard } from "../components/AttractionCard";
import { HorizontalScrollWeb } from "../components/HorizontalScrollWeb";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useCourseContext } from "../services/CourseContext";
import {
  directionsFailureMessage,
  KakaoTravelMode,
  openKakaoDirections,
} from "../services/kakaoDirections";
import { useTheme } from "../services/ThemeContext";
import { CourseStop, UserType } from "../types";

const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:8000";

type LatLng = [number, number]; // [lat, lng]
type RouteMode = "car" | "walk" | "transit";

const MODE_LABEL: Record<RouteMode, string> = {
  walk: "도보",
  transit: "대중교통",
  car: "자동차",
};
const MODE_ICON: Record<RouteMode, Icon> = {
  walk: PersonSimpleWalkIcon,
  transit: BusIcon,
  car: CarIcon,
};
// 우리 쪽 이동수단 이름 → 카카오맵 스킴이 받는 값
const MODE_TO_KAKAO: Record<RouteMode, KakaoTravelMode> = {
  walk: "FOOT",
  transit: "PUBLICTRANSIT",
  car: "CAR",
};

/**
 * 사용자 유형별 '걸어갈 만한' 최대 거리(m).
 *
 * 예전에는 누구에게나 1km를 기준으로 도보를 먼저 권했습니다. 하지만 이 앱은
 * 휠체어 이용자·고령자·임산부·유모차 동반 가족을 위한 코스를 만드는 앱이라,
 * 경사와 턱이 섞인 1km(빠른 걸음으로도 15분 이상)를 일괄로 권하는 건 과합니다.
 * 코스를 만든 대상(course.generated_for)에 맞춰 기준을 낮춥니다.
 */
const WALKABLE_METERS: Record<UserType, number> = {
  wheelchair: 400,
  senior: 500,
  pregnant: 500,
  stroller: 600,
  visual: 700,
  hearing: 1000,
  general: 1000,
};

// 대중교통을 자동차와 같은 잣대로 비교하면 거의 항상 자동차가 이깁니다 —
// 카카오 자동차 시간은 순수 주행시간인데, ODsay 대중교통 시간에는 환승과 도보가
// 들어 있기 때문입니다. 여행자는 자차가 없는 경우가 많아서, 자동차보다 이 배수
// 안쪽이면 대중교통을 먼저 권합니다.
const TRANSIT_TOLERANCE = 1.5;

// 이 직선거리를 넘으면 도보 경로를 조회하지 않습니다. 걸어갈 만한 최대 거리가
// 1km(WALKABLE_METERS의 최댓값)인데 실제 도보 거리는 직선거리보다 항상 기니까,
// 직선으로 2km가 넘으면 어떤 사용자 유형에게도 도보가 추천될 수 없습니다.
// (넉넉히 두 배로 잡아서, 도보 경로가 유일한 대안으로 쓰이는 경우도 남겨둡니다.)
const WALK_SKIP_METERS = 2000;

// '조회했지만 경로가 없음'을 뜻하는 값. 조회 실패(null)와 구분해야 카드에
// '도보 정보 없음'이라고 잘못 표시되지 않습니다.
const NO_ROUTE: RouteFetchResult = { distance_m: null, duration_sec: null, path: [] };

/** 두 지점 사이의 직선(대권) 거리(m). 도보 조회를 건너뛸지 판단하는 데만 씁니다. */
function straightDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface LegSummary {
  from: { name: string; latitude: number; longitude: number };
  to: { name: string; latitude: number; longitude: number };
  mode: RouteMode | null;
  durationSec: number | null;
  distanceM: number | null;
  // 추천한 것 말고 다른 수단으로 갔을 때의 소요 시간(카드 아래에 같이 보여줍니다).
  alternatives: { mode: RouteMode; durationSec: number }[];
  // 조회 자체가 실패한 수단. 조용히 빼지 않고 '정보 없음'으로 밝힙니다.
  failedModes: RouteMode[];
}

interface RouteFetchResult {
  distance_m: number | null;
  duration_sec: number | null;
  path: LatLng[];
}

async function fetchRoute(
  mode: RouteMode,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<RouteFetchResult | null> {
  try {
    const url =
      `${API_BASE_URL}/route?mode=${mode}` +
      `&start_lat=${start.lat}&start_lng=${start.lng}` +
      `&end_lat=${end.lat}&end_lng=${end.lng}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      distance_m: typeof data.distance_m === "number" ? data.distance_m : null,
      duration_sec: typeof data.duration_sec === "number" ? data.duration_sec : null,
      path: Array.isArray(data.path) ? data.path : [],
    };
  } catch {
    return null;
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "시간 정보 없음";
  const minutes = Math.max(1, Math.round(sec / 60));
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function formatDistance(m: number | null): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/**
 * 카카오맵은 공식 React Native SDK가 없으므로,
 * 카카오맵 JavaScript SDK를 WebView로 임베드하는 방식으로 연동합니다.
 *
 * 실제 도로 경로 좌표는 URL 쿼리스트링으로 넘기지 않고, 지도 페이지가 다 로드된
 * 뒤 postMessage로 전달합니다 (URL이 너무 길어지는 문제 방지).
 *
 * map_view.py는 페이지 로드 직후 곧바로 직선을 그리지 않고, 실제 경로가 도착할
 * 때까지 기다립니다. 그래서 이 화면도 지도 자체를 'route_drawn' 신호를 받기
 * 전까지는 전체 화면 로딩 오버레이로 가려서, 사용자가 직선이 잠깐이라도 보이는
 * 순간 없이 곧장 실제 경로만 보게 만듭니다.
 *
 * 구간(지점→지점)마다 도보/대중교통/자동차 세 가지 경로를 모두 조회해서
 * 가장 적절한 이동수단을 추천하고(1km 이하면 도보 우선, 그 외엔 최단 시간),
 * 화면 하단에 구간별 예상 시간과 추천 이동수단을 보여줍니다.
 *
 * 마커를 클릭하면 지도 페이지가 postMessage로 알려주고, 그 지점의 상세 정보를
 * (기존 AttractionCard 컴포넌트를 재사용해) 모달로 보여줍니다.
 */
export default function MapScreen() {
  // 코스를 여러 날로 나눴으면 어느 일차의 지도인지 ?day=N으로 받습니다.
  // (없거나 범위를 벗어나면 1일차 = 지금까지와 같은 동작)
  const { day } = useLocalSearchParams<{ day?: string }>();
  const { course: firstDayCourse, dayCourses } = useCourseContext();
  const dayIndex = Math.max(0, Math.trunc(Number(day)) || 0);
  const course = dayCourses[dayIndex]?.course ?? firstDayCourse;
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // null = 아직 조회 전. 조회가 끝나면(전부 실패했더라도) 배열이 들어오고,
  // 그때 지도 페이지로 넘겨서 로딩 오버레이를 걷습니다.
  const [routeLegs, setRouteLegs] = useState<{ mode: RouteMode | null; path: LatLng[] }[] | null>(null);
  const [legSummaries, setLegSummaries] = useState<LegSummary[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [routeDrawn, setRouteDrawn] = useState(false); // map_view.py가 실제로 경로를 그렸다는 신호를 받았는지
  const [selectedStop, setSelectedStop] = useState<CourseStop | null>(null);
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // order와 category는 지도 페이지가 마커를 그릴 때 씁니다 — 번호 배지와
  // 카테고리별 아이콘/색(관광지·음식점·숙박 …)이 여기서 결정됩니다.
  const markers = useMemo(() => {
    if (!course) return [];
    return course.stops.map((s) => ({
      id: s.attraction.content_id,
      lat: s.attraction.latitude,
      lng: s.attraction.longitude,
      name: s.attraction.name,
      order: s.order,
      category: s.attraction.category,
    }));
  }, [course]);

  const mapUrl = useMemo(() => {
    if (!course || markers.length === 0) return "";
    return `${API_BASE_URL}/map-view?markers=${encodeURIComponent(JSON.stringify(markers))}`;
  }, [course, markers]);

  // 코스가 바뀔 때마다 상태 초기화
  useEffect(() => {
    setMapLoaded(false);
    setRouteDrawn(false);
  }, [mapUrl]);

  // 구간별로 도보/대중교통/자동차 경로를 모두 조회해서 추천 수단을 정하고,
  // 지도에는 추천 수단의 실제 경로를 그림 + 하단 패널용 요약 데이터 생성
  useEffect(() => {
    let cancelled = false;

    async function buildRoutes() {
      if (!course || markers.length < 2) {
        // 지점이 하나뿐이면 그릴 구간이 없습니다. 그래도 빈 배열을 넣어야
        // 지도 페이지가 10초 폴백을 기다리지 않고 바로 화면을 보여줍니다.
        setRouteLegs([]);
        setLegSummaries([]);
        return;
      }
      setLoadingRoute(true);
      const walkLimit = WALKABLE_METERS[course.generated_for] ?? WALKABLE_METERS.general;
      try {
        const legs: { mode: RouteMode | null; path: LatLng[] }[] = [];
        const summaries: LegSummary[] = [];

        for (let i = 0; i < markers.length - 1; i++) {
          const start = markers[i];
          const end = markers[i + 1];

          // 직선거리가 이미 걸어갈 만한 거리를 넘으면 실제 도보 거리는 반드시 그보다
          // 더 멉니다 — 물어볼 것도 없이 도보는 후보에서 빠지므로 조회를 건너뜁니다.
          // TMAP 보행자 경로는 건당 11원으로 대중교통(0.88원)의 12배라, 이 화면
          // 요금의 대부분을 차지합니다. 먼 구간을 걸러내면 그 대부분이 사라집니다.
          const farApart = straightDistanceM(start, end) > WALK_SKIP_METERS;

          const [car, walk, transit] = await Promise.all([
            fetchRoute("car", start, end),
            farApart ? Promise.resolve(NO_ROUTE) : fetchRoute("walk", start, end),
            fetchRoute("transit", start, end),
          ]);

          const found = { walk, transit, car };
          const usable = (mode: RouteMode) => {
            const info = found[mode];
            return info && info.duration_sec != null ? { mode, info } : null;
          };
          const walkOption = usable("walk");
          const transitOption = usable("transit");
          const carOption = usable("car");

          // 1) 걸어갈 만한 거리면 도보. 2) 아니면 대중교통을 먼저 보되,
          // 자동차보다 지나치게 오래 걸리면 자동차. 3) 둘 중 하나만 되면 그것.
          let chosen: { mode: RouteMode; info: RouteFetchResult } | null = null;
          if (walkOption && walkOption.info.distance_m != null && walkOption.info.distance_m <= walkLimit) {
            chosen = walkOption;
          } else if (transitOption && carOption) {
            const transitSec = transitOption.info.duration_sec as number;
            const carSec = carOption.info.duration_sec as number;
            chosen = transitSec <= carSec * TRANSIT_TOLERANCE ? transitOption : carOption;
          } else {
            chosen = transitOption ?? carOption ?? walkOption;
          }

          const fallbackPath: LatLng[] =
            walk?.path && walk.path.length > 0
              ? walk.path
              : [[start.lat, start.lng], [end.lat, end.lng]];

          legs.push({
            mode: chosen?.mode ?? null,
            path: chosen && chosen.info.path.length > 1 ? chosen.info.path : fallbackPath,
          });
          summaries.push({
            from: { name: `${start.order}. ${start.name}`, latitude: start.lat, longitude: start.lng },
            to: { name: `${end.order}. ${end.name}`, latitude: end.lat, longitude: end.lng },
            mode: chosen?.mode ?? null,
            durationSec: chosen?.info.duration_sec ?? null,
            distanceM: chosen?.info.distance_m ?? null,
            alternatives: ([walkOption, transitOption, carOption].filter(
              (o): o is { mode: RouteMode; info: RouteFetchResult } => !!o && o.mode !== chosen?.mode
            )).map((o) => ({ mode: o.mode, durationSec: o.info.duration_sec as number })),
            // 키가 없거나 API가 실패한 수단은 후보에서 조용히 빠지는 대신
            // 카드에 그대로 밝혀서, '왜 항상 자동차만 나오지'를 알 수 있게 합니다.
            failedModes: (["walk", "transit", "car"] as RouteMode[]).filter((m) => found[m] === null),
          });
        }

        if (!cancelled) {
          setRouteLegs(legs);
          setLegSummaries(summaries);
        }
      } catch (e) {
        console.warn("경로 조회 중 오류, 직선으로 대체합니다:", e);
        if (!cancelled) {
          setRouteLegs([]);
          setLegSummaries([]);
        }
      } finally {
        if (!cancelled) setLoadingRoute(false);
      }
    }

    buildRoutes();
    return () => {
      cancelled = true;
    };
  }, [course, markers]);

  // 지도 로드 완료 + 경로 조회가 끝나면 postMessage로 전달. 전부 실패해서 빈
  // 배열이어도 보냅니다 — 그래야 지도 페이지가 10초 폴백 타이머를 기다리지 않고
  // 곧바로 직선이라도 그려서 로딩 화면이 걷힙니다.
  useEffect(() => {
    if (!mapLoaded || routeLegs === null) return;
    const payload = JSON.stringify({ legs: routeLegs });

    if (Platform.OS === "web") {
      iframeRef.current?.contentWindow?.postMessage(payload, "*");
    } else {
      webViewRef.current?.injectJavaScript(
        `window.postMessage(${JSON.stringify(payload)}, '*'); true;`
      );
    }
  }, [mapLoaded, routeLegs]);

  function handleHostMessage(raw: string) {
    try {
      const data = JSON.parse(raw);
      if (data?.type === "marker_click" && data.id) {
        const stop = course?.stops.find((s) => s.attraction.content_id === data.id);
        if (stop) setSelectedStop(stop);
      } else if (data?.type === "route_drawn") {
        // map_view.py가 경로(직선이든 실제든)를 한 번 그렸다는 신호 → 이제 지도를 보여줘도 됨
        setRouteDrawn(true);
      }
    } catch {
      // 우리 메시지 형식이 아니면 무시
    }
  }

  // 웹(iframe)에서는 window의 'message' 이벤트로 자식 프레임의 postMessage를 수신
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onWindowMessage(event: MessageEvent) {
      if (typeof event.data === "string") handleHostMessage(event.data);
    }
    window.addEventListener("message", onWindowMessage);
    return () => window.removeEventListener("message", onWindowMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  function handleWebViewMessage(event: WebViewMessageEvent) {
    handleHostMessage(event.nativeEvent.data);
  }

  // 화면에서 추천한 수단 그대로 카카오맵을 엽니다 — 카드에는 '도보 추천'이라고
  // 해놓고 자동차 길찾기를 열던 문제를 없앱니다. 추천을 못 정한 구간만 자동차로
  // 갑니다(카카오맵 기본값과 같습니다).
  async function openDirections(
    to: { name: string; latitude: number; longitude: number },
    from: { name: string; latitude: number; longitude: number } | null,
    mode: RouteMode | null
  ) {
    const result = await openKakaoDirections({
      to,
      from,
      mode: mode ? MODE_TO_KAKAO[mode] : "CAR",
    });
    if (!result.ok) {
      const { title, body } = directionsFailureMessage(result.reason);
      Alert.alert(title, body);
    }
  }

  if (!course) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>먼저 여행 코스를 생성해주세요.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 일차가 여럿이면 어느 날 지도인지 상단 제목에 밝혀줍니다. */}
      {dayCourses.length > 1 && <Stack.Screen options={{ title: `${dayIndex + 1}일차 지도` }} />}

      {Platform.OS === "web" ? (
        // react-native-webview는 웹을 지원하지 않으므로, 웹에서는 iframe으로 같은 페이지를 띄웁니다.
        <iframe
          ref={iframeRef}
          src={mapUrl}
          style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
          onLoad={() => setMapLoaded(true)}
        />
      ) : (
        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ uri: mapUrl }}
          style={{ flex: 1 }}
          javaScriptEnabled
          domStorageEnabled
          onLoadEnd={() => setMapLoaded(true)}
          onMessage={handleWebViewMessage}
        />
      )}

      {/* 실제 경로가 그려졌다는 신호를 받기 전까지는 지도를 전체 화면으로 가려서,
          사용자가 직선이 잠깐이라도 보이는 일이 없게 합니다. */}
      {!routeDrawn && (
        <View style={styles.fullOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.overlayText}>실제 경로를 준비하고 있어요...</Text>
        </View>
      )}

      {routeDrawn && (
        <View style={styles.bottomArea}>
          {legSummaries.length > 0 && (
            <HorizontalScrollWeb contentContainerStyle={styles.legScroll}>
              {legSummaries.map((leg, idx) => (
                <View key={idx} style={styles.legCard}>
                  <Text style={styles.legRoute} numberOfLines={1}>
                    {leg.from.name} → {leg.to.name}
                  </Text>
                  {leg.mode ? (
                    <>
                      <View style={styles.legModeRow}>
                        {(() => {
                          const ModeIcon = MODE_ICON[leg.mode];
                          return <ModeIcon size={13} color={colors.text} weight="bold" />;
                        })()}
                        <Text style={styles.legMode}>{MODE_LABEL[leg.mode]} 추천</Text>
                      </View>
                      <Text style={styles.legDetail}>
                        {formatDuration(leg.durationSec)}
                        {leg.distanceM != null ? ` · ${formatDistance(leg.distanceM)}` : ""}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.legDetail}>경로 정보를 가져오지 못했습니다</Text>
                  )}

                  {/* 다른 수단으로 가면 얼마나 걸리는지, 아예 못 불러온 수단은
                      무엇인지 같이 적어둡니다. 추천 하나만 보여주면 왜 그게
                      골라졌는지 알 수 없고, 실패한 수단도 눈에 띄지 않습니다. */}
                  {leg.alternatives.length > 0 && (
                    <Text style={styles.legAlt} numberOfLines={2}>
                      {leg.alternatives
                        .map((alt) => `${MODE_LABEL[alt.mode]} ${formatDuration(alt.durationSec)}`)
                        .join(" · ")}
                    </Text>
                  )}
                  {leg.failedModes.length > 0 && (
                    <Text style={styles.legFailed} numberOfLines={1}>
                      {leg.failedModes.map((m) => MODE_LABEL[m]).join("·")} 정보 없음
                    </Text>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.legNavButton, pressed && styles.pressedFeedback]}
                    onPress={() => openDirections(leg.to, leg.from, leg.mode)}
                    accessibilityRole="button"
                    accessibilityLabel={`${leg.from.name}에서 ${leg.to.name}까지 카카오맵으로 길찾기`}
                  >
                    <NavigationArrowIcon size={12} color={colors.primary} weight="bold" />
                    <Text style={styles.legNavButtonText}>이 구간 길찾기</Text>
                  </Pressable>
                </View>
              ))}
            </HorizontalScrollWeb>
          )}

          {/* 카카오맵 스킴은 경유지를 못 받아서 코스 전체를 한 번에 안내할 수
              없습니다. 그래서 이 버튼은 '내 위치 → 첫 장소'만 맡고, 나머지 구간은
              위 카드의 '이 구간 길찾기'가 각자 맡습니다. */}
          <Pressable
            style={({ pressed }) => [styles.navButton, pressed && styles.pressedFeedback]}
            onPress={() => {
              const first = course.stops[0]?.attraction;
              if (!first) return;
              openDirections(
                { name: first.name, latitude: first.latitude, longitude: first.longitude },
                null,
                legSummaries[0]?.mode ?? null
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="내 위치에서 첫 장소까지 카카오맵으로 길찾기"
          >
            <NavigationArrowIcon size={15} color={colors.onPrimary} weight="bold" />
            <Text style={styles.navButtonText}>내 위치에서 첫 장소까지 길찾기</Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={!!selectedStop}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedStop(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>상세 정보</Text>
              <TouchableOpacity onPress={() => setSelectedStop(null)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>{selectedStop && <AttractionCard stop={selectedStop} userType={course.generated_for} />}</ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  pressedFeedback: { opacity: 0.6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm + 2,
  },
  overlayText: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textSecondary },
  bottomArea: { position: "absolute", bottom: spacing.lg, left: 0, right: 0 },
  legScroll: { paddingHorizontal: spacing.lg, gap: spacing.sm + 2, paddingBottom: spacing.sm + 2 },
  legCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    // 구간 길찾기 버튼과 '다른 수단' 줄이 들어가면서 조금 넓혔습니다.
    minWidth: 176,
    maxWidth: 232,
  },
  legRoute: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.xs },
  legModeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legMode: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
  legDetail: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
  legAlt: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },
  legFailed: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.warningText, marginTop: 2 },
  legNavButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  legNavButtonText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.primary },
  navButton: {
    flexDirection: "row",
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    marginHorizontal: spacing.lg,
  },
  navButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  modalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "75%",
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.text },
  modalClose: { fontSize: 14, color: colors.primary, fontFamily: fontFamily.semiBold },
  });
}
