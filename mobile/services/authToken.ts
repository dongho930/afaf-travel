import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

/**
 * 백엔드 API를 부를 때 실어 보낼 로그인 토큰을 메모리에 들고 있습니다.
 *
 * 예전에는 API 호출 한 번마다 supabase.auth.getSession()을 기다렸습니다. 이건
 * 저장소(AsyncStorage)를 읽고 내부 잠금까지 거치는 작업이라, 화면 하나를 그리며
 * 여러 API를 부를 때마다 그만큼의 지연이 계속 붙었습니다. 세션은 로그인/로그아웃/
 * 토큰 갱신 때만 바뀌므로, 그 순간에만 갱신해두고 평소에는 메모리 값을 바로 씁니다.
 *
 * 앱이 오래 백그라운드에 있다가 돌아오면 토큰이 이미 만료됐을 수 있어서, 만료가
 * 임박했으면 supabase에 다시 물어봐 최신 토큰(필요하면 자동 갱신된 것)을 받습니다.
 */

// 만료까지 이만큼(초)도 안 남았으면 메모리 값을 믿지 않고 다시 확인합니다.
const EXPIRY_MARGIN_SECONDS = 60;

let cachedSession: Session | null = null;
// supabase로부터 세션 상태를 한 번이라도 전달받았는지. 이걸 구분해야 "아직 모름"과
// "로그인 안 한 상태"를 헷갈리지 않습니다 (후자라면 매번 다시 물어볼 필요가 없습니다).
let sessionKnown = false;
let pendingLoad: Promise<void> | null = null;

// 로그인/로그아웃/토큰 갱신이 일어나면 supabase가 알려줍니다(앱 시작 직후의 최초
// 세션 복원도 여기로 옵니다). 그때마다 메모리 값을 최신으로 유지합니다.
supabase.auth.onAuthStateChange((_event, session) => {
  cachedSession = session;
  sessionKnown = true;
});

function isUsable(session: Session | null): boolean {
  if (!session) return false;
  if (!session.expires_at) return true; // 만료 정보가 없으면 그대로 씁니다.
  return session.expires_at - EXPIRY_MARGIN_SECONDS > Date.now() / 1000;
}

/**
 * 지금 쓸 수 있는 access token. 로그인하지 않았으면 undefined를 돌려줍니다.
 */
export async function getAccessToken(): Promise<string | undefined> {
  if (sessionKnown && (cachedSession === null || isUsable(cachedSession))) {
    return cachedSession?.access_token;
  }

  // 여러 요청이 동시에 시작돼도 실제 조회는 한 번만 하도록 약속을 공유합니다.
  if (!pendingLoad) {
    pendingLoad = supabase.auth
      .getSession()
      .then(({ data }) => {
        cachedSession = data.session;
        sessionKnown = true;
      })
      .catch(() => {
        // 세션을 못 읽으면 비로그인으로 취급합니다 — 백엔드도 토큰 없는 요청을
        // 허용하므로, 여기서 요청 자체를 막지는 않습니다.
        cachedSession = null;
      })
      .finally(() => {
        pendingLoad = null;
      });
  }
  await pendingLoad;
  return cachedSession?.access_token;
}
