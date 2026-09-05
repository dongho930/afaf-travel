import Constants from "expo-constants";
import { BusIcon, CarIcon, type Icon, PersonSimpleWalkIcon } from "phosphor-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
import { useTheme } from "../services/ThemeContext";
import { CourseStop } from "../types";

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

interface LegSummary {
  fromName: string;
  toName: string;
  mode: RouteMode | null;
  durationSec: number | null;
  distanceM: number | null;
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
  const { course } = useCourseContext();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [routePath, setRoutePath] = useState<LatLng[]>([]);
  const [legSummaries, setLegSummaries] = useState<LegSummary[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [routeDrawn, setRouteDrawn] = useState(false); // map_view.py가 실제로 경로를 그렸다는 신호를 받았는지
  const [selectedStop, setSelectedStop] = useState<CourseStop | null>(null);
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const markers = useMemo(() => {
    if (!course) return [];
    return course.stops.map((s) => ({
      id: s.attraction.content_id,
      lat: s.attraction.latitude,
      lng: s.attraction.longitude,
      name: `${s.order}. ${s.attraction.name}`,
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
        setRoutePath([]);
        setLegSummaries([]);
        return;
      }
      setLoadingRoute(true);
      try {
        const legPaths: LatLng[][] = [];
        const summaries: LegSummary[] = [];

        for (let i = 0; i < markers.length - 1; i++) {
          const start = markers[i];
          const end = markers[i + 1];

          const [car, walk, transit] = await Promise.all([
            fetchRoute("car", start, end),
            fetchRoute("walk", start, end),
            fetchRoute("transit", start, end),
          ]);

          const candidates = (
            [
              { mode: "walk" as RouteMode, info: walk },
              { mode: "transit" as RouteMode, info: transit },
              { mode: "car" as RouteMode, info: car },
            ].filter((c) => c.info && c.info.duration_sec != null) as {
              mode: RouteMode;
              info: RouteFetchResult;
            }[]
          );

          let chosen: { mode: RouteMode; info: RouteFetchResult } | null = null;
          const walkCandidate = candidates.find((c) => c.mode === "walk");
          if (walkCandidate && walkCandidate.info.distance_m != null && walkCandidate.info.distance_m <= 1000) {
            chosen = walkCandidate;
          } else if (candidates.length > 0) {
            chosen = candidates.reduce((min, c) =>
              (c.info.duration_sec as number) < (min.info.duration_sec as number) ? c : min
            );
          }

          const fallbackPath: LatLng[] =
            walk?.path && walk.path.length > 0
              ? walk.path
              : [[start.lat, start.lng], [end.lat, end.lng]];

          legPaths.push(chosen ? chosen.info.path : fallbackPath);
          summaries.push({
            fromName: start.name,
            toName: end.name,
            mode: chosen?.mode ?? null,
            durationSec: chosen?.info.duration_sec ?? null,
            distanceM: chosen?.info.distance_m ?? null,
          });
        }

        if (!cancelled) {
          setRoutePath(legPaths.flat());
          setLegSummaries(summaries);
        }
      } catch (e) {
        console.warn("경로 조회 중 오류, 직선으로 대체합니다:", e);
        if (!cancelled) {
          setRoutePath([]);
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

  // 지도 로드 완료 + 경로 데이터 준비 완료되면 postMessage로 전달
  useEffect(() => {
    if (!mapLoaded || routePath.length < 2) return;
    const payload = JSON.stringify({ path: routePath });

    if (Platform.OS === "web") {
      iframeRef.current?.contentWindow?.postMessage(payload, "*");
    } else {
      webViewRef.current?.injectJavaScript(
        `window.postMessage(${JSON.stringify(payload)}, '*'); true;`
      );
    }
  }, [mapLoaded, routePath]);

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

  if (!course) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>먼저 여행 코스를 생성해주세요.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
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

      {legSummaries.length > 0 && routeDrawn && (
        <View style={styles.bottomArea}>
          <HorizontalScrollWeb contentContainerStyle={styles.legScroll}>
            {legSummaries.map((leg, idx) => (
              <View key={idx} style={styles.legCard}>
                <Text style={styles.legRoute} numberOfLines={1}>
                  {leg.fromName} → {leg.toName}
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
              </View>
            ))}
          </HorizontalScrollWeb>

          <Pressable
            style={({ pressed }) => [styles.navButton, pressed && styles.pressedFeedback]}
            onPress={() => {
              const first = course.stops[0]?.attraction;
              if (!first) return;
              const url = `kakaomap://route?ep=${first.latitude},${first.longitude}&by=FOOT`;
              Linking.canOpenURL(url).then((supported) => {
                if (supported) Linking.openURL(url);
                else
                  Linking.openURL(
                    `https://map.kakao.com/link/to/${encodeURIComponent(first.name)},${first.latitude},${first.longitude}`
                  );
              });
            }}
          >
            <PersonSimpleWalkIcon size={16} color={colors.onPrimary} weight="bold" />
            <Text style={styles.navButtonText}>카카오맵 앱으로 길찾기</Text>
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
    minWidth: 160,
  },
  legRoute: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.xs },
  legModeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legMode: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
  legDetail: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
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
