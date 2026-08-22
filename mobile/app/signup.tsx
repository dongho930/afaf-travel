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
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{2,20}$/;

export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignup = async () => {
    if (!username.trim() || !email.trim() || !password) {
      Alert.alert("입력이 필요해요", "아이디, 이메일, 비밀번호를 모두 입력해주세요.");
      return;
    }
    if (!USERNAME_PATTERN.test(username.trim())) {
      Alert.alert(
        "아이디 형식을 확인해주세요",
        "영문/숫자/밑줄(_)/마침표(.)만 사용해 2~20자로 입력해주세요."
      );
      return;
    }
    if (password.length < 6) {
      Alert.alert("비밀번호가 너무 짧아요", "6자 이상으로 입력해주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      Alert.alert("비밀번호가 일치하지 않아요", "다시 확인해주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error, userId } = await signUp(email.trim(), password);
      if (error) {
        Alert.alert("회원가입 실패", error);
        return;
      }
      if (!userId) {
        // 이론상 signUp 성공 시 항상 userId가 오지만, 방어적으로 처리합니다.
        Alert.alert(
          "가입은 완료됐지만 아이디 설정에 실패했어요",
          "잠시 후 로그인해서 다시 시도해주세요.",
          [{ text: "확인", onPress: () => router.replace("/login") }]
        );
        return;
      }

      try {
        await api.createProfile({ userId, username: username.trim(), email: email.trim() });
      } catch (profileErr) {
        // 계정 자체는 이미 만들어졌으니, 아이디만 다시 설정하면 됩니다.
        Alert.alert(
          "아이디 설정 실패",
          "이미 사용 중인 아이디이거나 오류가 발생했어요. 로그인 후 다른 아이디로 다시 시도해주세요.\n" +
            String(profileErr)
        );
        router.replace("/login");
        return;
      }

      Alert.alert(
        "가입 완료",
        "이메일 인증이 필요할 수 있어요. 메일함을 확인해주세요.",
        [{ text: "확인", onPress: () => router.replace("/login") }]
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>회원가입</Text>
      <Text style={styles.subtitle}>아이디를 만들고 이메일/비밀번호로 가입해요.</Text>

      <TextInput
        style={styles.input}
        placeholder="아이디 (영문/숫자, 2~20자)"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="이메일"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호 (6자 이상)"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호 확인"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={passwordConfirm}
        onChangeText={setPasswordConfirm}
      />

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleSignup}
        disabled={isSubmitting}
      >
        {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>회원가입</Text>}
      </Pressable>

      <Pressable onPress={() => router.push("/login")} style={styles.linkButton}>
        <Text style={styles.linkText}>이미 계정이 있으신가요? 로그인</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1A1A1A", marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#8A8A8A", marginBottom: 24, lineHeight: 18 },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  linkButton: { marginTop: 18, alignItems: "center" },
  linkText: { color: "#2E7D5B", fontSize: 14, fontWeight: "600" },
});
