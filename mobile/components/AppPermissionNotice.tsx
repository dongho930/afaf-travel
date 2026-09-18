import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  OPTIONAL_PERMISSIONS,
  PERMISSION_NOTICE_INTRO,
  PERMISSION_NOTICE_TITLE,
  PERMISSION_NOTICE_WITHDRAW,
  REQUIRED_PERMISSIONS,
} from "../constants/appPermissions";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/** 한 번 보고 나면 다시 띄우지 않기 위한 표시. 고지 내용이 바뀌면 v2로 올리세요. */
const SEEN_KEY = "app_permission_notice_seen_v1";

/**
 * 접근권한 목록 본문. 최초 실행 안내와 설정 화면이 같은 내용을 공유합니다 —
 * 두 곳에 따로 적어두면 권한이 바뀔 때 한쪽만 고쳐져 어긋납니다.
 */
export function AppPermissionList() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.body}>
      <Text style={styles.intro}>{PERMISSION_NOTICE_INTRO}</Text>

      <Text style={styles.groupTitle} accessibilityRole="header">
        필수 접근권한
      </Text>
      {REQUIRED_PERMISSIONS.length === 0 ? (
        <Text style={styles.none}>없음 — 반드시 허용해야 하는 권한은 없습니다.</Text>
      ) : (
        REQUIRED_PERMISSIONS.map((p) => (
          <View key={p.name} style={styles.item}>
            <Text style={styles.itemName}>{p.name}</Text>
            <Text style={styles.itemPurpose}>{p.purpose}</Text>
          </View>
        ))
      )}

      <Text style={[styles.groupTitle, styles.groupSpacing]} accessibilityRole="header">
        선택 접근권한
      </Text>
      {OPTIONAL_PERMISSIONS.map((p) => (
        <View key={p.name} style={styles.item}>
          <Text style={styles.itemName}>{p.name}</Text>
          <Text style={styles.itemPurpose}>{p.purpose}</Text>
        </View>
      ))}

      <Text style={styles.withdraw}>{PERMISSION_NOTICE_WITHDRAW}</Text>
    </View>
  );
}

/**
 * 설치 후 처음 실행할 때 한 번 보여주는 접근권한 안내입니다.
 *
 * 웹에는 앱 접근권한이라는 개념이 없어서 띄우지 않습니다. 저장에 실패하면(기기
 * 저장소 문제 등) 다음 실행 때 한 번 더 보이는데, 아예 안 보이는 것보다 낫습니다.
 */
export function AppPermissionNotice() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (!cancelled && !seen) setVisible(true);
      })
      .catch(() => {
        // 읽지 못했으면 보여주는 쪽을 택합니다 — 고지가 빠지는 것이 더 큰 문제입니다.
        if (!cancelled) setVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = () => {
    setVisible(false);
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {
      // 저장 실패는 넘어갑니다 — 다음 실행 때 한 번 더 보일 뿐입니다.
    });
  };

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { paddingBottom: spacing.xl + insets.bottom, paddingTop: spacing.xl + insets.top }]}>
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          {PERMISSION_NOTICE_TITLE}
        </Text>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          <AppPermissionList />
        </ScrollView>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="확인"
        >
          <Text style={styles.buttonText}>확인</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
    },
    card: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      padding: spacing.lg + 4,
      maxHeight: "100%",
    },
    scroll: { flexGrow: 0 },
    title: { fontSize: 18, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.md },

    body: { gap: spacing.sm },
    intro: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, lineHeight: 20 },
    groupTitle: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text, marginTop: spacing.md },
    groupSpacing: { marginTop: spacing.lg },
    none: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, lineHeight: 20 },
    item: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.xs,
    },
    itemName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
    itemPurpose: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, lineHeight: 19 },
    withdraw: {
      marginTop: spacing.md,
      fontSize: 12,
      fontFamily: fontFamily.regular,
      color: colors.textTertiary,
      lineHeight: 18,
    },

    button: {
      marginTop: spacing.lg,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonPressed: { opacity: 0.85 },
    buttonText: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.onPrimary },
  });
}
