import { Tabs } from "expo-router";
import React from "react";

/**
 * 홈/AI플래너/접근성/내여행 4개 화면을 <Tabs>로 묶어서 각 화면의 상태를
 * 유지합니다(다른 탭 갔다 와도 스크롤 위치 등 그대로). 하단 탭바 UI 자체는
 * 이 그룹 밖(관광지 상세, 로그인 등)에서도 항상 보이게 하려고 루트 레이아웃
 * (app/_layout.tsx)의 커스텀 BottomTabBar가 대신 그리므로, 여기 내장 탭바는
 * tabBar={() => null}로 꺼둡니다.
 */
export default function TabsLayout() {
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="planner" />
      <Tabs.Screen name="accessibility" />
      <Tabs.Screen name="trips" />
    </Tabs>
  );
}
