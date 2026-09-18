import { UserType } from "../types";

/**
 * 요청 문장에 다른 이동 유형 이야기가 들어 있는지 알아봅니다.
 *
 * AI 플래너는 탭에서 고른 유형으로 후보를 통째로 걸러냅니다(백엔드의
 * _matches_user_type). 그래서 청각 장애인을 고른 채 "지체 장애인도 갈 수 있는
 * 곳"을 물으면, 문장은 순위에만 영향을 주고 후보는 여전히 청각 편의시설이 있는
 * 곳만 남았습니다. 어느 기준으로 찾을지 먼저 확인하려고 이 표를 씁니다.
 *
 * 문장을 서버로 보내기 전에 앱에서 판단합니다 — 확인창을 띄우는 데 왕복이 한 번
 * 더 필요하지 않고, 사용자는 누르자마자 물음을 받습니다.
 */
const KEYWORDS: Record<Exclude<UserType, "general">, string[]> = {
  // 공백을 지운 문장에서 찾으므로 '지체 장애인'도 '지체장애'로 걸립니다.
  wheelchair: ["지체장애", "휠체어", "보행장애", "거동이불편", "하반신"],
  stroller: ["유모차", "아기띠", "영유아"],
  senior: ["고령", "노인", "어르신", "실버"],
  pregnant: ["임산부", "임신", "만삭"],
  visual: ["시각장애", "저시력", "점자", "맹인", "시각약자"],
  hearing: ["청각장애", "난청", "수어", "수화", "보청기", "농인"],
};

/**
 * 문장에서 가장 많이 언급된 이동 유형을 돌려줍니다. 아무 것도 안 걸리면 null.
 * 동점이면 표에 먼저 나오는 쪽을 씁니다.
 */
export function detectUserTypeFromText(text: string): UserType | null {
  const haystack = (text || "").replace(/\s/g, "");
  if (!haystack) return null;

  let best: UserType | null = null;
  let bestHits = 0;
  for (const [type, words] of Object.entries(KEYWORDS) as [UserType, string[]][]) {
    const hits = words.filter((w) => haystack.includes(w)).length;
    if (hits > bestHits) {
      best = type;
      bestHits = hits;
    }
  }
  return best;
}
