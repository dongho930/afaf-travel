import { useFocusEffect, useRouter } from "expo-router";
import { ChatCircleTextIcon, PlusIcon } from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import { PostItem } from "../../types";

const PAGE_SIZE = 20;

/**
 * '여행기록' 탭. 다른 사용자들이 올린 방문 여행지 게시물(사진+글)을 최신순으로
 * 보여주는 전체 공개 피드입니다. trips.tsx와 같은 방식(FlatList + onEndReached)
 * 으로 무한 스크롤하되, 이 화면은 섹션 전환 없이 피드 하나만 보여줍니다.
 */
export default function PostsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getPostFeed(PAGE_SIZE)
      .then((rows) => {
        setPosts(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => Alert.alert("불러오기 실패", "여행기록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadMore = () => {
    if (loading || loadingMore || !hasMore || posts.length === 0) return;
    setLoadingMore(true);
    const before = posts[posts.length - 1].created_at;
    api
      .getPostFeed(PAGE_SIZE, before)
      .then((rows) => {
        setPosts((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const handlePressWrite = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "여행기록을 남기려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    router.push("/post-create");
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const ListHeader = (
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.title}>여행기록</Text>
        <Text style={styles.subtitle}>다른 사람들이 남긴 방문 여행지 이야기를 둘러보세요</Text>
      </View>
      <TouchableOpacity style={styles.writeButton} onPress={handlePressWrite}>
        <PlusIcon size={16} color={colors.onPrimary} weight="bold" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={ListHeader}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>아직 등록된 여행기록이 없어요.</Text>
            <Text style={styles.emptyHint}>첫 여행기록을 남겨보세요!</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/post-detail", params: { postId: item.id } })}
          >
            <View style={styles.cardHeader}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>{item.username.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.username}>{item.username}</Text>
                <Text style={styles.placeName} numberOfLines={1}>
                  {item.place_name}
                </Text>
              </View>
              {item.photo_urls.length > 0 && (
                <Image source={{ uri: item.photo_urls[0] }} style={styles.thumb} />
              )}
            </View>
            <Text style={styles.body} numberOfLines={3}>
              {item.body}
            </Text>
            <View style={styles.commentRow}>
              <ChatCircleTextIcon size={14} color={colors.textTertiary} weight="bold" />
              <Text style={styles.commentCount}>댓글 {item.comment_count}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: spacing.xl - 4, paddingTop: 0 },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingTop: spacing.xl - 4,
      paddingBottom: spacing.lg,
    },
    title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
    subtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, maxWidth: 260 },
    writeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },

    emptyBox: { alignItems: "center", padding: spacing.xl },
    emptyText: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.textSecondary, marginBottom: spacing.xs + 2 },
    emptyHint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 2,
      marginBottom: spacing.md,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm + 2 },
    avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryLight },
    avatarPlaceholder: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarPlaceholderText: { color: colors.onPrimary, fontSize: 13, fontFamily: fontFamily.bold },
    username: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
    placeName: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginTop: 1 },
    thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.background },
    body: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 20, marginBottom: spacing.sm },
    commentRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    commentCount: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary },
  });
}
