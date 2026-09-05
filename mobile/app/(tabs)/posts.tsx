import { useFocusEffect, useRouter } from "expo-router";
import { ListBulletsIcon, PlusIcon } from "phosphor-react-native";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FadeInView } from "../../components/FadeInView";
import { PostCard } from "../../components/PostCard";
import { ProfileButton } from "../../components/ProfileButton";
import { Alert } from "../../services/crossPlatformAlert";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import { PostItem } from "../../types";

const PAGE_SIZE = 20;

/**
 * '게시물' 탭. 다른 사용자들이 올린 방문 여행지 게시물(사진+글)을 최신순으로
 * 보여주는 전체 공개 피드입니다. trips.tsx와 같은 방식(FlatList + onEndReached)
 * 으로 무한 스크롤하되, 이 화면은 섹션 전환 없이 피드 하나만 보여줍니다.
 * 새 게시물 작성 버튼은 화면 하단 중앙에 떠 있는 원형 버튼(FAB)입니다.
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
  // FlatList는 화면 밖으로 멀리 나간 카드를 가상화로 언마운트했다가 스크롤로
  // 되돌아오면 다시 마운트합니다. 매번 다시 마운트될 때마다 페이드인이 또
  // 재생되면 스크롤할 때마다 깜빡이는 것처럼 보이므로, 한 번이라도 렌더링된
  // 게시물 id는 기억해뒀다가 그 다음부터는(같은 방문 안에서는) 애니메이션 없이
  // 바로 보여줍니다. 다만 이 기록은 탭에 들어올 때마다(useFocusEffect) 비워서,
  // 게시물 탭에 새로 들어올 때는 지금 불러온 게시물들이 다시 한 번 페이드인되게 합니다.
  const animatedPostIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    api
      .getPostFeed(PAGE_SIZE)
      .then((rows) => {
        setPosts(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => Alert.alert("불러오기 실패", "게시물을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      animatedPostIdsRef.current = new Set();
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
      Alert.alert("로그인이 필요해요", "게시물을 남기려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    router.push("/post-create");
  };

  const handlePressManage = () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "게시물 관리는 로그인 후 이용할 수 있어요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    router.push("/post-manage");
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
      <Text style={styles.title}>게시물</Text>
      <ProfileButton />
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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>아직 등록된 게시물이 없어요.</Text>
            <Text style={styles.emptyHint}>첫 게시물을 남겨보세요!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const alreadyShown = animatedPostIdsRef.current.has(item.id);
          animatedPostIdsRef.current.add(item.id);
          return alreadyShown ? (
            <PostCard item={item} bodyNumberOfLines={4} />
          ) : (
            <FadeInView duration={300}>
              <PostCard item={item} bodyNumberOfLines={4} />
            </FadeInView>
          );
        }}
      />

      <View style={styles.fabContainer} pointerEvents="box-none">
        <TouchableOpacity style={styles.manageButton} onPress={handlePressManage}>
          <ListBulletsIcon size={14} color={colors.text} weight="bold" />
          <Text style={styles.manageButtonText}>게시물 관리</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={handlePressWrite}>
          <PlusIcon size={24} color={colors.onPrimary} weight="bold" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: spacing.xl - 4, paddingTop: 0, paddingBottom: spacing.xxl + 48 },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: spacing.xl - 4,
      paddingBottom: spacing.lg,
    },
    title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text },

    fabContainer: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: spacing.lg,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: spacing.sm + 2,
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    manageButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs + 2,
      height: 44,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md + 2,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 2,
    },
    manageButtonText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },

    emptyBox: { alignItems: "center", padding: spacing.xl },
    emptyText: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.textSecondary, marginBottom: spacing.xs + 2 },
    emptyHint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary },
  });
}
