import { useRouter } from "expo-router";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { useAuth } from "../services/AuthContext";
import { useProfile } from "../services/ProfileContext";
import { useTheme } from "../services/ThemeContext";

/**
 * 프로필 아바타 버튼 — 로그인했으면 프로필 사진(없으면 이니셜), 아니면 물음표를
 * 보여주고 누르면 프로필/로그인 화면으로 이동합니다. 홈 화면 상단에 있던
 * 버튼을 모든 탭 상단에서 재사용하기 위해 분리했습니다.
 *
 * 프로필 정보는 이 컴포넌트가 직접 불러오지 않고 ProfileContext(앱 전체에서
 * 한 번만 조회)에서 받아옵니다. 예전에는 화면마다 자기 몫의 조회를 다시 했기
 * 때문에, 아직 안 가본 탭에 처음 들어가면 그 조회가 끝날 때까지 버튼이 아무것도
 * 안 보였습니다("탭을 옮기면 아이콘이 사라진다"고 느껴지던 원인).
 *
 * 나타나는 방식은 이렇습니다.
 * - 앱을 켜고 프로필을 '처음' 불러오는 순간에만: 조회 + (사진이 있다면) 실제
 *   사진 다운로드가 끝날 때까지 기다렸다가 opacity 0→1로 부드럽게 나타납니다
 *   (물음표가 잠깐 보였다 사진으로 바뀌는 깜빡임을 없애기 위함).
 * - 그 뒤에 만들어지는 버튼들(다른 탭에 처음 들어갈 때 등): 이미 정보가 있으니
 *   기다릴 것 없이 처음부터 보이는 상태로 그려집니다.
 */
export function ProfileButton() {
  const router = useRouter();
  const { session } = useAuth();
  const { profile, loaded } = useProfile();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // 이 버튼이 만들어지는 시점에 이미 프로필을 받아둔 상태였다면 기다릴 이유가
  // 없으므로 곧바로 보이는 상태(1)에서 시작합니다.
  const opacity = useRef(new Animated.Value(loaded ? 1 : 0)).current;

  // 사진 주소가 바뀌면(예: 프로필 화면에서 새 사진 등록) 이전 사진의 로딩/실패
  // 상태가 새 사진에 잘못 이어지지 않도록 초기화합니다.
  useEffect(() => {
    setImageLoaded(false);
    setAvatarFailed(false);
  }, [profile?.avatar_url]);

  // 사진을 못 불러온 경우(avatarFailed)엔 사진이 없는 것으로 치고 이니셜을 씁니다.
  const avatarUrl = avatarFailed ? undefined : profile?.avatar_url;
  const hasPhoto = !!avatarUrl;
  // 보여줄 준비가 됐는지 — 프로필 조회가 끝났고, 사진이 있다면 그 사진까지
  // 다 받아온 상태. 위에서 opacity를 1로 시작한 경우엔 이 애니메이션이 다시
  // 1로 가는 것뿐이라 화면상 변화가 없습니다.
  const ready = loaded && (!hasPhoto || imageLoaded);
  useEffect(() => {
    if (session && ready) {
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [session, ready, opacity]);

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
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
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
