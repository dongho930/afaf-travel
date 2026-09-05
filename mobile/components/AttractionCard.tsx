import { useRouter } from "expo-router";
import { ClockIcon, FirstAidKitIcon } from "phosphor-react-native";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getCongestionDisplay } from "../constants/congestion";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";
import { Attraction, CourseStop, UserType } from "../types";
import { AccessibilityIcons } from "./AccessibilityIcons";
import { renderExtraInfo } from "./ExtraInfoList";
import { PhotoCardHeader } from "./PhotoCardHeader";

export function AttractionCard({
  stop,
  userType,
  actions,
  extraInfo,
}: {
  stop: CourseStop;
  userType?: UserType;
  // 사진 위가 아니라 사진 아래 본문(추천 방문 시간 옆)에 넣을 보조 액션 —
  // 예: 결과 화면(results.tsx)에서 웹 전용 순서 위/아래 버튼.
  actions?: React.ReactNode;
  // 홈 화면 카드와 같은 형식의 부가 정보(이용시간/요금 등). 코스 생성 응답에는
  // 포함되지 않아서(별도 API 절약), 호출한 화면이 따로 조회해서 넘겨줍니다.
  extraInfo?: Attraction["extra_info"];
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { attraction } = stop;
  const placeWithExtraInfo = extraInfo?.length ? { ...attraction, extra_info: extraInfo } : attraction;

  return (
    <Pressable
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/attraction-detail",
          params: { contentId: attraction.content_id, name: attraction.name },
        })
      }
    >
      <PhotoCardHeader
        imageUrl={attraction.image_url}
        title={attraction.name}
        subtitle={attraction.address}
        rating={attraction.avg_rating}
        reviewCount={attraction.review_count}
        congestion={getCongestionDisplay(attraction, colors)}
        topLeft={
          <View style={styles.orderBadge}>
            <Text style={styles.orderText}>{stop.order}</Text>
          </View>
        }
      />

      <View style={styles.body}>
        <View style={styles.bodyHeaderRow}>
          <View style={styles.timeRow}>
            <ClockIcon size={13} color={colors.text} weight="bold" />
            <Text style={styles.time}>추천 방문 시간: {stop.recommended_arrival_time}</Text>
          </View>
          {actions}
        </View>
        <Text style={styles.reason}>{stop.reason}</Text>
        {(() => {
          const extraInfoNode = renderExtraInfo(placeWithExtraInfo, colors);
          return (
            <>
              {extraInfoNode}
              <View style={extraInfoNode ? styles.accessibilityDivider : undefined}>
                <AccessibilityIcons features={attraction.accessibility} userType={userType} />
              </View>
            </>
          );
        })()}

        {attraction.nearby_medical_info && (
          <View style={styles.medicalRow}>
            <FirstAidKitIcon size={13} color={colors.textSecondary} weight="bold" />
            <Text style={styles.medical}>{attraction.nearby_medical_info}</Text>
          </View>
        )}

        <Text style={styles.detailButtonText}>상세 페이지 보기 →</Text>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    overflow: "hidden",
    // 테두리 대신 배경색을 살짝 반영한 그림자로 카드를 떠 있게 합니다.
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
  orderBadge: {
    backgroundColor: colors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 13 },

  body: { padding: spacing.lg },
  bodyHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  timeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  time: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.text },
  reason: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  // 부가 정보 아래 접근성 아이콘 — 부가 정보가 실제로 표시될 때만 구분선을 넣어
  // 섹션을 나눕니다 (홈 화면 카드와 동일한 방식).
  accessibilityDivider: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  medicalRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  medical: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },
  detailButtonText: {
    fontSize: 12,
    fontFamily: fontFamily.bold,
    color: colors.primary,
    marginTop: spacing.sm + 2,
  },
  });
}
