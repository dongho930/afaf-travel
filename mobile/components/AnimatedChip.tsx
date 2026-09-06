import React, { useEffect, useRef } from "react";
import { Animated, StyleProp, TextStyle, TouchableOpacity, ViewStyle } from "react-native";

// 카테고리/지역 칩처럼 "선택됨" 상태에 따라 배경/글자색이 바뀌는 버튼이
// 즉시 뚝 바뀌지 않고 짧게 색이 번지듯 바뀌도록 감싸는 공용 컴포넌트입니다.
// 색상 보간은 네이티브 드라이버를 못 쓰지만(짧은 시간 JS 스레드로 처리),
// 네이티브/웹 어디서나 동일하게 동작합니다.
export function AnimatedChip({
  selected,
  onPress,
  label,
  style,
  textStyle,
  backgroundColor,
  selectedBackgroundColor,
  borderColor,
  selectedBorderColor,
  textColor,
  selectedTextColor,
  duration = 180,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  backgroundColor: string;
  selectedBackgroundColor: string;
  borderColor?: string;
  selectedBorderColor?: string;
  textColor: string;
  selectedTextColor: string;
  duration?: number;
}) {
  const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: selected ? 1 : 0, duration, useNativeDriver: false }).start();
  }, [selected, progress, duration]);

  const animatedBackgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [backgroundColor, selectedBackgroundColor],
  });
  const animatedTextColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [textColor, selectedTextColor],
  });
  const animatedBorderColor =
    borderColor != null && selectedBorderColor != null
      ? progress.interpolate({ inputRange: [0, 1], outputRange: [borderColor, selectedBorderColor] })
      : undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      // 칩은 "여러 개 중 하나를 고르는" 필터라, 화면을 못 보는 사용자에게는
      // 지금 무엇이 골라져 있는지가 색깔 말고는 전달될 방법이 없었습니다.
      // 선택 여부는 앱(accessibilityState)과 웹(aria-selected)이 서로 다른 것만
      // 읽어서 둘 다 넘깁니다.
      accessible
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      accessibilityLabel={label}
      accessibilityHint={selected ? undefined : `${label} 조건으로 목록을 봅니다`}
    >
      <Animated.View
        style={[
          style,
          {
            backgroundColor: animatedBackgroundColor,
            ...(animatedBorderColor != null ? { borderColor: animatedBorderColor } : null),
          },
        ]}
      >
        <Animated.Text style={[textStyle, { color: animatedTextColor }]}>{label}</Animated.Text>
      </Animated.View>
    </TouchableOpacity>
  );
}
