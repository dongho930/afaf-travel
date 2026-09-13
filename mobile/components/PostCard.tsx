import { useRouter } from "expo-router";
import { CaretDownIcon, CaretUpIcon, ChatCircleTextIcon, XIcon } from "phosphor-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TextLayoutEventData,
  TouchableOpacity,
  View,
} from "react-native";
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

// 웹에서 본문이 잘렸는지 어림잡을 때 쓰는 한 줄당 글자 수. 카드 폭(모바일 기준)에
// 14px 글자가 대략 이만큼 들어갑니다. 네이티브는 실제 줄 수를 재므로 쓰이지 않습니다.
const _CHARS_PER_LINE = 22;

/**
 * 웹용 줄 수 어림값. react-native-web에는 onTextLayout이 없어서 실제 줄 수를 잴
 * 방법이 없습니다. 잘렸는데 '더보기'가 안 뜨는 쪽이 더 나쁘므로, 한 줄에 들어가는
 * 글자 수를 넉넉히 잡아(=줄 수를 크게 세어) 버튼이 빠지지 않도록 합니다.
 */
function estimateLineCount(text: string): number {
  return text
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / _CHARS_PER_LINE)), 0);
}

/**
 * 게시물 피드 카드(사진+글+댓글). 게시물 탭 피드와 '게시물 관리'의 팝업에서
 * 공통으로 씁니다. 댓글은 다른 화면으로 이동하지 않고, '댓글' 줄을 누르면
 * 카드 바로 아래에 펼쳐집니다(flat list + parent_comment_id 그룹핑 방식).
 *
 * bodyNumberOfLines를 주면 본문을 그 줄 수까지만 보여주고, 실제로 잘린 경우에만
 * '더보기'를 답니다(게시물 탭 피드). 값을 안 주면 지금까지처럼 전문이 보입니다
 * (게시물 관리 팝업, 관광지 상세의 게시물 팝업).
 *
 * 펼침 상태는 기본적으로 카드가 스스로 들고 있지만, bodyExpanded/onToggleBody를
 * 넘기면 부모가 대신 들고 있습니다. 긴 목록에서는 화면 밖으로 나간 카드가
 * 정리되면서 카드 안의 상태가 사라지기 때문에, 게시물 탭은 부모가 들고 있습니다.
 */
export function PostCard({
  item,
  bodyNumberOfLines,
  bodyExpanded,
  onToggleBody,
}: {
  item: PostItem;
  bodyNumberOfLines?: number;
  bodyExpanded?: boolean;
  onToggleBody?: () => void;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [photoWidth, setPhotoWidth] = useState(0);

  // 본문 접기/펼치기 (아래 expanded는 댓글 영역 토글이라 이름이 다릅니다).
  // 부모가 상태를 넘겨주면 그것을 따르고, 아니면 카드가 스스로 들고 있습니다.
  const [ownBodyExpanded, setOwnBodyExpanded] = useState(false);
  const isBodyExpanded = bodyExpanded ?? ownBodyExpanded;
  const toggleBody = onToggleBody ?? (() => setOwnBodyExpanded((prev) => !prev));
  // 네이티브에서 실제로 잰 본문 줄 수. null이면 아직 재기 전입니다.
  const [measuredLineCount, setMeasuredLineCount] = useState<number | null>(null);

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

  // 줄 수 제한이 걸린 화면(게시물 탭)에서만 접기/펼치기가 동작합니다.
  const clampLines = bodyNumberOfLines ?? 0;
  const isClampable = clampLines > 0;
  // 네이티브는 실제로 잰 값을, 웹은 어림값을 씁니다. 아직 재기 전(null)에는
  // 버튼을 띄우지 않습니다 — 잠깐 나타났다 사라지면 더 어수선합니다.
  const bodyLineCount =
    Platform.OS === "web" ? estimateLineCount(item.body) : measuredLineCount;
  const isTruncated = isClampable && (bodyLineCount ?? 0) > clampLines;

  const handleBodyTextLayout = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    setMeasuredLineCount(e.nativeEvent.lines.length);
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
          <Text style={styles.body} numberOfLines={isBodyExpanded ? undefined : bodyNumberOfLines}>
            {item.body}
          </Text>

          {/* 잘렸는지 알려면 줄 수 제한 없이 그린 높이를 재봐야 합니다. 눈에 보이지
              않게 겹쳐 그린 뒤 한 번 재고 나면 사라져서, 이후에는 비용이 없습니다.
              (웹은 onTextLayout이 없어 글자 수로 어림잡습니다) */}
          {isClampable && measuredLineCount === null && Platform.OS !== "web" && (
            <Text
              style={[styles.body, styles.bodyMeasure]}
              onTextLayout={handleBodyTextLayout}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {item.body}
            </Text>
          )}

          {isTruncated && (
            <TouchableOpacity
              onPress={toggleBody}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={isBodyExpanded ? "게시물 접기" : "게시물 전체 보기"}
            >
              <Text style={styles.moreButtonText}>{isBodyExpanded ? "접기" : "더보기"}</Text>
            </TouchableOpacity>
          )}
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
    // 줄 수를 재기 위해서만 그리는 사본 — 화면에는 보이지 않고 카드 높이에도
    // 영향을 주지 않도록 절대 위치로 겹쳐 둡니다.
    bodyMeasure: { position: "absolute", left: 0, right: 0, opacity: 0 },
    moreButtonText: {
      marginTop: spacing.xs,
      fontSize: 13,
      fontFamily: fontFamily.semiBold,
      color: colors.textSecondary,
    },

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
      // 웹에서 <input>이 고유 최소 너비 아래로 안 줄어들어 옆의 등록 버튼이
      // 밀려나는 것을 막습니다 (홈 화면 searchInput과 같은 이유).
      minWidth: 0,
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
