import React, { useEffect, useRef } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";

// 리스트/카드 항목이 툭 튀어나오지 않고, 마운트될 때 opacity 0→1(+살짝
// 아래에서 위로)로 부드럽게 나타나게 합니다. 홈 화면 인기 여행지 카드에 쓰던
// 패턴을 다른 화면에서도 재사용할 수 있도록 뽑아낸 공용 컴포넌트입니다.
// react-native 코어 Animated API만 사용해서 네이티브/웹 어디서나 동일하게 동작합니다.
export function FadeInView({
  children,
  duration = 300,
  translateY = 12,
  style,
  accessible,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  duration?: number;
  translateY?: number;
  style?: StyleProp<ViewStyle>;
  // 이 래퍼가 실제로 화면에 그려지는 상자라, 안쪽 내용을 한 덩어리로 묶어
  // 읽어주고 싶을 때(예: 홈 화면 통계 카드) 여기로 이름표를 넘깁니다.
  accessible?: boolean;
  accessibilityLabel?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [translateY, 0] }) }],
        },
        style,
      ]}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Animated.View>
  );
}
