import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { UserProfile } from "../types";
import { ThemeColors } from "../constants/theme";

/**
 * 첫 화면에서 프로필 사진(아바타)을 누르면 들어오는 화면입니다.
 * 아이디/프로필 사진을 바꿀 수 있고, 비밀번호도 여기서 변경합니다.
 * '설정' 항목을 누르면 테마(라이트/다크) 설정 화면으로 이동합니다.
 *
 * 프로필 사진은 base64로 인코딩해서 백엔드로 보내고, 백엔드가 서비스 키(관리자
 * 권한)로 Supabase Storage에 대신 업로드합니다 — 클라이언트가 직접 Storage에
 * 올리는 방식은 RLS 정책 문제로 자주 막혀서, 이미 검증된 백엔드 경로를 씁니다.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { session, signOut, changePassword } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    loadProfile();
  }, [session]);

  const loadProfile = () => {
    setLoading(true);
    api
      .getMyProfile()
      .then((p) => {
        setProfile(p);
        setUsernameDraft(p?.username ?? "");
      })
      .catch(() => Alert.alert("불러오기 실패", "프로필 정보를 불러오지 못했어요."))
      .finally(() => setLoading(false));
  };

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
      setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
    } catch (err) {
      Alert.alert("업로드 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
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
      setProfile((prev) => (prev ? { ...prev, username: usernameDraft.trim() } : prev));
      setUsernameEditing(false);
    } catch (err) {
      Alert.alert("변경 실패", "이미 사용 중인 아이디이거나 오류가 발생했어요.\n" + String(err));
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
              <Text style={styles.avatarEditBadgeText}>📷</Text>
            )}
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>사진을 눌러 프로필 사진 변경</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>아이디</Text>
        {usernameEditing ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.input}
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={colors.textTertiary}
            />
            <TouchableOpacity
              style={[styles.smallButton, isSavingUsername && styles.smallButtonDisabled]}
              onPress={handleSaveUsername}
              disabled={isSavingUsername}
            >
              {isSavingUsername ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.smallButtonText}>저장</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.smallButtonOutline}
              onPress={() => {
                setUsernameDraft(profile?.username ?? "");
                setUsernameEditing(false);
              }}
            >
              <Text style={styles.smallButtonOutlineText}>취소</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.rowBetween}>
            <Text style={styles.valueText}>{profile?.username ?? "-"}</Text>
            <TouchableOpacity onPress={() => setUsernameEditing(true)}>
              <Text style={styles.linkText}>아이디 변경</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>이메일</Text>
        <Text style={styles.valueText}>{profile?.email ?? session?.user.email ?? "-"}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionLabel}>비밀번호</Text>
          <TouchableOpacity onPress={() => setPasswordModalVisible(true)}>
            <Text style={styles.linkText}>비밀번호 변경</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.section} onPress={() => router.push("/settings")}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionLabel}>설정</Text>
          <Text style={styles.linkText}>화면 테마 등 →</Text>
        </View>
      </TouchableOpacity>

      <Pressable style={styles.signOutButton} onPress={signOut}>
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
              style={[styles.input, { marginTop: 10 }]}
              placeholder="새 비밀번호 확인"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={newPasswordConfirm}
              onChangeText={setNewPasswordConfirm}
            />
            <View style={styles.editRow}>
              <TouchableOpacity
                style={[styles.smallButton, { flex: 1 }, isSavingPassword && styles.smallButtonDisabled]}
                onPress={handleChangePassword}
                disabled={isSavingPassword}
              >
                {isSavingPassword ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.smallButtonText}>변경하기</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallButtonOutline}
                onPress={() => {
                  setPasswordModalVisible(false);
                  setNewPassword("");
                  setNewPasswordConfirm("");
                }}
              >
                <Text style={styles.smallButtonOutlineText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
    container: { flex: 1, padding: 24, backgroundColor: colors.background },
    avatarSection: { alignItems: "center", marginBottom: 28 },
    avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primaryLight },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    avatarPlaceholderText: { fontSize: 32, fontWeight: "700", color: colors.primary },
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
    avatarEditBadgeText: { fontSize: 13 },
    avatarHint: { fontSize: 12, color: colors.textTertiary, marginTop: 10 },

    section: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 12,
    },
    sectionLabel: { fontSize: 12, color: colors.textTertiary, marginBottom: 6, fontWeight: "600" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    valueText: { fontSize: 16, fontWeight: "700", color: colors.text },
    linkText: { fontSize: 13, color: colors.primary, fontWeight: "700" },

    editRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
    },
    smallButton: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    smallButtonDisabled: { opacity: 0.6 },
    smallButtonText: { color: colors.onPrimary, fontWeight: "700", fontSize: 13 },
    smallButtonOutline: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    smallButtonOutlineText: { color: colors.textSecondary, fontWeight: "700", fontSize: 13 },

    signOutButton: { marginTop: 12, alignItems: "center", padding: 12 },
    signOutButtonText: { color: colors.danger, fontWeight: "700", fontSize: 14 },

    passwordModal: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    passwordModalCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      padding: 20,
      width: "100%",
    },
    modalTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 12 },
  });
}
