import { Image, ImageProps } from "expo-image";
import React from "react";

/**
 * 사진 다운로드가 끝나면 부드럽게(opacity 0→1) 나타나는 이미지입니다. RN 기본
 * Image 대신 expo-image를 씁니다 — 디스크 캐시가 있어서 같은 사진을 다시 볼 때
 * 네트워크를 다시 타지 않고, 화면에 실제로 표시되는 크기에 맞춰 디코딩해서
 * 메모리도 덜 씁니다. 페이드 자체도 expo-image의 transition 옵션이 처리하므로
 * 별도 Animated.Value 없이 얇은 래퍼로만 남겨둡니다(호출부 교체 없이 그대로 사용).
 */
export function FadeImage({ style, duration = 250, ...rest }: ImageProps & { duration?: number }) {
  return <Image {...rest} style={style} transition={duration} cachePolicy="memory-disk" />;
}
