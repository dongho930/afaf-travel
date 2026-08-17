import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useCourseContext } from "../services/CourseContext";
import { storage } from "../services/storage";
import { UserType, USER_TYPE_LABELS } from "../types";

const OPTIONS: { type: UserType; emoji: string; desc: string }[] = [
  { type: "wheelchair", emoji: "♿", desc: "경사로·엘리베이터 등 이동 편의시설 우선" },
  { type: "stroller", emoji: "🧸", desc: "유모차로 이동 가능한 평탄한 동선 우선" },
  { type: "senior", emoji: "🧓", desc: "휴게 공간이 충분한 여유로운 코스" },
  { type: "pregnant", emoji: "🤰", desc: "무리 없는 동선과 휴식 공간 우선" },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { setUserType } = useCourseContext();

  useEffect(() => {
    // 저장된 이전 선택값이 있으면 자동으로 불러와 다음에 다시 고를 필요 없게 함
    storage.loadUserType().then((saved) => {
      if (saved) setUserType(saved);
    });
  }, []);

  const handleSelect = async (type: UserType) => {
    setUserType(type);
    await storage.saveUserType(type);
    AccessibilityInfo.announceForAccessibility?.(`${USER_TYPE_LABELS[type]} 선택됨`);
    router.push("/input");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>어떤 유형의 여행을 준비하시나요?</Text>
      <Text style={styles.subtitle}>선택한 유형에 맞춰 무장애 코스를 추천해드려요.</Text>

      <View style={styles.grid}>
        {OPTIONS.map((opt) => (
          <Pressable
            key={opt.type}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => handleSelect(opt.type)}
            accessibilityRole="button"
            accessibilityLabel={`${USER_TYPE_LABELS[opt.type]}, ${opt.desc}`}
          >
            <Text style={styles.emoji}>{opt.emoji}</Text>
            <Text style={styles.cardTitle}>{USER_TYPE_LABELS[opt.type]}</Text>
            <Text style={styles.cardDesc}>{opt.desc}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={styles.skipButton}
        onPress={() => handleSelect("general")}
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>일반 사용자로 계속하기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 32 },
  title: { fontSize: 22, fontWeight: "700", color: "#1A1A1A", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#5C5C5C", marginBottom: 24 },
  grid: { gap: 14 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    minHeight: 96,
  },
  cardPressed: { backgroundColor: "#EAF3EE", borderColor: "#2E7D5B" },
  emoji: { fontSize: 28, marginBottom: 6 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  cardDesc: { fontSize: 14, color: "#5C5C5C" },
  skipButton: { marginTop: 24, alignSelf: "center", padding: 12 },
  skipText: { fontSize: 15, color: "#2E7D5B", fontWeight: "600" },
});
