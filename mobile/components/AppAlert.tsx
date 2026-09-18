import {
  CheckCircleIcon,
  InfoIcon,
  LockIcon,
  QuestionIcon,
  TrashIcon,
  WarningIcon,
  type Icon,
} from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import {
  AlertButton,
  AlertIconName,
  AlertRequest,
  AlertTone,
  dismissAlert,
  subscribeToAlerts,
} from "../services/crossPlatformAlert";
import { useTheme } from "../services/ThemeContext";
import { useReduceMotion } from "../services/useReduceMotion";

const ICONS: Record<AlertIconName, Icon> = {
  check: CheckCircleIcon,
  info: InfoIcon,
  question: QuestionIcon,
  lock: LockIcon,
  trash: TrashIcon,
  alert: WarningIcon,
};

/**
 * 앱의 안내 창을 그리는 자리입니다. app/_layout.tsx에 한 번만 붙여두면,
 * 어느 화면에서 Alert.alert()를 부르든 여기서 받아 그립니다.
 *
 * 줄 서 있는 안내 중 맨 앞 하나만 보여주고, 닫히면 다음 것이 이어 뜹니다.
 */
export function AppAlertHost() {
  const [queue, setQueue] = useState<AlertRequest[]>([]);

  useEffect(() => subscribeToAlerts(setQueue), []);

  const current = queue[0] ?? null;
  // 창이 사라지는 동안(페이드 아웃)에도 내용이 남아 있어야 글자만 먼저 없어지고
  // 빈 상자가 접히는 모습이 보이지 않습니다.
  const lastRef = useRef<AlertRequest | null>(null);
  if (current) lastRef.current = current;

  return <AlertCard visible={!!current} request={current ?? lastRef.current} />;
}

