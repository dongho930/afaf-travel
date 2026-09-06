import { useNavigation } from "expo-router";
import { CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * 탭 스와이프와의 충돌:
 * 이 캐러셀은 5개 화면을 좌우로 넘기는 탭 네비게이터
 * (app/(tabs)/_layout.tsx, material-top-tabs) 안에 들어 있습니다. 둘 다
 * "좌우로 미는 손가락"을 기다리기 때문에, 사진을 넘기려고 밀면 화면 전체가
 * 같이 넘어갔습니다. 그래서 이 캐러셀을 만지는 동안에만 탭 스와이프를 꺼둡니다.
 *
 * 꺼둔 채로 굳으면 탭 전환이 아예 안 되므로 복구를 세 겹으로 둡니다 —
 * 손을 뗄 때, 3초 안전장치, 그리고 화면을 떠날 때(unmount).
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

  const navigation = useNavigation();
  const tabSwipeLocked = useRef(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTabSwipe = useCallback(
    (enabled: boolean) => {
      if (tabSwipeLocked.current === !enabled) return; // 같은 상태면 건드리지 않습니다
      tabSwipeLocked.current = !enabled;
      // 탭 그룹 밖(게시물 작성 화면 등)에서는 이 옵션이 없는 네비게이터라
      // 무시되지만, 혹시 모를 예외로 화면이 죽지 않게 감싸둡니다.
      try {
        navigation.setOptions({ swipeEnabled: enabled } as never);
      } catch {
        // 무시 — 탭 스와이프가 없는 화면입니다
      }
    },
    [navigation],
  );

  const unlockTabSwipe = useCallback(() => {
    if (restoreTimer.current) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    setTabSwipe(true);
  }, [setTabSwipe]);

  const lockTabSwipe = useCallback(() => {
    // 사진이 한 장뿐이면 넘길 게 없으니 탭 스와이프를 그대로 둡니다.
    if (pageCount <= 1) return;
    setTabSwipe(false);
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    // 손 떼는 이벤트가 유실돼도(터치 취소 등) 탭 전환이 영영 막히지 않도록.
    restoreTimer.current = setTimeout(() => setTabSwipe(true), 3000);
  }, [pageCount, setTabSwipe]);

  // 스크롤 도중에 화면을 떠나도 반드시 되살립니다.
  useEffect(() => unlockTabSwipe, [unlockTabSwipe]);

  const goTo = (target: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, target));
    scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
    setIndex(clamped);
  };

  const handleScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    unlockTabSwipe();
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
        // 손가락이 닿는 순간 탭 스와이프를 꺼서, 사진을 미는 동작이 화면
        // 전환으로 새어 나가지 않게 합니다. 탭 페이저는 '움직임'이 감지될 때
        // 제스처를 채가므로(PanResponderAdapter의 onMoveShouldSetPanResponderCapture),
        // 그전 단계인 '닿는 순간'에 꺼야 합니다.
        //
        // pointer와 touch를 모두 거는 이유: 웹(react-native-web)은 pointer 이벤트로
        // 제스처를 판정하고, 네이티브는 touch 이벤트를 씁니다. 둘 다 걸어두면
        // 어느 쪽이든 '움직임'보다 먼저 잠깁니다.
        onPointerDown={lockTabSwipe}
        onPointerUp={unlockTabSwipe}
        onPointerCancel={unlockTabSwipe}
        onTouchStart={lockTabSwipe}
        onTouchEnd={unlockTabSwipe}
        onTouchCancel={unlockTabSwipe}
        onScrollBeginDrag={lockTabSwipe}
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
