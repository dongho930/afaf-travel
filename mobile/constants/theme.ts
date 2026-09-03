/**
 * 앱 전체에서 쓰는 색상을 '의미(semantic)' 단위로 정의합니다. 화면 코드에서는
 * "#FFFFFF" 같은 실제 색값을 직접 쓰지 않고, colors.surface / colors.text처럼
 * 의미로 참조합니다 — 그래야 테마(라이트/다크)에 따라 자동으로 바뀝니다.
 *
 * 라이트 테마 값은 기존 앱에서 실제로 쓰던 색값을 그대로 옮긴 것이라, 라이트
 * 모드일 때는 지금까지와 화면이 완전히 동일합니다.
 */
export type ThemeColors = {
  background: string; // 화면 배경
  surface: string; // 카드/모달 등 배경
  surfaceAlt: string; // 살짝 다른 톤이 필요한 카드(예: 강조 카드)
  border: string; // 카드/구분선 테두리

  text: string; // 기본 텍스트
  textSecondary: string; // 보조 텍스트(설명, 메타 정보)
  textTertiary: string; // 더 옅은 텍스트(플레이스홀더 등)

  primary: string; // 브랜드 초록 (버튼, 강조, 선택 상태)
  primaryLight: string; // 초록 계열 옅은 배경(칩, 선택된 카드 배경)
  primaryDark: string; // 더 짙은 초록(텍스트용 강조 등)
  onPrimary: string; // 초록/색 배경 위에 올라가는 텍스트 (항상 흰색)

  danger: string; // 삭제 등 위험 액션
  dangerLight: string; // 위험 액션의 옅은 배경

  warning: string; // 혼잡도 보통/주의 등
  warningLight: string; // 경고의 옅은 배경
  warningText: string; // 경고 배경 위 텍스트

  overlay: string; // 모달 뒷배경(반투명 검정)
  shadow: string; // 그림자 색
};

export const lightColors: ThemeColors = {
  background: "#F4F7F5",
  surface: "#FFFFFF",
  surfaceAlt: "#F7F9F8",
  border: "#E2E8E4",

  text: "#1A1A1A",
  textSecondary: "#5C5C5C",
  textTertiary: "#8A8A8A",

  primary: "#2E7D5B",
  primaryLight: "#EAF3EE",
  primaryDark: "#296C34",
  onPrimary: "#FFFFFF",

  danger: "#C0392B",
  dangerLight: "#FDECEC",

  warning: "#C98A1D",
  warningLight: "#FFF7E0",
  warningText: "#8A6100",

  overlay: "rgba(0,0,0,0.4)",
  shadow: "#000000",
};

export const darkColors: ThemeColors = {
  background: "#12161A",
  surface: "#1C2126",
  surfaceAlt: "#22282E",
  border: "#333B42",

  text: "#EDEFEE",
  textSecondary: "#AEB6BB",
  textTertiary: "#82898F",

  primary: "#4FA487",
  primaryLight: "#1E332B",
  primaryDark: "#7FCBAE",
  onPrimary: "#12161A", // 다크 모드의 primary(민트그린)는 밝아서, 흰 글자보다 짙은 글자가 대비(WCAG AA)를 지킵니다 (약 6:1)

  danger: "#E17C6E",
  dangerLight: "#3A2422",

  warning: "#E0A94A",
  warningLight: "#3A2E12",
  warningText: "#F0C878",

  overlay: "rgba(0,0,0,0.6)",
  shadow: "#000000",
};

export type ThemeMode = "light" | "dark";

export const Colors: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};
