import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";
import { fontFamily } from "../constants/fonts";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

interface Props {
  visible: boolean;
  initialStartDate?: string | null; // "YYYY-MM-DD"
  initialEndDate?: string | null;
  onClose: () => void;
  onConfirm: (startDate: string | null, endDate: string | null) => void;
}

/**
 * 여행 시작일~종료일을 달력에서 범위로 선택하는 모달입니다.
 * 첫 번째 탭으로 시작일을, 두 번째 탭으로 종료일을 지정합니다
 * (종료일이 시작일보다 빠르면 시작일을 새로 다시 잡습니다).
 */
export function DateRangePickerModal({ visible, initialStartDate, initialEndDate, onClose, onConfirm }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [startDate, setStartDate] = useState<string | null>(initialStartDate ?? null);
  const [endDate, setEndDate] = useState<string | null>(initialEndDate ?? null);

  // 모달이 새로 열릴 때마다 기존 선택값으로 초기화
  React.useEffect(() => {
    if (visible) {
      setStartDate(initialStartDate ?? null);
      setEndDate(initialEndDate ?? null);
    }
  }, [visible, initialStartDate, initialEndDate]);

  const handleDayPress = (day: DateData) => {
    const picked = day.dateString;
    if (!startDate || (startDate && endDate)) {
      // 아직 선택 없음, 또는 이미 범위가 완성된 상태 → 새로 시작일부터 다시 선택
      setStartDate(picked);
      setEndDate(null);
      return;
    }
    // 시작일만 선택된 상태 → 이번 탭을 종료일로
    if (picked < startDate) {
      // 시작일보다 이른 날짜를 누르면 그걸 새 시작일로
      setStartDate(picked);
      setEndDate(null);
    } else {
      setEndDate(picked);
    }
  };

  const markedDates = useMemo(() => {
    if (!startDate) return {};
    if (!endDate) {
      return { [startDate]: { startingDay: true, endingDay: true, color: colors.primary, textColor: colors.onPrimary } };
    }
    const marks: Record<string, any> = {};
    let cursor = startDate;
    while (cursor <= endDate) {
      const isStart = cursor === startDate;
      const isEnd = cursor === endDate;
      marks[cursor] = {
        startingDay: isStart,
        endingDay: isEnd,
        color: isStart || isEnd ? colors.primary : colors.primaryLight,
        textColor: isStart || isEnd ? colors.onPrimary : colors.text,
      };
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return marks;
  }, [startDate, endDate, colors]);

  const handleConfirm = () => {
    onConfirm(startDate, endDate);
    onClose();
  };

  const handleClear = () => {
    setStartDate(null);
    setEndDate(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>여행 날짜 선택</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>닫기</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            {startDate && endDate
              ? `${startDate} ~ ${endDate}`
              : startDate
                ? "종료일을 선택해주세요 (같은 날짜를 또 누르면 하루짜리 여행이 돼요)"
                : "시작일을 선택해주세요"}
          </Text>

          <Calendar
            markingType="period"
            markedDates={markedDates}
            onDayPress={handleDayPress}
            theme={{
              calendarBackground: colors.surfaceAlt,
              dayTextColor: colors.text,
              monthTextColor: colors.text,
              textDisabledColor: colors.textTertiary,
              todayTextColor: colors.primary,
              arrowColor: colors.primary,
              selectedDayBackgroundColor: colors.primary,
              selectedDayTextColor: colors.onPrimary,
              textDayFontSize: 14,
              textMonthFontSize: 15,
              textMonthFontWeight: "700",
            }}
          />

          <View style={styles.buttonRow}>
            <Pressable style={styles.clearButton} onPress={handleClear}>
              <Text style={styles.clearButtonText}>초기화</Text>
            </Pressable>
            <Pressable style={styles.confirmButton} onPress={handleConfirm}>
              <Text style={styles.confirmButtonText}>선택 완료</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%",
    maxWidth: 640, // 웹에서 넓은 화면일 때 앱 폭(WebFrame)에 맞춰 시트도 가운데 정렬되게
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl - 4,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  title: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
  close: { fontSize: 14, color: colors.primary, fontFamily: fontFamily.semiBold },
  hint: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.md },
  buttonRow: { flexDirection: "row", gap: spacing.sm + 2, marginTop: spacing.lg },
  clearButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  clearButtonText: { color: colors.textSecondary, fontFamily: fontFamily.bold, fontSize: 15 },
  confirmButton: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.lg - 2,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
  },
  confirmButtonText: { color: colors.onPrimary, fontFamily: fontFamily.bold, fontSize: 15 },
  });
}
