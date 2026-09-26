import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { storage } from "./storage";

/**
 * 첫 실행 온보딩과 화면별 첫 방문 도움말을 언제 보여줄지 정합니다.
 *
 * 온보딩(components/Onboarding)
 *   - 앱: 설치 후 처음 열 때 한 번.
 *   - 웹: 홈('/')으로 처음 들어왔을 때 한 번. 공유 링크(게시물·여행지 상세 등)로
 *     바로 들어온 사람에게 전체 화면 안내부터 띄우면 보러 온 내용을 가립니다.
 *   - 이미 쓰던 사람(업데이트한 기존 사용자)은 건너뜁니다 — 유형을 저장했거나
 *     코스를 만든 적이 있으면 이미 앱을 아는 사람입니다.
 *
 * 도움말(components/FirstVisitTip)
 *   - 화면마다 한 번. 기존 사용자에게도 보여줍니다 (새 기능 안내 역할도 해서).
 *   - 온보딩이 떠 있는 동안에는 숨깁니다 (한꺼번에 여러 안내가 겹치지 않게).
 *
 * 둘 다 설정 화면에서 다시 볼 수 있습니다. 표시 여부는 기기(웹은 브라우저)에만
 * 저장합니다 — 기록이 지워지면 한 번 더 뜨는데, 그 정도는 괜찮습니다.
 */

/** 온보딩 내용이 크게 바뀌면 v2로 올려 모두에게 다시 보여주세요. */
const ONBOARDING_SEEN_KEY = "onboarding_seen_v1";
const TIP_KEY_PREFIX = "first_visit_tip_seen_v1:";
/** 접근권한 안내(components/AppPermissionNotice)를 이미 본 사람은 기존 사용자입니다. */
const PERMISSION_NOTICE_SEEN_KEY = "app_permission_notice_seen_v1";

export type TipKey = "planner" | "select" | "results" | "accessibility";
const TIP_KEYS: TipKey[] = ["planner", "select", "results", "accessibility"];

type OnboardingContextValue = {
  onboardingVisible: boolean;
  openOnboarding: () => void;
  finishOnboarding: () => void;
  isTipSeen: (key: TipKey) => boolean;
  dismissTip: (key: TipKey) => void;
  resetTips: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

async function isExistingUser(): Promise<boolean> {
  const [userType, course, permissionSeen] = await Promise.all([
    storage.loadUserType(),
    storage.loadCourse(),
    AsyncStorage.getItem(PERMISSION_NOTICE_SEEN_KEY),
  ]);
  return !!(userType || course || permissionSeen);
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 웹에서 '처음 들어온 주소'로 판단합니다. 앱 안에서 이동한 뒤의 주소가 아닙니다.
  const initialPathRef = useRef(pathname);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  // 아직 읽지 않은 동안에는 도움말을 모두 '본 것'으로 둡니다 — 읽기 전에 잠깐 떴다
  // 사라지는 깜빡임을 막기 위해서입니다.
  const [seenTips, setSeenTips] = useState<Set<TipKey>>(new Set(TIP_KEYS));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet(TIP_KEYS.map((k) => TIP_KEY_PREFIX + k));
        if (!cancelled) {
          setSeenTips(new Set(TIP_KEYS.filter((_, i) => !!entries[i][1])));
        }
      } catch {
        if (!cancelled) setSeenTips(new Set());
      }

      if (Platform.OS === "web" && initialPathRef.current !== "/") return;
      try {
        if (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) return;
        if (await isExistingUser()) {
          await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "existing");
          return;
        }
        if (!cancelled) setOnboardingVisible(true);
      } catch {
        // 저장소를 못 읽으면 띄우지 않습니다 — 매번 온보딩이 뜨는 쪽이 더 불편합니다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openOnboarding = useCallback(() => setOnboardingVisible(true), []);

  const finishOnboarding = useCallback(() => {
    setOnboardingVisible(false);
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "1").catch(() => {
      // 저장 실패는 넘어갑니다 — 다음 실행 때 한 번 더 보일 뿐입니다.
    });
  }, []);

  const isTipSeen = useCallback((key: TipKey) => seenTips.has(key), [seenTips]);

  const dismissTip = useCallback((key: TipKey) => {
    setSeenTips((prev) => new Set(prev).add(key));
    AsyncStorage.setItem(TIP_KEY_PREFIX + key, "1").catch(() => {});
  }, []);

  const resetTips = useCallback(() => {
    setSeenTips(new Set());
    AsyncStorage.multiRemove(TIP_KEYS.map((k) => TIP_KEY_PREFIX + k)).catch(() => {});
  }, []);

  return (
    <OnboardingContext.Provider
      value={{ onboardingVisible, openOnboarding, finishOnboarding, isTipSeen, dismissTip, resetTips }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding은 OnboardingProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
