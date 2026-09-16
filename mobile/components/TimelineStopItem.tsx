import { useRouter } from "expo-router";
import {
  CaretDownIcon,
  CaretUpIcon,
  FirstAidKitIcon,
  ImageSquareIcon,
  StarIcon,
  WarningCircleIcon,
} from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getCongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useReduceMotion } from "../services/useReduceMotion";
import { useTheme } from "../services/ThemeContext";
import { Attraction, CourseStop, UserType } from "../types";
import { AccessibilityIcons } from "./AccessibilityIcons";
import { renderExtraInfo } from "./ExtraInfoList";
import { FadeImage } from "./FadeImage";

const AXIS_WIDTH = 52;
const TIME_HEIGHT = 18;
const DOT_SIZE = 24;
const DOT_GAP = 6;
// 세로선이 순서 점의 한가운데에서 끊기고 이어지도록 맞추는 기준 위치입니다.
const DOT_CENTER = TIME_HEIGHT + DOT_GAP + DOT_SIZE / 2;
const PLACEHOLDER_BG = "#3A4038";

export function TimelineStopItem({
  stop,
  userType,
  extraInfo,
  isFirst,
  isLast,
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
  const hasMore = !!extraInfoNode || !!attraction.nearby_medical_info || stop.reason.length > 60;

  const timeColor = unfit ? colors.warningText : timeStale ? colors.textTertiary : colors.text;
  const borderColor = highlight.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] });

  return (
    <View style={styles.row}>
      <View
        style={styles.axis}
        accessible
        accessibilityLabel={`${stop.order}번째, 도착 예정 ${stop.recommended_arrival_time}${timeStale ? ", 순서 저장 후 다시 계산됨" : ""}${unfit ? ", 이날 방문 어려움" : ""}`}
      >
        {!(isFirst && isLast) && (
          <View
            style={[
              styles.line,
              isFirst ? { top: DOT_CENTER, bottom: 0 } : isLast ? { top: 0, height: DOT_CENTER } : { top: 0, bottom: 0 },
            ]}
          />
        )}
        <Text style={[styles.time, { color: timeColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {stop.recommended_arrival_time}
        </Text>
        <View style={[styles.dot, unfit && styles.dotUnfit, timeStale && styles.dotStale]}>
          <Text style={[styles.dotText, unfit && styles.dotTextUnfit]}>{stop.order}</Text>
        </View>
      </View>

      <Animated.View style={[styles.card, { borderColor }, isDragging && styles.cardDragging]}>
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/attraction-detail",
              params: { contentId: attraction.content_id, name: attraction.name },
            })
          }
          onLongPress={onLongPress}
          disabled={isDragging}
          accessibilityRole="button"
          accessibilityLabel={`${attraction.name}, 상세 페이지 보기`}
          accessibilityHint={onLongPress ? "길게 누르면 끌어서 순서를 바꿀 수 있습니다" : undefined}
        >
          <View style={styles.thumb}>
            {attraction.image_url ? (
              <FadeImage source={{ uri: attraction.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.thumbPlaceholder]}>
                <ImageSquareIcon size={24} color="rgba(255,255,255,0.35)" weight="light" />
              </View>
            )}
          </View>

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
                {extraInfoNode}
                {attraction.nearby_medical_info && (
                  <View style={styles.medicalRow}>
                    <FirstAidKitIcon size={13} color={colors.textSecondary} weight="bold" />
                    <Text style={styles.medical}>{attraction.nearby_medical_info}</Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.accessibilityRow}>
              <AccessibilityIcons features={attraction.accessibility} userType={userType} />
            </View>
          </View>
        </Pressable>

        {/* 카드 전체가 누르는 영역이라, 버튼 안에 버튼이 들어가지 않도록 바깥에 둡니다. */}
        {hasMore && (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? "정보 접기" : "이용시간 등 정보 더보기"}
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
    row: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.lg },
    axis: { width: AXIS_WIDTH, alignItems: "center" },
    line: {
      position: "absolute",
      left: AXIS_WIDTH / 2 - 1,
      width: 2,
      backgroundColor: colors.border,
    },
    time: {
      height: TIME_HEIGHT,
      lineHeight: TIME_HEIGHT,
      fontSize: 13,
      fontFamily: fontFamily.bold,
      fontVariant: ["tabular-nums"],
      backgroundColor: colors.background,
      paddingHorizontal: 2,
    },
    dot: {
      marginTop: DOT_GAP,
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: colors.background,
    },
    dotUnfit: { backgroundColor: colors.warning },
    dotStale: { opacity: 0.55 },
    dotText: { color: colors.onPrimary, fontSize: 11, fontFamily: fontFamily.bold },
    dotTextUnfit: { color: "#FFFFFF" },

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
    thumb: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.surfaceAlt },
    thumbPlaceholder: { backgroundColor: PLACEHOLDER_BG, alignItems: "center", justifyContent: "center" },
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

    moveColumn: { width: 32, gap: spacing.xs + 2, paddingTop: TIME_HEIGHT + DOT_GAP - 4 },
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
