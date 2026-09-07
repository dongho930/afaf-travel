import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { CheckIcon, XIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { Alert } from "../services/crossPlatformAlert";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";
import { flattenPhotoWeb } from "../utils/flattenPhotoWeb";
import { HorizontalScrollWeb } from "./HorizontalScrollWeb";
import { PHOTO_FILTER_PRESETS, PhotoFilterPreset } from "../utils/photoFilters";
import { WebFrame } from "./WebFrame";

const OUTPUT_SIZE = 1080;
// 화면 밖 내보내기 캔버스가 준비됐다는 신호(onLoad)를 최대 이만큼만 기다립니다.
// 오래 걸리는 작업이 아니라(이미 잘라둔 파일을 그리기만 함), 이걸 넘겼다면
// 기다려도 오지 않는 상황으로 보고 사용자에게 알린 뒤 다시 시도하게 합니다.
const EXPORT_READY_TIMEOUT_MS = 10000;
const MAX_PINCH_SCALE = 4;

// 이 편집기는 사진에 집중하도록 앱 테마와 무관하게 항상 어두운 화면(대부분의
// 사진 편집 UI 관례)을 씁니다. 대신 회색조를 여기저기 다른 값으로 흩어놓지
// 않도록, 톤 하나로 통일해서 상수로 고정합니다 — 버튼/카드 배경이 전부 같은
// 톤을 공유해야 '제각각'으로 보이지 않습니다.
const EDITOR_BG = "#0B0B0C";
const EDITOR_SURFACE = "rgba(255,255,255,0.08)";
const EDITOR_BORDER = "rgba(255,255,255,0.16)";
const EDITOR_TEXT = "#FFFFFF";
const EDITOR_TEXT_MUTED = "rgba(255,255,255,0.6)";
const TOOLBAR_TILE = 44;

/**
 * 게시물 사진 한 장을 편집하는 전체화면 모달입니다.
 * (1) 정사각형 프레임 안에서 핀치줌/드래그로 크롭, (2) 색감 필터 선택.
 * '완료'를 누르면 크롭+필터가 반영된 최종 이미지를 base64로 만들어 반환합니다.
 *
 * 최종 합성(굽기) 방식이 플랫폼별로 다릅니다:
 * - 네이티브(iOS/Android): react-native-view-shot의 captureRef로, 화면 밖에
 *   숨겨둔 실제 뷰(필터 SVG)를 그대로 캡처합니다.
 * - 웹: react-native-view-shot이 웹을 지원하지 않아서, utils/flattenPhotoWeb.ts의
 *   <canvas> 기반 자체 합성 함수를 씁니다.
 */
export function PhotoEditor({
  imageUri,
  onCancel,
  onConfirm,
}: {
  imageUri: string;
  onCancel: () => void;
  onConfirm: (base64: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [frameSize, setFrameSize] = useState(0);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<PhotoFilterPreset>(PHOTO_FILTER_PRESETS[0]);
  const [processing, setProcessing] = useState(false);
  const [exportUri, setExportUri] = useState<string | null>(null);
  // 네이티브 내보내기(캡처) 캔버스 안에서 최종 사진을 그릴 위치/크기(여백은
  // 흰 배경이 그대로 비치도록 나머지 영역을 비워둡니다).
  const [exportRect, setExportRect] = useState({ x: 0, y: 0, width: OUTPUT_SIZE, height: OUTPUT_SIZE });

  const exportViewRef = useRef<View>(null);
  const exportReadyResolveRef = useRef<(() => void) | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    Image.getSize(
      imageUri,
      (width, height) => setNaturalSize({ width, height }),
      () => setNaturalSize({ width: 1, height: 1 })
    );
  }, [imageUri]);

  const handleFrameLayout = (e: LayoutChangeEvent) => setFrameSize(e.nativeEvent.layout.width);

  const naturalW = naturalSize?.width ?? 1;
  const naturalH = naturalSize?.height ?? 1;
  // 프레임 안에 사진 전체가 들어오도록(contain) 맞추는 배율 — 이 값에 핀치 배율(scale)을
  // 곱한 게 실제 표시 배율입니다. 가로로 긴 사진은 가로가 프레임에 꽉 차고(위아래
  // 여백), 세로로 긴 사진은 세로가 꽉 차게(좌우 여백) 되며, 남는 여백은 흰색 배경이
  // 그대로 비칩니다(styles.frame의 backgroundColor).
  const baseScale = frameSize > 0 ? Math.min(frameSize / naturalW, frameSize / naturalH) : 1;
  const displayW = naturalW * baseScale;
  const displayH = naturalH * baseScale;

  const clampTranslate = (t: number, displayedDim: number, frame: number) => {
    "worklet";
    const max = Math.max(0, (displayedDim - frame) / 2);
    return Math.min(max, Math.max(-max, t));
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(MAX_PINCH_SCALE, Math.max(1, savedScale.value * e.scale));
      scale.value = next;
      const totalScale = baseScale * next;
      translateX.value = clampTranslate(translateX.value, naturalW * totalScale, frameSize);
      translateY.value = clampTranslate(translateY.value, naturalH * totalScale, frameSize);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const totalScale = baseScale * scale.value;
      translateX.value = clampTranslate(savedTranslateX.value + e.translationX, naturalW * totalScale, frameSize);
      translateY.value = clampTranslate(savedTranslateY.value + e.translationY, naturalH * totalScale, frameSize);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  // 핀치(꼬집기) 제스처는 터치 전용이라, 마우스만 있는 PC 웹에서는 확대/축소할
  // 방법이 아예 없었습니다(드래그=이동은 가능해도 줌이 안 되니 크롭 자체가
  // 막힌 것처럼 보였습니다). 그래서 웹에서는 마우스 휠(또는 트랙패드 두 손가락
  // 핀치 — 브라우저가 ctrlKey를 켠 wheel 이벤트로 보내줍니다)과 +/- 버튼으로도
  // 같은 배율(scale)을 조절할 수 있게 합니다.
  const applyZoom = (factor: number) => {
    const next = Math.min(MAX_PINCH_SCALE, Math.max(1, scale.value * factor));
    scale.value = next;
    savedScale.value = next;
    const totalScale = baseScale * next;
    translateX.value = clampTranslate(translateX.value, naturalW * totalScale, frameSize);
    translateY.value = clampTranslate(translateY.value, naturalH * totalScale, frameSize);
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  };

  const handleWheel = (e: any) => {
    e?.preventDefault?.();
    const deltaY = e?.deltaY ?? e?.nativeEvent?.deltaY ?? 0;
    applyZoom(1 - deltaY * 0.0015);
  };
  const webFrameProps: any = Platform.OS === "web" ? { onWheel: handleWheel } : {};

  const handleConfirm = async () => {
    if (!naturalSize || frameSize <= 0) return;
    setProcessing(true);
    try {
      const totalScale = baseScale * scale.value;
      const shownW = naturalSize.width * totalScale;
      const shownH = naturalSize.height * totalScale;

      // 축(가로/세로)마다 따로 계산합니다: 그 축이 프레임보다 작으면(사진이
      // 그 방향으로 다 들어와 있으면) 원본을 자르지 않고 축소만 해서 가운데에
      // 놓고 남는 자리는 흰 배경이 비치게 두고, 프레임보다 크면(핀치로 확대한
      // 상태) 기존처럼 그 축을 프레임 크기만큼 잘라냅니다.
      const axis = (shown: number, natural: number, translate: number) => {
        if (shown <= frameSize) {
          return { srcOrigin: 0, srcSize: natural, destSize: (shown / frameSize) * OUTPUT_SIZE };
        }
        const visible = (shown - frameSize) / 2 - translate;
        const srcSize = frameSize / totalScale;
        const srcOrigin = Math.max(0, Math.min(natural - srcSize, visible / totalScale));
        return { srcOrigin, srcSize, destSize: OUTPUT_SIZE };
      };

      const x = axis(shownW, naturalSize.width, translateX.value);
      const y = axis(shownH, naturalSize.height, translateY.value);
      const destWidth = Math.max(1, Math.round(x.destSize));
      const destHeight = Math.max(1, Math.round(y.destSize));
      const destOffsetX = Math.round((OUTPUT_SIZE - destWidth) / 2);
      const destOffsetY = Math.round((OUTPUT_SIZE - destHeight) / 2);

      const context = ImageManipulator.manipulate(imageUri);
      context.crop({
        originX: Math.round(x.srcOrigin),
        originY: Math.round(y.srcOrigin),
        width: Math.max(1, Math.round(x.srcSize)),
        height: Math.max(1, Math.round(y.srcSize)),
      });
      context.resize({ width: destWidth, height: destHeight });
      const rendered = await context.renderAsync();
      const cropped = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });

      if (Platform.OS === "web") {
        const base64 = await flattenPhotoWeb(cropped.uri, OUTPUT_SIZE, selectedFilter.cssFilter, {
          x: destOffsetX,
          y: destOffsetY,
          width: destWidth,
          height: destHeight,
        });
        onConfirm(base64);
        return;
      }

      setExportRect({ x: destOffsetX, y: destOffsetY, width: destWidth, height: destHeight });
      setExportUri(cropped.uri);
      // 화면 밖 내보내기 캔버스에 사진이 다 그려졌다고 알려주는 onLoad를 기다립니다.
      // 그 신호가 끝내 오지 않는 경우(이미지 디코딩 실패 등)를 대비해 시간
      // 제한을 둡니다 — 예전에는 제한이 없어서, 신호가 안 오면 '처리 중'
      // 상태로 멈춘 채 취소 말고는 빠져나갈 방법이 없었습니다.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          exportReadyResolveRef.current = null;
          reject(new Error("사진을 내보내는 데 시간이 너무 오래 걸렸어요."));
        }, EXPORT_READY_TIMEOUT_MS);
        exportReadyResolveRef.current = () => {
          clearTimeout(timer);
          exportReadyResolveRef.current = null;
          resolve();
        };
      });
      if (!exportViewRef.current) throw new Error("내보내기 화면을 찾지 못했어요.");
      const base64 = await captureRef(exportViewRef, { format: "jpg", quality: 0.9, result: "base64" });
      onConfirm(base64);
    } catch (err) {
      // 내보내기 캔버스를 비워서, 다시 시도할 때 사진이 새로 그려지고 준비
      // 신호(onLoad)도 다시 오도록 합니다 — 같은 uri를 그대로 두면 화면이
      // 바뀌지 않아 신호가 오지 않고 또 시간만 초과합니다.
      setExportUri(null);
      exportReadyResolveRef.current = null;
      Alert.alert("사진 처리 실패", "잠시 후 다시 시도해주세요.\n" + String(err));
    } finally {
      setProcessing(false);
    }
  };

  const matrixValues = selectedFilter.svgMatrix.join(" ");

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <WebFrame colors={colors}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topBarIconButton} onPress={onCancel} hitSlop={10} disabled={processing}>
            <XIcon size={18} color={EDITOR_TEXT} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>사진 편집</Text>
          <TouchableOpacity
            style={[styles.topBarIconButton, styles.topBarConfirmButton]}
            onPress={handleConfirm}
            hitSlop={10}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <CheckIcon size={18} color={colors.onPrimary} weight="bold" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.frameWrap} onLayout={handleFrameLayout}>
          {frameSize > 0 && naturalSize ? (
            <View style={[styles.frame, { width: frameSize, height: frameSize }]} {...webFrameProps}>
              <GestureDetector gesture={composedGesture}>
                <Animated.View style={[{ width: displayW, height: displayH }, imageAnimatedStyle]}>
                  <Svg width={displayW} height={displayH}>
                    <Defs>
                      <Filter id="previewFilter">
                        <FeColorMatrix type="matrix" values={matrixValues} />
                      </Filter>
                    </Defs>
                    <SvgImage
                      href={imageUri}
                      x={0}
                      y={0}
                      width={displayW}
                      height={displayH}
                      preserveAspectRatio="none"
                      filter="url(#previewFilter)"
                    />
                  </Svg>
                </Animated.View>
              </GestureDetector>
            </View>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}

          {Platform.OS === "web" && frameSize > 0 && (
            <View style={styles.zoomControls}>
              <TouchableOpacity style={styles.zoomButton} onPress={() => applyZoom(1 / 1.25)} hitSlop={6}>
                <Text style={styles.zoomButtonText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.zoomButton} onPress={() => applyZoom(1.25)} hitSlop={6}>
                <Text style={styles.zoomButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.controlPanel}>
          <Text style={styles.panelLabel}>필터</Text>
          <HorizontalScrollWeb style={styles.toolbarRow}>
            {PHOTO_FILTER_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                onPress={() => setSelectedFilter(preset)}
                style={[styles.filterChip, selectedFilter.id === preset.id && styles.filterChipSelected]}
              >
                <Text style={[styles.filterChipText, selectedFilter.id === preset.id && styles.filterChipTextSelected]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            ))}
          </HorizontalScrollWeb>
        </View>
      </View>
      </WebFrame>

      {Platform.OS !== "web" && exportUri && (
        <View
          ref={exportViewRef}
          collapsable={false}
          style={[styles.hiddenExport, { width: OUTPUT_SIZE, height: OUTPUT_SIZE, backgroundColor: "#FFFFFF" }]}
        >
          <Svg width={OUTPUT_SIZE} height={OUTPUT_SIZE}>
            <Defs>
              <Filter id="exportFilter">
                <FeColorMatrix type="matrix" values={matrixValues} />
              </Filter>
            </Defs>
            <SvgImage
              href={exportUri}
              x={exportRect.x}
              y={exportRect.y}
              width={exportRect.width}
              height={exportRect.height}
              filter="url(#exportFilter)"
              onLoad={() => exportReadyResolveRef.current?.()}
            />
          </Svg>
        </View>
      )}
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: EDITOR_BG },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    topBarTitle: { color: EDITOR_TEXT, fontSize: 15, fontFamily: fontFamily.bold },
    topBarIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: EDITOR_SURFACE,
      alignItems: "center",
      justifyContent: "center",
    },
    topBarConfirmButton: { backgroundColor: colors.primary },

    frameWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
    // 흰색: 사진이 프레임을 다 채우지 못하는 방향(가로로 긴 사진의 위아래,
    // 세로로 긴 사진의 좌우)에 이 배경이 여백으로 비칩니다.
    frame: { overflow: "hidden", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },

    // 웹(마우스)에서 핀치 줌이 안 되는 걸 보완하는 확대/축소 버튼 — 프레임 아래
    // 오른쪽 구석에 겹쳐서 띄웁니다.
    zoomControls: {
      position: "absolute",
      bottom: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      gap: spacing.sm,
    },
    zoomButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
    zoomButtonText: { color: EDITOR_TEXT, fontSize: 18, fontFamily: fontFamily.bold, lineHeight: 20 },

    // 필터 줄을 하나의 '컨트롤 패널'로 묶어서, 프레임 영역과 시각적으로
    // 분리된 하나의 톤(같은 배경/여백 리듬)을 갖게 합니다.
    controlPanel: {
      borderTopWidth: 1,
      borderTopColor: EDITOR_BORDER,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    panelLabel: {
      color: EDITOR_TEXT_MUTED,
      fontSize: 12,
      fontFamily: fontFamily.semiBold,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    toolbarRow: { paddingHorizontal: spacing.lg },
    filterChip: {
      height: TOOLBAR_TILE,
      justifyContent: "center",
      paddingHorizontal: spacing.md + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: EDITOR_BORDER,
      marginRight: spacing.sm,
    },
    filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterChipText: { color: EDITOR_TEXT_MUTED, fontSize: 13, fontFamily: fontFamily.semiBold },
    filterChipTextSelected: { color: colors.onPrimary },

    hiddenExport: { position: "absolute", top: -99999, left: -99999 },
  });
}
