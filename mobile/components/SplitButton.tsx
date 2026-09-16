import { CaretDownIcon, type Icon } from "phosphor-react-native";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

export interface SplitButtonMenuItem {
  key: string;
  label: string;
  icon?: Icon;
  onPress: () => void;
  disabled?: boolean;
}

const MENU_WIDTH = 188;

/**
 * 주 동작 버튼 + 오른쪽 ▾ 버튼. ▾를 누르면 버튼 바로 아래에 관련 동작 목록이 뜹니다.
 * 메뉴는 Modal로 띄워서 스크롤 영역이나 다른 카드에 가려지지 않습니다.
 */
export function SplitButton({
  label,
  onPress,
  menuItems,
  accessibilityHint,
  menuAccessibilityLabel,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  menuItems: SplitButtonMenuItem[];
  accessibilityHint?: string;
  menuAccessibilityLabel: string;
  // 주 동작이 진행 중일 때 글자 대신 로딩 표시를 보여주고 누르지 못하게 합니다.
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const anchorRef = useRef<View>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setMenu({ top: y + height + 6, left: Math.max(spacing.sm, x + width - MENU_WIDTH) });
    });
  };

  return (
    <>
      <View ref={anchorRef} style={styles.container} collapsable={false}>
        <Pressable
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
          onPress={onPress}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ busy: loading, disabled: loading }}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={styles.label}>{label}</Text>
          )}
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel={menuAccessibilityLabel}
          accessibilityState={{ expanded: !!menu }}
        >
          <CaretDownIcon size={16} color={colors.onPrimary} weight="regular" />
        </Pressable>
      </View>

      <Modal visible={!!menu} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} accessibilityLabel="메뉴 닫기" />
        {menu && (
          <View style={[styles.menu, { top: menu.top, left: menu.left }]} accessibilityRole="menu">
            {menuItems.map((item) => {
              const ItemIcon = item.icon;
              const itemColor = item.disabled ? colors.textTertiary : colors.text;
              return (
                <Pressable
                  key={item.key}
                  style={({ pressed }) => [styles.menuItem, pressed && !item.disabled && styles.menuItemPressed]}
                  disabled={item.disabled}
                  onPress={() => {
                    setMenu(null);
                    item.onPress();
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ disabled: !!item.disabled }}
                >
                  {ItemIcon && <ItemIcon size={16} color={itemColor} weight="regular" />}
                  <Text style={[styles.menuItemText, { color: itemColor }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "stretch",
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      overflow: "hidden",
    },
    main: { minWidth: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md + 2 },
    toggle: { width: 36, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.75 },
    divider: { width: 1, backgroundColor: `${colors.onPrimary}59` },
    label: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.onPrimary },
    menu: {
      position: "absolute",
      width: MENU_WIDTH,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 12,
      elevation: 6,
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 3,
    },
    menuItemPressed: { backgroundColor: colors.surfaceAlt },
    menuItemText: { fontSize: 14, fontFamily: fontFamily.medium, color: colors.text },
  });
}
