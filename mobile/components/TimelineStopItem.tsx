import { useRouter } from "expo-router";
import {
  CaretDownIcon,
  CaretUpIcon,
  ClockIcon,
  FirstAidKitIcon,
  ImageSquareIcon,
  StarIcon,
  WarningCircleIcon,
} from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import Svg, { Line } from "react-native-svg";
import { getCongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useReduceMotion } from "../services/useReduceMotion";
import { useTheme } from "../services/ThemeContext";
import { Attraction, CourseStop, UserType } from "../types";
import { AccessibilityIcons, hasAccessibilityIcons } from "./AccessibilityIcons";
import { renderExtraInfo } from "./ExtraInfoList";
import { FadeImage } from "./FadeImage";

const PHOTO_WIDTH = 72;
const PHOTO_HEIGHT = Math.round((PHOTO_WIDTH * 9) / 16);
const PHOTO_BORDER = 2;
const AXIS_WIDTH = PHOTO_WIDTH + PHOTO_BORDER * 2;
const TIME_HEIGHT = 18;
const TIME_GAP = 4;
const NODE_HEIGHT = PHOTO_HEIGHT + PHOTO_BORDER * 2;
const ROW_GAP = spacing.lg;
const LINE_WIDTH = 3;
const FLOW_MARKER_SIZE = 16;
const PLACEHOLDER_BG = "#3A4038";

