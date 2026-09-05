import React, { useRef } from "react";
import { Animated } from "react-native";

/**
 * 실제 이미지 다운로드가 끝난(onLoad/onError) 뒤에야 opacity 0→1로 부드럽게
 * 나타나게 하는 Image입니다. 카드 전체를 마운트 시점에 페이드인시키는
 * FadeInView와 달리, 사진 자체의 다운로드 완료 시점에 맞춰 페이드하므로
 * 네트워크가 느려 카드보다 사진이 늦게 도착해도 뚝 튀어나오지 않습니다.
 */
export function FadeImage({
  style,
  onLoad,
  onError,
  duration = 250,
  ...rest
}: React.ComponentProps<typeof Animated.Image> & { duration?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;

  const reveal = () => {
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
  };

  return (
    <Animated.Image
      {...rest}
      style={[style, { opacity }]}
      onLoad={(e) => {
        reveal();
        onLoad?.(e);
      }}
      onError={(e) => {
        reveal();
        onError?.(e);
      }}
    />
  );
}
