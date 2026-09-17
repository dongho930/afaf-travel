import { Image, ImageProps } from "expo-image";
import React from "react";
import { httpsImageUrl } from "../utils/imageUrl";

/**
 * 사진 다운로드가 끝나면 부드럽게(opacity 0→1) 나타나는 이미지입니다. RN 기본
 * Image 대신 expo-image를 씁니다 — 디스크 캐시가 있어서 같은 사진을 다시 볼 때
 * 네트워크를 다시 타지 않고, 화면에 실제로 표시되는 크기에 맞춰 디코딩해서
 * 메모리도 덜 씁니다. 페이드 자체도 expo-image의 transition 옵션이 처리하므로
 * 별도 Animated.Value 없이 얇은 래퍼로만 남겨둡니다(호출부 교체 없이 그대로 사용).
 *
 * 앱에서 사진이 통째로 안 나오는 것을 막기 위해, 주소가 평문 http:// 이면
 * https:// 로 올려서 넘깁니다 — 이유는 utils/imageUrl.ts 참고.
 */
export function FadeImage({ source, style, duration = 250, ...rest }: ImageProps & { duration?: number }) {
  return (
    <Image {...rest} source={secureSource(source)} style={style} transition={duration} cachePolicy="memory-disk" />
  );
}

/**
 * source는 문자열("https://…"), { uri } 객체, require()한 로컬 파일(숫자),
 * 그리고 이들의 배열까지 올 수 있습니다. 원격 주소일 때만 손대고 나머지는
 * 원본 그대로 돌려줍니다.
 */
function secureSource(source: ImageProps["source"]): ImageProps["source"] {
  if (typeof source === "string") return httpsImageUrl(source);
  if (Array.isArray(source)) return source.map(secureSource) as ImageProps["source"];
  if (source && typeof source === "object" && "uri" in source && typeof source.uri === "string") {
    return { ...source, uri: httpsImageUrl(source.uri) };
  }
  return source;
}
