import { useFocusEffect, useRouter } from "expo-router";
import { CaretDownIcon, CaretUpIcon, ChatCircleTextIcon, ListBulletsIcon, PlusIcon, XIcon } from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../../services/crossPlatformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { fontFamily } from "../../constants/fonts";
import { ThemeColors } from "../../constants/theme";
import { radius, spacing } from "../../constants/tokens";
import { api } from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useTheme } from "../../services/ThemeContext";
import { PostComment, PostItem } from "../../types";

const PAGE_SIZE = 20;

/**
 * 인스타그램 게시물 카드처럼, 사진이 카드 폭에 꽉 차야 합니다. 부모(FlatList)가
 * 카드 너비를 픽셀 단위로 알려주지 않아서, 이 카드 컴포넌트가 자체
 * onLayout으로 자기 너비를 측정한 뒤에야 그 너비로 정사각형 사진을 그립니다
 * (측정 전까지는 사진 영역을 비워둡니다 — 아주 짧은 순간 레이아웃이
 * 잡히는 동안만 보이는 정도라 눈에 띄지 않습니다).
 *
 * 댓글은 다른 화면으로 이동하지 않고, '댓글' 줄을 누르면 카드 바로 아래에
 * 펼쳐집니다(flat list + parent_comment_id 그룹핑 방식). 게시물을 눌러도
 * 다른 화면으로 이동하지 않아요 — 이 피드 화면이 전부입니다. 본인 게시물
 * 삭제는 하단의 '게시물 관리' 화면에서 합니다.
 */
