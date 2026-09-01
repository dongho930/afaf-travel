import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomTabBar } from "../components/BottomTabBar";
import { WebFrame } from "../components/WebFrame";
import { AuthProvider } from "../services/AuthContext";
import { CourseProvider } from "../services/CourseContext";
import { ThemeProvider, useTheme } from "../services/ThemeContext";
// import { useEmailVerificationDeepLink } from "../services/useEmailVerificationDeepLink"; // 이메일 인증 기능을 다시 켤 때 주석 해제

/**
 * (tabs) 그룹의 화면들과 그 밖의 화면들(장소선택/결과/지도/로그인/회원가입/
 * 프로필/설정/여행상세/관광지상세)을 전부 하나의 Stack에 담아두고, 그 아래에
 * BottomTabBar를 항상 렌더링합니다. Stack을 flex:1로 감싸서 남는 공간을 다
 * 차지하게 하고, 그 아래에 고정 높이의 탭바가 나란히(overlap 없이) 붙는
 * 구조라, 어떤 화면으로 이동해도 하단바가 사라지지 않습니다.
 *
 * GestureHandlerRootView로 전체를 감싸야 react-native-gesture-handler
 * (드래그 정렬에 쓰는 react-native-draggable-flatlist가 내부적으로 사용)가
 * 정상 동작합니다 — 최상위에 한 번만 감싸면 됩니다.
 *
 * WebFrame은 PC 브라우저의 넓은 화면에서만 콘텐츠를 모바일 폭으로 가운데
 * 정렬합니다 (인스타그램 웹과 같은 방식). 앱(iOS/Android)이나 좁은 화면의
 * 모바일 브라우저에서는 아무 영향이 없습니다.
 */
function ThemedApp() {
  const { theme, colors } = useTheme();
  // 이메일 인증 기능은 꺼둔 상태라 딥링크 처리 훅도 잠시 꺼둡니다.
  // 나중에 이메일 인증을 다시 켜면 아래 줄의 주석을 해제하면 됩니다.
  // useEmailVerificationDeepLink();
  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <WebFrame colors={colors}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTitleStyle: { fontSize: 17, fontWeight: "600", color: colors.text },
                headerTintColor: colors.text,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="select" options={{ title: "장소 선택하기" }} />
              <Stack.Screen name="results" options={{ title: "추천 코스" }} />
              <Stack.Screen name="map" options={{ title: "지도로 보기" }} />
              <Stack.Screen name="login" options={{ title: "로그인" }} />
              <Stack.Screen name="signup" options={{ title: "회원가입" }} />
              <Stack.Screen name="verify-email" options={{ title: "이메일 인증" }} />
              <Stack.Screen name="verify-email-complete" options={{ title: "이메일 인증" }} />
              <Stack.Screen name="trip-detail" options={{ title: "여행 상세" }} />
              <Stack.Screen name="profile" options={{ title: "프로필" }} />
              <Stack.Screen name="settings" options={{ title: "설정" }} />
              <Stack.Screen name="attraction-detail" options={{ title: "관광지 상세" }} />
            </Stack>
          </View>
          <BottomTabBar />
        </View>
      </WebFrame>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <CourseProvider>
              <ThemedApp />
            </CourseProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
