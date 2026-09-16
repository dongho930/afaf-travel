import { useRouter } from "expo-router";
import { ImageSquareIcon, MagnifyingGlassIcon, XCircleIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnimatedChip } from "../components/AnimatedChip";
import { FadeImage } from "../components/FadeImage";
import { HorizontalScrollWeb } from "../components/HorizontalScrollWeb";
import { ScreenHeader } from "../components/ScreenHeader";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { api } from "../services/api";
import { useTheme } from "../services/ThemeContext";
import { Attraction } from "../types";

// 홈 탭의 인기 여행지와 같은 칩을 씁니다 — 두 화면에서 고르는 기준이 다르면
// 사용자가 같은 말을 두 번 배워야 합니다.
const CATEGORY_CHIPS = ["전체", "관광지", "문화시설", "레포츠", "숙박", "음식점"];
// 글자를 칠 때마다 조회하면 한 단어 치는 동안 대여섯 번이 나갑니다.
// 손이 멈춘 뒤 한 번만 보냅니다.
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * 여행지 직접 검색 화면.
 *
 * 홈 히어로의 검색창은 입력한 문장을 AI 플래너로 넘기는 입구라, "수원화성"처럼
 * 장소 이름을 아는 사람에게는 돌아가는 길이었습니다. 이 화면은 이름(또는 주소)으로
 * 바로 찾아 상세로 가는 지름길입니다.
 *
 * 검색은 서버의 경기도 목록 캐시에서 이뤄져서 공공데이터 API를 호출하지 않습니다.
 * 그래서 타자에 맞춰 여러 번 불러도 일일 트래픽 한도에 영향이 없습니다.
 */
export default function SearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [results, setResults] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(false);
  // 한 글자만 쳤을 때 "결과 없음"을 띄우지 않도록, 실제로 조회한 적이 있는지 기억합니다.
  const [searched, setSearched] = useState(false);
  // 늦게 도착한 옛 응답이 최신 결과를 덮어쓰지 않도록 요청마다 번호를 붙입니다.
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      api
        .searchAttractions(trimmed, category === "전체" ? null : category)
        .then((found) => {
          if (id !== requestId.current) return;
          setResults(found);
          setSearched(true);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setResults([]);
          setSearched(true);
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, category]);

  const openDetail = (place: Attraction) => {
    router.push({
      pathname: "/attraction-detail",
      params: { contentId: place.content_id, name: place.name },
    });
  };

  const renderItem = ({ item }: { item: Attraction }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openDetail(item)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        `${item.name}, ${item.category}` +
        (item.avg_rating != null ? `, 평점 ${item.avg_rating.toFixed(1)} 리뷰 ${item.review_count}개` : "") +
        (item.address ? `, ${item.address}` : "")
      }
      accessibilityHint="두 번 탭하면 상세 정보를 봅니다"
    >
      {item.image_url ? (
        <FadeImage source={{ uri: item.image_url }} style={styles.thumb} />
      ) : (
        // 사진이 없는 곳도 카드 높이가 흔들리지 않도록 같은 크기의 자리를 둡니다.
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <ImageSquareIcon size={20} color={colors.textTertiary} weight="light" />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.cardAddress} numberOfLines={1}>
          {item.address}
        </Text>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardCategory}>{item.category}</Text>
          {item.avg_rating != null && (
            <Text style={styles.cardRating}>
              ★ {item.avg_rating.toFixed(1)}
              <Text style={styles.cardReviewCount}> ({item.review_count})</Text>
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  const emptyMessage = () => {
    if (loading) return null;
    if (query.trim().length < MIN_QUERY_LENGTH) {
      return `여행지 이름이나 지역을 ${MIN_QUERY_LENGTH}글자 이상 입력해주세요.\n'수원 화성'처럼 띄어 써도 찾을 수 있어요.`;
    }
    if (searched && results.length === 0) {
      return "찾는 여행지가 없어요.\n이름의 일부만 넣거나 다른 카테고리로 바꿔보세요.";
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScreenHeader title="여행지 검색" style={styles.header} />

      <View style={styles.searchRow}>
        <MagnifyingGlassIcon size={18} color={colors.textTertiary} weight="bold" />
        <TextInput
          style={styles.input}
          placeholder="여행지 이름이나 지역으로 찾기"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="여행지 검색어 입력"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
            <XCircleIcon size={18} color={colors.textTertiary} weight="fill" />
          </Pressable>
        )}
      </View>

      <HorizontalScrollWeb contentContainerStyle={styles.chipRow}>
        {CATEGORY_CHIPS.map((chip) => (
          <AnimatedChip
            key={chip}
            selected={category === chip}
            onPress={() => setCategory(chip)}
            label={chip}
            style={styles.chip}
            textStyle={styles.chipText}
            backgroundColor={colors.surface}
            selectedBackgroundColor={colors.primary}
            borderColor={colors.border}
            selectedBorderColor={colors.primary}
            textColor={colors.textSecondary}
            selectedTextColor={colors.onPrimary}
          />
        ))}
      </HorizontalScrollWeb>

      {loading && <ActivityIndicator style={styles.loading} color={colors.primary} />}

      <FlatList
        data={results}
        keyExtractor={(item) => item.content_id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          emptyMessage() ? <Text style={styles.empty}>{emptyMessage()}</Text> : null
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.md },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.xl - 4,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
      height: 46,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    // 웹에서 <input>은 고유 최소 너비를 고집해서 옆 아이콘을 밀어냅니다(홈 검색창과 같은 처리).
    input: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: fontFamily.regular, color: colors.text },
    chipRow: { gap: spacing.sm, paddingHorizontal: spacing.xl - 4, paddingBottom: spacing.md },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.xs + 2,
    },
    chipText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
    loading: { marginBottom: spacing.sm },
    listContent: { paddingHorizontal: spacing.xl - 4, paddingBottom: spacing.xxl, gap: spacing.sm + 2 },
    card: {
      flexDirection: "row",
      gap: spacing.md,
      padding: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    thumb: { width: 78, height: 78, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    cardBody: { flex: 1, justifyContent: "center", gap: 3 },
    cardName: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
    cardAddress: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textSecondary },
    cardMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
    cardCategory: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.primary },
    cardRating: { fontSize: 12, fontFamily: fontFamily.semiBold, color: colors.text },
    cardReviewCount: { fontFamily: fontFamily.regular, color: colors.textTertiary },
    empty: {
      fontSize: 13,
      fontFamily: fontFamily.regular,
      color: colors.textTertiary,
      textAlign: "center",
      lineHeight: 20,
      marginTop: spacing.xxl,
    },
  });
}
