import { useRouter } from "expo-router";
import { CaretLeftIcon } from "phosphor-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { fontFamily } from "../constants/fonts";
import { spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * 장소 선택하기/추천 코스 화면에서 쓰는 상단 바입니다.
 *
 * 이 두 화면은 네비게이션이 그려주는 고정 헤더(app/_layout.tsx의 Stack) 대신
 * 이 컴포넌트를 목록의 맨 위 콘텐츠로 넣습니다. 그러면 홈 화면처럼 스크롤을
 * 내릴 때 상단 바가 콘텐츠와 함께 위로 밀려 사라지고, 다시 맨 위로 올리면
 * 자연스럽게 나타납니다.
 *
 * 스크롤을 내린 상태에서는 뒤로가기 버튼이 화면 밖으로 나가므로, 앱에서는
 * 화면을 옆으로 미는 제스처가, 웹에서는 브라우저 뒤로가기가 그 역할을 합니다.
 */
export function ScreenHeader({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { colors } = useTheme();

  const goBack = () => {
    // 웹에서 이 화면 주소로 바로 들어온 경우에는 돌아갈 기록이 없어서,
    // 앱을 벗어나지 않도록 홈으로 보냅니다.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={goBack}
        style={styles.backButton}
        // 아이콘만 있는 작은 버튼이라, 손가락으로 누를 수 있는 범위를 넓혀둡니다.
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="뒤로 가기"
      >
        <CaretLeftIcon size={22} color={colors.text} weight="bold" />
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 40 },
  // 아이콘 자체의 좌우 여백을 상쇄해서, 화살표가 화면 왼쪽 여백선에 맞게 놓이도록 합니다.
  backButton: { marginLeft: -4, padding: 4 },
  title: { fontSize: 17, fontFamily: fontFamily.semiBold, flexShrink: 1 },
});
