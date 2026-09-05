import { CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import React, { useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";

/**
 * 칩/카드/사진 등을 가로로 늘어놓고 넘겨보는 목록을 감쌉니다. 모바일에서는
 * 손가락 스와이프로 자연스럽게 넘어가지만, PC 웹에서는 마우스로 스와이프
 * 제스처를 할 수 없고(스크롤바도 숨겨둔 상태라) 넘길 방법이 없었습니다.
 * 그래서 웹에서만, 더 넘길 내용이 있는 쪽에 좌우 화살표 버튼을 얹어
 * 누르면 한 화면 폭만큼 스크롤되게 합니다. (페이지 단위로 딱 맞춰 넘기는
 * PhotoCarousel과 달리, 이건 자유 스크롤 목록에 씁니다.)
 */
export function HorizontalScrollWeb({
  children,
  style,
  contentContainerStyle,
  scrollStep = 220,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollStep?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(e.nativeEvent.contentOffset.x);
  };

  const scrollBy = (delta: number) => {
    const max = Math.max(0, contentWidth - containerWidth);
    const next = Math.max(0, Math.min(max, scrollX + delta));
    scrollRef.current?.scrollTo({ x: next, animated: true });
  };

  const canScrollLeft = scrollX > 4;
  const canScrollRight = scrollX < contentWidth - containerWidth - 4;
  const showArrows = Platform.OS === "web" && containerWidth > 0 && contentWidth > containerWidth + 4;

  return (
    <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={contentContainerStyle}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(w) => setContentWidth(w)}
      >
        {children}
      </ScrollView>

      {showArrows && (
        <>
          {canScrollLeft && (
            <TouchableOpacity
              style={[arrowStyles.arrowButton, arrowStyles.arrowLeft]}
              onPress={() => scrollBy(-scrollStep)}
              hitSlop={6}
            >
              <CaretLeftIcon size={14} color="#FFFFFF" weight="bold" />
            </TouchableOpacity>
          )}
          {canScrollRight && (
            <TouchableOpacity
              style={[arrowStyles.arrowButton, arrowStyles.arrowRight]}
              onPress={() => scrollBy(scrollStep)}
              hitSlop={6}
            >
              <CaretRightIcon size={14} color="#FFFFFF" weight="bold" />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const arrowStyles = StyleSheet.create({
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
  arrowLeft: { left: 2 },
  arrowRight: { right: 2 },
});
