import { useRouter, usePathname } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../services/ThemeContext";
import { fontFamily } from "../constants/fonts";
import { TAB_ROUTES } from "../constants/tabs";
import { spacing } from "../constants/tokens";
import { AccessibilityIcon, AirplaneIcon, HomeIcon, MapIcon, NotebookIcon } from "./TabIcons";

// 탭 순서와 이름은 constants/tabs.ts 한 곳에서 관리합니다 — 밀어서 넘기는 순서
// (app/(tabs)/_layout.tsx)와 어긋나지 않게 하기 위함입니다. 여기서는 아이콘만 붙입니다.
const TAB_ICONS: Record<string, React.ComponentType<{ color?: string; size?: number }>> = {
  accessibility: AccessibilityIcon,
  planner: AirplaneIcon,
  index: HomeIcon,
  posts: NotebookIcon,
  trips: MapIcon,
};

/**
 * 앱의 어느 화면(관광지 상세, 코스 결과, 로그인 등 탭 밖의 화면 포함)에서도
 * 항상 떠 있는 하단 탭바입니다.
 *
 * 예전에는 app/(tabs)/_layout.tsx의 <Tabs>가 그리는 내장 탭바였는데, 그러면
 * 탭 밖 화면(장소선택/결과/지도/로그인/여행상세/관광지상세 등, app/_layout.tsx의
 * 일반 스택 화면)으로 이동하는 순간 자동으로 하단바가 사라졌습니다. 이제 그
 * 내장 탭바는 꺼두고(tabBar={() => null}), 이 컴포넌트를 루트 레이아웃에서
 * Stack과 나란히 항상 렌더링해서 화면이 바뀌어도 하단바가 그대로 남아있게
 * 합니다. 탭 전환 자체는 여전히 <Tabs> 내비게이터가 처리해서(router.push로
 * 탭 경로를 호출), 다른 탭 갔다와도 스크롤 위치 등 상태가 유지됩니다.
 */
export function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      {TAB_ROUTES.map((tab) => {
        const isActive = tab.path === "/" ? pathname === "/" : pathname.startsWith(tab.path);
        const tintColor = isActive ? colors.primary : colors.textTertiary;
        const TabIcon = TAB_ICONS[tab.name];
        return (
          <Pressable
            key={tab.path}
            style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
            onPress={() => router.push(tab.path)}
          >
            <TabIcon color={tintColor} size={22} />
            <Text style={[styles.label, { color: tintColor }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 2 },
  tabButtonPressed: { opacity: 0.6 },
  label: { fontSize: 11, fontFamily: fontFamily.semiBold },
});
