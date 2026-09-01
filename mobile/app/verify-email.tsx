import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import { ThemeColors } from "../constants/theme";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";

/**
 * 회원가입 직후 이동하는 화면입니다. 인증 메일을 보냈다고 명확히 안내하고,
 * 메일을 못 받았거나 놓쳤을 때 다시 보낼 수 있는 버튼을 제공합니다.
 * 로그인 화면에서 '이메일 미인증' 에러를 받았을 때도 같은 화면으로 옵니다.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { resendVerificationEmail } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [isResending, setIsResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setIsResending(true);
    try {
      const { error } = await resendVerificationEmail(email);
      if (error) {
        Alert.alert("재전송 실패", "잠시 후 다시 시도해주세요.\n" + error);
        return;
      }
      setResent(true);
      Alert.alert("재전송 완료", "인증 메일을 다시 보냈어요. 메일함(스팸함 포함)을 확인해주세요.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📧</Text>
      <Text style={styles.title}>메일함을 확인해주세요</Text>
      <Text style={styles.desc}>
        {email ? `${email}으로` : "가입하신 이메일로"} 인증 메일을 보냈어요.{"\n"}
        메일 안의 링크를 눌러 인증을 완료하면 로그인하실 수 있어요.
      </Text>

      <Pressable
        style={[styles.resendButton, isResending && styles.resendButtonDisabled]}
        onPress={handleResend}
        disabled={isResending}
      >
        {isResending ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.resendButtonText}>{resent ? "메일 다시 보내기" : "인증 메일이 안 왔나요? 다시 보내기"}</Text>
        )}
      </Pressable>

      <Pressable style={styles.loginButton} onPress={() => router.replace("/login")}>
        <Text style={styles.loginButtonText}>인증 완료 후 로그인하러 가기</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
    icon: { fontSize: 48, marginBottom: 16 },
    title: { fontSize: 20, fontWeight: "800", color: colors.text, marginBottom: 10, textAlign: "center" },
    desc: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 21, marginBottom: 32 },
    resendButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      marginBottom: 12,
      alignSelf: "stretch",
    },
    resendButtonDisabled: { opacity: 0.6 },
    resendButtonText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
    loginButton: { paddingVertical: 12, alignItems: "center" },
    loginButtonText: { color: colors.textTertiary, fontWeight: "600", fontSize: 13 },
  });
}