function AlertCard({ visible, request }: { visible: boolean; request: AlertRequest | null }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start();
  }, [visible, request?.id, reduceMotion]);

  if (!request) return null;

  const IconComponent = ICONS[request.icon];
  const tone = toneColors(colors, request.tone);

  // 주요 동작을 위에 두고 '취소'는 맨 아래로 내립니다 — 엄지에서 가장 먼 자리가
  // 되돌아가는 버튼이어야 잘못 누르는 일이 적습니다.
  const cancelButton = request.buttons.find((b) => b.style === "cancel");
  const ordered = [
    ...request.buttons.filter((b) => b.style !== "cancel"),
    ...request.buttons.filter((b) => b.style === "cancel"),
  ];

  const press = (button: AlertButton) => {
    // 먼저 닫아야, 이어서 또 다른 안내를 띄우는 동작(예: 삭제 실패)이
    // 이 창 뒤로 줄을 서서 순서대로 보입니다.
    dismissAlert(request.id);
    button.onPress?.();
  };

  // 안드로이드 뒤로 가기 — 취소 버튼이 있으면 그걸 누른 것으로, 없으면 그냥
  // 닫습니다(운영체제 기본 창과 같은 동작이라 사용자가 갇히지 않습니다).
  const handleRequestClose = () => {
    if (cancelButton) press(cancelButton);
    else dismissAlert(request.id);
  };

  // 바깥을 눌렀을 때는 취소가 있을 때만 닫습니다. 버튼이 하나뿐인 안내는
  // 스치듯 누른 손가락에 내용이 사라지지 않게 그대로 둡니다.
  const handleBackdropPress = () => {
    if (cancelButton) press(cancelButton);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
      <Pressable
        style={styles.backdrop}
        onPress={handleBackdropPress}
        accessibilityViewIsModal
        // 배경은 닫기 수단일 뿐이라 스크린리더가 따로 읽지 않게 합니다.
        importantForAccessibility="no"
      >
        <Animated.View
          style={[
            styles.card,
            {
              opacity: progress,
              transform: [
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {/* 카드 안쪽을 눌렀을 때 배경의 닫기가 같이 실행되지 않게 막습니다.
              웹에서는 onPress가 DOM click이라 바깥까지 타고 올라가므로,
              다른 시트들과 같은 방식으로 여기서 전파를 끊습니다. */}
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.cardInner}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View
                style={[styles.badge, { backgroundColor: tone.background }]}
                // 아이콘은 제목·내용과 같은 뜻을 색과 모양으로 한 번 더 말해주는
                // 장식이라, 스크린리더에서는 건너뜁니다.
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
              >
                <IconComponent size={26} color={tone.foreground} weight="regular" />
              </View>

              <Text style={styles.title}>{request.title}</Text>
              {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
            </ScrollView>

            <View style={styles.buttonColumn}>
              {ordered.map((button, index) => (
                <AlertActionButton
                  key={`${button.text ?? "확인"}-${index}`}
                  button={button}
                  // 채운 초록 버튼은 하나뿐이어야 어디를 눌러야 할지가 분명합니다.
                  emphasized={index === 0 && button.style !== "cancel"}
                  colors={colors}
                  styles={styles}
                  onPress={() => press(button)}
                />
              ))}
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function AlertActionButton({
  button,
  emphasized,
  colors,
  styles,
  onPress,
}: {
  button: AlertButton;
  emphasized: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const isCancel = button.style === "cancel";
  const isDestructive = button.style === "destructive";
  const label = button.text ?? "확인";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        isDestructive
          ? styles.buttonDestructive
          : isCancel
            ? styles.buttonCancel
            : emphasized
              ? styles.buttonPrimary
              : styles.buttonNeutral,
        pressed && (isCancel ? styles.buttonCancelPressed : styles.buttonFilledPressed),
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={[
          styles.buttonText,
          isCancel
            ? { color: colors.textSecondary, fontFamily: fontFamily.semiBold }
            : isDestructive || emphasized
              ? // 초록·빨강 어느 쪽이든 그 배경 위에서 대비를 지키는 색입니다.
                // 다크 모드의 danger(#E17C6E)는 밝아서 흰 글자면 대비가 2.7:1까지
                // 떨어집니다 — onPrimary(짙은 색)를 쓰면 8:1을 넘깁니다.
                { color: colors.onPrimary }
              : { color: colors.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function toneColors(colors: ThemeColors, tone: AlertTone) {
  if (tone === "danger") return { foreground: colors.danger, background: colors.dangerLight };
  if (tone === "warning") return { foreground: colors.warning, background: colors.warningLight };
  return { foreground: colors.primary, background: colors.primaryLight };
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xl + 4,
    },
    card: {
      width: "100%",
      // 태블릿·PC 웹에서 창이 화면 폭만큼 늘어나지 않게 잡아둡니다.
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: radius.xl + 4,
      // 화면 배경 위에 확실히 떠 보이도록, 카드보다 한 단계 깊은 그림자를 씁니다.
      ...Platform.select({
        web: { boxShadow: "0 10px 30px rgba(0,0,0,0.18)" } as any,
        default: {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 12,
        },
      }),
    },
    cardInner: {
      paddingTop: spacing.xl + 4,
      paddingHorizontal: spacing.xl - 2,
      paddingBottom: spacing.xl - 4,
    },
    // 안내문이 아주 길어도(서버가 보낸 오류 원문 등) 버튼이 화면 밖으로 밀리지
    // 않도록, 글 영역만 접어서 스크롤되게 합니다.
    scroll: { maxHeight: 320, flexGrow: 0 },
    scrollContent: { alignItems: "center" },
    badge: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontSize: 17,
      fontFamily: fontFamily.extraBold,
      color: colors.text,
      lineHeight: 24,
      marginTop: spacing.lg,
      textAlign: "center",
    },
    message: {
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: colors.textSecondary,
      lineHeight: 21,
      marginTop: spacing.sm,
      textAlign: "center",
    },
    buttonColumn: { marginTop: spacing.xl - 2, gap: spacing.sm },
    button: {
      height: 48,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    buttonPrimary: { backgroundColor: colors.primary },
    buttonDestructive: { backgroundColor: colors.danger },
    // 강조 버튼이 따로 있을 때의 나머지 실행 버튼 (SegmentedButtonGroup과 같은 중립색)
    buttonNeutral: { backgroundColor: `${colors.textTertiary}24` },
    buttonCancel: { backgroundColor: "transparent" },
    buttonFilledPressed: { opacity: 0.8 },
    buttonCancelPressed: { backgroundColor: `${colors.textTertiary}24` },
    buttonText: { fontSize: 15, fontFamily: fontFamily.bold },
  });
}
