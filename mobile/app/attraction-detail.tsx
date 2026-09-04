import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AirplaneIcon,
  BusIcon,
  CameraIcon,
  ChatCircleTextIcon,
  FloppyDiskIcon,
  type Icon,
  MapPinIcon,
  MapTrifoldIcon,
  NotebookIcon,
  StarIcon,
  TrainIcon,
  XIcon,
} from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../services/crossPlatformAlert";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccessibilityIcons } from "../components/AccessibilityIcons";
import { PostCard } from "../components/PostCard";
import { SaveCourseModal, SaveCourseParams } from "../components/SaveCourseModal";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import {
  BICYCLE_ICON_BASE64,
  CAR_ICON_BASE64,
  FOOT_ICON_BASE64,
  PUBLIC_TRANSIT_ICON_BASE64,
} from "../constants/travelModeIcons";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useTheme } from "../services/ThemeContext";
import { Attraction, NearbyAttraction, PostItem, Review } from "../types";

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

const TRANSIT_BOOKING_OPTIONS: { type: TransitBookingType; icon: Icon; label: string; url: string }[] = [
  { type: "train", icon: TrainIcon, label: "기차 (코레일+)", url: "https://korailtalk.co.kr" },
  { type: "bus", icon: BusIcon, label: "고속·시외버스", url: "https://www.bustago.or.kr" },
  { type: "flight", icon: AirplaneIcon, label: "항공", url: "https://www.skyscanner.co.kr" },
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
  const [postsModalVisible, setPostsModalVisible] = useState(false);
  const [placePosts, setPlacePosts] = useState<PostItem[]>([]);
  const [loadingPlacePosts, setLoadingPlacePosts] = useState(false);

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

    setPickingPhoto(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: MAX_REVIEW_PHOTOS - photoDrafts.length,
        quality: 0.6,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const picked = result.assets.slice(0, MAX_REVIEW_PHOTOS - photoDrafts.length);
      const encoded = picked
        .filter((asset) => !!asset.base64)
        .map((asset) => ({ uri: asset.uri, payload: asset.base64 as string }));
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

  // '게시물' 버튼 — 이 관광지에 대한 게시물을 팝업으로 보여줍니다(최신순).
  // 열 때마다 다시 불러와서 항상 최신 상태를 보여줍니다.
  const handleOpenPosts = () => {
    if (!contentId) return;
    setPostsModalVisible(true);
    setLoadingPlacePosts(true);
    api
      .getPostsByPlace(contentId)
      .then(setPlacePosts)
      .catch(() => Alert.alert("불러오기 실패", "게시물을 불러오지 못했어요."))
      .finally(() => setLoadingPlacePosts(false));
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
      setDirectionsModalVisible(false);

      if (Platform.OS === "web") {
        // 웹(PC)에서는 브라우저 위치 정확도가 낮아서(GPS 없이 Wi-Fi/IP 기반
        // 추정이라 실제 위치와 꽤 차이날 수 있음) 자동으로 내 위치를 출발지로
        // 잡지 않습니다. 대신 도착지만 채운 카카오맵 페이지를 열어서,
        // 출발지와 이동수단은 사용자가 그 페이지에서 직접 입력하게 합니다.
        const to = `${encodeURIComponent(attraction.name)},${attraction.latitude},${attraction.longitude}`;
        const webUrl = `https://map.kakao.com/link/to/${to}`;
        await Linking.openURL(webUrl);
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("위치 권한이 필요해요", "내 위치에서 길을 찾으려면 위치 권한을 허용해주세요.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      const sp = `${position.coords.latitude},${position.coords.longitude}`;
      const ep = `${attraction.latitude},${attraction.longitude}`;

      // 카카오맵 앱이 설치돼 있으면 그쪽으로, 없으면 모바일 웹 스킴(카카오맵
      // 설치 유도 페이지로도 연결됨)으로 대신 엽니다.
      const appUrl = `kakaomap://route?sp=${sp}&ep=${ep}&by=${mode}`;
      const canOpenApp = await Linking.canOpenURL(appUrl);
      const url = canOpenApp
        ? appUrl
        : `https://m.map.kakao.com/scheme/route?sp=${sp}&ep=${ep}&by=${mode}`;

      await Linking.openURL(url);
    } catch (err) {
      Alert.alert("길찾기 실패", "현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setFindingRoute(null);
    }
  };

  const handleOpenDirections = async () => {
    if (!attraction) return;
    if (Platform.OS === "web") {
      // 웹에서는 이동수단 선택 팝업을 거치지 않고, 바로 도착지만 채운
      // 카카오맵 페이지를 엽니다 (이동수단을 골라도 결과가 다 같아서 팝업이
      // 불필요합니다. 출발지/이동수단은 그 페이지에서 직접 고르면 됩니다).
      const to = `${encodeURIComponent(attraction.name)},${attraction.latitude},${attraction.longitude}`;
      await Linking.openURL(`https://map.kakao.com/link/to/${to}`);
      return;
    }
    setDirectionsModalVisible(true);
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
              <StarIcon size={12} color={colors.warningText} weight="fill" />
              <Text style={styles.ratingBadgeText}>
                {attraction.avg_rating.toFixed(1)} ({attraction.review_count})
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
      <View style={styles.addressRow}>
        <MapPinIcon size={13} color={colors.textSecondary} weight="bold" />
        <Text style={styles.address}>{attraction.address}</Text>
      </View>

      <View style={styles.actionButtonRow}>
        <Pressable style={styles.directionsButton} onPress={handleOpenDirections}>
          <MapTrifoldIcon size={16} color={colors.primary} weight="bold" />
          <Text style={styles.directionsButtonText}>길찾기</Text>
        </Pressable>
        <Pressable style={styles.directionsButton} onPress={() => setTransitModalVisible(true)}>
          <TrainIcon size={16} color={colors.primary} weight="bold" />
          <Text style={styles.directionsButtonText}>교통편 예약</Text>
        </Pressable>
        <Pressable style={styles.directionsButton} onPress={handleOpenPosts}>
          <NotebookIcon size={16} color={colors.primary} weight="bold" />
          <Text style={styles.directionsButtonText}>게시물</Text>
        </Pressable>
        <Pressable style={styles.directionsButton} onPress={openSaveModal}>
          <FloppyDiskIcon size={16} color={colors.primary} weight="bold" />
          <Text style={styles.directionsButtonText}>저장</Text>
        </Pressable>
      </View>

      {!!attraction.overview && <Text style={styles.overview}>{attraction.overview}</Text>}

      <AccessibilityIcons features={attraction.accessibility} />

      {!!attraction.extra_info?.length && (
        <View style={styles.infoSection}>
          {attraction.extra_info.map((info, i) => (
            <View
              key={info.label}
              style={[styles.infoRow, i === attraction.extra_info!.length - 1 && styles.infoRowLast]}
            >
              <Text style={styles.infoLabel}>{info.label}</Text>
              <Text style={styles.infoValue}>{info.value}</Text>
            </View>
          ))}
        </View>
      )}

      {nearby.length > 0 && (
        <View style={styles.nearbySection}>
          <View style={styles.nearbySectionTitleRow}>
            <MapPinIcon size={14} color={colors.text} weight="bold" />
            <Text style={styles.nearbySectionTitle}>근처 가볼 만한 곳</Text>
          </View>
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
                    <MapPinIcon size={24} color={colors.primary} weight="bold" />
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

      <View style={styles.sectionTitleRow}>
        <ChatCircleTextIcon size={16} color={colors.text} weight="bold" />
        <Text style={styles.sectionTitle}>방문자 리뷰 ({reviews.length})</Text>
      </View>

      <View style={styles.reviewForm}>
        <Text style={styles.reviewFormLabel}>
          {myReview ? "내 리뷰 수정하기" : "리뷰 남기기"}
        </Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity key={n} onPress={() => setRatingInput(n)} hitSlop={6}>
              <StarIcon size={26} color={n <= ratingInput ? "#F0A93B" : colors.border} weight={n <= ratingInput ? "fill" : "regular"} />
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
                <XIcon size={11} color={colors.surface} weight="bold" />
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
                  <CameraIcon size={16} color={colors.textTertiary} weight="bold" />
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
              <View style={styles.reviewStarsRow}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <StarIcon key={i} size={12} color="#F0A93B" weight={i < r.rating ? "fill" : "regular"} />
                ))}
              </View>
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
            {TRANSIT_BOOKING_OPTIONS.map((opt) => {
              const OptIcon = opt.icon;
              return (
                <TouchableOpacity
                  key={opt.type}
                  style={styles.travelModeButton}
                  onPress={() => handleSelectTransitBooking(opt)}
                >
                  <View style={styles.travelModeCircle}>
                    <OptIcon size={26} color={colors.onPrimary} weight="bold" />
                  </View>
                  <Text style={styles.travelModeLabel}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
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

    <Modal
      visible={postsModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setPostsModalVisible(false)}
    >
      <View style={styles.postsModalBackdrop}>
        <View style={styles.postsModalSheet}>
          <View style={styles.postsModalHeader}>
            <Text style={styles.postsModalTitle}>게시물</Text>
            <TouchableOpacity onPress={() => setPostsModalVisible(false)} hitSlop={10}>
              <XIcon size={18} color={colors.text} weight="bold" />
            </TouchableOpacity>
          </View>
          {loadingPlacePosts ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : placePosts.length === 0 ? (
            <Text style={styles.postsEmptyText}>아직 이 장소에 대한 게시물이 없어요.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {placePosts.map((p) => (
                <PostCard key={p.id} item={p} />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  emptyText: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center" },
  container: { padding: spacing.xl - 4, paddingBottom: spacing.xxl + spacing.xl, backgroundColor: colors.background },

  heroImage: { width: "100%", height: 200, borderRadius: radius.lg, marginBottom: spacing.lg, backgroundColor: colors.primaryLight },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, flexShrink: 1 },
  category: { fontSize: 13, color: colors.primary, fontFamily: fontFamily.semiBold, marginTop: spacing.xs },
  addressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginTop: spacing.sm },
  address: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 },

  actionButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm + 2, marginTop: spacing.md },
  directionsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl - 4,
    paddingVertical: spacing.md + 1,
  },
  directionsButtonText: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  modalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.xl - 4,
  },
  modalTitle: { fontSize: 17, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
  modalSubtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.xl },

  // '게시물' 팝업 — 게시물 관리 화면의 게시물 팝업과 같은 형태(가운데 정렬 시트,
  // 제목+닫기 헤더)이되, 여러 게시물을 최신순으로 스크롤해서 볼 수 있습니다.
  postsModalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  postsModalSheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl - 4,
    maxHeight: "85%",
  },
  postsModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  postsModalTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
  postsEmptyText: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.textTertiary,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  travelModeRow: { flexDirection: "row", justifyContent: "space-between" },
  travelModeButton: { alignItems: "center", gap: spacing.sm },
  travelModeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  travelModeIcon: { width: 36, height: 36 },
  travelModeLabel: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.text },
  overview: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.text, marginTop: spacing.md, lineHeight: 21 },

  infoSection: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  infoValue: { flex: 1, fontSize: 13, fontFamily: fontFamily.regular, color: colors.text, textAlign: "left" },

  nearbySection: { marginTop: spacing.xl - 4 },
  nearbySectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginBottom: spacing.sm + 2 },
  nearbySectionTitle: { fontSize: 15, fontFamily: fontFamily.extraBold, color: colors.text },
  nearbyRow: { gap: spacing.md, paddingRight: spacing.xs },
  nearbyCard: { width: 130 },
  nearbyImage: { width: 130, height: 90, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  nearbyImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  nearbyName: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text, marginTop: spacing.sm },
  nearbyMeta: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 2 },

  badgeGroup: { flexDirection: "row", gap: spacing.xs + 2, marginLeft: spacing.sm },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs - 2,
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  ratingBadgeText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.warningText },
  congestionBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  congestionBadgeText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.warningText },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xl - 4 },

  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginBottom: spacing.md + 2 },
  sectionTitle: { fontSize: 16, fontFamily: fontFamily.extraBold, color: colors.text },

  reviewForm: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.lg,
  },
  reviewFormLabel: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text, marginBottom: spacing.sm },
  starRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm + 2 },
  reviewInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm + 2,
    padding: spacing.sm + 2,
    minHeight: 70,
    textAlignVertical: "top",
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.text,
    marginBottom: spacing.sm + 2,
  },
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
    borderRadius: radius.sm + 2,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 14 },

  emptyReviewText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center", marginTop: spacing.sm },

  reviewCard: {
    paddingVertical: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs + 2 },
  reviewAuthorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reviewAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryLight },
  reviewAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 13, fontFamily: fontFamily.bold },
  reviewAuthor: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
  reviewStarsRow: { flexDirection: "row", gap: 1 },
  reviewBody: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 19 },
  reviewPhotoRow: { marginTop: spacing.sm },
  reviewPhoto: { width: 72, height: 72, borderRadius: spacing.sm, marginRight: spacing.sm, backgroundColor: colors.background },
  });
}
