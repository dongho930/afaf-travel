import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
 *
 * 로그인 상태에서는 프로필 조회 + (사진이 있다면) 실제 사진 다운로드가 둘 다
 * 끝나기 전까지 아무것도 보여주지 않다가(물음표가 잠깐 나타났다 사진으로
 * 바뀌는 깜빡임을 없애기 위함), 준비되면 opacity를 0→1로 부드럽게 올립니다.
 */
export function ProfileButton() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const hasLoadedRef = useRef(false);

  // 이미 한 번 불러온 적이 있으면(다른 탭 갔다가 이 탭으로 돌아온 경우) 화면을
  // 비웠다가 다시 불러오지 않고, 기존 프로필을 계속 보여준 채 조용히 최신
  // 정보로만 갱신합니다. 그래야 탭을 오갈 때마다 버튼이 잠깐씩 안 보이는
  // 현상이 생기지 않습니다.
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setProfile(null);
        hasLoadedRef.current = false;
        return;
      }
      const isFirstLoad = !hasLoadedRef.current;
      if (isFirstLoad) {
        setProfileLoaded(false);
        setImageLoaded(false);
        setAvatarFailed(false);
        opacity.setValue(0);
      }
      api
        .getMyProfile()
        .then((p) => {
          setProfile(p);
          hasLoadedRef.current = true;
        })
        .catch(() => {
          if (isFirstLoad) setProfile(null);
        })
        .finally(() => {
          if (isFirstLoad) setProfileLoaded(true);
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session])
  );

  // 백그라운드 갱신으로 사진 주소가 바뀌면(예: 프로필 화면에서 새 사진 등록)
  // 이전 사진의 실패 상태가 새 사진에 잘못 이어지지 않도록 초기화합니다.
  useEffect(() => {
    setAvatarFailed(false);
    setImageLoaded(false);
  }, [profile?.avatar_url]);

  // 프로필에 사진이 없으면(이니셜/물음표만 보여줄 것이라) 기다릴 이미지가
  // 없으므로, 프로필 조회가 끝나는 즉시 부드럽게 나타나게 합니다.
  useEffect(() => {
    if (session && profileLoaded && !profile?.avatar_url) {
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [session, profileLoaded, profile?.avatar_url, opacity]);

  // 프로필 사진이 있는 경우엔, 실제 이미지 다운로드(onLoad/onError)가 끝난
  // 뒤에야 부드럽게 나타나게 합니다.
  useEffect(() => {
    if (imageLoaded) {
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [imageLoaded, opacity]);

  if (!session) {
    return (
      <TouchableOpacity onPress={() => router.push("/login")} accessibilityRole="button" accessibilityLabel="프로필">
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarPlaceholderText}>?</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={() => router.push("/profile")} accessibilityRole="button" accessibilityLabel="프로필">
      <Animated.View style={{ opacity }}>
        {profile?.avatar_url && !avatarFailed ? (
          <Image
            source={{ uri: profile.avatar_url }}
            style={styles.avatar}
            cachePolicy="memory-disk"
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              setAvatarFailed(true);
              setImageLoaded(true);
            }}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarPlaceholderText}>{profile?.username?.[0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
      </Animated.View>
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
