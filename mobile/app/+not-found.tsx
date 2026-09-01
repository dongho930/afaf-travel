import { router, usePathname } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

/**
 * 정상적인 404(진짜 없는 경로로 들어온 경우)는 그대로 보여주지만, 웹에서 새로고침
 * 직후 루트("/")로 들어왔는데도 초기 라우팅이 꼬여서 이 화면으로 떨어지는 경우가
 * 있어서, 그 경우에만 자동으로 홈으로 한 번 더 이동시킵니다. ("/"가 아니라
 * "/(tabs)"로 이동해야 실제로 통과됩니다 — Sitemap에서 수동으로 확인된 방식과
 * 동일합니다.) 한 번 시도해서도 안 풀리면 무한 루프에 빠지지 않도록 딱 한 번만
 * 시도합니다.
 */
export default function NotFound() {
  const pathname = usePathname();
  const [redirecting, setRedirecting] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    const isWeb = Platform.OS === "web";
    const landedOnRoot =
      isWeb && typeof window !== "undefined" && window.location.pathname === "/";
    if (landedOnRoot) {
      triedRef.current = true;
      setRedirecting(true);
      const timer = setTimeout(() => {
        router.replace("/(tabs)");
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  if (redirecting) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>페이지를 찾을 수 없어요</Text>
      <Text style={styles.body}>주소를 다시 확인해주세요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 14, color: "#666" },
});
