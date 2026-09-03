/**
 * 여백(spacing)과 모서리 반경(radius)의 공통 스케일입니다. 화면마다 20, 18, 14
 * 같은 숫자를 따로 정하지 않고 이 스케일에서 골라 쓰면, 화면을 넘나들어도
 * 리듬(줄맞춤 감각)이 흐트러지지 않습니다.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * 모서리 반경 스케일 — 칩/배지는 pill(완전 둥근), 카드는 lg, 입력창·작은
 * 버튼은 md를 씁니다. 화면마다 12/14/16이 섞여 있던 걸 여기로 고정합니다.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;
