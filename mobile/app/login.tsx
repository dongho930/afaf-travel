import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ThemeColors } from "../constants/theme";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [identifier, setIdentifier] = useState(""); // 이메일 또는 아이디
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      Alert.alert("입력이 필요해요", "이메일(또는 아이디)과 비밀번호를 모두 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      // 입력값이 이메일이면 그대로, 아이디면 서버에서 실제 이메일로 변환해줍니다.
      let email: string;
      try {
        const result = await api.resolveLoginEmail(identifier.trim());
        email = result.email;
      } catch {
        Alert.alert("로그인 실패", "일치하는 계정을 찾을 수 없어요. 이메일/아이디를 다시 확인해주세요.");
        return;
      }

      const { error } = await signIn(email, password);
      if (error) {
        Alert.alert("로그인 실패", error);
        return;
      }
      router.back();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>로그인</Text>
      <Text style={styles.subtitle}>로그인하면 내가 만든 코스 이력을 다시 볼 수 있어요.</Text>

      <TextInput
        style={styles.input}
        placeholder="이메일 또는 아이디"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        value={identifier}
        onChangeText={setIdentifier}
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호"
        placeholderTextColor={colors.textTertiary}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
      />

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={isSubmitting}
      >
        {isSubmitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>로그인</Text>}
      </Pressable>

      <Pressable onPress={() => router.push("/signup")} style={styles.linkButton}>
        <Text style={styles.linkText}>계정이 없으신가요? 회원가입</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: colors.background },
    title: { fontSize: 24, fontWeight: "700", color: colors.text, marginBottom: 6 },
    subtitle: { fontSize: 13, color: colors.textTertiary, marginBottom: 24, lineHeight: 18 },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      marginBottom: 12,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: "center",
      marginTop: 8,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
    linkButton: { marginTop: 18, alignItems: "center" },
    linkText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  });
}
