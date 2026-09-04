import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { CheckIcon, TextTIcon, XIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { Alert } from "../services/crossPlatformAlert";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";
import { flattenPhotoWeb } from "../utils/flattenPhotoWeb";
import { PHOTO_FILTER_PRESETS, PhotoFilterPreset } from "../utils/photoFilters";
import { WebFrame } from "./WebFrame";

const OUTPUT_SIZE = 1080;
const MAX_PINCH_SCALE = 4;
const MIN_OVERLAY_SCALE = 0.4;
const MAX_OVERLAY_SCALE = 3;
const STICKERS = ["📍", "✈️", "🌊", "🏔️", "☕️", "❤️", "😊", "✨"];

// 이 편집기는 사진에 집중하도록 앱 테마와 무관하게 항상 어두운 화면(대부분의
// 사진 편집 UI 관례)을 씁니다. 대신 회색조를 여기저기 다른 값으로 흩어놓지
// 않도록, 톤 하나로 통일해서 상수로 고정합니다 — 버튼/카드 배경이 전부 같은
// 톤을 공유해야 '제각각'으로 보이지 않습니다.
const EDITOR_BG = "#0B0B0C";
const EDITOR_SURFACE = "rgba(255,255,255,0.08)";
const EDITOR_BORDER = "rgba(255,255,255,0.16)";
const EDITOR_TEXT = "#FFFFFF";
const EDITOR_TEXT_MUTED = "rgba(255,255,255,0.6)";
const EDITOR_BADGE = "rgba(0,0,0,0.65)";
const TOOLBAR_TILE = 44;

interface OverlayItem {
  id: string;
  type: "text" | "sticker";
  content: string;
  xRatio: number; // 프레임 기준 중심 x (0~1)
  yRatio: number; // 프레임 기준 중심 y (0~1)
  scale: number;
}

/**
 * 게시물 사진 한 장을 인스타그램처럼 편집하는 전체화면 모달입니다.
 * (1) 정사각형 프레임 안에서 핀치줌/드래그로 크롭, (2) 색감 필터 선택,
 * (3) 텍스트/스티커를 얹어 드래그·핀치로 배치. '완료'를 누르면 실제
 * 크롭+필터+오버레이가 반영된 최종 이미지를 base64로 만들어 반환합니다.
 *
 * 최종 합성(굽기) 방식이 플랫폼별로 다릅니다:
 * - 네이티브(iOS/Android): react-native-view-shot의 captureRef로, 화면 밖에
 *   숨겨둔 실제 뷰(필터 SVG + 오버레이 Text)를 그대로 캡처합니다.
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
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [activeTab, setActiveTab] = useState<"filter" | "decorate">("filter");
  const [addingText, setAddingText] = useState(false);
  const [textDraft, setTextDraft] = useState("");
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

  const addOverlay = (type: "text" | "sticker", content: string) => {
    setOverlays((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, type, content, xRatio: 0.5, yRatio: 0.5, scale: 1 },
    ]);
  };

  const updateOverlay = (id: string, xRatio: number, yRatio: number, overlayScale: number) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, xRatio, yRatio, scale: overlayScale } : o)));
  };

  const removeOverlay = (id: string) => setOverlays((prev) => prev.filter((o) => o.id !== id));

  const confirmAddText = () => {
    if (textDraft.trim()) addOverlay("text", textDraft.trim());
    setTextDraft("");
    setAddingText(false);
  };

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
        const base64 = await flattenPhotoWeb(
          cropped.uri,
          OUTPUT_SIZE,
          selectedFilter.cssFilter,
          overlays.map((o) => ({ type: o.type, content: o.content, xRatio: o.xRatio, yRatio: o.yRatio, scale: o.scale })),
          { x: destOffsetX, y: destOffsetY, width: destWidth, height: destHeight }
        );
        onConfirm(base64);
        return;
      }

      setExportRect({ x: destOffsetX, y: destOffsetY, width: destWidth, height: destHeight });
      setExportUri(cropped.uri);
      await new Promise<void>((resolve) => {
        exportReadyResolveRef.current = resolve;
      });
      if (!exportViewRef.current) throw new Error("내보내기 화면을 찾지 못했어요.");
      const base64 = await captureRef(exportViewRef, { format: "jpg", quality: 0.9, result: "base64" });
      onConfirm(base64);
    } catch (err) {
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

              {overlays.map((ov) => (
                <EditableOverlayView
                  key={ov.id}
                  overlay={ov}
                  frameSize={frameSize}
                  onChange={updateOverlay}
                  onRemove={removeOverlay}
                />
              ))}
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
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              onPress={() => setActiveTab("filter")}
              style={[styles.segment, activeTab === "filter" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, activeTab === "filter" && styles.segmentTextActive]}>필터</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("decorate")}
              style={[styles.segment, activeTab === "decorate" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, activeTab === "decorate" && styles.segmentTextActive]}>꾸미기</Text>
            </TouchableOpacity>
          </View>

          {activeTab === "filter" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbarRow}>
              {PHOTO_FILTER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  onPress={() => setSelectedFilter(preset)}
                  style={[styles.filterChip, selectedFilter.id === preset.id && styles.filterChipSelected]}
                >
                  <Text
                    style={[styles.filterChipText, selectedFilter.id === preset.id && styles.filterChipTextSelected]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbarRow}>
              <TouchableOpacity style={styles.toolbarTile} onPress={() => setAddingText(true)}>
                <TextTIcon size={20} color={EDITOR_TEXT} weight="bold" />
              </TouchableOpacity>
              {STICKERS.map((s) => (
                <TouchableOpacity key={s} style={styles.toolbarTile} onPress={() => addOverlay("sticker", s)}>
                  <Text style={styles.stickerEmoji}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {addingText && (
          <View style={styles.textInputBar}>
            <TextInput
              autoFocus
              style={styles.textInput}
              placeholder="문구를 입력하세요"
              placeholderTextColor={EDITOR_TEXT_MUTED}
              value={textDraft}
              onChangeText={setTextDraft}
              onSubmitEditing={confirmAddText}
            />
            <TouchableOpacity onPress={confirmAddText} hitSlop={8}>
              <Text style={styles.textInputConfirm}>추가</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setAddingText(false);
                setTextDraft("");
              }}
              hitSlop={8}
            >
              <XIcon size={16} color={EDITOR_TEXT_MUTED} weight="bold" />
            </TouchableOpacity>
          </View>
        )}
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
          {overlays.map((ov) => {
            const box = OUTPUT_SIZE * 0.6;
            return (
              <View
                key={ov.id}
                style={{
                  position: "absolute",
                  left: ov.xRatio * OUTPUT_SIZE - box / 2,
                  top: ov.yRatio * OUTPUT_SIZE - box / 2,
                  width: box,
                  height: box,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: OUTPUT_SIZE * 0.12 * ov.scale,
                    fontWeight: ov.type === "text" ? "bold" : "normal",
                    color: EDITOR_TEXT,
                    textShadowColor: "rgba(0,0,0,0.6)",
                    textShadowRadius: 4,
                    textShadowOffset: { width: 0, height: 1 },
                  }}
                >
                  {ov.content}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Modal>
  );
}

/**
 * 텍스트/스티커 오버레이 한 개. 자체 Pan+Pinch 제스처로 드래그 이동과 크기
 * 조절을 처리합니다(회전은 v1에서 생략). 각 오버레이가 자기만의 shared value를
 * 가져야 해서 별도 컴포넌트로 분리했습니다(훅은 반복문 안에서 호출할 수 없음).
 */
function EditableOverlayView({
  overlay,
  frameSize,
  onChange,
  onRemove,
}: {
  overlay: OverlayItem;
  frameSize: number;
  onChange: (id: string, xRatio: number, yRatio: number, scale: number) => void;
  onRemove: (id: string) => void;
}) {
  const box = frameSize * 0.6;
  const translateX = useSharedValue(overlay.xRatio * frameSize);
  const translateY = useSharedValue(overlay.yRatio * frameSize);
  const savedX = useSharedValue(translateX.value);
  const savedY = useSharedValue(translateY.value);
  const itemScale = useSharedValue(overlay.scale);
  const savedItemScale = useSharedValue(overlay.scale);

  const commit = (x: number, y: number, s: number) => {
    onChange(overlay.id, x / frameSize, y / frameSize, s);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
      runOnJS(commit)(translateX.value, translateY.value, itemScale.value);
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      itemScale.value = Math.min(MAX_OVERLAY_SCALE, Math.max(MIN_OVERLAY_SCALE, savedItemScale.value * e.scale));
    })
    .onEnd(() => {
      savedItemScale.value = itemScale.value;
      runOnJS(commit)(translateX.value, translateY.value, itemScale.value);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value - box / 2 },
      { translateY: translateY.value - box / 2 },
      { scale: itemScale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[{ position: "absolute", left: 0, top: 0, width: box, height: box, alignItems: "center", justifyContent: "center" }, animatedStyle]}
      >
        <TouchableOpacity style={styles_removeBadge} onPress={() => onRemove(overlay.id)} hitSlop={8}>
          <XIcon size={10} color={EDITOR_TEXT} weight="bold" />
        </TouchableOpacity>
        <Text
          style={{
            fontSize: box * 0.22,
            fontWeight: overlay.type === "text" ? "bold" : "normal",
            color: EDITOR_TEXT,
            textShadowColor: "rgba(0,0,0,0.6)",
            textShadowRadius: 4,
            textShadowOffset: { width: 0, height: 1 },
          }}
        >
          {overlay.content}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles_removeBadge = {
  position: "absolute" as const,
  top: -4,
  right: -4,
  width: 20,
  height: 20,
  borderRadius: 10,
  backgroundColor: EDITOR_BADGE,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  zIndex: 1,
};

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

    // 필터/꾸미기 탭 + 그 아래 도구 줄을 하나의 '컨트롤 패널'로 묶어서, 프레임
    // 영역과 시각적으로 분리된 하나의 톤(같은 배경/여백 리듬)을 갖게 합니다.
    controlPanel: {
      borderTopWidth: 1,
      borderTopColor: EDITOR_BORDER,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    segmentedControl: {
      flexDirection: "row",
      alignSelf: "center",
      backgroundColor: EDITOR_SURFACE,
      borderRadius: radius.pill,
      padding: 3,
      marginBottom: spacing.md,
    },
    segment: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs + 3, borderRadius: radius.pill },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: EDITOR_TEXT_MUTED },
    segmentTextActive: { color: colors.onPrimary },

    // 필터 칩과 꾸미기 툴바 타일이 같은 가로 스크롤 줄 스타일(좌우 패딩)을 공유합니다.
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

    toolbarTile: {
      width: TOOLBAR_TILE,
      height: TOOLBAR_TILE,
      borderRadius: radius.md,
      backgroundColor: EDITOR_SURFACE,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.sm,
    },
    stickerEmoji: { fontSize: 22 },

    textInputBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: EDITOR_SURFACE,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    textInput: { flex: 1, color: EDITOR_TEXT, fontSize: 14, fontFamily: fontFamily.regular, paddingVertical: spacing.xs },
    textInputConfirm: { color: colors.primary, fontSize: 13, fontFamily: fontFamily.bold },

    hiddenExport: { position: "absolute", top: -99999, left: -99999 },
  });
}
