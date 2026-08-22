import { Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";

const ICONS: Record<string, string> = {
  index: "🏠",
  planner: "🤖",
  accessibility: "♿",
  trips: "🧳",
};

const LABELS: Record<string, string> = {
  index: "홈",
  planner: "AI 플래너",
  accessibility: "접근성",
  trips: "내 여행",
};

/**
 * 하단 탭바(홈/AI플래너/접근성/내여행) 정의. 이 그룹 밖의 화면(장소선택, 결과,
 * 지도, 로그인/회원가입, 프로필, 여행상세)은 탭 화면 안에서 눌렀을 때 위로
 * 밀려 올라오는 일반 스택 화면으로 그대로 유지됩니다 (app/_layout.tsx 참고).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#2E7D5B",
        tabBarInactiveTintColor: "#8A8A8A",
        tabBarStyle: { backgroundColor: "#FFFFFF", borderTopColor: "#E2E8E4" },
        tabBarLabel: LABELS[route.name] ?? route.name,
        tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>{ICONS[route.name]}</Text>,
      })}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="planner" />
      <Tabs.Screen name="accessibility" />
      <Tabs.Screen name="trips" />
    </Tabs>
  );
}
