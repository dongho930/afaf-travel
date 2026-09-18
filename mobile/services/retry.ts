import { ApiError } from "./api";

// 다시 시도하기까지 기다리는 시간. 서버가 잠깐 숨을 고르는 사이를 넘기는 게
// 목적이라 길게 끌지 않고 세 번 안에 끝냅니다(최대 5초).
const RETRY_DELAYS_MS = [500, 1500, 3000];

/**
 * 잠깐의 문제로 실패한 요청을 몇 번 다시 시도합니다.
 *
 * 접근성 탭의 유형별 개수와 홈 화면의 '무장애 여행지' 수는 같은 캐시 테이블을
 * 읽습니다. 서버 로그를 보면 그 읽기가 하루 한두 번 순간적으로 거부됩니다 —
 * PostgREST의 'JWT issued at future'(시계 어긋남)와 인스턴스의 'Resource
 * temporarily unavailable'(동시 요청이 겹칠 때) 두 가지입니다. 둘 다 몇 초 뒤면
 * 멀쩡해지는 일시적인 상태인데, 지금은 그 한 번의 실패가 화면에 그대로 굳어서
 * 모든 유형이 '-'로 보이고 여행지 카드가 뜨지 않았습니다.
 */
export async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransient(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * 다시 시도할 만한 실패인지 판단합니다.
 *
 * 서버가 "지금은 안 되니 잠시 후에"라고 답했거나(502/503/504), 아예 닿지 못한
 * 경우(네트워크 끊김·시간 초과 — status가 null)만 다시 겁니다. 400·404처럼
 * 다시 해도 같은 답이 올 요청은 그대로 실패로 둬야 사용자를 괜히 기다리게
 * 하지 않습니다.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === null || err.status === 502 || err.status === 503 || err.status === 504;
}
