import { useIsFocused } from "@react-navigation/native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, ImageStyle, StyleProp } from "react-native";
import { useReduceMotion } from "../services/useReduceMotion";

const SWAP_INTERVAL_MS = 3000;
const FADE_DURATION_MS = 900;

/**
 * 홈 화면 상단 배너의 배경 사진입니다. 3초마다 후보 중 하나를 다시 골라
 * 크로스페이드로 바꿉니다 — 지금 보이지 않는(opacity 0) 레이어에 다음 사진을
 * 미리 얹어두고 두 레이어의 opacity를 서로 반대로 움직여서 깜빡임이 없습니다.
 *
 * 이 동작이 홈 화면 본체에 있을 때는 3초마다 setState가 돌면서 여행지 카드
 * 수십 장을 포함한 화면 전체가 통째로 다시 그려졌습니다(탭을 떠나 있어도
 * 계속). 바뀌는 건 이 배경뿐이므로, 상태와 타이머를 여기 안에 가둬서 다시
 * 그려지는 범위를 배경 두 장으로 좁혔습니다.
 */
export function HeroBackdrop({
  imageUrls,
  style,
}: {
  imageUrls: string[];
  style: StyleProp<ImageStyle>;
}) {
  const isFocused = useIsFocused();
  const reduceMotion = useReduceMotion();

  const [layers, setLayers] = useState<{ a: string | null; b: string | null; visible: "a" | "b" }>({
    a: null,
    b: null,
    visible: "a",
  });
  // 타이머 안에서 지금 상태를 읽어야 하는데, 상태를 의존성에 넣으면 사진이 바뀔
  // 때마다 타이머가 새로 걸립니다. 값만 따로 들고 참조합니다.
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const opacityA = useRef(new Animated.Value(1)).current;
  const opacityB = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);

  // 첫 사진을 얹습니다. 배너 전체가 한 번에 나타나므로(홈 화면의 heroContentOpacity)
  // 이 레이어는 처음부터 보이는 상태로 둡니다 — 안 그러면 배너가 뜬 뒤 사진이
  // 한 번 더 페이드인되어 두 단계로 나뉘어 보입니다.
  useEffect(() => {
    if (startedRef.current || imageUrls.length === 0) return;
    startedRef.current = true;
    opacityA.setValue(1);
    opacityB.setValue(0);
    setLayers({ a: imageUrls[Math.floor(Math.random() * imageUrls.length)], b: null, visible: "a" });
  }, [imageUrls, opacityA, opacityB]);

  useEffect(() => {
    if (imageUrls.length <= 1) return;
    // 다른 탭을 보고 있는 동안에는 돌릴 이유가 없습니다 — 탭 화면은 살아있어서
    // 예전에는 보이지도 않는 배경을 계속 바꾸며 배터리와 프레임을 썼습니다.
    if (!isFocused) return;
    // '동작 줄이기'를 켠 기기에서는 사진을 바꾸지 않고 한 장으로 둡니다.
    if (reduceMotion) return;

    const timer = setInterval(() => {
      const prev = layersRef.current;
      const currentUrl = prev.visible === "a" ? prev.a : prev.b;
      // 바로 직전 사진은 후보에서 빼서 같은 사진이 연달아 나오지 않게 합니다.
      const pool = imageUrls.filter((url) => url !== currentUrl);
      if (pool.length === 0) return;

      const nextUrl = pool[Math.floor(Math.random() * pool.length)];
      const nextLayer: "a" | "b" = prev.visible === "a" ? "b" : "a";
      const fadeOut = prev.visible === "a" ? opacityA : opacityB;
      const fadeIn = nextLayer === "a" ? opacityA : opacityB;

      setLayers({ ...prev, [nextLayer]: nextUrl, visible: nextLayer });
      Animated.parallel([
        Animated.timing(fadeOut, { toValue: 0, duration: FADE_DURATION_MS, useNativeDriver: true }),
        Animated.timing(fadeIn, { toValue: 1, duration: FADE_DURATION_MS, useNativeDriver: true }),
      ]).start();
    }, SWAP_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [imageUrls, isFocused, reduceMotion, opacityA, opacityB]);

  return (
    <>
      <Animated.Image
        source={layers.a ? { uri: layers.a } : undefined}
        style={[style, { opacity: opacityA }]}
        resizeMode="cover"
        // 3초마다 바뀌는 배경 장식이라, 스크린리더에는 방해만 됩니다.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      />
      <Animated.Image
        source={layers.b ? { uri: layers.b } : undefined}
        style={[style, { opacity: opacityB }]}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      />
    </>
  );
}
