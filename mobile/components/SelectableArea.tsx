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
 * 앱(iOS/Android)은 페이저 구현이 달라서 이 처리가 필요 없고, 아무것도 하지 않습니다.
 */
const BLOCKED_EVENTS = ["mousedown", "mousemove", "mouseup", "touchstart", "touchmove"];

export function SelectableArea({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    const stop = (event: Event) => event.stopPropagation();
    BLOCKED_EVENTS.forEach((type) => node.addEventListener(type, stop));
    return () => BLOCKED_EVENTS.forEach((type) => node.removeEventListener(type, stop));
  }, []);

  return (
    // userSelect는 위쪽에서 선택을 막아둔 경우에도 이 영역만큼은 선택되게 합니다.
    // (RN 타입에는 없는 웹 전용 속성이라, 다른 화면의 웹 전용 스타일과 같은 방식으로 씁니다)
    <View ref={ref} style={[Platform.select({ web: { userSelect: "text" } as any }), style]}>
      {children}
    </View>
  );
}
