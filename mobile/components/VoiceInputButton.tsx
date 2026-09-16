import { MicrophoneIcon, StopCircleIcon } from "phosphor-react-native";
import React from "react";
import { Keyboard, Pressable, StyleSheet, Text } from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import { errorMessage } from "../services/api";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * expo-speech-recognition은 네이티브 모듈이라 Expo Go에는 포함돼 있지 않습니다.
 * 이 컴포넌트는 부모(input.tsx)에서 네이티브 모듈 사용 가능 여부를 먼저 확인한 뒤
 * 사용 가능할 때만 마운트되므로, 이 안에서는 안전하게 훅을 호출할 수 있습니다.
 * (Expo Go에서 사용하려면 expo prebuild + dev client 빌드가 필요합니다.)
 */
// 말을 안 했거나 사용자가 스스로 멈춘 경우까지 '오류'라고 띄우면, 정상적으로
// 취소한 것뿐인데 실패한 것처럼 보입니다. 이 둘은 조용히 듣기만 끝냅니다.
const SILENT_ERRORS = ["no-speech", "aborted", "client"];

// 음성 인식 모듈은 오류를 'not-allowed' 같은 영어 코드로 줍니다. 그대로 띄우면
// 사용자는 무엇을 해야 할지 알 수 없어서, 할 수 있는 일을 알려주는 문장으로 바꿉니다.
const VOICE_ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "마이크·음성 인식 권한이 필요해요. 설정에서 권한을 허용해주세요.",
  "service-not-allowed": "이 기기에서는 음성 인식을 쓸 수 없어요. 텍스트로 입력해주세요.",
  "audio-capture": "마이크를 사용할 수 없어요. 다른 앱이 쓰고 있는지 확인해주세요.",
  network: "네트워크에 연결할 수 없어요. 연결 상태를 확인해주세요.",
  "language-not-supported": "이 기기에서는 한국어 음성 인식을 지원하지 않아요.",
  busy: "음성 인식이 아직 준비 중이에요. 잠시 후 다시 눌러주세요.",
};

export function VoiceInputButton({
  isListening,
  onListeningChange,
  onResult,
  onStart,
}: {
  isListening: boolean;
  onListeningChange: (listening: boolean) => void;
  onResult: (text: string) => void;
  // 듣기를 시작하기 직전에 불립니다(입력창을 비우는 용도).
  onStart?: () => void;
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
    if (SILENT_ERRORS.includes(event.error)) return;
    console.warn("[speech]", event.error, event.message);
    Alert.alert(
      "음성 입력을 쓸 수 없어요",
      VOICE_ERROR_MESSAGES[event.error] ?? "잠시 후 다시 시도하거나 텍스트로 입력해주세요."
    );
  });

  const startListening = async () => {
    // 글자를 치던 중이면 입력창에 커서가 남아 있고, 그 상태로 인식을 시작하면
    // 키보드가 잡고 있는 마이크와 부딪혀 실패할 수 있습니다. 키보드부터 내립니다.
    Keyboard.dismiss();

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        "권한이 필요해요",
        "음성 입력을 사용하려면 마이크·음성 인식 권한을 허용해주세요. 지금은 텍스트로 입력해주세요."
      );
      return;
    }

    // 이미 쓰여 있던 글자는 비웁니다 — 말한 내용이 입력창을 새로 채우는 게 이
    // 버튼의 동작이라, 남겨두면 무엇이 반영될지 헷갈립니다.
    onStart?.();

    try {
      ExpoSpeechRecognitionModule.start({
        lang: "ko-KR",
        interimResults: true,
        continuous: false,
      });
    } catch (err) {
      onListeningChange(false);
      Alert.alert("음성 입력을 시작하지 못했어요", errorMessage(err));
    }
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
      {isListening ? (
        <StopCircleIcon size={26} color={colors.danger} weight="bold" />
      ) : (
        <MicrophoneIcon size={26} color={colors.primary} weight="bold" />
      )}
      <Text style={styles.micLabel}>
        {isListening ? "듣는 중... 눌러서 중지" : "눌러서 음성으로 말하기"}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  micButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.xs + 2,
  },
  micButtonActive: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  micLabel: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.primary },
  });
}
