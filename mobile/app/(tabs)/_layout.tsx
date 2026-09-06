import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions,
} from "@react-navigation/material-top-tabs";
import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { withLayoutContext } from "expo-router";
import React from "react";
import { TAB_ROUTES } from "../../constants/tabs";

/**
 * 홈/AI플래너/접근성/게시물/내여행 5개 화면을 하나의 네비게이터로 묶어서 각 화면의
 * 상태를 유지합니다(다른 탭 갔다 와도 스크롤 위치 등 그대로).
 *
 * 예전에는 하단 탭 네비게이터(bottom-tabs)를 썼는데, 그건 손가락으로 밀어서
 * 넘기는 기능이 없습니다. 그래서 좌우로 밀어 넘길 수 있는 상단탭 네비게이터
 * (material-top-tabs)로 바꾸고, 탭바 UI만 그리지 않게 껐습니다. 화면을 미는 동안
 * 다음 화면이 손가락을 따라오는 동작은 이 네비게이터가 처리합니다
 * (네이티브는 react-native-pager-view, 웹은 react-native-tab-view의 자체 구현).
 *
 * 하단 탭바 UI 자체는 이 그룹 밖(관광지 상세, 로그인 등)에서도 항상 보여야 해서
 * 루트 레이아웃(app/_layout.tsx)의 BottomTabBar가 계속 대신 그립니다.
 */
const { Navigator } = createMaterialTopTabNavigator();

const SwipeTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);

export default function TabsLayout() {
  return (
    <SwipeTabs
      // 화면을 미는 순서는 아래 화면 등록 순서를 따릅니다. 하단 탭바와 같은
      // 순서여야 해서 두 곳 모두 TAB_ROUTES를 씁니다.
      // 앱을 켰을 때는 순서와 상관없이 항상 홈부터 엽니다.
      initialRouteName="index"
      tabBar={() => null}
      screenOptions={{
        // 손가락으로 밀어서 전환 허용
        swipeEnabled: true,
        // 처음부터 5개를 다 그리지 않고, 실제로 열어본 화면만 그립니다.
        // (끄면 앱을 켜자마자 5개 화면이 전부 데이터를 불러와 시작이 느려집니다)
        lazy: true,
      }}
    >
      {TAB_ROUTES.map((tab) => (
        <SwipeTabs.Screen key={tab.name} name={tab.name} />
      ))}
    </SwipeTabs>
  );
}
