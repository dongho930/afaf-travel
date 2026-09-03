import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { XIcon } from "phosphor-react-native";
import React, { useCallback, useState } from "react";
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
import { PostComment, PostItem } from "../types";

/**
 * 여행기록 게시물 상세 + 댓글/답글(1단계) 화면.
 *
 * 댓글은 GET /api/posts/{postId}/comments에서 flat list로 받아서, 여기서
 * parent_comment_id 기준으로 최상위 댓글/답글을 묶습니다. '답글' 버튼은
 * 최상위 댓글에만 보여줘서(답글에는 답글 불가), 서버 검증과 이중으로
 * 1단계 제한을 지킵니다.
 */
export default function PostDetailScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [post, setPost] = useState<PostItem | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);

  const [commentInput, setCommentInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<PostComment | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const load = useCallback(() => {
    if (!postId) return;
    setLoading(true);
    Promise.all([api.getPost(postId), api.getPostComments(postId)])
      .then(([p, c]) => {
        setPost(p);
        setComments(c);
      })
      .catch(() => Alert.alert("불러오기 실패", "여행기록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDeletePost = () => {
    if (!postId) return;
    Alert.alert("게시물을 삭제할까요?", "삭제하면 되돌릴 수 없어요.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deletePost(postId);
            router.back();
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  const handleDeleteComment = (commentId: string) => {
    Alert.alert("댓글을 삭제할까요?", "답글이 있다면 함께 삭제됩니다.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deletePostComment(commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_comment_id !== commentId));
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          }
        },
      },
    ]);
  };

  const handleSubmitComment = async () => {
    if (!postId) return;
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
      const created = await api.createPostComment(postId, commentInput.trim(), replyingTo?.id);
      setComments((prev) => [...prev, created]);
      setCommentInput("");
      setReplyingTo(null);
    } catch (err) {
      Alert.alert("등록 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>게시물을 찾을 수 없어요.</Text>
      </View>
    );
  }

  const topLevelComments = comments.filter((c) => !c.parent_comment_id);
  const repliesFor = (commentId: string) => comments.filter((c) => c.parent_comment_id === commentId);

  const renderComment = (comment: PostComment, isReply: boolean) => (
    <View key={comment.id} style={[styles.commentRow, isReply && styles.replyRow]}>
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
          <View style={styles.commentActionsRow}>
            {!isReply && (
              <TouchableOpacity onPress={() => setReplyingTo(comment)} hitSlop={8}>
                <Text style={styles.replyLink}>답글</Text>
              </TouchableOpacity>
            )}
            {comment.is_mine && (
              <TouchableOpacity onPress={() => handleDeleteComment(comment.id)} hitSlop={8}>
                <Text style={styles.deleteLink}>삭제</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.commentBody}>{comment.body}</Text>
      </View>
    </View>
  );

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          onPress={() =>
            router.push({ pathname: "/attraction-detail", params: { contentId: post.content_id, name: post.place_name } })
          }
        >
          <Text style={styles.placeName}>{post.place_name}</Text>
        </TouchableOpacity>

        <View style={styles.authorRow}>
          {post.avatar_url ? (
            <Image source={{ uri: post.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarPlaceholderText}>{post.username.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.username}>{post.username}</Text>
          {post.is_mine && (
            <TouchableOpacity onPress={handleDeletePost} hitSlop={8} style={{ marginLeft: "auto" }}>
              <Text style={styles.deleteLink}>삭제</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.body}>{post.body}</Text>

        {post.photo_urls.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
            {post.photo_urls.map((url) => (
              <Image key={url} source={{ uri: url }} style={styles.photo} />
            ))}
          </ScrollView>
        )}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>댓글 {comments.length}</Text>
        {topLevelComments.length === 0 ? (
          <Text style={styles.emptyCommentText}>아직 댓글이 없어요. 첫 댓글을 남겨보세요!</Text>
        ) : (
          topLevelComments.map((c) => (
            <View key={c.id}>
              {renderComment(c, false)}
              {repliesFor(c.id).map((r) => renderComment(r, true))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.commentInputBar}>
        {replyingTo && (
          <View style={styles.replyingToChip}>
            <Text style={styles.replyingToText}>{replyingTo.username}님에게 답글 남기는 중</Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
              <XIcon size={12} color={colors.primary} weight="bold" />
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
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.textTertiary },
    container: { padding: spacing.xl - 4, paddingBottom: spacing.xxl },

    placeName: { fontSize: 20, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.md },
    authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
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
    username: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
    deleteLink: { fontSize: 13, color: colors.danger, fontFamily: fontFamily.semiBold },

    body: { fontSize: 15, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 22, marginBottom: spacing.md },
    photoRow: { marginBottom: spacing.md },
    photo: { width: 140, height: 140, borderRadius: radius.md, marginRight: spacing.sm, backgroundColor: colors.background },

    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
    sectionTitle: { fontSize: 15, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.md },
    emptyCommentText: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textTertiary },

    commentRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm + 2 },
    replyRow: { marginLeft: spacing.xl, paddingVertical: spacing.xs + 2 },
    commentAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryLight },
    commentAvatarPlaceholder: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    commentAvatarPlaceholderText: { color: colors.onPrimary, fontSize: 11, fontFamily: fontFamily.bold },
    commentHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    commentAuthor: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
    commentActionsRow: { flexDirection: "row", gap: spacing.md },
    replyLink: { fontSize: 12, color: colors.primary, fontFamily: fontFamily.semiBold },
    commentBody: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 19, marginTop: 2 },

    commentInputBar: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md + 2,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    replyingToChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      gap: spacing.xs + 2,
      marginBottom: spacing.xs + 2,
    },
    replyingToText: { fontSize: 11, fontFamily: fontFamily.semiBold, color: colors.primary },
    commentInputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    commentInput: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 13,
      fontFamily: fontFamily.regular,
      color: colors.text,
      maxHeight: 90,
    },
    commentSubmitButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
      justifyContent: "center",
    },
    commentSubmitButtonDisabled: { opacity: 0.6 },
    commentSubmitText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 13 },
  });
}
