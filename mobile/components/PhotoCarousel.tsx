import { CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import React, { useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

/**
 * 사진이 여러 장일 때 옆으로 넘기는(스와이프) 가로 캐러셀입니다.
 * 터치 기기(폰/태블릿)에서는 손가락 스와이프로 자연스럽게 넘어가지만,
 * PC 웹에서는 마우스로 스와이프 제스처를 할 수 없어서(스크롤바도
 * showsHorizontalScrollIndicator={false}로 숨겨둔 상태) 넘길 방법이
 * 없었습니다. 그래서 웹에서만 좌우 화살표 버튼을 얹어 클릭으로도
 * 넘길 수 있게 합니다.
 */
export function PhotoCarousel({
  pageWidth,
  pageCount,
  children,
}: {
  pageWidth: number;
  pageCount: number;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const goTo = (target: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, target));
    scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
    setIndex(clamped);
  };

  const handleScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  };

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={pageWidth}
        snapToAlignment="start"
        disableIntervalMomentum
        onMomentumScrollEnd={handleScrollSettled}
        onScrollEndDrag={handleScrollSettled}
      >
        {children}
      </ScrollView>

      {Platform.OS === "web" && pageCount > 1 && (
        <>
          {index > 0 && (
            <TouchableOpacity
              style={[styles.arrowButton, styles.arrowLeft]}
              onPress={() => goTo(index - 1)}
              hitSlop={6}
            >
              <CaretLeftIcon size={16} color="#FFFFFF" weight="bold" />
            </TouchableOpacity>
          )}
          {index < pageCount - 1 && (
            <TouchableOpacity
              style={[styles.arrowButton, styles.arrowRight]}
              onPress={() => goTo(index + 1)}
              hitSlop={6}
            >
              <CaretRightIcon size={16} color="#FFFFFF" weight="bold" />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  arrowButton: {
    position: "absolute",
    top: "50%",
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: 8 },
  arrowRight: { right: 8 },
});
