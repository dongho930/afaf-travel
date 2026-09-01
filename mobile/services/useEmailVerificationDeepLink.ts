import * as Linking from "expo-linking";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { Alert } from "./crossPlatformAlert";
import { supabase } from "./supabaseClient";

/**
 * 인증 메일 안의 링크를 누르면 이 앱이 열립니다. Supabase가 어떤 인증 방식을
 * 쓰느냐에 따라 두 가지 형태로 링크가 옵니다:
 *   1) 기존 방식(implicit): #access_token=...&refresh_token=... (해시로 옴)
 *   2) PKCE 방식: ?code=... (쿼리 파라미터로 옴)
 * 어느 쪽인지 프로젝트 설정에 따라 달라질 수 있어서, 이 함수는 두 형태를
 * 전부 인식해서 어느 값이 들어있는지 반환합니다.
 */
function extractAuthDataFromUrl(url: string): { type: "tokens"; accessToken: string; refreshToken: string } | { type: "code"; code: string } | null {
  const params = new URLSearchParams();
  const [, queryAndHash] = url.split("?");
  const [query, hash] = (queryAndHash ?? "").split("#");
  // '?' 없이 바로 '#'으로 시작하는 경우도 있어서 원본에서 한 번 더 시도합니다.
  const fallbackHash = url.includes("#") ? url.split("#")[1] : "";

  new URLSearchParams(query ?? "").forEach((v, k) => params.set(k, v));
  new URLSearchParams(hash ?? fallbackHash ?? "").forEach((v, k) => params.set(k, v));

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { type: "tokens", accessToken, refreshToken };
  }
  const code = params.get("code");
  if (code) {
    return { type: "code", code };
  }
  return null;
}

/**
 * 이 훅을 앱 최상위(RootLayout)에서 한 번만 호출하면, 앱이 꺼져있다가 링크로
 * 열리는 경우와 앱이 켜진 채로 링크를 받는 경우 둘 다 처리합니다.
 *
 * 예전엔 Linking.getInitialURL()/addEventListener를 직접 썼는데, expo-router가
 * 내부적으로 같은 딥링크를 자기 라우팅 처리에 먼저 써버려서(경로만 보고 이
 * 화면으로 이동시킴), 정작 우리 코드가 getInitialURL을 호출하는 시점엔 이미
 * 소비되어 null만 돌아오는 경쟁 상태(race condition)가 있었습니다.
 * Linking.useURL()은 expo-router와 공존하도록 설계된 공식 훅이라 이 문제가
 * 없습니다 — 앱을 실행시킨 최초 URL과 이후 들어오는 URL을 안정적으로 계속
 * 추적해줍니다.
 */
export function useEmailVerificationDeepLink() {
  const router = useRouter();
  const url = Linking.useURL();
  const handledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url || !url.includes("verify-email-complete")) return;
    if (handledUrlRef.current === url) return; // 같은 URL을 중복 처리하지 않도록
    handledUrlRef.current = url;

    const authData = extractAuthDataFromUrl(url);
    if (!authData) return;

    (async () => {
      const { error } =
        authData.type === "tokens"
          ? await supabase.auth.setSession({
              access_token: authData.accessToken,
              refresh_token: authData.refreshToken,
            })
          : await supabase.auth.exchangeCodeForSession(authData.code);

      if (error) {
        Alert.alert("인증 처리 실패", "링크가 만료됐을 수 있어요. 앱에서 인증 메일을 다시 요청해주세요.");
        return;
      }
      Alert.alert("인증 완료!", "이메일 인증이 완료되어 자동으로 로그인됐어요.");
      router.replace("/(tabs)");
    })();
  }, [url, router]);
}

