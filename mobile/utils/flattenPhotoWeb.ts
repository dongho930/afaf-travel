/**
 * PhotoEditor의 '완료' 처리 중 웹 전용 최종 합성(굽기) 단계.
 *
 * react-native-view-shot이 웹을 지원하지 않아서(공식 문서 확인 — Android/iOS만),
 * 웹에서는 이 파일에서 브라우저 DOM의 <canvas> API를 직접 써서 크롭된 이미지 +
 * 색감 필터(ctx.filter) + 텍스트/스티커 오버레이를 한 장으로 합칩니다. RN Web은
 * 실제 브라우저 위에서 동작하므로 document/Image/canvas를 직접 쓸 수 있습니다.
 *
 * 이 파일의 함수들은 Platform.OS === 'web'일 때만 호출되어야 합니다(PhotoEditor.tsx
 * 에서 분기). 네이티브에서는 이 함수가 실행되지 않으므로 document 참조가 문제되지
 * 않습니다(모듈은 번들에 포함되지만, 함수 바디는 호출 전까지 평가되지 않습니다).
 */

export interface FlattenOverlay {
  type: "text" | "sticker";
  content: string;
  xRatio: number; // 정사각형 프레임 기준 중심 x (0~1)
  yRatio: number; // 정사각형 프레임 기준 중심 y (0~1)
  scale: number; // 기본 폰트 크기 대비 배율
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했어요."));
    img.src = uri;
  });
}

/**
 * imageUri(이미 프레임 비율에 맞춰 잘리고 크기 조절된 이미지)에 필터와 오버레이를
 * 입혀 base64(접두어 없음)로 반환합니다. size는 출력 정사각형 한 변의 픽셀
 * 크기이고, destRect는 그 정사각형 캔버스 안에서 이미지를 그릴 위치/크기입니다
 * (이미지가 정사각형을 다 채우지 못하면 나머지는 흰 배경이 그대로 비칩니다).
 */
export async function flattenPhotoWeb(
  imageUri: string,
  size: number,
  cssFilter: string,
  overlays: FlattenOverlay[],
  destRect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: size, height: size }
): Promise<string> {
  const img = await loadImage(imageUri);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("캔버스를 생성하지 못했어요.");
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  ctx.filter = cssFilter;
  ctx.drawImage(img, destRect.x, destRect.y, destRect.width, destRect.height);
  ctx.filter = "none";

  for (const overlay of overlays) {
    const fontSize = size * 0.12 * overlay.scale;
    ctx.font = `${overlay.type === "text" ? "bold " : ""}${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = overlay.xRatio * size;
    const y = overlay.yRatio * size;
    if (overlay.type === "text") {
      ctx.lineWidth = fontSize * 0.12;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(overlay.content, x, y);
      ctx.fillStyle = "#FFFFFF";
    }
    ctx.fillText(overlay.content, x, y);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.split(",")[1];
}
