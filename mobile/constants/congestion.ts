import { ThemeColors } from "./theme";
import { Attraction } from "../types";

export type CongestionDisplay = { label: string; color: string };

/**
 * 혼잡도를 카드에서 한눈에 알아볼 수 있게, 항상 심각도별 색(여유=초록/
 * 보통=주황/혼잡=빨강)이 있는 라벨로 바꿔줍니다. 시간대별 예보
 * (congestion_forecast)가 있으면 그걸 우선하고, 없으면 집중률 숫자
 * (congestion_rate)로 구간을 나눠 같은 방식으로 보여줍니다.
 */
export function getCongestionDisplay(
  attraction: Pick<Attraction, "congestion_forecast" | "congestion_rate">,
  colors: ThemeColors
): CongestionDisplay | null {
  const currentForecast = attraction.congestion_forecast?.[0];
  if (currentForecast) {
    const LEVEL_DISPLAY: Record<string, CongestionDisplay> = {
      low: { label: "여유", color: colors.primary },
      medium: { label: "보통", color: colors.warning },
      high: { label: "혼잡", color: colors.danger },
    };
    return LEVEL_DISPLAY[currentForecast.congestion_level] ?? null;
  }
  if (typeof attraction.congestion_rate === "number") {
    const rate = Math.round(attraction.congestion_rate);
    if (rate < 40) return { label: `여유 ${rate}%`, color: colors.primary };
    if (rate < 70) return { label: `보통 ${rate}%`, color: colors.warning };
    return { label: `혼잡 ${rate}%`, color: colors.danger };
  }
  return null;
}
