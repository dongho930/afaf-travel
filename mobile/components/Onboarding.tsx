import { useRouter } from "expo-router";
import {
  ChatsCircleIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  type Icon,
} from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { userTypeIcon } from "../constants/userTypeIcons";
import { EXAMPLE_QUERY_BY_TYPE, USER_TYPE_OPTIONS } from "../constants/userTypes";
import { useCourseContext } from "../services/CourseContext";
import { useOnboarding } from "../services/OnboardingContext";
import { storage } from "../services/storage";
import { useTheme } from "../services/ThemeContext";
import { USER_TYPE_LABELS, UserType } from "../types";

const PAGE_TITLES = ["경기포올 소개", "내 유형 고르기", "여행 만드는 방법", "시작하기"];
const INTRO_TYPES = ["wheelchair", "stroller", "senior", "pregnant", "visual", "hearing"] as const;

const MORE_FEATURES: { icon: Icon; title: string; desc: string }[] = [
  { icon: MagnifyingGlassIcon, title: "여행지 정보 확인", desc: "홈에서 검색하거나 인기 여행지를 눌러 편의시설·혼잡도·리뷰를 봐요." },
  { icon: MegaphoneIcon, title: "접근성 제보", desc: "가본 곳의 편의시설을 알려주면 다른 사람에게 큰 도움이 돼요." },
  { icon: ChatsCircleIcon, title: "게시물", desc: "여행 후기와 사진을 나누고 다른 사람의 이야기를 봐요." },
];

/**
 * 처음 실행할 때 보여주는 4장짜리 안내입니다 (언제 띄울지는 services/OnboardingContext).
 *   1 소개 → 2 내 유형 고르기(바로 저장) → 3 여행 만드는 방법 → 4 시작하기
 * 세부 조작은 각 화면에 처음 들어갈 때 도움말(components/FirstVisitTip)이 알려줍니다.
 *
 * 접근성: 저절로 넘어가지 않습니다(밀어서 넘기기와 '다음' 버튼 둘 다). 장이 바뀌면
 * 스크린리더에 "2/4, 내 유형 고르기"처럼 알려주고, '동작 줄이기'를 켠 사람에게는
 * 넘김 애니메이션을 뺍니다. 큰 글씨에서도 잘리지 않도록 각 장은 세로로 스크롤됩니다.
 */
export function Onboarding() {
  const { onboardingVisible } = useOnboarding();
  if (!onboardingVisible) return null;
  return <OnboardingPages />;
}

