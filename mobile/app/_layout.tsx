import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CourseProvider } from "../services/CourseContext";

export default function RootLayout() {
  return (
    <CourseProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#F4F7F5" },
          headerTitleStyle: { fontSize: 17, fontWeight: "600" },
          contentStyle: { backgroundColor: "#F4F7F5" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "무장애 여행 플래너" }} />
        <Stack.Screen name="input" options={{ title: "여행 요청하기" }} />
        <Stack.Screen name="results" options={{ title: "추천 코스" }} />
        <Stack.Screen name="map" options={{ title: "지도로 보기" }} />
      </Stack>
    </CourseProvider>
  );
}
