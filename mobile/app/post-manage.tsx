import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { ChatCircleTextIcon, TrashIcon, XIcon } from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { PostCard } from "../components/PostCard";
import { Alert } from "../services/crossPlatformAlert";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useTheme } from "../services/ThemeContext";
import { PostItem } from "../types";

/**
 * '게시물 관리' 화면. 내가 작성한 게시물만 한눈에 모아 보고 삭제할 수
 * 있습니다. 게시물을 누르면 피드 카드와 같은 모습(사진/글/댓글)을 팝업으로
 * 보여줍니다. 본인 게시물 삭제는 이 화면 목록에서 합니다.
 */
export default function PostManageScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingPost, setViewingPost] = useState<PostItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getMyPosts()
      .then(setPosts)
      .catch((err) => Alert.alert("불러오기 실패", "내 게시물을 불러오지 못했어요.\n" + String(err)))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDelete = (postId: string, onDeleted?: () => void) => {
    Alert.alert("게시물을 삭제할까요?", "삭제하면 댓글과 함께 되돌릴 수 없어요.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          setDeletingId(postId);
          try {
            await api.deletePost(postId);
            setPosts((prev) => prev.filter((p) => p.id !== postId));
            onDeleted?.();
          } catch (err) {
            Alert.alert("삭제 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={posts}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>아직 작성한 게시물이 없어요.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.emptyHint}>게시물 피드로 돌아가서 첫 게시물을 남겨보세요!</Text>
          </TouchableOpacity>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.row} onPress={() => setViewingPost(item)} activeOpacity={0.7}>
          {item.photo_urls.length > 0 ? (
            <Image source={{ uri: item.photo_urls[0] }} style={styles.thumb} />
          ) : (
            <View style={styles.thumbPlaceholder} />
          )}
          <View style={styles.rowContent}>
            <Text style={styles.placeName} numberOfLines={1}>
              {item.place_name}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
            <View style={styles.metaRow}>
              <ChatCircleTextIcon size={12} color={colors.textTertiary} weight="bold" />
              <Text style={styles.metaText}>댓글 {item.comment_count}</Text>
              <Text style={styles.metaText}>· {item.created_at?.slice(0, 10)}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(item.id)}
            disabled={deletingId === item.id}
            hitSlop={8}
          >
            {deletingId === item.id ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <TrashIcon size={18} color={colors.danger} weight="bold" />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    />

      <Modal
        visible={!!viewingPost}
        animationType="slide"
        transparent
        onRequestClose={() => setViewingPost(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>게시물</Text>
              <View style={styles.modalHeaderActions}>
                <TouchableOpacity
                  onPress={() => viewingPost && handleDelete(viewingPost.id, () => setViewingPost(null))}
                  disabled={!!viewingPost && deletingId === viewingPost.id}
                  hitSlop={10}
                >
                  {viewingPost && deletingId === viewingPost.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <TrashIcon size={18} color={colors.danger} weight="bold" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setViewingPost(null)} hitSlop={10}>
                  <XIcon size={18} color={colors.text} weight="bold" />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {viewingPost && <PostCard item={viewingPost} />}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: spacing.xl - 4 },
    emptyBox: { alignItems: "center", padding: spacing.xl },
    emptyText: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.textSecondary, marginBottom: spacing.xs + 2 },
    emptyHint: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.primary, textAlign: "center" },

    row: {
      flexDirection: "row",
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      alignItems: "center",
    },
    thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.background },
    thumbPlaceholder: {
      width: 56,
      height: 56,
      borderRadius: radius.sm,
      backgroundColor: colors.primaryLight,
    },
    rowContent: { flex: 1, minWidth: 0 },
    placeName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.text },
    body: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
    metaText: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary },
    deleteButton: { padding: spacing.xs + 2 },

    modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
    modalSheet: {
      width: "100%",
      maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
      backgroundColor: colors.surfaceAlt,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xl - 4,
      maxHeight: "85%",
    },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
    modalTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
    modalHeaderActions: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  });
}
