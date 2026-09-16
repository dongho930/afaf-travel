import { PencilSimpleIcon, TrashIcon } from "phosphor-react-native";
import React from "react";
import { StyleSheet } from "react-native";
import { spacing } from "../constants/tokens";
import { SegmentedButtonGroup } from "./SegmentedButtonGroup";

/** 목록 카드 오른쪽 위의 작은 '수정 | 삭제' 버튼 묶음. */
export function EditDeleteButtons({
  name,
  onEdit,
  onDelete,
}: {
  // 스크린리더가 무엇을 수정/삭제하는지 알 수 있게 항목 이름을 함께 읽어줍니다.
  name: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <SegmentedButtonGroup
      size="sm"
      style={styles.group}
      items={[
        { key: "edit", label: "수정", icon: PencilSimpleIcon, onPress: onEdit, accessibilityLabel: `${name} 수정` },
        {
          key: "delete",
          label: "삭제",
          icon: TrashIcon,
          tone: "danger",
          onPress: onDelete,
          accessibilityLabel: `${name} 삭제`,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  group: { flexShrink: 0, marginLeft: spacing.sm },
});
