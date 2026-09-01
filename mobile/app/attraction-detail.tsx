import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccessibilityIcons } from "../components/AccessibilityIcons";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { ThemeColors } from "../constants/theme";
import {
  BICYCLE_ICON_BASE64,
  CAR_ICON_BASE64,
  FOOT_ICON_BASE64,
  PUBLIC_TRANSIT_ICON_BASE64,
} from "../constants/travelModeIcons";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { Attraction, NearbyAttraction, Review } from "../types";

// 카카오맵 길찾기 URL Scheme이 요구하는 이동수단 값 (공식 문서 기준: 소문자).
type TravelMode = "car" | "publictransit" | "foot" | "bicycle";

const TRAVEL_MODES: { mode: TravelMode; icon: string; label: string }[] = [
  { mode: "car", icon: CAR_ICON_BASE64, label: "자동차" },
  { mode: "publictransit", icon: PUBLIC_TRANSIT_ICON_BASE64, label: "대중교통" },
  { mode: "foot", icon: FOOT_ICON_BASE64, label: "도보" },
  { mode: "bicycle", icon: BICYCLE_ICON_BASE64, label: "자전거" },
];

// 교통편 예약 — 각 서비스가 출발지/도착지를 URL로 자동 입력받는 공식 방법을
// 제공하지 않아서(사이트가 세션 기반의 복잡한 폼이라), 검색/예매 페이지를
// 그대로 열어드리는 선까지만 지원합니다. 사용자가 화면에서 직접 입력해야 해요.
type TransitBookingType = "train" | "bus" | "flight";

const TRANSIT_BOOKING_OPTIONS: { type: TransitBookingType; icon: string; label: string; url: string }[] = [
  { type: "train", icon: "🚄", label: "기차 (코레일+)", url: "https://korailtalk.co.kr" },
  { type: "bus", icon: "🚌", label: "고속·시외버스", url: "https://www.bustago.or.kr" },
  { type: "flight", icon: "✈️", label: "항공", url: "https://www.skyscanner.co.kr" },
];

const MAX_REVIEW_PHOTOS = 5;

// 리뷰 사진 선택 화면에서 다루는 사진 한 장. uri는 미리보기용이고,
// payload는 서버로 보낼 값입니다 — 기존에 이미 업로드된 사진은 그 URL을
// 그대로 유지(재업로드 없이)하고, 새로 고른 사진은 base64로 인코딩해서 보냅니다.
interface ReviewPhotoDraft {
  uri: string;
  payload: string;
}

/**
 * 홈 화면 '인기 여행지' 카드를 눌렀을 때 들어오는 상세 화면입니다.
 * 주소/혼잡도/이점 태그/소개문 + 방문자 리뷰 목록과, 로그인한 사용자의 리뷰
 * 작성(또는 이미 쓴 리뷰 수정)을 보여줍니다.
 */
