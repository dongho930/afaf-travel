import { usePathname, useRouter } from "expo-router";
import { CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { TAB_ROUTES, tabIndexOfPath } from "../constants/tabs";
import { ThemeColors } from "../constants/theme";
import { radius } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * PC 웹에서만 화면 좌우 가장자리에 나타나는 탭 이동 버튼입니다.
 *
 * 앱과 모바일 브라우저는 손가락으로 밀어서 탭을 넘길 수 있지만, PC는 마우스라
 * 미는 동작이 자연스럽지 않습니다(드래그로도 되긴 하지만 아무도 시도하지 않습니다).
 * 그래서 마우스가 화면 좌우 끝 가까이 가면 그쪽 방향 버튼이 스르륵 나타나고,
 * 누르면 옆 탭으로 넘어갑니다. 평소에는 보이지 않아 화면을 가리지 않습니다.
 *
 * 마우스가 없는 환경(휴대폰/태블릿 브라우저)에서는 아예 그리지 않습니다 —
 * 거기서는 밀어서 넘기면 되기 때문입니다.
 *
 * 버튼이 숨어 있는 동안 뒤쪽 내용을 클릭할 수 있어야 해서, 커서 위치는 화면에
 * 무언가를 덮어서 감지하지 않고 마우스 이동 이벤트로만 계산합니다.
 */

// 가장자리에서 이 거리(px) 안으로 커서가 들어오면 버튼이 나타납니다.
const EDGE_ZONE = 96;

function useHasMouse() {
  const [hasMouse, setHasMouse] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !window.matchMedia) return;
    // 마우스처럼 정밀하게 가리킬 수 있고 hover가 되는 기기인지 (터치 기기는 제외)
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    setHasMouse(query.matches);
    const onChange = (e: MediaQueryListEvent) => setHasMouse(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return hasMouse;
}

export function WebTabArrows() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const hasMouse = useHasMouse();
  const containerRef = useRef<View>(null);
  const [near, setNear] = useState<"left" | "right" | null>(null);

  const currentIndex = tabIndexOfPath(pathname);
  const prevTab = currentIndex > 0 ? TAB_ROUTES[currentIndex - 1] : null;
  const nextTab =
    currentIndex >= 0 && currentIndex < TAB_ROUTES.length - 1 ? TAB_ROUTES[currentIndex + 1] : null;

  useEffect(() => {
    if (!hasMouse || Platform.OS !== "web" || typeof window === "undefined") return;
    const onMove = (event: MouseEvent) => {
      // 웹에서 View의 ref는 실제 DOM 요소라 위치를 직접 잴 수 있습니다. 넓은 화면에서는
      // 내용이 가운데로 모이므로(WebFrame), 창이 아니라 이 영역의 좌우 끝을 기준으로 봅니다.
      const rect = (containerRef.current as unknown as HTMLElement | null)?.getBoundingClientRect?.();
      if (!rect) return;
      const inside = event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        setNear(null);
        return;
      }
      if (event.clientX >= rect.left && event.clientX < rect.left + EDGE_ZONE) setNear("left");
      else if (event.clientX <= rect.right && event.clientX > rect.right - EDGE_ZONE) setNear("right");
      else setNear(null);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [hasMouse]);

  // 탭 화면이 아니거나(관광지 상세 등) 마우스가 없으면 아무것도 그리지 않습니다.
  if (!hasMouse || currentIndex < 0) {
    return <View ref={containerRef} style={styles.container} pointerEvents="none" />;
  }

  return (
    <View ref={containerRef} style={styles.container} pointerEvents="box-none">
      <ArrowButton
        side="left"
        visible={near === "left" && !!prevTab}
        label={prevTab?.label}
        onPress={() => prevTab && router.push(prevTab.path)}
        styles={styles}
        colors={colors}
      />
      <ArrowButton
        side="right"
        visible={near === "right" && !!nextTab}
        label={nextTab?.label}
        onPress={() => nextTab && router.push(nextTab.path)}
        styles={styles}
        colors={colors}
      />
    </View>
  );
}

function ArrowButton({
  side,
  visible,
  label,
  onPress,
  styles,
  colors,
}: {
  side: "left" | "right";
  visible: boolean;
  label?: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  const Caret = side === "left" ? CaretLeftIcon : CaretRightIcon;

  return (
    <Animated.View
      style={[styles.arrowWrap, side === "left" ? styles.arrowLeft : styles.arrowRight, { opacity }]}
      // 숨어 있을 때는 뒤쪽 내용을 그대로 클릭할 수 있어야 합니다.
      pointerEvents={visible ? "auto" : "none"}
    >
      <Pressable
        style={({ pressed }) => [styles.arrowButton, pressed && styles.arrowButtonPressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label} 화면으로 이동` : "옆 화면으로 이동"}
      >
        <Caret size={20} color={colors.text} weight="bold" />
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject },
    arrowWrap: { position: "absolute", top: "50%", marginTop: -22 },
    arrowLeft: { left: 12 },
    arrowRight: { right: 12 },
    arrowButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      ...Platform.select({
        web: { boxShadow: "0 4px 14px rgba(0,0,0,0.16)" } as any,
        default: {},
      }),
    },
    arrowButtonPressed: { opacity: 0.7 },
  });
}
