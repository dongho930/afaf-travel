import { ThemeColors } from "./theme";
import { Attraction, CongestionForecast } from "../types";

export type CongestionDisplay = { label: string; color: string };
type CongestionLevel = CongestionForecast["congestion_level"];

// 집중률(0~100)을 등급으로 나누는 경계. 서버(course_validator.congestion_level,
// tour_api 예보 등급)와 같은 값이어야 합니다 — 예전에는 앱만 40/70을 써서, 서버가
// '많이 몰리는 곳'(66 이상)이라고 설명한 곳이 앱에는 '보통 67%'로 보였습니다.
const MEDIUM_RATE = 34;
const HIGH_RATE = 66;
const LEVEL_RANK: Record<CongestionLevel, number> = { low: 0, medium: 1, high: 2 };

function rateLevel(rate: number): CongestionLevel {
  if (rate >= HIGH_RATE) return "high";
  return rate >= MEDIUM_RATE ? "medium" : "low";
}

/**
 * 혼잡도를 카드에서 한눈에 알아볼 수 있게, 항상 심각도별 색(여유=초록/
 * 보통=주황/혼잡=빨강)이 있는 라벨로 바꿔줍니다.
 *
 * 등급은 서버와 같은 순서로 고릅니다.
 * 1. level(서버가 코스 장소마다 매긴 등급)이 있으면 그대로
 * 2. 방문일을 알고 그날 예보가 있으면 그 예보
 * 3. 방문일을 모르면 예보의 첫 줄
 * 4. 집중률 숫자
 * 숫자는 등급이 집중률에서 나왔을 때만 붙입니다 — 방문일 예보는 '혼잡'인데
 * 평소 집중률 40%를 함께 적으면 서로 어긋나 보이기 때문입니다.
 */
export function getCongestionDisplay(
  attraction: Pick<Attraction, "congestion_forecast" | "congestion_rate">,
  colors: ThemeColors,
  options: { level?: CongestionLevel | null; visitDate?: string | null } = {}
): CongestionDisplay | null {
  const LEVEL_DISPLAY: Record<CongestionLevel, CongestionDisplay> = {
    low: { label: "여유", color: colors.primary },
    medium: { label: "보통", color: colors.warning },
    high: { label: "혼잡", color: colors.danger },
  };
  const rate = typeof attraction.congestion_rate === "number" ? Math.round(attraction.congestion_rate) : null;
  const withRate = (level: CongestionLevel): CongestionDisplay => {
    const display = LEVEL_DISPLAY[level];
    return rate !== null && rateLevel(rate) === level ? { ...display, label: `${display.label} ${rate}%` } : display;
  };

  if (options.level && LEVEL_DISPLAY[options.level]) return withRate(options.level);

  const forecast = attraction.congestion_forecast ?? [];
  if (options.visitDate) {
    const levels = forecast
      .filter((c) => c.date === options.visitDate && LEVEL_DISPLAY[c.congestion_level])
      .map((c) => c.congestion_level);
    if (levels.length) {
      return LEVEL_DISPLAY[levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a))];
    }
  } else if (forecast[0] && LEVEL_DISPLAY[forecast[0].congestion_level]) {
    return LEVEL_DISPLAY[forecast[0].congestion_level];
  }
  if (rate !== null) return withRate(rateLevel(rate));
  return null;
}
