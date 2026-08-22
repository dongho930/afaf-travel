import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { Attraction, Review } from "../types";

/**
 * 홈 화면 '인기 여행지' 카드를 눌렀을 때 들어오는 상세 화면입니다.
 * 주소/혼잡도/이점 태그/소개문 + 방문자 리뷰 목록과, 로그인한 사용자의 리뷰
 * 작성(또는 이미 쓴 리뷰 수정)을 보여줍니다.
 */
export default function AttractionDetailScreen() {
  const router = useRouter();
  const { contentId, name } = useLocalSearchParams<{ contentId: string; name?: string }>();
  const { session } = useAuth();

  const [attraction, setAttraction] = useState<Attraction | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingInput, setRatingInput] = useState(5);
  const [bodyInput, setBodyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        }
      })
      .catch(() => Alert.alert("불러오기 실패", "관광지 정보를 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [contentId, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
      await api.submitReview(contentId, ratingInput, bodyInput.trim());
      const reviewList = await api.getReviews(contentId);
      setReviews(reviewList);
      Alert.alert("리뷰가 등록됐어요. 감사합니다!");
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D5B" />
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

      {!!attraction.overview && <Text style={styles.overview}>{attraction.overview}</Text>}

      {attraction.accessibility_benefits.length > 0 && (
        <View style={styles.benefitRow}>
          {attraction.accessibility_benefits.map((b) => (
            <View key={b} style={styles.benefitTag}>
              <Text style={styles.benefitTagText}>{b}</Text>
            </View>
          ))}
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
          value={bodyInput}
          onChangeText={setBodyInput}
          editable={!!session}
        />
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmitReview}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
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
              <Text style={styles.reviewAuthor}>{r.username}</Text>
              <Text style={styles.reviewStars}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</Text>
            </View>
            <Text style={styles.reviewBody}>{r.body}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 15, color: "#8A8A8A", textAlign: "center" },
  container: { padding: 20, paddingBottom: 60 },

  heroImage: { width: "100%", height: 200, borderRadius: 16, marginBottom: 16, backgroundColor: "#EAF3EE" },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", flexShrink: 1 },
  category: { fontSize: 13, color: "#2E7D5B", fontWeight: "600", marginTop: 4 },
  address: { fontSize: 13, color: "#5C5C5C", marginTop: 6 },
  overview: { fontSize: 14, color: "#3A3A3A", marginTop: 12, lineHeight: 21 },

  badgeGroup: { flexDirection: "row", gap: 6, marginLeft: 8 },
  ratingBadge: {
    backgroundColor: "#FFF7E0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ratingBadgeText: { fontSize: 12, fontWeight: "700", color: "#B8860B" },
  congestionBadge: {
    backgroundColor: "#FFF1E6",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  congestionBadgeText: { fontSize: 12, fontWeight: "700", color: "#C2622A" },

  benefitRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, gap: 8 },
  benefitTag: {
    backgroundColor: "#EAF3EE",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  benefitTagText: { fontSize: 12, fontWeight: "600", color: "#2E7D5B" },

  divider: { height: 1, backgroundColor: "#E2E8E4", marginVertical: 20 },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1A1A1A", marginBottom: 14 },

  reviewForm: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 14,
    marginBottom: 16,
  },
  reviewFormLabel: { fontSize: 13, fontWeight: "700", color: "#1A1A1A", marginBottom: 8 },
  starRow: { flexDirection: "row", gap: 4, marginBottom: 10 },
  star: { fontSize: 24, color: "#D9D9D9" },
  starFilled: { color: "#F0A93B" },
  reviewInput: {
    borderWidth: 1,
    borderColor: "#E2E8E4",
    borderRadius: 10,
    padding: 10,
    minHeight: 70,
    textAlignVertical: "top",
    fontSize: 14,
    color: "#1A1A1A",
    marginBottom: 10,
  },
  submitButton: {
    backgroundColor: "#2E7D5B",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  emptyReviewText: { fontSize: 13, color: "#8A8A8A", textAlign: "center", marginTop: 8 },

  reviewCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8E4",
    padding: 14,
    marginBottom: 10,
  },
  reviewCardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  reviewAuthor: { fontSize: 13, fontWeight: "700", color: "#1A1A1A" },
  reviewStars: { fontSize: 12, color: "#F0A93B" },
  reviewBody: { fontSize: 13, color: "#3A3A3A", lineHeight: 19 },
});
