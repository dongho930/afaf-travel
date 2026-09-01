import React from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { ThemeColors } from "../constants/theme";
import { useTheme } from "../services/ThemeContext";

/**
 * expo-speech-recognition은 네이티브 모듈이라 Expo Go에는 포함돼 있지 않습니다.
 * 이 컴포넌트는 부모(input.tsx)에서 네이티브 모듈 사용 가능 여부를 먼저 확인한 뒤
 * 사용 가능할 때만 마운트되므로, 이 안에서는 안전하게 훅을 호출할 수 있습니다.
 * (Expo Go에서 사용하려면 expo prebuild + dev client 빌드가 필요합니다.)
 */
export function VoiceInputButton({
  isListening,
  onListeningChange,
  onResult,
}: {
  isListening: boolean;
  onListeningChange: (listening: boolean) => void;
  onResult: (text: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  useSpeechRecognitionEvent("start", () => onListeningChange(true));
  useSpeechRecognitionEvent("end", () => onListeningChange(false));
  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript;
    if (text) onResult(text);
  });
  useSpeechRecognitionEvent("error", (event) => {
    onListeningChange(false);
    Alert.alert("음성 인식 오류", `${event.error}: ${event.message}`);
  });

  const startListening = async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        "권한이 필요해요",
        "음성 입력을 사용하려면 마이크·음성 인식 권한을 허용해주세요. 지금은 텍스트로 입력해주세요."
      );
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: "ko-KR",
      interimResults: true,
      continuous: false,
    });
  };

  const stopListening = () => {
    ExpoSpeechRecognitionModule.stop();
  };

  return (
    <Pressable
      style={[styles.micButton, isListening && styles.micButtonActive]}
      onPress={isListening ? stopListening : startListening}
      accessibilityRole="button"
      accessibilityLabel={isListening ? "음성 입력 중지" : "음성으로 입력하기"}
    >
      <Text style={styles.micIcon}>{isListening ? "🛑" : "🎙️"}</Text>
      <Text style={styles.micLabel}>
        {isListening ? "듣는 중... 눌러서 중지" : "눌러서 음성으로 말하기"}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  micButton: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  micButtonActive: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  micIcon: { fontSize: 26, marginBottom: 4 },
  micLabel: { fontSize: 15, fontWeight: "600", color: colors.primary },
  });
}
