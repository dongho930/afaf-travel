import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ThemeColors } from "../constants/theme";
import { useTheme } from "../services/ThemeContext";

/**
 * 인증 메일의 링크를 눌러 앱이 열리면 잠깐 거쳐가는 화면입니다. 실제 세션
 * 설정과 화면 전환은 app/_layout.tsx에 걸려있는 useEmailVerificationDeepLink
 * 훅이 URL을 가로채서 처리하고 곧바로 홈으로 이동시키므로, 정상적인 경우 이
 * 화면은 아주 짧은 순간만 보입니다.
 *
 * 다만 원인 파악을 위해, 일정 시간(4초)이 지나도 훅이 처리를 못 끝내고
 * 여전히 이 화면에 머물러 있으면, 무한 스피너 대신 실제로 넘어온 링크
 * 원문을 그대로 보여줍니다 — 어떤 파라미터가 왔는지 눈으로 확인할 수 있게요.
 */
export default function VerifyEmailCompleteScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [showDebug, setShowDebug] = useState(false);
  const rawUrl = Linking.useURL();

  useEffect(() => {
    const timer = setTimeout(() => setShowDebug(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!showDebug) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.text}>이메일 인증을 확인하고 있어요...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.debugContainer}>
      <Text style={styles.debugTitle}>처리가 오래 걸리고 있어요</Text>
      <Text style={styles.text}>아래 내용을 캡처해서 보내주시면 원인을 확인할 수 있어요.</Text>
      <View style={styles.debugBox}>
        <Text style={styles.debugLabel}>전달받은 링크 원문</Text>
        <Text selectable style={styles.debugValue}>
          {rawUrl ?? "(링크를 못 받았어요)"}
        </Text>
      </View>
      <Pressable style={styles.button} onPress={() => router.replace("/login")}>
        <Text style={styles.buttonText}>로그인 화면으로 이동</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, gap: 12 },
    text: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
    debugContainer: { flexGrow: 1, backgroundColor: colors.background, padding: 24, gap: 16, justifyContent: "center" },
    debugTitle: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center" },
    debugBox: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    debugLabel: { fontSize: 12, fontWeight: "700", color: colors.textTertiary, marginBottom: 6 },
    debugValue: { fontSize: 12, color: colors.text },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  });
}
