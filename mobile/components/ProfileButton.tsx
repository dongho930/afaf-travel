import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { UserProfile } from "../types";

/**
 * 프로필 아바타 버튼 — 로그인했으면 프로필 사진(없으면 이니셜), 아니면 물음표를
 * 보여주고 누르면 프로필/로그인 화면으로 이동합니다. 홈 화면 상단에 있던
 * 버튼을 모든 탭 상단에서 재사용하기 위해 분리했습니다. 프로필 사진은 다른
 * 화면(프로필 화면)에서 바뀔 수 있어서, 이 화면에 다시 들어올 때마다 최신
 * 상태로 불러옵니다.
 */
export function ProfileButton() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setProfile(null);
        return;
      }
      api
        .getMyProfile()
        .then(setProfile)
        .catch(() => setProfile(null));
    }, [session])
  );

  return (
    <TouchableOpacity
      onPress={() => router.push(session ? "/profile" : "/login")}
      accessibilityRole="button"
      accessibilityLabel="프로필"
    >
      {profile?.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarPlaceholderText}>{profile?.username?.[0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    avatar: { width: 34, height: 34, borderRadius: 17 },
    avatarPlaceholder: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
    avatarPlaceholderText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.primary },
  });
}
