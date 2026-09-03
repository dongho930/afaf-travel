/**
 * 한글 최적화 폰트 Pretendard입니다. 시스템 기본 폰트 대신 이 폰트를 쓰면
 * 라이트/다크 어떤 테마에서도 브랜드 느낌이 또렷해집니다.
 *
 * fontWeight 숫자값 대신, 굵기별로 실제 다른 폰트 파일(family)을 쓰는 게
 * 커스텀 폰트를 쓸 때의 표준 방식입니다 — 그래서 아래처럼 굵기별 상수를
 * 따로 두고, 화면 스타일에서는 fontWeight가 아니라 fontFamily로 굵기를
 * 지정합니다.
 */
export const fontFamily = {
  regular: "Pretendard-Regular",
  medium: "Pretendard-Medium",
  semiBold: "Pretendard-SemiBold",
  bold: "Pretendard-Bold",
  extraBold: "Pretendard-ExtraBold",
} as const;

export const fontsToLoad = {
  [fontFamily.regular]: require("pretendard/dist/public/static/Pretendard-Regular.otf"),
  [fontFamily.medium]: require("pretendard/dist/public/static/Pretendard-Medium.otf"),
  [fontFamily.semiBold]: require("pretendard/dist/public/static/Pretendard-SemiBold.otf"),
  [fontFamily.bold]: require("pretendard/dist/public/static/Pretendard-Bold.otf"),
  [fontFamily.extraBold]: require("pretendard/dist/public/static/Pretendard-ExtraBold.otf"),
};
