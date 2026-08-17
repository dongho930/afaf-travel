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
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { USER_TYPE_LABELS } from "../types";

// expo-speech-recognition은 네이티브 모듈이라 Expo Go에는 포함돼 있지 않습니다.
// 정적으로 import하면 모듈 평가 시점에 바로 에러가 나서 화면 전체가 깨지므로,
// require()로 감싸 실행 시점에만 로드하고 실패하면 안전하게 null로 대체합니다.
// (Expo Go에서도 완전히 쓰려면 expo prebuild + dev client 빌드가 필요합니다.)
let VoiceInputButton: typeof import("../components/VoiceInputButton").VoiceInputButton | null =
  null;
try {
  VoiceInputButton = require("../components/VoiceInputButton").VoiceInputButton;
} catch {
  VoiceInputButton = null;
}

const EXAMPLE_QUERY = "휠체어로 갈 수 있는 경사 없는 산책로와 맛집 추천해줘";

export default function InputScreen() {
  const router = useRouter();
  const { userType, setCourse } = useCourseContext();
  const [queryText, setQueryText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!queryText.trim()) {
      Alert.alert("입력이 필요해요", "원하시는 여행 코스를 텍스트나 음성으로 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const course = await api.generateCourse({ queryText, userType });
      setCourse(course);
      await storage.saveCourse(course);
      router.push("/results");
    } catch (err) {
      Alert.alert("코스 생성 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>{USER_TYPE_LABELS[userType]} 맞춤</Text>
      <Text style={styles.title}>어떤 여행을 원하세요?</Text>
      <Text style={styles.hint}>예: "{EXAMPLE_QUERY}"</Text>

      <TextInput
        style={styles.input}
        multiline
        placeholder="여기에 입력하거나 마이크 버튼을 눌러 말씀해주세요"
        value={queryText}
        onChangeText={setQueryText}
        accessibilityLabel="여행 요청 입력창"
      />

      {VoiceInputButton ? (
        <VoiceInputButton
          isListening={isListening}
          onListeningChange={setIsListening}
          onResult={setQueryText}
        />
      ) : (
        <Text style={styles.voiceNotice}>
          🎙️ 음성 입력은 iOS/Android 개발 빌드(dev client)에서 활성화됩니다. 지금은 텍스트로
          입력해주세요.
        </Text>
      )}

      <Pressable
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}
        accessibilityRole="button"
        accessibilityLabel="맞춤 코스 생성하기"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitText}>맞춤 코스 생성하기</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#EAF3EE",
    color: "#2E7D5B",
    fontWeight: "700",
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 6, color: "#1A1A1A" },
  hint: { fontSize: 13, color: "#8A8A8A", marginBottom: 16 },
  input: {
    minHeight: 110,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 16,
    fontSize: 16,
    textAlignVertical: "top",
  },
  voiceNotice: { fontSize: 13, color: "#8A8A8A", marginTop: 16, textAlign: "center", lineHeight: 18 },
  submitButton: {
    marginTop: 24,
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
