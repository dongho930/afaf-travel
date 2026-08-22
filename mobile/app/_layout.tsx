import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../services/AuthContext";
import { CourseProvider } from "../services/CourseContext";

/**
 * (tabs) 그룹이 홈/AI플래너/접근성/내여행 하단 탭바를 담당하고(app/(tabs)/_layout.tsx),
 * 그 안에서 눌렀을 때 위로 밀려 올라오는 화면들(장소선택/결과/지도/로그인/회원가입/
 * 프로필/여행상세)은 여기 일반 스택 화면으로 남겨둡니다.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <CourseProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#F4F7F5" },
            headerTitleStyle: { fontSize: 17, fontWeight: "600" },
            contentStyle: { backgroundColor: "#F4F7F5" },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="select" options={{ title: "장소 선택하기" }} />
          <Stack.Screen name="results" options={{ title: "추천 코스" }} />
          <Stack.Screen name="map" options={{ title: "지도로 보기" }} />
          <Stack.Screen name="login" options={{ title: "로그인" }} />
          <Stack.Screen name="signup" options={{ title: "회원가입" }} />
          <Stack.Screen name="trip-detail" options={{ title: "여행 상세" }} />
          <Stack.Screen name="profile" options={{ title: "프로필" }} />
        </Stack>
      </CourseProvider>
    </AuthProvider>
  );
}
