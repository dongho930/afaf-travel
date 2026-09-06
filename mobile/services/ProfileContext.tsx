import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { UserProfile } from "../types";

/**
 * 로그인한 사용자의 프로필(아이디/사진)을 앱 전체가 함께 쓰는 곳입니다.
 *
 * 예전에는 화면(탭)마다 있는 프로필 버튼이 각자 따로 프로필을 불러왔습니다.
 * 그래서 (1) 탭 5개를 다 돌면 똑같은 조회가 최대 5번 나갔고, (2) 아직 안 가본
 * 탭에 처음 들어갈 때는 그 화면의 버튼이 자기 몫의 조회를 처음부터 다시
 * 하느라 그동안 아무것도 안 보였습니다 — "탭을 옮기면 프로필 아이콘이
 * 사라진다"고 느껴지던 원인입니다.
 *
 * 이제 로그인 상태가 되면 여기서 딱 한 번 불러오고, 모든 화면이 그 결과를
 * 같이 봅니다. 프로필 화면에서 아이디/사진을 바꾸면 applyLocalChange로 곧바로
 * 반영되므로, 화면을 오갈 때마다 서버에 다시 물어볼 필요도 없습니다.
 */
interface ProfileContextValue {
  profile: UserProfile | null;
  /** 로그인 후 프로필 조회가 한 번이라도 끝났는지 (성공/실패는 무관). */
  loaded: boolean;
  /** 서버에서 최신 프로필을 다시 받아옵니다 (보여주고 있는 값은 지우지 않음). */
  refresh: () => Promise<void>;
  /** 방금 바꾼 값(아이디/사진)을 서버 재조회 없이 즉시 반영합니다. */
  applyLocalChange: (patch: Partial<UserProfile>) => void;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      setProfile(await api.getMyProfile());
    } catch {
      // 갱신에 실패해도 이미 보여주고 있는 값은 그대로 둡니다 — 화면에서
      // 프로필이 갑자기 사라지는 것보다 조금 오래된 값이 낫습니다.
    } finally {
      // 실패했더라도 "기다림은 끝났다"고 알려줘야 버튼이 물음표라도 띄웁니다.
      setLoaded(true);
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setLoaded(false);
      return;
    }
    refresh();
  }, [session, refresh]);

  const applyLocalChange = useCallback((patch: Partial<UserProfile>) => {
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, loaded, refresh, applyLocalChange }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile은 ProfileProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