function OnboardingPages() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { finishOnboarding } = useOnboarding();
  const { userType, setUserType } = useCourseContext();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pagerRef = useRef<ScrollView>(null);
  const last = PAGE_TITLES.length - 1;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(`${page + 1}/${PAGE_TITLES.length}, ${PAGE_TITLES[page]}`);
  }, [page]);

  const goTo = (next: number) => {
    const target = Math.max(0, Math.min(last, next));
    setPage(target);
    pagerRef.current?.scrollTo({ x: target * width, animated: !reduceMotion });
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const current = Math.round(e.nativeEvent.contentOffset.x / width);
    if (current !== page) setPage(current);
  };

  const chooseType = (type: UserType) => {
    setUserType(type);
    storage.saveUserType(type).catch(() => {});
  };

  const handleLogin = () => {
    finishOnboarding();
    router.push("/login");
  };

  return (
    <View
      style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityViewIsModal
    >
      <View style={styles.topBar}>
        <View style={styles.dots} accessibilityLabel={`${page + 1}/${PAGE_TITLES.length}, ${PAGE_TITLES[page]}`}>
          {PAGE_TITLES.map((title, i) => (
            <View key={title} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {page < last && (
          <Pressable onPress={finishOnboarding} hitSlop={12} accessibilityRole="button" accessibilityLabel="안내 건너뛰기">
            <Text style={styles.skip}>건너뛰기</Text>
          </Pressable>
        )}
      </View>

      {width > 0 && (
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          style={styles.pager}
        >
          <Page width={width} styles={styles}>
            <Text style={styles.brand}>경기포올</Text>
            <Text style={styles.title} accessibilityRole="header">당신만을 위한{"\n"}여행 가이드</Text>
            <Text style={styles.body}>
              휠체어·유모차·어르신·임산부·시각·청각 장애가 있어도 편하게 다닐 수 있는 경기도 여행지를 찾고,
              코스까지 만들어 드려요.
            </Text>
            <View style={styles.introIcons} accessible={false}>
              {INTRO_TYPES.map((type) => {
                const TypeIcon = userTypeIcon[type];
                return (
                  <View key={type} style={styles.introIcon} importantForAccessibility="no-hide-descendants">
                    <TypeIcon size={22} color={colors.primary} weight="bold" />
                  </View>
                );
              })}
            </View>
          </Page>

          <Page width={width} styles={styles}>
            <Text style={styles.title} accessibilityRole="header">먼저 내 유형을{"\n"}골라주세요</Text>
            <Text style={styles.body}>
              추천과 코스가 이 기준으로 맞춰져요. 여러 가지에 해당하면 가장 중요한 한 가지를 골라주세요.
              AI 플래너 위쪽에서 언제든 바꿀 수 있어요.
            </Text>
            <View style={styles.typeList} accessibilityRole="radiogroup">
              {USER_TYPE_OPTIONS.map((opt) => {
                const selected = opt.type === userType;
                const TypeIcon = opt.icon;
                return (
                  <Pressable
                    key={opt.type}
                    onPress={() => chooseType(opt.type)}
                    style={[styles.typeRow, selected && styles.typeRowSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${USER_TYPE_LABELS[opt.type]}, ${opt.desc}`}
                  >
                    <TypeIcon size={22} color={colors.primary} weight="bold" />
                    <View style={styles.typeText}>
                      <Text style={styles.typeLabel}>{USER_TYPE_LABELS[opt.type]}</Text>
                      <Text style={styles.typeDesc}>{opt.desc}</Text>
                    </View>
                    {selected && <CheckCircleIcon size={22} color={colors.primary} weight="fill" />}
                  </Pressable>
                );
              })}
            </View>
          </Page>

          <Page width={width} styles={styles}>
            <Text style={styles.title} accessibilityRole="header">이렇게 여행을{"\n"}만들어요</Text>
            {[
              { title: "요청하기", desc: "AI 플래너에 원하는 여행을 문장으로 적거나 마이크로 말해요." },
              { title: "장소 고르기", desc: "추천된 장소 중 가고 싶은 곳을 체크해요. 새로고침하면 새 장소가 나와요." },
              { title: "코스 저장", desc: "방문 순서와 시간이 정해진 코스를 확인하고 '내 여행'에 저장해요." },
            ].map((step, i) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                  {i === 0 && (
                    <Text style={styles.example} accessibilityLabel={`예시: ${EXAMPLE_QUERY_BY_TYPE[userType]}`}>
                      “{EXAMPLE_QUERY_BY_TYPE[userType]}”
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </Page>

          <Page width={width} styles={styles}>
            <Text style={styles.title} accessibilityRole="header">이런 것도{"\n"}할 수 있어요</Text>
            {MORE_FEATURES.map((feature) => {
              const FeatureIcon = feature.icon;
              return (
                <View key={feature.title} style={styles.feature}>
                  <FeatureIcon size={24} color={colors.primary} weight="bold" />
                  <View style={styles.stepText}>
                    <Text style={styles.stepTitle}>{feature.title}</Text>
                    <Text style={styles.stepDesc}>{feature.desc}</Text>
                  </View>
                </View>
              );
            })}
            <Text style={styles.note}>접근성 제보와 게시물은 로그인 후 이용할 수 있어요.</Text>
          </Page>
        </ScrollView>
      )}

      <View style={styles.bottomBar}>
        {page < last ? (
          <>
            {page > 0 ? (
              <Pressable
                onPress={() => goTo(page - 1)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="이전"
              >
                <Text style={styles.secondaryText}>이전</Text>
              </Pressable>
            ) : (
              <View style={styles.flexSpacer} />
            )}
            <Pressable
              onPress={() => goTo(page + 1)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="다음"
            >
              <Text style={styles.primaryText}>다음</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={handleLogin}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="로그인하기"
            >
              <Text style={styles.secondaryText}>로그인</Text>
            </Pressable>
            <Pressable
              onPress={finishOnboarding}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="로그인 없이 둘러보기"
            >
              <Text style={styles.primaryText}>둘러보기</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function Page({
  width,
  styles,
  children,
}: {
  width: number;
  styles: ReturnType<typeof makeStyles>;
  children: React.ReactNode;
}) {
  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.background,
      zIndex: 100,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      minHeight: 48,
    },
    dots: { flexDirection: "row", gap: spacing.xs + 2 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
    dotActive: { width: 22, backgroundColor: colors.primary },
    skip: { fontSize: 15, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
    pager: { flex: 1 },
    page: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
    brand: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.primary },
    title: { fontSize: 26, lineHeight: 34, fontFamily: fontFamily.extraBold, color: colors.text },
    body: { fontSize: 15, lineHeight: 23, fontFamily: fontFamily.regular, color: colors.textSecondary },
    // 여섯 개가 좁은 폰(360px)에서도 한 줄에 들어가는 크기입니다.
    introIcons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm + 2, marginTop: spacing.md },
    introIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    typeList: { gap: spacing.sm },
    typeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    typeRowSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryLight },
    typeText: { flex: 1, gap: 2 },
    typeLabel: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
    typeDesc: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textSecondary },
    step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    stepNumber: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    stepNumberText: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.onPrimary },
    stepText: { flex: 1, gap: spacing.xs },
    stepTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.text },
    stepDesc: { fontSize: 14, lineHeight: 21, fontFamily: fontFamily.regular, color: colors.textSecondary },
    example: {
      marginTop: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      fontSize: 14,
      lineHeight: 21,
      fontFamily: fontFamily.medium,
      color: colors.text,
    },
    feature: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    note: { fontSize: 13, lineHeight: 19, fontFamily: fontFamily.regular, color: colors.textTertiary },
    bottomBar: {
      flexDirection: "row",
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    flexSpacer: { flex: 1 },
    primaryButton: {
      flex: 1,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.onPrimary },
    secondaryButton: {
      flex: 1,
      height: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: { fontSize: 16, fontFamily: fontFamily.semiBold, color: colors.text },
    pressed: { opacity: 0.85 },
  });
}
