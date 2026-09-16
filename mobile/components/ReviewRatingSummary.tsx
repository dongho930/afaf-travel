import { StarHalfIcon, StarIcon } from "phosphor-react-native";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useReduceMotion } from "../services/useReduceMotion";
import { Review } from "../types";

const STAR_COLOR = "#F0A93B";
const SCORES = [5, 4, 3, 2, 1] as const;

export interface RatingSummary {
  average: number;
  count: number;
  // 인덱스 0 = 1점, 4 = 5점
  counts: [number, number, number, number, number];
}

export function summarizeRatings(reviews: Review[]): RatingSummary {
  const counts: RatingSummary["counts"] = [0, 0, 0, 0, 0];
  let total = 0;
  for (const r of reviews) {
    const score = Math.min(5, Math.max(1, Math.round(r.rating)));
    counts[score - 1] += 1;
    total += score;
  }
  return { average: reviews.length ? total / reviews.length : 0, count: reviews.length, counts };
}

function DistributionBar({
  ratio,
  reduceMotion,
  delay,
  styles,
}: {
  ratio: number;
  reduceMotion: boolean;
  delay: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const progress = useRef(new Animated.Value(reduceMotion ? ratio : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(ratio);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: ratio,
      duration: 450,
      delay,
      easing: Easing.out(Easing.cubic),
      // width는 레이아웃 속성이라 네이티브 드라이버를 쓸 수 없습니다.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [ratio, reduceMotion, delay, progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { width }]} />
    </View>
  );
}

export function ReviewRatingSummary({ summary, colors }: { summary: RatingSummary; colors: ThemeColors }) {
  const styles = makeStyles(colors);
  const reduceMotion = useReduceMotion();

  const { average, count, counts } = summary;
  // 별 아이콘은 0.5 단위로 반올림해서 보여줍니다 (숫자는 소수 첫째 자리 그대로).
  const halfSteps = Math.round(average * 2);

  return (
    <View style={styles.container}>
      <View style={styles.scoreColumn} accessible accessibilityLabel={`평균 평점 5점 만점에 ${average.toFixed(1)}점, 리뷰 ${count}개`}>
        <Text style={styles.averageText}>{average.toFixed(1)}</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => {
            if (halfSteps >= n * 2) return <StarIcon key={n} size={14} color={STAR_COLOR} weight="fill" />;
            if (halfSteps === n * 2 - 1) return <StarHalfIcon key={n} size={14} color={STAR_COLOR} weight="fill" />;
            return <StarIcon key={n} size={14} color={colors.border} weight="regular" />;
          })}
        </View>
        <Text style={styles.countText}>리뷰 {count}개</Text>
      </View>

      <View style={styles.distribution}>
        {SCORES.map((score, i) => {
          const n = counts[score - 1];
          const ratio = count ? n / count : 0;
          return (
            <View
              key={score}
              style={styles.distributionRow}
              accessible
              accessibilityLabel={`${score}점 ${n}개, ${Math.round(ratio * 100)}퍼센트`}
            >
              <Text style={styles.scoreLabel}>{score}점</Text>
              <DistributionBar ratio={ratio} reduceMotion={reduceMotion} delay={i * 60} styles={styles} />
              <Text style={styles.rowCount}>{n}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    scoreColumn: { alignItems: "center", minWidth: 84 },
    averageText: {
      fontSize: 36,
      lineHeight: 42,
      fontFamily: fontFamily.extraBold,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    starsRow: { flexDirection: "row", gap: 1, marginTop: 2 },
    countText: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: spacing.xs },
    distribution: { flex: 1, minWidth: 0, gap: spacing.xs + 2 },
    distributionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    scoreLabel: { width: 26, fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 4, backgroundColor: STAR_COLOR },
    rowCount: {
      width: 24,
      textAlign: "right",
      fontSize: 12,
      fontFamily: fontFamily.regular,
      color: colors.textTertiary,
      fontVariant: ["tabular-nums"],
    },
  });
}
