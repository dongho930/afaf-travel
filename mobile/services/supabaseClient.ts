import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

export const supabaseUrl: string =
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ?? "";
export const supabaseAnonKey: string =
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined) ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  // 개발 중 설정을 깜빡했을 때 바로 알아챌 수 있도록 콘솔에만 경고를 남깁니다
  // (앱을 죽이지는 않습니다 — 로그인 기능만 동작하지 않습니다).
  console.warn(
    "[supabase] app.json의 expo.extra.supabaseUrl / supabaseAnonKey가 비어있어요. 로그인/회원가입이 동작하지 않습니다."
  );
}

// React Native 환경에서는 세션을 AsyncStorage에 저장해야 앱을 껐다 켜도 로그인이 유지됩니다.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