export default function AttractionDetailScreen() {
  const router = useRouter();
  const { contentId, name } = useLocalSearchParams<{ contentId: string; name?: string }>();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [attraction, setAttraction] = useState<Attraction | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [nearby, setNearby] = useState<NearbyAttraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingInput, setRatingInput] = useState(5);
  const [bodyInput, setBodyInput] = useState("");
  const [photoDrafts, setPhotoDrafts] = useState<ReviewPhotoDraft[]>([]);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [directionsModalVisible, setDirectionsModalVisible] = useState(false);
  const [findingRoute, setFindingRoute] = useState<TravelMode | null>(null);
  const [transitModalVisible, setTransitModalVisible] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);

  const load = useCallback(() => {
    if (!contentId) return;
    setLoading(true);
    Promise.all([api.getAttractionDetail(contentId), api.getReviews(contentId)])
      .then(([detail, reviewList]) => {
        setAttraction(detail);
        setReviews(reviewList);
        const mine = session ? reviewList.find((r) => r.user_id === session.user.id) : null;
        if (mine) {
          setRatingInput(mine.rating);
          setBodyInput(mine.body);
          setPhotoDrafts((mine.photo_urls || []).map((url) => ({ uri: url, payload: url })));
        }
      })
      .catch(() => Alert.alert("불러오기 실패", "관광지 정보를 불러오지 못했어요."))
      .finally(() => setLoading(false));
    // '근처 가볼 만한 곳'은 있으면 좋은 부가 정보라, 실패해도 조용히 빈 목록으로
    // 둡니다 (메인 상세 정보 로딩을 막지 않도록 별도로 처리).
    api
      .getNearbyAttractions(contentId)
      .then(setNearby)
      .catch(() => setNearby([]));
  }, [contentId, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handlePickReviewPhotos = async () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "리뷰를 쓰려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (photoDrafts.length >= MAX_REVIEW_PHOTOS) {
      Alert.alert(`사진은 최대 ${MAX_REVIEW_PHOTOS}장까지 첨부할 수 있어요.`);
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
      selectionLimit: MAX_REVIEW_PHOTOS - photoDrafts.length,
      quality: 0.6,
    });
    if (result.canceled || !result.assets?.length) return;

    setPickingPhoto(true);
    try {
      const picked = result.assets.slice(0, MAX_REVIEW_PHOTOS - photoDrafts.length);
      const encoded = await Promise.all(
        picked.map(async (asset) => {
          const base64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { uri: asset.uri, payload: base64 };
        })
      );
      setPhotoDrafts((prev) => [...prev, ...encoded].slice(0, MAX_REVIEW_PHOTOS));
    } catch (err) {
      Alert.alert("사진을 불러오지 못했어요", String(err));
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleRemoveReviewPhoto = (uri: string) => {
    setPhotoDrafts((prev) => prev.filter((p) => p.uri !== uri));
  };

  const handleSubmitReview = async () => {
    if (!contentId) return;
    if (!session) {
      Alert.alert("로그인이 필요해요", "리뷰를 쓰려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!bodyInput.trim()) {
      Alert.alert("리뷰 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitReview(
        contentId,
        ratingInput,
        bodyInput.trim(),
        photoDrafts.map((p) => p.payload)
      );
      const reviewList = await api.getReviews(contentId);
      setReviews(reviewList);
      Alert.alert("리뷰가 등록됐어요. 감사합니다!");
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openSaveModal = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "이 장소를 저장하려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setSaveModalVisible(true);
  };

  const handleConfirmSave = async (params: SaveCourseParams) => {
    if (!attraction) return;
    // 1단계: 이 관광지 하나만 담은 코스를 만들어 course_id를 발급받고,
    // 2단계: AI플래너 결과 화면과 동일한 저장 API로 여행에 붙입니다.
    const course = await api.createCourseFromAttraction(attraction.content_id);
    await api.saveCourse(course.course_id, params);
  };

  const handleSelectTravelMode = async (mode: TravelMode) => {
    if (!attraction) return;
    setFindingRoute(mode);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("위치 권한이 필요해요", "내 위치에서 길을 찾으려면 위치 권한을 허용해주세요.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const sp = `${position.coords.latitude},${position.coords.longitude}`;
      const ep = `${attraction.latitude},${attraction.longitude}`;

      // 카카오맵 앱이 설치돼 있으면 그쪽으로, 없으면 모바일 웹 스킴(카카오맵
      // 설치 유도 페이지로도 연결됨)으로 대신 엽니다.
      const appUrl = `kakaomap://route?sp=${sp}&ep=${ep}&by=${mode}`;
      const canOpenApp = await Linking.canOpenURL(appUrl);
      const url = canOpenApp
        ? appUrl
        : `https://m.map.kakao.com/scheme/route?sp=${sp}&ep=${ep}&by=${mode}`;

      setDirectionsModalVisible(false);
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert("길찾기 실패", "현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setFindingRoute(null);
    }
  };

  const handleSelectTransitBooking = async (option: (typeof TRANSIT_BOOKING_OPTIONS)[number]) => {
    setTransitModalVisible(false);
    try {
      await Linking.openURL(option.url);
    } catch (err) {
      Alert.alert("열기 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!attraction) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>"{name}" 정보를 찾을 수 없어요.</Text>
      </View>
    );
  }

  const myReview = session ? reviews.find((r) => r.user_id === session.user.id) : null;

  return (
    <>
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {attraction.image_url ? (
        <Image source={{ uri: attraction.image_url }} style={styles.heroImage} />
      ) : null}

      <View style={styles.titleRow}>
        <Text style={styles.title}>{attraction.name}</Text>
        <View style={styles.badgeGroup}>
          {typeof attraction.avg_rating === "number" && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingBadgeText}>
                ★ {attraction.avg_rating.toFixed(1)} ({attraction.review_count})
              </Text>
            </View>
          )}
          {typeof attraction.congestion_rate === "number" && (
            <View style={styles.congestionBadge}>
              <Text style={styles.congestionBadgeText}>
                혼잡도 {Math.round(attraction.congestion_rate)}%
              </Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.category}>{attraction.category}</Text>
      <Text style={styles.address}>📍 {attraction.address}</Text>

      <View style={styles.actionButtonRow}>
        <Pressable style={styles.directionsButton} onPress={() => setDirectionsModalVisible(true)}>
          <Text style={styles.directionsButtonText}>🗺️ 길찾기</Text>
        </Pressable>
        <Pressable style={styles.directionsButton} onPress={() => setTransitModalVisible(true)}>
          <Text style={styles.directionsButtonText}>🚄 교통편 예약</Text>
        </Pressable>
        <Pressable style={styles.directionsButton} onPress={openSaveModal}>
          <Text style={styles.directionsButtonText}>💾 저장</Text>
        </Pressable>
      </View>

      {!!attraction.overview && <Text style={styles.overview}>{attraction.overview}</Text>}

      <AccessibilityIcons features={attraction.accessibility} />

      {nearby.length > 0 && (
        <View style={styles.nearbySection}>
          <Text style={styles.nearbySectionTitle}>📍 근처 가볼 만한 곳</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nearbyRow}>
            {nearby.map((n) => (
              <Pressable
                key={n.content_id}
                style={styles.nearbyCard}
                onPress={() =>
                  router.push({
                    pathname: "/attraction-detail",
                    params: { contentId: n.content_id, name: n.name },
                  })
                }
              >
                {n.image_url ? (
                  <Image source={{ uri: n.image_url }} style={styles.nearbyImage} />
                ) : (
                  <View style={[styles.nearbyImage, styles.nearbyImagePlaceholder]}>
                    <Text style={styles.nearbyImagePlaceholderText}>📍</Text>
                  </View>
                )}
                <Text style={styles.nearbyName} numberOfLines={1}>
                  {n.name}
                </Text>
                <Text style={styles.nearbyMeta}>
                  {n.category} · {n.distance_km}km
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>💬 방문자 리뷰 ({reviews.length})</Text>

      <View style={styles.reviewForm}>
        <Text style={styles.reviewFormLabel}>
          {myReview ? "내 리뷰 수정하기" : "리뷰 남기기"}
        </Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity key={n} onPress={() => setRatingInput(n)} hitSlop={6}>
              <Text style={[styles.star, n <= ratingInput && styles.starFilled]}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.reviewInput}
          multiline
          placeholder={
            session ? "이 장소는 어땠나요? 이동 편의성 등을 남겨주세요." : "로그인 후 리뷰를 남길 수 있어요."
          }
          placeholderTextColor={colors.textTertiary}
          value={bodyInput}
          onChangeText={setBodyInput}
          editable={!!session}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoPickerRow}>
          {photoDrafts.map((p) => (
            <View key={p.uri} style={styles.photoThumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.photoThumb} />
              <TouchableOpacity
                style={styles.photoRemoveButton}
                onPress={() => handleRemoveReviewPhoto(p.uri)}
                hitSlop={6}
              >
                <Text style={styles.photoRemoveButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          {session && photoDrafts.length < MAX_REVIEW_PHOTOS && (
            <TouchableOpacity
              style={styles.photoAddButton}
              onPress={handlePickReviewPhotos}
              disabled={pickingPhoto}
            >
              {pickingPhoto ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Text style={styles.photoAddButtonIcon}>📷</Text>
                  <Text style={styles.photoAddButtonText}>사진 추가</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmitReview}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitText}>{session ? (myReview ? "리뷰 수정하기" : "리뷰 등록하기") : "로그인하고 리뷰 남기기"}</Text>
          )}
        </TouchableOpacity>
      </View>

      {reviews.length === 0 ? (
        <Text style={styles.emptyReviewText}>아직 리뷰가 없어요. 첫 리뷰를 남겨보세요!</Text>
      ) : (
        reviews.map((r) => (
          <View key={r.id} style={styles.reviewCard}>
            <View style={styles.reviewCardHeader}>
              <View style={styles.reviewAuthorRow}>
                {r.avatar_url ? (
                  <Image source={{ uri: r.avatar_url }} style={styles.reviewAvatar} />
                ) : (
                  <View style={styles.reviewAvatarPlaceholder}>
                    <Text style={styles.reviewAvatarPlaceholderText}>
                      {r.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.reviewAuthor}>{r.username}</Text>
              </View>
              <Text style={styles.reviewStars}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</Text>
            </View>
            <Text style={styles.reviewBody}>{r.body}</Text>
            {r.photo_urls && r.photo_urls.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reviewPhotoRow}>
                {r.photo_urls.map((url) => (
                  <Image key={url} source={{ uri: url }} style={styles.reviewPhoto} />
                ))}
              </ScrollView>
            )}
          </View>
        ))
      )}
    </ScrollView>

    <Modal
      visible={directionsModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setDirectionsModalVisible(false)}
    >
      <Pressable style={styles.modalBackdrop} onPress={() => setDirectionsModalVisible(false)}>
        <Pressable style={[styles.modalSheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>이동수단을 선택해주세요</Text>
          <Text style={styles.modalSubtitle}>내 위치에서 카카오맵으로 길을 안내해드려요</Text>

          <View style={styles.travelModeRow}>
            {TRAVEL_MODES.map((tm) => (
              <TouchableOpacity
                key={tm.mode}
                style={styles.travelModeButton}
                onPress={() => handleSelectTravelMode(tm.mode)}
                disabled={findingRoute !== null}
              >
                <View style={styles.travelModeCircle}>
                  {findingRoute === tm.mode ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Image source={{ uri: tm.icon }} style={styles.travelModeIcon} resizeMode="contain" />
                  )}
                </View>
                <Text style={styles.travelModeLabel}>{tm.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={transitModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setTransitModalVisible(false)}
    >
      <Pressable style={styles.modalBackdrop} onPress={() => setTransitModalVisible(false)}>
        <Pressable style={[styles.modalSheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>교통편을 선택해주세요</Text>
          <Text style={styles.modalSubtitle}>
            각 예매 사이트로 이동해요. 출발지·도착지는 직접 입력해주셔야 해요.
          </Text>

          <View style={styles.travelModeRow}>
            {TRANSIT_BOOKING_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.type}
                style={styles.travelModeButton}
                onPress={() => handleSelectTransitBooking(opt)}
              >
                <View style={styles.travelModeCircle}>
                  <Text style={styles.transitModeIcon}>{opt.icon}</Text>
                </View>
                <Text style={styles.travelModeLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <SaveCourseModal
      visible={saveModalVisible}
      onClose={() => setSaveModalVisible(false)}
      defaultNewTripName={attraction.name}
      onConfirm={handleConfirmSave}
    />
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  emptyText: { fontSize: 15, color: colors.textTertiary, textAlign: "center" },
  container: { padding: 20, paddingBottom: 60, backgroundColor: colors.background },

  heroImage: { width: "100%", height: 200, borderRadius: 16, marginBottom: 16, backgroundColor: colors.primaryLight },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, flexShrink: 1 },
  category: { fontSize: 13, color: colors.primary, fontWeight: "600", marginTop: 4 },
  address: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },

  actionButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  directionsButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  directionsButtonText: { fontSize: 15, fontWeight: "700", color: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: colors.textTertiary, marginBottom: 24 },
  travelModeRow: { flexDirection: "row", justifyContent: "space-between" },
  travelModeButton: { alignItems: "center", gap: 8 },
  travelModeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  travelModeIcon: { width: 36, height: 36 },
  transitModeIcon: { fontSize: 28 },
  travelModeLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  overview: { fontSize: 14, color: colors.text, marginTop: 12, lineHeight: 21 },

  nearbySection: { marginTop: 20 },
  nearbySectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 10 },
  nearbyRow: { gap: 12, paddingRight: 4 },
  nearbyCard: { width: 130 },
  nearbyImage: { width: 130, height: 90, borderRadius: 12, backgroundColor: colors.primaryLight },
  nearbyImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  nearbyImagePlaceholderText: { fontSize: 24 },
  nearbyName: { fontSize: 13, fontWeight: "700", color: colors.text, marginTop: 6 },
  nearbyMeta: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },

  badgeGroup: { flexDirection: "row", gap: 6, marginLeft: 8 },
  ratingBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ratingBadgeText: { fontSize: 12, fontWeight: "700", color: colors.warningText },
  congestionBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  congestionBadgeText: { fontSize: 12, fontWeight: "700", color: colors.warningText },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 14 },

  reviewForm: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  reviewFormLabel: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 8 },
  starRow: { flexDirection: "row", gap: 4, marginBottom: 10 },
  star: { fontSize: 24, color: colors.border },
  starFilled: { color: "#F0A93B" },
  reviewInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 70,
    textAlignVertical: "top",
    fontSize: 14,
    color: colors.text,
    marginBottom: 10,
  },
  photoPickerRow: { marginBottom: 10 },
  photoThumbWrap: { marginRight: 8, position: "relative" },
  photoThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.background },
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
  photoRemoveButtonText: { color: colors.surface, fontSize: 11, fontWeight: "700" },
  photoAddButton: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  photoAddButtonIcon: { fontSize: 16 },
  photoAddButtonText: { fontSize: 10, color: colors.textTertiary, marginTop: 2 },

  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },

  emptyReviewText: { fontSize: 13, color: colors.textTertiary, textAlign: "center", marginTop: 8 },

  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  reviewCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  reviewAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryLight },
  reviewAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
  reviewAuthor: { fontSize: 13, fontWeight: "700", color: colors.text },
  reviewStars: { fontSize: 12, color: "#F0A93B" },
  reviewBody: { fontSize: 13, color: colors.text, lineHeight: 19 },
  reviewPhotoRow: { marginTop: 8 },
  reviewPhoto: { width: 72, height: 72, borderRadius: 8, marginRight: 8, backgroundColor: colors.background },
  });
}
