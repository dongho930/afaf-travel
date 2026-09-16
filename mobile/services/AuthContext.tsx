import { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

interface AuthContextValue {
  session: Session | null;
  loading: boolean; // 앱 시작 시 기존 로그인 세션 복원 중인지 여부
  signUp: (email: string, password: string) => Promise<{ error: string | null; userId: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Supabase가 주는 영어 오류 메시지를 사용자에게 보여줄 한국어로 바꿉니다.
 *
 * 예전에는 로그인·회원가입·비밀번호 변경 화면이 이 값을 그대로 팝업에 띄워서
 * "Invalid login credentials" 같은 문구가 사용자에게 보였습니다. 여기서 한 번만
 * 바꾸면 그 세 화면이 모두 함께 고쳐집니다.
 *
 * 목록에 없는 메시지는 원문 대신 일반 안내로 바꾸고, 원문은 콘솔에만 남깁니다 —
 * 어떤 영어 문장이 올지 다 알 수 없기 때문입니다.
 */
function authErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "이메일(또는 아이디)이나 비밀번호가 맞지 않아요.";
  }
  if (lower.includes("email not confirmed")) {
    return "이메일 인증이 아직 끝나지 않았어요. 받은 메일함을 확인해주세요.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "이미 가입된 이메일이에요. 로그인해주세요.";
  }
  if (lower.includes("password should be at least")) {
    return "비밀번호가 너무 짧아요. 6자 이상으로 만들어주세요.";
  }
  if (lower.includes("unable to validate email") || lower.includes("invalid email")) {
    return "이메일 형식이 올바르지 않아요.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "요청이 너무 잦아요. 잠시 후 다시 시도해주세요.";
  }
  if (lower.includes("new password should be different")) {
    return "지금 쓰는 비밀번호와 다른 비밀번호를 입력해주세요.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "네트워크에 연결할 수 없어요. 연결 상태를 확인해주세요.";
  }

  console.warn("[auth]", raw);
  return "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // 이메일 인증 기능은 현재 꺼둔 상태입니다 — Supabase 프로젝트의 "Confirm email"
  // 설정도 꺼져 있어야(Authentication > Providers > Email > Confirm email) 가입
  // 즉시 로그인이 가능합니다. 나중에 이메일 인증을 다시 켜려면, emailRedirectTo
  // 옵션과 verify-email 관련 화면 이동 로직을 되살리면 됩니다.
  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { error: authErrorMessage(error?.message), userId: data.user?.id ?? null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: authErrorMessage(error?.message) };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // 비밀번호 변경은 Supabase Auth가 클라이언트에서 바로 처리합니다 (로그인 세션 필요).
  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: authErrorMessage(error?.message) };
  };

  // 인증 메일 재발송. 이메일 인증 기능을 다시 켤 때 verify-email 화면이 씁니다
  // (기능을 꺼두면서 이 함수가 빠져 그 화면이 컴파일되지 않는 상태였습니다).
  const resendVerificationEmail = async (email: string) => {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    return { error: authErrorMessage(error?.message) };
  };

  return (
    <AuthContext.Provider
      value={{ session, loading, signUp, signIn, signOut, changePassword, resendVerificationEmail }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
