import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { CameraIcon, XIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
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
import { VisitedPlace } from "../types";

const MAX_POST_PHOTOS = 5;

// uri는 미리보기용, payload는 서버로 보낼 base64 값입니다. ImagePicker에
// base64:true를 줘서 바로 받아오므로, expo-file-system(readAsStringAsync)에
// 의존하지 않습니다 — 그 API는 웹에서 지원되지 않아 "not available on web"
// 에러가 났었습니다.
interface PhotoDraft {
  uri: string;
  payload: string;
}

/**
 * '게시물' 작성 화면. 장소는 자유 검색이 아니라 '내 여행' 탭에서 방문
 * 완료로 표시해둔 장소 중에서만 고를 수 있습니다(실제로 가본 곳에 대한
 * 게시물이라는 취지에 맞춰서). 본문 + 사진 첨부(최대 5장)로 구성됩니다.
 */
export default function PostCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [visitedPlaces, setVisitedPlaces] = useState<VisitedPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [selectedPlace, setSelectedPlace] = useState<VisitedPlace | null>(null);
  const [placeModalVisible, setPlaceModalVisible] = useState(false);

  const [bodyInput, setBodyInput] = useState("");
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 게시물 피드 카드의 사진과 같은 크기(카드 폭 기준 정사각형)로 미리보기를
  // 보여주기 위해, 이 화면에서도 같은 방식(onLayout으로 실제 폭 측정)을 씁니다.
  const [previewWidth, setPreviewWidth] = useState(0);
  const handlePreviewAreaLayout = (e: LayoutChangeEvent) => setPreviewWidth(e.nativeEvent.layout.width);

  useEffect(() => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "게시물을 남기려면 먼저 로그인해주세요.", [
        { text: "확인", onPress: () => router.back() },
      ]);
      return;
    }
    api
      .getMyVisitedPlaces()
      .then(setVisitedPlaces)
      .catch(() => setVisitedPlaces([]))
      .finally(() => setLoadingPlaces(false));
  }, [session, router]);

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

    setPickingPhoto(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: MAX_POST_PHOTOS - photoDrafts.length,
        quality: 0.6,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const picked = result.assets.slice(0, MAX_POST_PHOTOS - photoDrafts.length);
      const encoded = picked
        .filter((asset) => !!asset.base64)
        .map((asset) => ({ uri: asset.uri, payload: asset.base64 as string }));
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
      Alert.alert("여행지를 선택해주세요", "방문 완료로 표시한 장소 중에서 골라주세요.");
      return;
    }
    if (!bodyInput.trim()) {
      Alert.alert("내용을 입력해주세요");
      return;
    }
    setSubmitting(true);
    try {
      await api.createPost(
        selectedPlace.content_id,
        selectedPlace.place_name,
        bodyInput.trim(),
        photoDrafts.map((p) => p.payload)
      );
      router.replace("/posts");
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
          <Text style={styles.selectedPlaceChipText}>{selectedPlace.place_name}</Text>
          <TouchableOpacity onPress={() => setPlaceModalVisible(true)} hitSlop={8}>
            <Text style={styles.changePlaceText}>변경</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.selectPlaceButton} onPress={() => setPlaceModalVisible(true)}>
          <Text style={styles.selectPlaceButtonText}>여행지 선택하기</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.fieldLabel}>사진 (선택)</Text>
      <View onLayout={handlePreviewAreaLayout}>
        {previewWidth > 0 &&
          (photoDrafts.length === 0 ? (
            <TouchableOpacity
              style={[styles.addPhotoTile, { width: previewWidth, height: previewWidth }]}
              onPress={handlePickPhotos}
              disabled={pickingPhoto}
            >
              {pickingPhoto ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <CameraIcon size={28} color={colors.textTertiary} weight="bold" />
                  <Text style={styles.addPhotoTileText}>사진 추가</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {photoDrafts.map((p) => (
                <View key={p.uri} style={[styles.photoPreviewWrap, { width: previewWidth, height: previewWidth }]}>
                  <Image
                    source={{ uri: p.uri }}
                    style={{ width: previewWidth, height: previewWidth, backgroundColor: colors.background }}
                  />
                  <TouchableOpacity
                    style={styles.photoRemoveButtonLarge}
                    onPress={() => handleRemovePhoto(p.uri)}
                    hitSlop={8}
                  >
                    <XIcon size={14} color="#FFFFFF" weight="bold" />
                  </TouchableOpacity>
                </View>
              ))}
              {photoDrafts.length < MAX_POST_PHOTOS && (
                <TouchableOpacity
                  style={[styles.addPhotoTile, { width: previewWidth, height: previewWidth }]}
                  onPress={handlePickPhotos}
                  disabled={pickingPhoto}
                >
                  {pickingPhoto ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <>
                      <CameraIcon size={24} color={colors.textTertiary} weight="bold" />
                      <Text style={styles.addPhotoTileText}>
                        사진 추가 ({photoDrafts.length}/{MAX_POST_PHOTOS})
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          ))}
      </View>

      <Text style={styles.fieldLabel}>어떤 이야기를 남기고 싶나요?</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="이 여행지에서의 경험을 자유롭게 남겨보세요."
        placeholderTextColor={colors.textTertiary}
        value={bodyInput}
        onChangeText={setBodyInput}
        multiline
      />

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.submitText}>등록하기</Text>}
      </TouchableOpacity>

      <Modal
        visible={placeModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPlaceModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>여행지 선택</Text>
              <TouchableOpacity onPress={() => setPlaceModalVisible(false)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {loadingPlaces ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 6 }} />
              ) : visitedPlaces.length === 0 ? (
                <Text style={styles.emptyPlacesText}>
                  방문 완료로 표시한 여행지가 없어요. '내 여행' 탭에서 먼저 방문 완료로 표시해주세요.
                </Text>
              ) : (
                visitedPlaces.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.placeRow}
                    onPress={() => {
                      setSelectedPlace(p);
                      setPlaceModalVisible(false);
                    }}
                  >
                    <Text style={styles.placeRowName} numberOfLines={1}>
                      {p.place_name}
                    </Text>
                    <Text style={styles.placeRowDate}>{p.visited_at?.slice(0, 10)} 방문</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    changePlaceText: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.primary },
    selectPlaceButton: {
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
    },
    selectPlaceButtonText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
    emptyPlacesText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, lineHeight: 19, padding: spacing.sm },
    placeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: spacing.sm + 4,
      paddingHorizontal: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    placeRowName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text, flexShrink: 1, marginRight: spacing.sm },
    placeRowDate: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary },

    modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
    modalSheet: {
      width: "100%",
      maxWidth: 640,
      backgroundColor: colors.surfaceAlt,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xl - 4,
      maxHeight: "70%",
    },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
    modalTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
    modalClose: { fontSize: 14, color: colors.primary, fontFamily: fontFamily.semiBold },

    photoPreviewWrap: { position: "relative", borderRadius: radius.md, overflow: "hidden" },
    photoRemoveButtonLarge: {
      position: "absolute",
      top: spacing.sm,
      right: spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
    addPhotoTile: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: "dashed",
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    addPhotoTileText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: spacing.xs },

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
