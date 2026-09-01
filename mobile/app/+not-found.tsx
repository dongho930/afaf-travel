import { Link, usePathname } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * 정상적인 404 화면입니다. 다만 웹에서 루트("/")로 들어왔는데 초기 라우팅이
 * 꼬여서 이 화면으로 떨어지는 문제를 조사 중이라, 진단을 위해 홈으로 가는
 * 링크를 크게 보여줍니다. (프로그래밍 방식 router.replace는 잘 안 먹혀서,
 * 실제 Link 클릭과 어떻게 다른지 비교해보는 중입니다.)
 */
export default function NotFound() {
  const pathname = usePathname();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>페이지를 찾을 수 없어요</Text>
      <Text style={styles.body}>현재 경로: {pathname}</Text>
      <Link href="/" style={styles.link}>
        홈으로 가기
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 14, color: "#666" },
  link: { fontSize: 16, color: "#2E7D5B", fontWeight: "700", marginTop: 8, padding: 12 },
});
