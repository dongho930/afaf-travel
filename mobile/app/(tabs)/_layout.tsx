import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions,
} from "@react-navigation/material-top-tabs";
import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { withLayoutContext } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { SELECTABLE_AREA_ATTR } from "../../components/SelectableArea";
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

/**
 * 밀어서 화면을 넘기려던 동작이 '누르기'로도 같이 처리되는 것을 막습니다.
 *
 * react-native-web에서 onPress는 responder 시스템이 아니라 DOM의 click 이벤트로
 * 발화합니다(PressResponder.js의 주석: "The `onPress` callback is not connected to
 * the responder system"). 그래서 페이저가 드래그를 스와이프로 가져가도 press는
 * 취소되지 않고, 버튼 위에서 눌렀다 뗀 가로 드래그가 click을 만들어 버튼까지
 * 눌렸습니다(예: 게시물의 '더보기'를 지나며 밀면 펼쳐지면서 화면도 넘어감).
 *
 * 누른 지점에서 TAP_SLOP 넘게 움직인 뒤에 나온 click은 '끌었던 것'으로 보고 여기서
 * 끊습니다. 캡처 단계에서 멈추므로 React가 루트에서 받는 click까지 가지 못하고,
 * 안쪽 어떤 버튼의 onPress도 실행되지 않습니다.
 *
 * 기준값은 페이저가 스와이프로 인정하는 거리(react-native-tab-view의 DEAD_ZONE = 12)와
 * 맞췄습니다 — 그보다 작게 잡으면 넘어가지도 않았는데 버튼만 안 눌리는 일이 생깁니다.
 *
 * 같은 이유로 '밀고 난 자리에 글자가 선택된 채 남는' 것도 여기서 막습니다.
 * react-native-web은 View/Text에 user-select를 지정하지 않아서 웹에서는 모든 글자가
 * 브라우저 기본값대로 선택 가능합니다. 그래서 화면을 넘기려고 민 드래그가 지나간
 * 자리의 글자들이 파랗게 선택된 채 남았습니다. 드래그로 판정되는 순간 선택을 끄고
 * 이미 잡힌 범위를 해제하되, SelectableArea 안에서 시작한 드래그(=진짜 복사하려는
 * 동작)는 손대지 않습니다.
 *
 * 앱(iOS/Android)은 responder 시스템이 press를 제대로 취소하므로 그냥 둡니다.
 */
const TAP_SLOP = 12;

function SwipeTapGuard({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    let start: { x: number; y: number; selecting: boolean } | null = null;
    let dragging = false;

    const movedBeyondSlop = (event: MouseEvent) =>
      start != null &&
      (Math.abs(event.clientX - start.x) > TAP_SLOP || Math.abs(event.clientY - start.y) > TAP_SLOP);

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      node.style.removeProperty("user-select");
    };

    const handlePointerDown = (event: Event) => {
      const pointer = event as PointerEvent;
      const target = pointer.target as Element | null;
      endDrag();
      start = {
        x: pointer.clientX,
        y: pointer.clientY,
        // 복사하려고 긁는 중인지 — 이 경우에는 선택을 그대로 둡니다.
        selecting: target?.closest?.(`[${SELECTABLE_AREA_ATTR}="true"]`) != null,
      };
    };

    const handlePointerMove = (event: Event) => {
      if (!start || start.selecting || dragging) return;
      if (!movedBeyondSlop(event as PointerEvent)) return;
      dragging = true;
      // 여기서부터는 글자가 더 선택되지 않게 하고, 드래그 초반에 이미 잡힌
      // 범위도 해제합니다.
      node.style.setProperty("user-select", "none");
      window.getSelection()?.removeAllRanges();
    };

    const handlePointerUp = () => {
      // 12px을 넘기 전(=아직 드래그로 판정하기 전)에 잡힌 글자가 남아 있을 수 있어서
      // 손을 뗄 때 한 번 더 지웁니다.
      if (dragging) window.getSelection()?.removeAllRanges();
      endDrag();
    };

    const handleClick = (event: Event) => {
      if (!start) return;
      const dragged = movedBeyondSlop(event as MouseEvent);
      start = null;
      if (dragged) {
        event.stopPropagation();
        event.preventDefault();
      }
    };

    // 캡처 단계로 답니다 — 안쪽에서 전파를 끊는 곳(SelectableArea)이 있어도
    // 누른 지점은 놓치지 않고, click은 목표 요소에 닿기 전에 멈출 수 있습니다.
    node.addEventListener("pointerdown", handlePointerDown, true);
    node.addEventListener("pointermove", handlePointerMove, true);
    node.addEventListener("click", handleClick, true);
    // 손을 떼는 건 화면 밖에서 일어날 수도 있어서 window에서 받습니다.
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerUp, true);
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown, true);
      node.removeEventListener("pointermove", handlePointerMove, true);
      node.removeEventListener("click", handleClick, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerUp, true);
      endDrag();
    };
  }, []);

  return (
    <View ref={ref} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <SwipeTapGuard>
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
    </SwipeTapGuard>
  );
}
