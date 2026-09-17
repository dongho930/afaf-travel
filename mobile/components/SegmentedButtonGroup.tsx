import type { Icon } from "phosphor-react-native";
import React, { useState } from "react";
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

export interface SegmentedButtonItem {
  key: string;
  label: string;
  icon: Icon;
  onPress: () => void;
  // "danger"면 글자/아이콘을 위험색(빨강)으로 그립니다(삭제 등).
  tone?: "default" | "danger";
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

// md 칸 하나가 이 폭보다 좁으면 아이콘을 숨겨 글자가 잘리지 않게 합니다.
// (아이콘 17 + 간격 5 + 좌우 여백 16 = 38, 세 글자 라벨 약 42 → 여유 포함 84)
const MIN_SEGMENT_WIDTH_WITH_ICON = 84;

const SIZES = {
  md: { height: 40, iconSize: 17, fontSize: 14, paddingHorizontal: spacing.sm, radius: radius.md },
  sm: { height: 30, iconSize: 13, fontSize: 12, paddingHorizontal: spacing.sm + 2, radius: radius.sm },
} as const;

/** 한 덩어리 배경 위에 구분선으로 나뉜 여러 버튼(아이콘 + 글자)을 나란히 놓습니다. */
export function SegmentedButtonGroup({
  items,
  size = "md",
  style,
}: {
  items: SegmentedButtonItem[];
  // md: 칸이 남는 폭을 나눠 가짐, sm: 글자 폭만큼만 차지하는 작은 묶음
  size?: keyof typeof SIZES;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const s = SIZES[size];
  const [hideIcons, setHideIcons] = useState(false);

  return (
    <View
      style={[styles.group, { height: s.height, borderRadius: s.radius }, style]}
      onLayout={
        size === "md"
          ? (e) => setHideIcons(e.nativeEvent.layout.width / items.length < MIN_SEGMENT_WIDTH_WITH_ICON)
          : undefined
      }
    >
      {items.map((item, i) => {
        const ItemIcon = item.icon;
        const color = item.tone === "danger" ? colors.danger : colors.text;
        return (
          <React.Fragment key={item.key}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              style={({ pressed }) => [
                styles.segment,
                { paddingHorizontal: s.paddingHorizontal },
                size === "md" && styles.segmentFill,
                pressed && styles.segmentPressed,
              ]}
              onPress={item.onPress}
              hitSlop={size === "sm" ? { top: 6, bottom: 6 } : undefined}
              accessibilityRole="button"
              accessibilityLabel={item.accessibilityLabel ?? item.label}
              accessibilityHint={item.accessibilityHint}
            >
              {!hideIcons && <ItemIcon size={s.iconSize} color={color} weight="regular" />}
              <Text style={[styles.label, { fontSize: s.fontSize, color }]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    group: {
      flexDirection: "row",
      alignItems: "stretch",
      // 테마의 보조 글자색을 옅게 깔아, 라이트/다크 어디서나 중립 회색 바탕이 되게 합니다.
      backgroundColor: `${colors.textTertiary}24`,
      overflow: "hidden",
    },
    segment: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs + 1,
    },
    segmentFill: { flex: 1 },
    segmentPressed: { backgroundColor: `${colors.textTertiary}33` },
    divider: { width: StyleSheet.hairlineWidth * 2, backgroundColor: `${colors.textTertiary}40` },
    label: { fontFamily: fontFamily.medium },
  });
}
