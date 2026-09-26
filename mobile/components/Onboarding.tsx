import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { CheckCircleIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { USER_TYPE_OPTIONS } from "../constants/userTypes";
import { useCourseContext } from "../services/CourseContext";
import { useOnboarding } from "../services/OnboardingContext";
import { storage } from "../services/storage";
import { useTheme } from "../services/ThemeContext";
import { USER_TYPE_LABELS, UserType } from "../types";

// 화면 캡처(assets/onboarding)는 웹 버전을 390×844 크기로 띄워 찍었습니다. 아래 표시
// 위치(rect: x, y, 너비, 높이)도 그 크기 기준 좌표라, 캡처를 다시 찍으면 함께 다시 재야 합니다.
const SHOT_WIDTH = 390;
const SHOT_HEIGHT = 844;

type Rect = [number, number, number, number];
type GuidePage = {
  title: string;
  image: ImageSourcePropType;
  /** 스크린리더용 — 캡처를 볼 수 없는 사람에게 화면 구성을 말로 알려줍니다. */
  imageLabel: string;
  steps: { rect: Rect; text: string }[];
};

const GUIDE_PAGES: GuidePage[] = [
  {
    title: "AI 플래너 탭에서 시작해요",
    image: require("../assets/onboarding/home.webp"),
    imageLabel: "홈 화면. 맨 아래에 접근성, AI 플래너, 홈, 게시물, 내 여행 탭이 있어요.",
    steps: [{ rect: [78, 788, 78, 56], text: "화면 아래 'AI 플래너' 탭을 눌러요." }],
  },
  {
    title: "원하는 여행을 요청해요",
    image: require("../assets/onboarding/planner.webp"),
    imageLabel: "AI 플래너 화면. 위에서부터 접근성 유형, 지역과 방문일, 요청 입력칸, 음성 버튼, AI 경로 생성하기 버튼이 있어요.",
    steps: [
      { rect: [16, 56, 358, 140], text: "접근성 유형이 맞는지 확인해요." },
      { rect: [24, 309, 342, 100], text: "지역과 방문일을 골라요. 비워둬도 돼요." },
      { rect: [24, 479, 342, 210], text: "원하는 여행을 적거나 '눌러서 음성으로 말하기'로 말해요." },
      { rect: [24, 709, 342, 51], text: "'AI 경로 생성하기'를 눌러요." },
    ],
  },
  {
    title: "가고 싶은 곳을 골라요",
    image: require("../assets/onboarding/select.webp"),
    imageLabel: "장소 선택 화면. 추천된 장소 카드가 있고, 아래에 새로고침과 코스 만들기 버튼이 있어요.",
    steps: [
      { rect: [20, 196, 350, 414], text: "가고 싶은 장소 카드를 눌러 체크해요." },
      { rect: [20, 712, 96, 52], text: "마음에 드는 곳이 없으면 '새로고침'을 눌러요. 고른 곳은 남고 새 장소가 나와요." },
      { rect: [124, 712, 246, 52], text: "'N곳 코스 만들기'를 눌러요." },
    ],
  },
  {
    title: "코스를 확인하고 저장해요",
    image: require("../assets/onboarding/results.webp"),
    imageLabel: "추천 코스 화면. 장소별 도착 시각과 순서 바꾸기 화살표가 있고, 아래에 지도로 전체 보기와 저장 버튼이 있어요.",
    steps: [
      {
        rect: [332, 264, 44, 272],
        text: Platform.OS === "web"
          ? "오른쪽 화살표로 방문 순서를 바꿀 수 있어요."
          : "오른쪽 화살표를 누르거나 카드를 길게 눌러 끌어서 순서를 바꿀 수 있어요.",
      },
      { rect: [20, 712, 212, 52], text: "'지도로 전체 보기'로 동선을 확인해요." },
      { rect: [322, 712, 48, 52], text: "'저장'을 누르면 '내 여행'에 담겨요." },
    ],
  },
  {
    title: "이것도 할 수 있어요",
    image: require("../assets/onboarding/home.webp"),
    imageLabel: "홈 화면. 오른쪽 아래에 돋보기 모양 검색 버튼이, 맨 아래에 접근성과 게시물 탭이 있어요.",
    steps: [
      { rect: [306, 708, 64, 64], text: "돋보기 버튼으로 여행지를 이름으로 찾아요." },
      { rect: [0, 788, 78, 56], text: "'접근성' 탭에서 가본 곳의 편의시설을 제보해요." },
      { rect: [234, 788, 78, 56], text: "'게시물' 탭에서 여행 후기와 사진을 나눠요." },
    ],
  },
];

const PAGE_TITLES = ["내 유형 고르기", ...GUIDE_PAGES.map((page) => page.title)];

/**
 * 처음 실행할 때 보여주는 사용법 안내입니다 (언제 띄울지는 services/OnboardingContext).
 *   1 소개 + 내 유형 고르기(바로 저장)
 *   2~6 실제 화면 캡처 위에 눌러야 할 곳을 번호로 표시하고, 아래에 같은 번호로 설명합니다.
 *
 * 접근성: 저절로 넘어가지 않습니다(밀어서 넘기기와 '다음' 버튼 둘 다). 장이 바뀌면
 * 스크린리더에 "2/6, …"처럼 알려주고, 캡처에는 화면 구성을 말로 풀어 붙였습니다.
 * '동작 줄이기'를 켠 사람에게는 넘김 애니메이션을 빼고, 큰 글씨에서도 잘리지 않도록
 * 각 장은 세로로 스크롤됩니다.
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
  const { height: windowHeight } = useWindowDimensions();
  const { finishOnboarding } = useOnboarding();
  const { userType, setUserType } = useCourseContext();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pagerRef = useRef<ScrollView>(null);
  const last = PAGE_TITLES.length - 1;
  // 캡처는 화면 높이의 절반쯤으로 둡니다 — 아래 설명이 스크롤 없이 함께 보이게.
  const shotHeight = Math.min(windowHeight * 0.5, 440);
  const shotWidth = Math.min(shotHeight * (SHOT_WIDTH / SHOT_HEIGHT), Math.max(width - spacing.xl * 2, 0));

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
            <Text style={styles.brand}>경기포올 · 당신만을 위한 여행 가이드</Text>
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

          {GUIDE_PAGES.map((guide, pageIndex) => (
            <Page key={guide.title} width={width} styles={styles}>
              <Text style={styles.title} accessibilityRole="header">{guide.title}</Text>
              <Screenshot guide={guide} width={shotWidth} styles={styles} />
              <View style={styles.stepList}>
                {guide.steps.map((step, i) => (
                  <View key={step.text} style={styles.step}>
                    <StepBadge number={i + 1} styles={styles} />
                    <Text style={styles.stepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
              {pageIndex === GUIDE_PAGES.length - 1 && (
                <Text style={styles.note}>접근성 제보와 게시물은 로그인 후 이용할 수 있어요.</Text>
              )}
            </Page>
          ))}
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

/** 캡처 한 장과, 그 위에 눌러야 할 곳을 감싸는 테두리·번호. */
function Screenshot({
  guide,
  width,
  styles,
}: {
  guide: GuidePage;
  width: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const scale = width / SHOT_WIDTH;
  const height = SHOT_HEIGHT * scale;
  return (
    <View
      style={[styles.shotFrame, { width, height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={guide.imageLabel}
    >
      <Image source={guide.image} style={{ width, height }} contentFit="cover" />
      {guide.steps.map(({ rect: [x, y, w, h] }, i) => {
        const left = x * scale;
        const top = y * scale;
        return (
          <React.Fragment key={i}>
            <View style={[styles.ring, { left, top, width: w * scale, height: h * scale }]} />
            <View style={[styles.ringBadge, { left: Math.max(left - 10, 2), top: Math.max(top - 10, 2) }]}>
              <Text style={styles.ringBadgeText}>{i + 1}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function StepBadge({ number, styles }: { number: number; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stepNumber}>
      <Text style={styles.stepNumberText}>{number}</Text>
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
    page: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
    brand: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.primary },
    title: { fontSize: 24, lineHeight: 32, fontFamily: fontFamily.extraBold, color: colors.text },
    body: { fontSize: 15, lineHeight: 23, fontFamily: fontFamily.regular, color: colors.textSecondary },
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
    shotFrame: {
      alignSelf: "center",
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      backgroundColor: colors.surfaceAlt,
    },
    ring: {
      position: "absolute",
      borderWidth: 2.5,
      borderColor: colors.primary,
      borderRadius: radius.sm,
      backgroundColor: "rgba(46, 125, 91, 0.10)",
    },
    ringBadge: {
      position: "absolute",
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    ringBadgeText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.onPrimary },
    stepList: { gap: spacing.md },
    step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    stepNumber: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    stepNumberText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.onPrimary },
    stepText: { flex: 1, fontSize: 15, lineHeight: 22, fontFamily: fontFamily.medium, color: colors.text },
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
