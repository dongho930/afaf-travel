import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { CameraIcon, XIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { AttractionSearchResult } from "../types";

const MAX_POST_PHOTOS = 5;

// attraction-detail.tsx의 리뷰 사진 선택과 동일한 구조: uri는 미리보기용,
// payload는 서버로 보낼 base64 값입니다.
interface PhotoDraft {
  uri: string;
  payload: string;
}

/**
 * '여행기록' 작성 화면. 장소 검색(접근성 제보 작성과 같은 디바운스 검색-선택
 * 패턴) + 본문 + 사진 첨부(리뷰 사진 첨부와 같은 방식)로 구성됩니다.
 */
export default function PostCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<AttractionSearchResult[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<AttractionSearchResult | null>(null);

  const [bodyInput, setBodyInput] = useState("");
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "여행기록을 남기려면 먼저 로그인해주세요.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    }
  }, [session, router]);

  // 여행지 이름 검색은 디바운스(입력 멈추고 400ms 뒤에만 호출)해서, 접근성
  // 제보 작성 화면과 동일하게 일일 트래픽 한도를 아껴 씁니다.
  useEffect(() => {
    if (!placeQuery.trim() || placeQuery.trim().length < 2) {
      setPlaceSearchResults([]);
      return;
    }
    setSearchingPlace(true);
    const timer = setTimeout(() => {
      api
        .searchAttractionsByName(placeQuery.trim())
        .then(setPlaceSearchResults)
        .catch(() => setPlaceSearchResults([]))
        .finally(() => setSearchingPlace(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [placeQuery]);

  const handlePickPhotos = async () => {
    if (photoDrafts.length >= MAX_POST_PHOTOS) {
      Alert.alert(`사진은 최대 ${MAX_POST_PHOTOS}장까지 첨부할 수 있어요.`);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("권한이 필요해요", "사진 접근 권한을 허용해주세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_POST_PHOTOS - photoDrafts.length,
      quality: 0.6,
    });
    if (result.canceled || !result.assets?.length) return;

    setPickingPhoto(true);
    try {
      const picked = result.assets.slice(0, MAX_POST_PHOTOS - photoDrafts.length);
      const encoded = await Promise.all(
        picked.map(async (asset) => {
          const base64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { uri: asset.uri, payload: base64 };
        })
      );
      setPhotoDrafts((prev) => [...prev, ...encoded].slice(0, MAX_POST_PHOTOS));
    } catch (err) {
      Alert.alert("사진을 불러오지 못했어요", String(err));
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleRemovePhoto = (uri: string) => {
    setPhotoDrafts((prev) => prev.filter((p) => p.uri !== uri));
  };

  const handleSubmit = async () => {
    if (!selectedPlace) {
      Alert.alert("여행지를 선택해주세요", "이름을 검색해서 목록에서 골라주세요.");
      return;
    }
    if (!bodyInput.trim()) {
      Alert.alert("내용을 입력해주세요");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createPost(
        selectedPlace.content_id,
        selectedPlace.name,
        bodyInput.trim(),
        photoDrafts.map((p) => p.payload)
      );
      router.replace({ pathname: "/post-detail", params: { postId: created.id } });
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.fieldLabel}>어떤 여행지인가요?</Text>
      {selectedPlace ? (
        <View style={styles.selectedPlaceChip}>
          <Text style={styles.selectedPlaceChipText}>{selectedPlace.name}</Text>
          <TouchableOpacity onPress={() => setSelectedPlace(null)} hitSlop={8}>
            <XIcon size={13} color={colors.primary} weight="bold" />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="여행지 이름을 검색해주세요"
            placeholderTextColor={colors.textTertiary}
            value={placeQuery}
            onChangeText={setPlaceQuery}
          />
          {searchingPlace && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 6 }} />}
          {placeSearchResults.map((p) => (
            <TouchableOpacity
              key={p.content_id}
              style={styles.searchResultRow}
              onPress={() => {
                setSelectedPlace(p);
                setPlaceSearchResults([]);
                setPlaceQuery("");
              }}
            >
              <Text style={styles.searchResultName}>{p.name}</Text>
              <Text style={styles.searchResultAddress} numberOfLines={1}>
                {p.address}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <Text style={styles.fieldLabel}>어떤 이야기를 남기고 싶나요?</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="이 여행지에서의 경험을 자유롭게 남겨보세요."
        placeholderTextColor={colors.textTertiary}
        value={bodyInput}
        onChangeText={setBodyInput}
        multiline
      />

      <Text style={styles.fieldLabel}>사진 (선택)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoPickerRow}>
        {photoDrafts.map((p) => (
          <View key={p.uri} style={styles.photoThumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.photoThumb} />
            <TouchableOpacity style={styles.photoRemoveButton} onPress={() => handleRemovePhoto(p.uri)} hitSlop={6}>
              <XIcon size={11} color={colors.surface} weight="bold" />
            </TouchableOpacity>
          </View>
        ))}
        {photoDrafts.length < MAX_POST_PHOTOS && (
          <TouchableOpacity style={styles.photoAddButton} onPress={handlePickPhotos} disabled={pickingPhoto}>
            {pickingPhoto ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <CameraIcon size={16} color={colors.textTertiary} weight="bold" />
                <Text style={styles.photoAddButtonText}>사진 추가</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.submitText}>등록하기</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { padding: spacing.xl - 4, paddingBottom: spacing.xxl },
    fieldLabel: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    input: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.md,
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: colors.text,
    },
    textArea: { minHeight: 120, textAlignVertical: "top" },

    selectedPlaceChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      gap: spacing.sm,
    },
    selectedPlaceChipText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.primary },
    searchResultRow: {
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    searchResultName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
    searchResultAddress: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },

    photoPickerRow: { marginBottom: spacing.sm + 2 },
    photoThumbWrap: { marginRight: spacing.sm, position: "relative" },
    photoThumb: { width: 64, height: 64, borderRadius: spacing.sm, backgroundColor: colors.background },
    photoRemoveButton: {
      position: "absolute",
      top: -6,
      right: -6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.text,
      alignItems: "center",
      justifyContent: "center",
    },
    photoAddButton: {
      width: 64,
      height: 64,
      borderRadius: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: "dashed",
      alignItems: "center",
      justifyContent: "center",
    },
    photoAddButtonText: { fontSize: 10, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },

    submitButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 3,
      alignItems: "center",
      marginTop: spacing.xl - 4,
    },
    submitButtonDisabled: { opacity: 0.6 },
    submitText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 16 },
  });
}