function PostCard({
  item,
  colors,
  styles,
}: {
  item: PostItem;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const [photoWidth, setPhotoWidth] = useState(0);

  const [expanded, setExpanded] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentCount, setCommentCount] = useState(item.comment_count);

  const [commentInput, setCommentInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<PostComment | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const handlePhotoAreaLayout = (e: LayoutChangeEvent) => {
    setPhotoWidth(e.nativeEvent.layout.width);
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !commentsLoaded) {
      setLoadingComments(true);
      api
        .getPostComments(item.id)
        .then((rows) => {
          setComments(rows);
          setCommentsLoaded(true);
        })
        .catch(() => Alert.alert("불러오기 실패", "댓글을 불러오지 못했어요."))
        .finally(() => setLoadingComments(false));
    }
  };

  const handleSubmitComment = async () => {
    if (!session) {
      Alert.alert("로그인이 필요해요", "댓글을 쓰려면 먼저 로그인해주세요.", [
        { text: "취소", style: "cancel" },
        { text: "로그인하러 가기", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!commentInput.trim()) {
      Alert.alert("댓글 내용을 입력해주세요.");
      return;
    }
    setSubmittingComment(true);
    try {
      const created = await api.createPostComment(item.id, commentInput.trim(), replyingTo?.id);
      setComments((prev) => [...prev, created]);
      setCommentCount((prev) => prev + 1);
      setCommentInput("");
      setReplyingTo(null);
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmittingComment(false);
    }
  };

  const topLevelComments = comments.filter((c) => !c.parent_comment_id);
  const repliesFor = (commentId: string) => comments.filter((c) => c.parent_comment_id === commentId);

  const renderComment = (comment: PostComment, isReply: boolean) => (
    <View key={comment.id} style={[styles.commentRow2, isReply && styles.replyRow]}>
      {comment.avatar_url ? (
        <Image source={{ uri: comment.avatar_url }} style={styles.commentAvatar} />
      ) : (
        <View style={styles.commentAvatarPlaceholder}>
          <Text style={styles.commentAvatarPlaceholderText}>{comment.username.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.commentHeaderRow}>
          <Text style={styles.commentAuthor}>{comment.username}</Text>
          {!isReply && (
            <TouchableOpacity onPress={() => setReplyingTo(comment)} hitSlop={8}>
              <Text style={styles.replyLink}>답글</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.commentBody}>{comment.body}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.card}>
      <View>
        {item.photo_urls.length > 0 && (
          <View onLayout={handlePhotoAreaLayout}>
            {photoWidth > 0 && (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {item.photo_urls.map((url) => (
                  <Image
                    key={url}
                    source={{ uri: url }}
                    style={{ width: photoWidth, height: photoWidth, backgroundColor: colors.background }}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}
        <View style={styles.cardContent}>
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
          </View>
          <Text style={styles.body} numberOfLines={4}>
            {item.body}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.commentToggleRow} onPress={toggleExpanded}>
        <ChatCircleTextIcon size={14} color={colors.textTertiary} weight="bold" />
        <Text style={styles.commentCount}>댓글 {commentCount}</Text>
        {expanded ? (
          <CaretUpIcon size={12} color={colors.textTertiary} weight="bold" />
        ) : (
          <CaretDownIcon size={12} color={colors.textTertiary} weight="bold" />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.commentsSection}>
          {loadingComments ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.sm }} />
          ) : topLevelComments.length === 0 ? (
            <Text style={styles.emptyCommentText}>아직 댓글이 없어요. 첫 댓글을 남겨보세요!</Text>
          ) : (
            topLevelComments.map((c) => (
              <View key={c.id}>
                {renderComment(c, false)}
                {repliesFor(c.id).map((r) => renderComment(r, true))}
              </View>
            ))
          )}

          {replyingTo && (
            <View style={styles.replyingToChip}>
              <Text style={styles.replyingToText}>{replyingTo.username}님에게 답글 남기는 중</Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
                <XIcon size={11} color={colors.primary} weight="bold" />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder={session ? "댓글을 남겨보세요" : "로그인 후 댓글을 남길 수 있어요."}
              placeholderTextColor={colors.textTertiary}
              value={commentInput}
              onChangeText={setCommentInput}
              editable={!!session}
              multiline
            />
            <TouchableOpacity
              style={[styles.commentSubmitButton, submittingComment && styles.commentSubmitButtonDisabled]}
              onPress={handleSubmitComment}
              disabled={submittingComment}
            >
              {submittingComment ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.commentSubmitText}>등록</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

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
      <Text style={styles.subtitle}>다른 사람들이 남긴 방문 여행지 이야기를 둘러보세요</Text>
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
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>아직 등록된 게시물이 없어요.</Text>
            <Text style={styles.emptyHint}>첫 게시물을 남겨보세요!</Text>
          </View>
        }
        renderItem={({ item }) => <PostCard item={item} colors={colors} styles={styles} />}
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
    headerRow: { paddingTop: spacing.xl - 4, paddingBottom: spacing.lg },
    title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
    subtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary },

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

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
      overflow: "hidden",
    },
    cardContent: { padding: spacing.md + 2 },
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
    body: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 20 },

    commentToggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md + 2,
      paddingBottom: spacing.md,
    },
    commentCount: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginRight: 2 },

    commentsSection: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.md + 2,
      paddingTop: spacing.sm + 2,
      paddingBottom: spacing.md,
      backgroundColor: colors.surfaceAlt,
    },
    emptyCommentText: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textTertiary, marginBottom: spacing.sm },

    commentRow2: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs + 2 },
    replyRow: { marginLeft: spacing.xl - 4, paddingVertical: 2 },
    commentAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primaryLight },
    commentAvatarPlaceholder: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    commentAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 10, fontFamily: fontFamily.bold },
    commentHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    commentAuthor: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.text },
    replyLink: { fontSize: 11, color: colors.primary, fontFamily: fontFamily.semiBold },
    commentBody: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 17, marginTop: 1 },

    replyingToChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      gap: spacing.xs + 2,
      marginTop: spacing.xs + 2,
      marginBottom: spacing.xs + 2,
    },
    replyingToText: { fontSize: 11, fontFamily: fontFamily.semiBold, color: colors.primary },
    commentInputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.xs + 2 },
    commentInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      fontSize: 12,
      fontFamily: fontFamily.regular,
      color: colors.text,
      maxHeight: 80,
    },
    commentSubmitButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      alignItems: "center",
      justifyContent: "center",
    },
    commentSubmitButtonDisabled: { opacity: 0.6 },
    commentSubmitText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 12 },
  });
}
