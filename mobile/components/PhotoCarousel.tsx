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

  // 웹에서는 ScrollView의 onTouchStart/onPointerDown prop이 DOM까지 전달되지
  // 않습니다(react-native-web). 실제 터치를 보내 확인해 보니 핸들러가 한 번도
  // 불리지 않았습니다. 그래서 웹에서는 스크롤 노드에 리스너를 직접 붙입니다.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const scrollable = scrollRef.current as unknown as {
      getScrollableNode?: () => unknown;
    } | null;
    const node = (scrollable?.getScrollableNode?.() ?? scrollable) as HTMLElement | null;
    if (!node?.addEventListener) return;

    // 한 장씩 딱 멈추게 + 끝에서 더 밀어도 부모로 새어 나가지 않게.
    //
    // react-native-web은 snapToInterval / disableIntervalMomentum을 구현하지
    // 않습니다(네이티브 전용). 그래서 웹에서는 사진이 한 장 단위로 멈추지 않고
    // 관성으로 여러 장을 지나쳤습니다. CSS 스크롤 스냅으로 대체합니다.
    //
    // overscroll-behavior-x: contain은 마지막 사진에서 더 밀었을 때 그 스크롤이
    // 부모(탭 페이저)로 이어지는 것을 막습니다 — 다음 장이 없을 때 화면이
    // 넘어가던 경우에 대한 브라우저 차원의 차단입니다.
    // 정렬(사진 경계에 딱 맞추기)은 브라우저 스냅에 맡깁니다.
    node.style.scrollSnapType = "x mandatory";
    node.style.overscrollBehaviorX = "contain";
    const content = node.firstElementChild;
    if (content) {
      for (const child of Array.from(content.children)) {
        (child as HTMLElement).style.scrollSnapAlign = "start";
        // 세게 밀어도 관성으로 여러 장을 지나치지 않고 한 장씩 멈춥니다.
        (child as HTMLElement).style.scrollSnapStop = "always";
      }
    }

    const opts = { passive: true } as const;
    // 해제는 '손을 뗐을 때'만 듣습니다.
    //
    // pointercancel / touchcancel을 해제 신호로 쓰면 안 됩니다 — 브라우저는
    // 터치 스크롤이 시작되는 순간 이 이벤트를 보냅니다. 실제로 측정해 보니
    // 잠근 지 11ms 만에 풀려서, 사진을 미는 바로 그 순간 탭 스와이프가 다시
    // 켜지고 화면이 넘어갔습니다. 손을 떼는 이벤트가 유실되는 경우는 아래
    // 3초 안전장치가 처리합니다.
    // touchstart와 pointerdown이 한 번의 터치에 둘 다 발생합니다(touchend/
    // pointerup도 마찬가지). 그대로 두면 '한 장만 이동'이 두 번 계산되면서
    // 두 번째 계산이 이미 움직이는 위치를 기준으로 삼아 엉뚱한 곳으로 갑니다.
    let gestureActive = false;
    const onDown = () => {
      if (gestureActive) return;
      gestureActive = true;
      lockTabSwipe();
    };
    const onUp = () => {
      if (!gestureActive) return;
      gestureActive = false;
      unlockTabSwipe();
    };
    node.addEventListener("touchstart", onDown, opts);
    node.addEventListener("pointerdown", onDown, opts);
    node.addEventListener("touchend", onUp, opts);
    node.addEventListener("pointerup", onUp, opts);
    return () => {
      node.removeEventListener("touchstart", onDown);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("touchend", onUp);
      node.removeEventListener("pointerup", onUp);
    };
    // pageCount가 바뀌면 사진 요소도 바뀌므로 스냅 정렬을 다시 걸어야 합니다.
  }, [lockTabSwipe, unlockTabSwipe, pageCount]);

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
        // 네이티브는 이 prop들이 그대로 동작합니다. 웹은 아래 useEffect가
        // DOM에 직접 리스너를 붙입니다(이 prop들이 웹에서는 호출되지 않습니다).
        onTouchStart={lockTabSwipe}
        onTouchEnd={unlockTabSwipe}
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
