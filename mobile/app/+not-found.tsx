import { router, usePathname } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

/**
 * 정상적인 404(진짜 없는 경로로 들어온 경우)는 그대로 보여주지만, 웹에서 새로고침
 * 직후 루트("/")로 들어왔는데도 초기 라우팅이 꼬여서 이 화면으로 떨어지는 경우가
 * 있어서, 그 경우에만 자동으로 홈으로 한 번 더 이동시킵니다. (앱 내부에서
 * 화면을 옮기는 것 자체는 정상 동작하는 게 확인됐어서, 같은 방식으로 코드가
 * 대신 한 번 눌러주는 셈입니다.)
 */
export default function NotFound() {
  const pathname = usePathname();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const isWeb = Platform.OS === "web";
    const landedOnRoot =
      isWeb && typeof window !== "undefined" && window.location.pathname === "/";
    if (landedOnRoot) {
      setRedirecting(true);
      // 다음 tick에 이동시켜서, 라우터 초기화가 끝난 뒤 이동하도록 합니다.
      const timer = setTimeout(() => {
        router.replace("/");
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
