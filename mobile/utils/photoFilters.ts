/**
 * 게시물 사진 편집기(PhotoEditor)의 색감 필터 프리셋.
 *
 * 각 프리셋은 두 가지 값을 함께 갖습니다:
 * - cssFilter: 웹에서 미리보기(RNW 스타일) 및 최종 캔버스 굽기(ctx.filter)에 그대로 씁니다.
 * - svgMatrix: 네이티브(iOS/Android)에서 react-native-svg의 <FeColorMatrix values={...}>로
 *   똑같은 효과를 내기 위한 4x5(20개) 컬러 매트릭스입니다.
 *
 * 둘이 시각적으로 어긋나지 않도록, svgMatrix는 CSS Filter Effects 스펙이 정의하는
 * grayscale()/sepia()/saturate()/hue-rotate()/contrast()의 "공식 등가 매트릭스" 공식을
 * 그대로 구현해서 계산합니다(스펙: https://www.w3.org/TR/filter-effects-1/).
 */

// 4x5 컬러 매트릭스(마지막 알파 행은 항상 [0,0,0,1,0]로 고정) 두 개를 합성합니다.
// "b를 먼저 적용한 뒤 a를 적용"하는 순서(CSS의 `filter: f-b f-a`와 동일한 왼쪽→오른쪽 적용 순서를
// 맞추려면 combine(matrixOfSecondFn, matrixOfFirstFn) 형태로 호출).
function combine(a: number[], b: number[]): number[] {
  // 5x5 동차좌표 행렬로 취급해서 곱한다 (마지막 행 [0,0,0,0,1] 암묵 고정, 알파는 항상 그대로 통과).
  const A = to5x5(a);
  const B = to5x5(b);
  const result: number[][] = [];
  for (let r = 0; r < 5; r++) {
    result.push([]);
    for (let c = 0; c < 5; c++) {
      let sum = 0;
      for (let k = 0; k < 5; k++) sum += A[r][k] * B[k][c];
      result[r].push(sum);
    }
  }
  return from5x5(result);
}

function to5x5(m: number[]): number[][] {
  return [
    [m[0], m[1], m[2], m[3], m[4]],
    [m[5], m[6], m[7], m[8], m[9]],
    [m[10], m[11], m[12], m[13], m[14]],
    [m[15], m[16], m[17], m[18], m[19]],
    [0, 0, 0, 0, 1],
  ];
}

function from5x5(m: number[][]): number[] {
  return [...m[0], ...m[1], ...m[2], ...m[3]];
}

const IDENTITY: number[] = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function grayscaleMatrix(amount: number): number[] {
  const a = 1 - amount;
  return [
    0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0, 0,
    0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0, 0,
    0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function sepiaMatrix(amount: number): number[] {
  const a = 1 - amount;
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0, 0,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0, 0,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function saturateMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function hueRotateMatrix(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function contrastMatrix(amount: number): number[] {
  const intercept = (1 - amount) / 2;
  return [
    amount, 0, 0, 0, intercept,
    0, amount, 0, 0, intercept,
    0, 0, amount, 0, intercept,
    0, 0, 0, 1, 0,
  ];
}

export interface PhotoFilterPreset {
  id: string;
  label: string;
  cssFilter: string;
  svgMatrix: number[];
}

export const PHOTO_FILTER_PRESETS: PhotoFilterPreset[] = [
  { id: "original", label: "원본", cssFilter: "none", svgMatrix: IDENTITY },
  { id: "bw", label: "흑백", cssFilter: "grayscale(1)", svgMatrix: grayscaleMatrix(1) },
  {
    id: "warm",
    label: "따뜻하게",
    cssFilter: "sepia(0.6) saturate(1.3)",
    svgMatrix: combine(saturateMatrix(1.3), sepiaMatrix(0.6)),
  },
  {
    id: "cool",
    label: "차갑게",
    cssFilter: "hue-rotate(180deg) saturate(1.1)",
    svgMatrix: combine(saturateMatrix(1.1), hueRotateMatrix(180)),
  },
  {
    id: "vivid",
    label: "선명하게",
    cssFilter: "saturate(1.6) contrast(1.1)",
    svgMatrix: combine(contrastMatrix(1.1), saturateMatrix(1.6)),
  },
];
