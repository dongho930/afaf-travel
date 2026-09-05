import { useRouter } from "expo-router";
import { CaretDownIcon, CaretUpIcon, ChatCircleTextIcon, XIcon } from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { Alert } from "../services/crossPlatformAlert";
import { useTheme } from "../services/ThemeContext";
import { PostComment, PostItem } from "../types";
import { FadeImage } from "./FadeImage";
import { PhotoCarousel } from "./PhotoCarousel";

/**
 * 게시물 피드 카드(사진+글+댓글). 게시물 탭 피드와 '게시물 관리'의 팝업에서
 * 공통으로 씁니다. 댓글은 다른 화면으로 이동하지 않고, '댓글' 줄을 누르면
 * 카드 바로 아래에 펼쳐집니다(flat list + parent_comment_id 그룹핑 방식).
 */
export function PostCard({ item, bodyNumberOfLines }: { item: PostItem; bodyNumberOfLines?: number }) {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

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
        <FadeImage source={{ uri: comment.avatar_url }} style={styles.commentAvatar} />
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
              <PhotoCarousel pageWidth={photoWidth} pageCount={item.photo_urls.length}>
                {item.photo_urls.map((url) => (
                  <FadeImage
                    key={url}
                    source={{ uri: url }}
                    style={{ width: photoWidth, height: photoWidth, backgroundColor: colors.background }}
                  />
                ))}
              </PhotoCarousel>
            )}
          </View>
        )}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            {item.avatar_url ? (
              <FadeImage source={{ uri: item.avatar_url }} style={styles.avatar} />
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
          <Text style={styles.body} numberOfLines={bodyNumberOfLines}>
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
