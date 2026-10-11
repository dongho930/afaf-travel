import React from "react";
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from "react-native";

// 스크롤 목록 안의 카드용 Pressable입니다.
// 손가락이 닿자마자 눌림 효과를 켜면, 스크롤하려고 카드를 짚은 순간 카드가
// 흐려졌다가 스크롤이 시작되며 돌아와 "번쩍"이는 것처럼 보입니다. 그래서
// 효과를 100ms 늦게 켜고(안드로이드 기본 탭 판정 시간과 같음 — 그 안에 스크롤이
// 시작되면 효과가 아예 켜지지 않습니다), 켜지더라도 살짝만 흐려지게 합니다.
// 짧게 탭하면 효과가 잠깐 보인 뒤 정상적으로 눌립니다.
const PRESS_DELAY_MS = 100;

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
};

export function PressableCard({ style, ...rest }: Props) {
  return (
    <Pressable
      unstable_pressDelay={PRESS_DELAY_MS}
      style={({ pressed }) => [style, pressed && styles.pressed]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
});
