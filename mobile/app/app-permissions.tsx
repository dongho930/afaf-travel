import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppPermissionList } from "../components/AppPermissionNotice";
import { PERMISSION_NOTICE_TITLE } from "../constants/appPermissions";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * 설정 화면에서 들어오는 접근권한 안내입니다. 설치 후 처음 실행할 때 한 번 뜨는
 * 안내(components/AppPermissionNotice)와 같은 내용을, 나중에 다시 확인하고 싶을 때
 * 볼 수 있게 화면으로도 열어둡니다.
 */
export default function AppPermissionsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: spacing.xxl + insets.bottom }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {PERMISSION_NOTICE_TITLE}
      </Text>
      <AppPermissionList />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { padding: spacing.xl },
    title: { fontSize: 20, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.md },
  });
}
