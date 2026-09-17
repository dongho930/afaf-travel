import React, { useEffect, useRef } from "react";
import { Platform, StyleProp, View, ViewStyle } from "react-native";

/**
 * 이 영역 안에서는 웹에서 텍스트를 끌어서 선택할 수 있습니다.
 *
 * 탭 화면은 좌우로 밀어서 넘길 수 있는데(app/(tabs)/_layout.tsx), 웹에서 그 스와이프는
 * react-native-tab-view의 PanResponderAdapter가 처리합니다. 가로로 12px만 끌어도
 * 스와이프로 인정해버려서(DEAD_ZONE), 문장을 긁어 복사하려는 드래그가 전부 화면
 * 넘김으로 먹혔습니다.
 *
 * react-native-web의 responder 시스템은 mousedown/mousemove/touchstart/touchmove를
 * document에 '버블 단계'로 걸어둡니다(ResponderSystem.js). 그래서 중간에서 전파를
 * 끊으면 document까지 올라가지 못하고, 페이저의 PanResponder는 호출조차 되지
 * 않습니다 — 이 영역에서만 브라우저 기본 동작(드래그 선택)이 살아나고, 화면의
 * 나머지 부분은 스와이프가 그대로입니다.
 *
 * preventDefault가 아니라 stopPropagation만 하므로, 이 텍스트 위에서 시작한 세로
 * 스크롤은 브라우저 기본 동작으로 그대로 동작합니다.
 *
 * 선택은 '여기서 시작한 드래그'일 때만 켭니다. 늘 켜두면, 화면을 넘기려고 다른
 * 곳에서 시작한 드래그가 이 영역 위를 지나가는 동안 글자가 잡혀 파랗게 깜빡였습니다
 * (user-select는 상속값보다 요소 자신의 값이 우선이라, 위쪽에서 꺼도 소용이 없습니다).
 * 그래서 평소에는 꺼두고, 누르는 지점이 이 안일 때만 켭니다 — 누름 지점 판별은
 * pointerdown에서 하는데, 브라우저가 글자를 잡기 시작하는 mousedown보다 먼저
 * 일어나므로 첫 글자부터 정상적으로 선택됩니다.
 *
 * 앱(iOS/Android)은 페이저 구현이 달라서 이 처리가 필요 없고, 아무것도 하지 않습니다.
 */
const BLOCKED_EVENTS = ["mousedown", "mousemove", "mouseup", "touchstart", "touchmove"];

/** 탭 레이아웃(SwipeTapGuard)이 선택 가능한 영역을 알아보는 표식입니다. */
export const SELECTABLE_AREA_ATTR = "data-selectable-area";

export function SelectableArea({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    // 탭 레이아웃의 SwipeTapGuard가 "이 드래그가 선택하려는 것인지"를 판단할 때
    // 찾는 표식입니다. 여기서 시작한 드래그는 선택을 지우지 않습니다.
    node.setAttribute(SELECTABLE_AREA_ATTR, "true");
    node.style.setProperty("user-select", "none");

    // 누르는 지점이 이 안이면 선택을 켜고, 밖이면 다시 끕니다. document에 캡처로
    // 달아서 안쪽에서 전파를 끊기 전에 먼저 봅니다.
    const syncSelectable = (event: Event) => {
      const target = event.target as Node | null;
      const inside = target != null && node.contains(target);
      node.style.setProperty("user-select", inside ? "text" : "none");
    };
    document.addEventListener("pointerdown", syncSelectable, true);

    const stop = (event: Event) => event.stopPropagation();
    BLOCKED_EVENTS.forEach((type) => node.addEventListener(type, stop));
    return () => {
      node.removeAttribute(SELECTABLE_AREA_ATTR);
      node.style.removeProperty("user-select");
      document.removeEventListener("pointerdown", syncSelectable, true);
      BLOCKED_EVENTS.forEach((type) => node.removeEventListener(type, stop));
    };
  }, []);

  // user-select는 위 useEffect가 눌린 지점에 따라 직접 켜고 끕니다.
  return (
    <View ref={ref} style={style}>
      {children}
    </View>
  );
}
