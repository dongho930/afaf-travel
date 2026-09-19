import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { CameraIcon, XIcon } from "phosphor-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Alert } from "../services/crossPlatformAlert";
import { PhotoCarousel } from "../components/PhotoCarousel";
import { PhotoEditor } from "../components/PhotoEditor";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api, errorMessage } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { VisitedPlace } from "../types";

const MAX_POST_PHOTOS = 5;

// uri는 미리보기용(payload를 data URI로 감싼 값), payload는 서버로 보낼 base64
// 값입니다. 사진을 고르면 원본을 바로 쓰지 않고 PhotoEditor(크롭/필터/꾸미기)를
// 거쳐 이미 편집이 끝난 결과물만 여기 들어옵니다.
//
// id는 uri와 별개로 둡니다 — 같은 사진을 두 번 붙이면 편집 결과가 완전히 같아서
// uri(=base64)도 같아집니다. 예전에는 그 uri를 목록 key와 삭제 기준으로 써서,
// 한 장을 지우면 같은 사진이 전부 함께 사라졌습니다.
interface PhotoDraft {
  id: string;
  uri: string;
  payload: string;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface VisitedPlaceSection {
  /** 그룹 키 = 방문 날짜(YYYY-MM-DD). 날짜가 없는 항목은 빈 문자열로 모읍니다. */
  dateKey: string;
  title: string;
  data: VisitedPlace[];
}

/**
 * 방문 날짜(YYYY-MM-DD)를 '9월 14일 (월)' 형태로 바꿉니다. 오늘/어제는 날짜
 * 대신 그렇게 읽어주는 편이 훨씬 빨리 눈에 들어와서 그 말을 씁니다.
 * 날짜 문자열을 직접 쪼개서 씁니다 — new Date("2026-09-14")는 UTC 자정으로
 * 해석되어서, 한국 시간대에서는 하루 밀린 날짜가 나옵니다.
 */
function formatVisitedDateLabel(dateKey: string, today: string): string {
  if (!dateKey) return "날짜 미정";

  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;

  if (dateKey === today) return "오늘";
  if (dateKey === shiftDateKey(today, -1)) return "어제";

  // 날짜 숫자를 UTC 자정으로 넣었으니 요일도 UTC 기준으로 읽어야 짝이 맞습니다.
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  // 올해가 아니면 연도를 붙입니다 — 안 붙이면 작년 12월과 올해 12월이 같은
  // 헤더로 보입니다.
  const yearPrefix = dateKey.slice(0, 4) === today.slice(0, 4) ? "" : `${y}년 `;
  return `${yearPrefix}${m}월 ${d}일 (${weekday})`;
}

/** YYYY-MM-DD를 days만큼 옮긴 YYYY-MM-DD. 월/연 경계도 Date가 알아서 넘겨줍니다. */
function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * 방문한 여행지 목록을 방문 날짜별로 묶습니다. 서버가 이미 최신순으로
 * 내려주므로(list_visited_places) 등장 순서를 그대로 따라가면 날짜 그룹도
 * 최신 → 과거 순이 됩니다. 날짜가 비어 있는 항목은 맨 아래로 보냅니다.
 */
function groupVisitedPlacesByDate(places: VisitedPlace[], today: string): VisitedPlaceSection[] {
  const sections: VisitedPlaceSection[] = [];
  const byDateKey = new Map<string, VisitedPlaceSection>();
  const undated: VisitedPlace[] = [];

  for (const place of places) {
    const dateKey = place.visited_at?.slice(0, 10);
    if (!dateKey) {
      undated.push(place);
      continue;
    }
    let section = byDateKey.get(dateKey);
    if (!section) {
      section = { dateKey, title: formatVisitedDateLabel(dateKey, today), data: [] };
      byDateKey.set(dateKey, section);
      sections.push(section);
    }
    section.data.push(place);
  }

  if (undated.length > 0) {
    sections.push({ dateKey: "", title: "날짜 미정", data: undated });
  }
  return sections;
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
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const [visitedPlaces, setVisitedPlaces] = useState<VisitedPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [selectedPlace, setSelectedPlace] = useState<VisitedPlace | null>(null);
  const [placeModalVisible, setPlaceModalVisible] = useState(false);
  // 방문 날짜별로 묶어서 보여줍니다. 방문지가 쌓이면 평평한 목록에서는 같은
  // 여행에서 다녀온 곳들을 눈으로 다시 묶어야 해서, 날짜 헤더로 대신합니다.
  const visitedPlaceSections = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    return groupVisitedPlacesByDate(visitedPlaces, todayKey);
  }, [visitedPlaces]);

  const [bodyInput, setBodyInput] = useState("");
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 여러 장을 한 번에 고르면, 한 장씩 순서대로 PhotoEditor를 띄워 편집을
  // 마친 것부터 photoDrafts에 추가합니다. 큐의 첫 항목이 곧 '지금 편집 중인 사진'.
  // 항목마다 고유 key를 함께 들고 다닙니다 — 같은 사진을 두 장 고르면 uri가
  // 같아서, uri만 key로 쓰면 다음 사진 차례에 편집기가 새로 열리지 않고 앞
  // 사진의 편집 상태(크롭/필터/꾸미기)를 그대로 이어받았습니다.
  const [editQueue, setEditQueue] = useState<{ key: string; uri: string }[]>([]);
  const editing = editQueue[0] ?? null;
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
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) return;

      const picked = result.assets.slice(0, MAX_POST_PHOTOS - photoDrafts.length);
      // 바로 photoDrafts에 넣지 않고, 한 장씩 편집기를 거치도록 큐에 쌓아둡니다.
      setEditQueue((prev) => [
        ...prev,
        ...picked.map((a, i) => ({ key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`, uri: a.uri })),
      ]);
    } catch (err) {
      Alert.alert("사진을 불러오지 못했어요", errorMessage(err));
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleRemovePhoto = (id: string) => {
    setPhotoDrafts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleEditorConfirm = (base64: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPhotoDrafts((prev) =>
      [...prev, { id, uri: `data:image/jpeg;base64,${base64}`, payload: base64 }].slice(0, MAX_POST_PHOTOS)
    );
    setEditQueue((prev) => prev.slice(1));
  };

  const handleEditorCancel = () => {
    setEditQueue((prev) => prev.slice(1));
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
      const created = await api.createPost(
        selectedPlace.content_id,
        selectedPlace.place_name,
        bodyInput.trim(),
        photoDrafts.map((p) => p.payload)
      );
      // 사진 일부가 서버에 올라가지 못해도 글은 저장됩니다. 예전에는 그걸
      // 알리지 않아서, 사용자는 피드에서 사진이 사라진 걸 보고서야 알았습니다.
      if (created.photo_upload_failed > 0) {
        Alert.alert(
          "사진 일부를 올리지 못했어요",
          `게시물은 등록됐지만 사진 ${created.photo_upload_failed}장은 올라가지 않았어요. ` +
            "'게시물 관리'에서 지우고 다시 올려주세요.",
          [{ text: "확인", onPress: () => router.replace("/posts") }]
        );
        return;
      }
      router.replace("/posts");
    } catch (err) {
      Alert.alert("등록 실패", errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" bottomOffset={20}>
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
            <PhotoCarousel
              pageWidth={previewWidth}
              pageCount={photoDrafts.length + (photoDrafts.length < MAX_POST_PHOTOS ? 1 : 0)}
            >
              {photoDrafts.map((p) => (
                <View key={p.id} style={[styles.photoPreviewWrap, { width: previewWidth, height: previewWidth }]}>
                  <Image
                    source={{ uri: p.uri }}
                    style={{ width: previewWidth, height: previewWidth, backgroundColor: colors.surfaceAlt }}
                  />
                  <TouchableOpacity
                    style={styles.photoRemoveButtonLarge}
                    onPress={() => handleRemovePhoto(p.id)}
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
            </PhotoCarousel>
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
          <View style={[styles.modalSheet, { paddingBottom: spacing.xl - 4 + insets.bottom }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>여행지 선택</Text>
              <TouchableOpacity onPress={() => setPlaceModalVisible(false)} hitSlop={10}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            {loadingPlaces ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 6 }} />
            ) : (
              <SectionList
                sections={visitedPlaceSections}
                keyExtractor={(p) => p.id}
                // 시트 높이(maxHeight 70%) 안에서 목록이 줄어들며 스스로 스크롤되게
                // 합니다. 이게 없으면 목록이 내용 높이만큼 늘어나 시트를 넘칩니다.
                style={{ flexShrink: 1 }}
                showsVerticalScrollIndicator={false}
                stickySectionHeadersEnabled
                ListEmptyComponent={
                  <Text style={styles.emptyPlacesText}>
                    방문 완료로 표시한 여행지가 없어요. '내 여행' 탭에서 먼저 방문 완료로 표시해주세요.
                  </Text>
                }
                renderSectionHeader={({ section }) => (
                  <View style={styles.placeSectionHeader}>
                    <Text style={styles.placeSectionHeaderText}>{section.title}</Text>
                    <Text style={styles.placeSectionHeaderCount}>{section.data.length}곳</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.placeRow}
                    onPress={() => {
                      setSelectedPlace(item);
                      setPlaceModalVisible(false);
                    }}
                  >
                    <Text style={styles.placeRowName} numberOfLines={1}>
                      {item.place_name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {editing && (
        <PhotoEditor key={editing.key} imageUri={editing.uri} onCancel={handleEditorCancel} onConfirm={handleEditorConfirm} />
      )}
    </KeyboardAwareScrollView>
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
    // 스크롤 중에도 위에 붙어 있는 날짜 헤더. 시트 배경(surfaceAlt)과 같은 색을
    // 깔아둬야 아래 행들이 헤더를 통과해 지나가는 게 보이지 않습니다.
    placeSectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    placeSectionHeaderText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.textSecondary },
    placeSectionHeaderCount: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary },

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
