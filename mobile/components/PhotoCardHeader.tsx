import { LinearGradient } from "expo-linear-gradient";
import { ImageSquareIcon, StarIcon } from "phosphor-react-native";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { CongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { radius, spacing } from "../constants/tokens";

// 사진이 없는 카드를 위한 자리표시 배경색입니다. 라이트/다크 테마와 무관하게
// 항상 어두운 톤으로 고정해서, 위에 얹는 흰 글자가 어떤 테마에서도 읽힙니다.
const PLACEHOLDER_BG = "#3A4038";

/**
 * "사진이 카드 전체를 채우고, 그 위에 이름·평점·혼잡도가 얹히는" 카드 상단부.
 * AttractionCard(결과/지도), 홈 화면 인기 여행지, 장소 선택하기 카드가
 * 전부 이 컴포넌트로 사진 영역을 통일해서 씁니다. 사진 아래(본문) 내용은
 * 화면마다 다르므로 각자 알아서 이어 붙입니다.
 */
export function PhotoCardHeader({
  imageUrl,
  height = 220,
  topLeft,
  topRight,
  title,
  titleNumberOfLines = 2,
  subtitle,
  rating,
  reviewCount,
  congestion,
}: {
  imageUrl?: string | null;
  height?: number;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  title: string;
  titleNumberOfLines?: number;
  subtitle?: string;
  rating?: number | null;
  reviewCount?: number;
  congestion?: CongestionDisplay | null;
}) {
  return (
    <View style={[styles.photo, { height }]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]}>
          <ImageSquareIcon size={28} color="rgba(255,255,255,0.35)" weight="light" />
        </View>
      )}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.82)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      {topLeft && <View style={styles.topLeft}>{topLeft}</View>}
      {topRight}
      {typeof rating === "number" && !topRight && (
        <View style={styles.ratingBadge}>
          <StarIcon size={11} color="#FFD666" weight="fill" />
          <Text style={styles.ratingBadgeText}>
            {rating.toFixed(1)}
            {typeof reviewCount === "number" ? ` (${reviewCount})` : ""}
          </Text>
        </View>
      )}

      <View style={styles.textZone}>
        <Text style={styles.title} numberOfLines={titleNumberOfLines}>
          {title}
        </Text>
        {(subtitle || congestion) && (
          <View style={styles.metaRow}>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {congestion && (
              <View style={[styles.congestionPill, { backgroundColor: congestion.color }]}>
                <Text style={styles.congestionPillText}>{congestion.label}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { justifyContent: "flex-end" },
  photoPlaceholder: { backgroundColor: PLACEHOLDER_BG, alignItems: "center", justifyContent: "center" },
  topLeft: { position: "absolute", top: spacing.md, left: spacing.md, zIndex: 1 },
  ratingBadge: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs - 2,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  ratingBadgeText: { fontSize: 11, fontFamily: fontFamily.bold, color: "#FFFFFF" },
  textZone: { padding: spacing.md + 2 },
  title: { fontSize: 19, fontFamily: fontFamily.extraBold, color: "#FFFFFF" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
  },
  subtitle: { fontSize: 12, fontFamily: fontFamily.medium, color: "rgba(255,255,255,0.82)", flexShrink: 1 },
  congestionPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  congestionPillText: { fontSize: 11, fontFamily: fontFamily.extraBold, color: "#FFFFFF" },
});
