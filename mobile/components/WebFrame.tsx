import React from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { ThemeColors } from "../constants/theme";

/**
 * 웹(PC 브라우저)에서 화면이 넓을 때, 콘텐츠를 인스타그램 웹처럼 모바일 폭으로
 * 가운데 정렬하고 좌우는 옅은 배경으로 채웁니다.
 * - 앱(iOS/Android)에서는 그냥 children을 그대로 통과시킵니다 (영향 없음).
 * - 웹이라도 화면 폭이 이미 좁으면(모바일 브라우저) 그대로 꽉 채웁니다.
 */
const MAX_CONTENT_WIDTH = 640;
const NARROW_BREAKPOINT = 700;

export function WebFrame({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== "web" || width < NARROW_BREAKPOINT) {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        // @ts-ignore 웹 전용 스타일 — RN 타입에는 없지만 웹 렌더링에서만 쓰입니다.
        backgroundColor: (colors as any).webFrameBackdrop ?? "#e9e9ec",
        minHeight: height,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          height: "100%",
          maxHeight: height,
          backgroundColor: colors.background,
          overflow: "hidden",
          // @ts-ignore 웹 전용 스타일
          boxShadow: "0 0 24px rgba(0,0,0,0.12)",
        }}
      >
        {children}
      </View>
    </View>
  );
}
