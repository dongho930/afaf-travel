import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useRouter } from "expo-router";
import {
  CameraIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  GearIcon,
  LockIcon,
  SignOutIcon,
  UserIcon,
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Alert } from "../services/crossPlatformAlert";
import { ActionButton } from "../components/ActionButton";
import { SettingsRow } from "../components/SettingsRow";
import { api, errorMessage } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useProfile } from "../services/ProfileContext";
import { useTheme } from "../services/ThemeContext";
import { fontFamily } from "../constants/fonts";
import { THEME_LABELS, ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";

/**
 * 첫 화면에서 프로필 사진(아바타)을 누르면 들어오는 화면입니다.
 * 아이디/프로필 사진을 바꿀 수 있고, 비밀번호도 여기서 변경합니다.
 * '설정' 항목을 누르면 테마(라이트/다크) 설정 화면으로, '개인정보처리방침'을
 * 누르면 방침 화면으로 이동합니다.
 *
 * 프로필 사진은 base64로 인코딩해서 백엔드로 보내고, 백엔드가 서비스 키(관리자
 * 권한)로 Supabase Storage에 대신 업로드합니다 — 클라이언트가 직접 Storage에
 * 올리는 방식은 RLS 정책 문제로 자주 막혀서, 이미 검증된 백엔드 경로를 씁니다.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { session, loading: authLoading, signOut, changePassword } = useAuth();
  // 프로필은 앱 전체가 공유합니다(ProfileContext) — 이 화면에서 바꾼 내용이
  // 각 탭 상단의 프로필 버튼에도 곧바로 반영되고, 화면에 들어올 때마다 다시
  // 조회하느라 기다릴 필요도 없습니다.
  const { profile, loaded, refresh, applyLocalChange } = useProfile();
  const { colors, theme } = useTheme();
  const styles = makeStyles(colors);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    // 로그인하지 않은 경우의 이동은 아래 <Redirect>가 맡습니다.
    if (!session) return;
    // 이미 갖고 있는 값으로 화면을 먼저 그리고, 최신 값은 뒤에서 조용히 받아옵니다.
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 아이디 입력칸의 초기값은 실제 프로필 값을 따라갑니다 (편집 중일 때는
  // 사용자가 입력하던 내용을 덮어쓰지 않도록 건드리지 않습니다).
  useEffect(() => {
    if (!usernameEditing) setUsernameDraft(profile?.username ?? "");
  }, [profile?.username, usernameEditing]);

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("권한이 필요해요", "사진 접근 권한을 허용해주세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileExt = asset.uri.split(".").pop()?.toLowerCase() || "jpg";

      const { avatar_url: avatarUrl } = await api.uploadAvatar(base64, fileExt);
      applyLocalChange({ avatar_url: avatarUrl });
    } catch (err) {
      Alert.alert("업로드 실패", errorMessage(err));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveUsername = async () => {
    if (!usernameDraft.trim()) {
      Alert.alert("아이디를 입력해주세요");
      return;
    }
    setIsSavingUsername(true);
    try {
      await api.updateProfile({ username: usernameDraft.trim() });
      applyLocalChange({ username: usernameDraft.trim() });
      setUsernameEditing(false);
    } catch (err) {
      Alert.alert("변경 실패", errorMessage(err));
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert("비밀번호가 너무 짧아요", "6자 이상으로 입력해주세요.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      Alert.alert("비밀번호가 일치하지 않아요");
      return;
    }
    setIsSavingPassword(true);
    try {
      const { error } = await changePassword(newPassword);
      if (error) {
        Alert.alert("변경 실패", error);
        return;
      }
      setPasswordModalVisible(false);
      setNewPassword("");
      setNewPasswordConfirm("");
      Alert.alert("변경 완료", "비밀번호가 변경됐어요.");
    } finally {
      setIsSavingPassword(false);
    }
  };

  // 웹에서 /profile을 새로고침하면 저장된 로그인 세션을 복원하는 동안 session이
  // 잠깐 비어 있습니다. 그때 바로 로그인 화면으로 보내면 로그인한 사람도 튕겨 나가고,
  // 화면 틀이 준비되기 전에 이동을 시도해 오류가 나므로 복원이 끝날 때까지 기다립니다.
  // <Redirect>는 라우터가 준비된 뒤에 이동하므로 useEffect 안의 router.replace보다 안전합니다.
  if (!authLoading && !session) return <Redirect href="/login" />;

  // 아직 한 번도 못 불러온 상태(앱을 켜자마자 바로 이 화면에 들어온 경우)에만
  // 로딩을 보여줍니다. 이미 값이 있으면 그걸 그대로 그리고 갱신은 뒤에서 합니다.
  if (authLoading || !loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.avatarSection}>
        <TouchableOpacity onPress={handlePickAvatar} disabled={uploadingAvatar}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>{profile?.username?.[0]?.toUpperCase() ?? "?"}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <CameraIcon size={13} color={colors.onPrimary} weight="bold" />
            )}
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>사진을 눌러 프로필 사진 변경</Text>
      </View>

      <View style={styles.group}>
        {usernameEditing ? (
          <View style={styles.editCell}>
            <Text style={styles.editLabel}>아이디</Text>
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={usernameDraft}
                onChangeText={setUsernameDraft}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.textTertiary}
              />
              <ActionButton label="저장" size="sm" onPress={handleSaveUsername} loading={isSavingUsername} />
              <ActionButton
                label="취소"
                size="sm"
                variant="secondary"
                onPress={() => {
                  setUsernameDraft(profile?.username ?? "");
                  setUsernameEditing(false);
                }}
              />
            </View>
          </View>
        ) : (
          <SettingsRow
            icon={UserIcon}
            label="아이디"
            value={profile?.username ?? "-"}
            onPress={() => setUsernameEditing(true)}
            accessibilityHint="아이디를 변경합니다"
          />
        )}
        {/* 이메일은 바꿀 수 없는 값이라 onPress를 주지 않습니다(셰브론도 안 그려집니다). */}
        <SettingsRow
          icon={EnvelopeSimpleIcon}
          label="이메일"
          value={profile?.email ?? session?.user.email ?? "-"}
          divider
        />
        <SettingsRow
          icon={LockIcon}
          label="비밀번호"
          value="••••••"
          onPress={() => setPasswordModalVisible(true)}
          divider
          accessibilityHint="비밀번호를 변경합니다"
        />
      </View>

      <View style={styles.group}>
        {/* 지금 켜져 있는 테마를 값으로 보여줍니다 — 설정 화면에 들어가 보지 않아도
            밝은/어두운 중 무엇인지 알 수 있습니다. */}
        <SettingsRow
          icon={GearIcon}
          label="설정"
          value={THEME_LABELS[theme]}
          onPress={() => router.push("/settings")}
          accessibilityHint="화면 테마 등을 설정합니다"
        />
        <SettingsRow
          icon={FileTextIcon}
          label="개인정보처리방침"
          onPress={() => router.push("/privacy")}
          divider
          role="link"
        />
      </View>

      <Pressable
        style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
        onPress={signOut}
        accessibilityRole="button"
        accessibilityLabel="로그아웃"
      >
        <SignOutIcon size={18} color={colors.danger} weight="bold" />
        <Text style={styles.signOutButtonText}>로그아웃</Text>
      </Pressable>

      {passwordModalVisible && (
        <View style={styles.passwordModal}>
          <View style={styles.passwordModalCard}>
            <Text style={styles.modalTitle}>비밀번호 변경</Text>
            <TextInput
              style={styles.input}
              placeholder="새 비밀번호 (6자 이상)"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              style={[styles.input, { marginTop: spacing.sm + 2 }]}
              placeholder="새 비밀번호 확인"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={newPasswordConfirm}
              onChangeText={setNewPasswordConfirm}
            />
            <View style={[styles.editRow, styles.modalButtonRow]}>
              <ActionButton
                label="취소"
                variant="secondary"
                style={styles.modalButton}
                onPress={() => {
                  setPasswordModalVisible(false);
                  setNewPassword("");
                  setNewPasswordConfirm("");
                }}
              />
              <ActionButton
                label="변경하기"
                style={styles.modalButton}
                onPress={handleChangePassword}
                loading={isSavingPassword}
              />
            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
    container: { flex: 1, padding: spacing.xl, backgroundColor: colors.background },
    avatarSection: { alignItems: "center", marginBottom: spacing.xl + 4 },
    avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primaryLight },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    avatarPlaceholderText: { fontSize: 32, fontFamily: fontFamily.bold, color: colors.primary },
    avatarEditBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      backgroundColor: colors.primary,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    avatarHint: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: spacing.sm + 2 },

    // 설정 줄들을 묶는 카드입니다. overflow: hidden이 있어야 첫 줄/마지막 줄을
    // 눌렀을 때 생기는 배경색이 둥근 모서리 밖으로 삐져나오지 않습니다.
    group: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg - 2,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
      overflow: "hidden",
    },
    editCell: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
    editLabel: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.textTertiary },

    editRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.xs },
    input: {
      flex: 1,
      // 웹에서 <input>이 고유 최소 너비 아래로 안 줄어들어 옆 버튼(저장/취소)이
      // 밀려나는 것을 막습니다 (홈 화면 searchInput과 같은 이유).
      minWidth: 0,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: colors.text,
    },
    modalButtonRow: { marginTop: spacing.lg },
    modalButton: { flex: 1 },

    signOutButton: {
      marginTop: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.dangerLight,
    },
    signOutButtonPressed: { opacity: 0.8 },
    signOutButtonText: { color: colors.danger, fontFamily: fontFamily.bold, fontSize: 15 },

    passwordModal: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    passwordModalCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      padding: spacing.lg + 4,
      width: "100%",
    },
    modalTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.md },
  });
}