export function TimelineStopItem({
  stop,
  userType,
  extraInfo,
  isFirst,
  isLast,
  nextUnfit = false,
  timeStale = false,
  onMoveUp,
  onMoveDown,
  onLongPress,
  isDragging = false,
  highlightToken = 0,
}: {
  stop: CourseStop;
  userType?: UserType;
  extraInfo?: Attraction["extra_info"];
  isFirst: boolean;
  isLast: boolean;
  // 다음 장소가 그날 방문이 어려운지. 그리로 이어지는 선을 점선으로 그립니다.
  nextUnfit?: boolean;
  // 순서를 바꾸고 아직 저장하지 않아 시각이 옛 순서 기준일 때.
  timeStale?: boolean;
  // 둘 다 없으면 오른쪽 순서 버튼 칸을 그리지 않습니다(2일차 구간).
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onLongPress?: () => void;
  isDragging?: boolean;
  // 값이 바뀔 때마다 카드 테두리를 잠깐 강조합니다(방금 옮긴 항목 표시).
  highlightToken?: number;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const reduceMotion = useReduceMotion();
  const [expanded, setExpanded] = useState(false);
  const highlight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!highlightToken) return;
    if (reduceMotion) return;
    highlight.setValue(1);
    const anim = Animated.timing(highlight, { toValue: 0, duration: 900, delay: 150, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [highlightToken, reduceMotion, highlight]);

  const { attraction } = stop;
  const unfit = stop.fits_today === false;
  const showMoveButtons = !!(onMoveUp || onMoveDown);
  const congestion = getCongestionDisplay(attraction, colors);
  const place = extraInfo?.length ? { ...attraction, extra_info: extraInfo } : attraction;
  const extraInfoNode = renderExtraInfo(place, colors);
  const hasAccessibility = hasAccessibilityIcons(attraction.accessibility, userType);
  const hasMore =
    hasAccessibility || !!extraInfoNode || !!attraction.nearby_medical_info || stop.reason.length > 60;

  const timeColor = unfit ? colors.warningText : timeStale ? colors.textTertiary : colors.text;
  // 8자리 hex(#RRGGBBAA)로 강조색을 옅게 씁니다.
  const solidLineColor = `${colors.primary}59`;
  const borderColor = highlight.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] });

  return (
    <View style={styles.row}>
      <View
        style={styles.axis}
        accessible
        accessibilityLabel={`${stop.order}번째, 도착 예정 ${stop.recommended_arrival_time}${timeStale ? ", 순서 저장 후 다시 계산됨" : ""}${unfit ? ", 이날 방문 어려움" : ""}`}
      >
        {/* 선은 위(이전 장소에서 들어오는)·아래(다음 장소로 나가는) 두 구간으로 나눠 그립니다.
            그날 방문이 어려운 장소로 이어지는 구간은 경고색 점선으로 표시합니다. */}
        {!isFirst && (
          <LineSegment
            style={{ top: 0, height: "50%" }}
            dashed={unfit}
            color={unfit ? colors.warning : solidLineColor}
          />
        )}
        {!isLast && (
          <>
            {/* 항목 사이 여백(row의 paddingBottom)까지 늘려야 다음 항목과 이어집니다. */}
            <LineSegment
              style={{ top: "50%", bottom: -ROW_GAP }}
              dashed={nextUnfit}
              color={nextUnfit ? colors.warning : solidLineColor}
            />
            <View style={[styles.flowMarker, { borderColor: nextUnfit ? colors.warning : colors.primary }]}>
              <CaretDownIcon size={9} color={nextUnfit ? colors.warning : colors.primary} weight="bold" />
            </View>
          </>
        )}
        <View style={[styles.photoNode, unfit && styles.photoNodeUnfit, timeStale && styles.photoNodeStale]}>
          {/* 사진이 카드 세로 중앙에 오도록, 시각은 흐름에서 빼서 사진 바로 위에 띄웁니다. */}
          <View style={styles.timeWrap}>
            <View style={styles.timeRow}>
              <ClockIcon size={13} color={timeColor} weight="bold" />
              <Text style={[styles.time, { color: timeColor }]} numberOfLines={1}>
                {stop.recommended_arrival_time}
              </Text>
            </View>
          </View>
          <View style={styles.photo}>
            {attraction.image_url ? (
              <FadeImage source={{ uri: attraction.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]}>
                <ImageSquareIcon size={18} color="rgba(255,255,255,0.4)" weight="light" />
              </View>
            )}
          </View>
          <View style={[styles.orderBadge, unfit && styles.orderBadgeUnfit]}>
            <Text style={[styles.orderText, unfit && styles.orderTextUnfit]}>{stop.order}</Text>
          </View>
        </View>
      </View>

      <Animated.View style={[styles.card, { borderColor }, isDragging && styles.cardDragging]}>
        <Pressable
          onPress={() => attraction.data_source === "kakao" && attraction.external_url
            ? void Linking.openURL(attraction.external_url)
            : router.push({
              pathname: "/attraction-detail",
              params: { contentId: attraction.content_id, name: attraction.name },
            })
          }
          onLongPress={onLongPress}
          disabled={isDragging}
          accessibilityRole="button"
          accessibilityLabel={`${attraction.name}, ${attraction.data_source === "kakao" ? "접근성 미확인, 카카오맵에서 확인" : "상세 페이지 보기"}`}
          accessibilityHint={onLongPress ? "길게 누르면 끌어서 순서를 바꿀 수 있습니다" : undefined}
        >
          <View style={[styles.body, hasMore && styles.bodyWithFooter]}>
            <Text style={styles.name} numberOfLines={2}>
              {attraction.name}
            </Text>
            {!!attraction.address && (
              <Text style={styles.address} numberOfLines={1}>
                {attraction.address}
              </Text>
            )}

            {(typeof attraction.avg_rating === "number" || congestion) && (
              <View style={styles.metaRow}>
                {typeof attraction.avg_rating === "number" && (
                  <View style={styles.ratingRow}>
                    <StarIcon size={12} color="#F0A93B" weight="fill" />
                    <Text style={styles.ratingText}>
                      {attraction.avg_rating.toFixed(1)}
                      {attraction.review_count ? ` (${attraction.review_count})` : ""}
                    </Text>
                  </View>
                )}
                {congestion && (
                  <View style={[styles.congestionPill, { backgroundColor: congestion.color }]}>
                    <Text style={styles.congestionText}>{congestion.label}</Text>
                  </View>
                )}
              </View>
            )}

            {stop.time_note ? <Text style={styles.timeNote}>{stop.time_note}</Text> : null}
            {stop.closed_note ? (
              <View style={styles.closedRow}>
                <WarningCircleIcon size={13} color={colors.warningText} weight="bold" />
                <Text style={styles.closedText}>{stop.closed_note}</Text>
              </View>
            ) : null}

            <Text style={styles.reason} numberOfLines={expanded ? undefined : 3}>
              {stop.reason}
            </Text>

            {expanded && (
              <>
                {hasAccessibility && (
                  <View style={styles.accessibilityRow}>
                    <AccessibilityIcons features={attraction.accessibility} userType={userType} />
                  </View>
                )}
                {extraInfoNode}
                {attraction.nearby_medical_info && (
                  <View style={styles.medicalRow}>
                    <FirstAidKitIcon size={13} color={colors.textSecondary} weight="bold" />
                    <Text style={styles.medical}>{attraction.nearby_medical_info}</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </Pressable>

        {/* 카드 전체가 누르는 영역이라, 버튼 안에 버튼이 들어가지 않도록 바깥에 둡니다. */}
        {hasMore && (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? "정보 접기" : "편의시설, 이용시간 등 정보 더보기"}
          >
            <Text style={styles.moreText}>{expanded ? "접기" : "더보기"}</Text>
          </Pressable>
        )}
      </Animated.View>

      {showMoveButtons && (
        <View style={styles.moveColumn}>
          <MoveButton
            direction="up"
            disabled={isFirst || !onMoveUp}
            onPress={onMoveUp}
            label={`${attraction.name} 순서 위로 올리기`}
            styles={styles}
            colors={colors}
          />
          <MoveButton
            direction="down"
            disabled={isLast || !onMoveDown}
            onPress={onMoveDown}
            label={`${attraction.name} 순서 아래로 내리기`}
            styles={styles}
            colors={colors}
          />
        </View>
      )}
    </View>
  );
}

function LineSegment({
  style,
  dashed,
  color,
}: {
  style: StyleProp<ViewStyle>;
  dashed: boolean;
  color: string;
}) {
  if (!dashed) {
    return <View style={[lineStyles.box, style, { backgroundColor: color, borderRadius: LINE_WIDTH / 2 }]} />;
  }
  // RN의 dashed 테두리는 iOS에서 한쪽 변에만 줄 수 없어서, 점선은 SVG로 그립니다.
  return (
    <View style={[lineStyles.box, style]}>
      <Svg width={LINE_WIDTH} height="100%">
        <Line
          x1={LINE_WIDTH / 2}
          y1="2"
          x2={LINE_WIDTH / 2}
          y2="100%"
          stroke={color}
          strokeWidth={LINE_WIDTH - 0.5}
          strokeDasharray="3 5"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

const lineStyles = StyleSheet.create({
  box: { position: "absolute", left: AXIS_WIDTH / 2 - LINE_WIDTH / 2, width: LINE_WIDTH },
});

function MoveButton({
  direction,
  disabled,
  onPress,
  label,
  styles,
  colors,
}: {
  direction: "up" | "down";
  disabled: boolean;
  onPress?: () => void;
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const Icon = direction === "up" ? CaretUpIcon : CaretDownIcon;
  return (
    <Pressable
      style={({ pressed }) => [styles.moveButton, disabled && styles.moveButtonDisabled, pressed && !disabled && styles.moveButtonPressed]}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Icon size={16} color={disabled ? colors.textTertiary : colors.primary} weight="bold" />
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // 항목 사이 간격을 margin이 아닌 paddingBottom으로 둬야 세로선이 끊기지 않습니다.
    row: { flexDirection: "row", gap: spacing.sm, paddingBottom: ROW_GAP },
    // 시각 라벨이 사진 위로 튀어나오므로, 카드가 아주 낮아도 잘리지 않게 최소 높이를 둡니다.
    axis: {
      width: AXIS_WIDTH,
      minHeight: (TIME_HEIGHT + TIME_GAP) * 2 + NODE_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    // 항목 사이 여백 한가운데, 선 위에 놓이는 진행 방향 표시.
    flowMarker: {
      position: "absolute",
      bottom: -(ROW_GAP + FLOW_MARKER_SIZE) / 2,
      left: AXIS_WIDTH / 2 - FLOW_MARKER_SIZE / 2,
      width: FLOW_MARKER_SIZE,
      height: FLOW_MARKER_SIZE,
      borderRadius: FLOW_MARKER_SIZE / 2,
      borderWidth: 1.5,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    timeWrap: {
      position: "absolute",
      bottom: NODE_HEIGHT - PHOTO_BORDER + TIME_GAP,
      left: -PHOTO_BORDER,
      right: -PHOTO_BORDER,
      alignItems: "center",
    },
    timeRow: {
      height: TIME_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 3,
      // 세로선이 시각 글자 뒤로 지나가지 않도록 배경으로 가립니다.
      backgroundColor: colors.background,
    },
    time: {
      lineHeight: TIME_HEIGHT,
      fontSize: 13,
      fontFamily: fontFamily.bold,
      fontVariant: ["tabular-nums"],
    },
    photoNode: {
      width: AXIS_WIDTH,
      height: NODE_HEIGHT,
      borderRadius: radius.sm + PHOTO_BORDER,
      borderWidth: PHOTO_BORDER,
      borderColor: colors.primary,
      backgroundColor: colors.background,
    },
    photoNodeUnfit: { borderColor: colors.warning },
    photoNodeStale: { opacity: 0.55 },
    photo: { flex: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surfaceAlt },
    photoPlaceholder: { backgroundColor: PLACEHOLDER_BG, alignItems: "center", justifyContent: "center" },
    orderBadge: {
      position: "absolute",
      top: 3,
      left: 3,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    orderBadgeUnfit: { backgroundColor: colors.warning },
    orderText: { color: colors.onPrimary, fontSize: 10, lineHeight: 12, fontFamily: fontFamily.bold },
    orderTextUnfit: { color: "#FFFFFF" },

    card: {
      flex: 1,
      minWidth: 0,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      overflow: "hidden",
      ...Platform.select({
        web: { boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 3px 10px rgba(0,0,0,0.07)" } as object,
        default: {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 2,
        },
      }),
    },
    cardDragging: { opacity: 0.8 },
    body: { padding: spacing.md },
    name: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.extraBold, color: colors.text },
    address: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },
    metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs + 2 },
    ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
    ratingText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.text },
    congestionPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
    congestionText: { fontSize: 11, fontFamily: fontFamily.extraBold, color: "#FFFFFF" },
    timeNote: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: spacing.sm },
    closedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginTop: spacing.xs,
      paddingVertical: 5,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.warningLight,
    },
    closedText: { flex: 1, fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.warningText },
    reason: { fontSize: 13, lineHeight: 19, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.sm },
    medicalRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
    medical: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },
    accessibilityRow: { marginTop: spacing.sm },
    bodyWithFooter: { paddingBottom: 0 },
    moreButton: { alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
    moreText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.primary },

    moveColumn: { width: 32, gap: spacing.xs + 2, justifyContent: "center" },
    moveButton: {
      width: 32,
      height: 32,
      borderRadius: radius.sm + 2,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    moveButtonDisabled: { backgroundColor: colors.surfaceAlt },
    moveButtonPressed: { opacity: 0.6 },
  });
}
