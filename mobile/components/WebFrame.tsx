import React from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { ThemeColors } from "../constants/theme";

/**
 * 화면이 넓을 때 콘텐츠를 모바일 폭으로 가운데 정렬하고 좌우는 옅은 배경으로
 * 채웁니다 (인스타그램 웹과 같은 방식).
 *
 * - PC 브라우저: 예전부터 이렇게 동작했습니다.
 * - 태블릿·폴더블, 그리고 **가로로 돌린 휴대폰**: 이제 여기도 적용됩니다.
 *   방향 고정을 풀면서(app.json orientation: default) 가로 화면이 열렸는데,
 *   이 앱의 화면들은 세로 한 칸 기준으로 짜여 있어서 그대로 늘리면 카드 하나가
 *   1,000px까지 퍼지고 글줄이 지나치게 길어집니다. 읽기 좋은 폭으로 묶어두는
 *   편이 늘려놓는 것보다 낫습니다.
 * - 화면 폭이 좁으면(세로 휴대폰) 아무 영향이 없습니다 — 그대로 통과시킵니다.
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

  if (width < NARROW_BREAKPOINT) {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: (colors as any).webFrameBackdrop ?? "#e9e9ec",
        minHeight: height,
      }}
    >
      <View
        style={[
          {
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            height: "100%",
            maxHeight: height,
            backgroundColor: colors.background,
            overflow: "hidden",
          },
          // 그림자는 웹에서만 씁니다. 네이티브에서는 이 문자열 문법이 통하지
          // 않거나 렌더링 비용만 늘어서, 경계는 배경색 대비만으로 충분합니다.
          Platform.OS === "web"
            ? // @ts-ignore 웹 전용 스타일 — RN 타입에는 없지만 웹 렌더링에서만 쓰입니다.
              { boxShadow: "0 0 24px rgba(0,0,0,0.12)" }
            : null,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
