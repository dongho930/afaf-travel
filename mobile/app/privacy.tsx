import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily } from "../constants/fonts";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_INTRO,
  PRIVACY_POLICY_SECTIONS,
  PolicyBlock,
} from "../constants/privacyPolicy";
import { ThemeColors } from "../constants/theme";
import { radius, spacing } from "../constants/tokens";
import { useTheme } from "../services/ThemeContext";

/**
 * 개인정보처리방침 화면. 로그인 없이 볼 수 있어야 해서 프로필·설정·회원가입
 * 화면 어디서든 들어올 수 있고, 웹에서는 /privacy 주소 자체가 스토어에 등록하는
 * 공개 방침 주소가 됩니다. 본문은 constants/privacyPolicy.ts에 있습니다.
 */
export default function PrivacyPolicyScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingBottom: spacing.xxl + insets.bottom }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        경기포올 개인정보처리방침
      </Text>
      <Text style={styles.meta}>시행일 {PRIVACY_POLICY_EFFECTIVE_DATE}</Text>
      <Text style={styles.paragraph}>{PRIVACY_POLICY_INTRO}</Text>

      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {section.title}
          </Text>
          {section.blocks.map((block, i) => (
            <PolicyBlockView key={i} block={block} styles={styles} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function PolicyBlockView({ block, styles }: { block: PolicyBlock; styles: Styles }) {
  if (block.type === "paragraph") {
    return <RichText style={styles.paragraph} boldStyle={styles.bold} text={block.text} />;
  }

  if (block.type === "bullets") {
    return (
      <View style={styles.bulletList}>
        {block.items.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <Text style={styles.bulletDot} aria-hidden>
              •
            </Text>
            <RichText style={[styles.paragraph, styles.bulletText]} boldStyle={styles.bold} text={item} />
          </View>
        ))}
      </View>
    );
  }

  // 두 열짜리 표(항목/내용)는 한 카드 안에 "이름  값" 줄로 모아 보여줍니다.
  if (block.headers.length === 2) {
    return (
      <View style={styles.card}>
        {block.rows.map(([label, value]) => (
          <View key={label} style={styles.pairRow}>
            <Text style={styles.pairLabel}>{label}</Text>
            <Text style={styles.pairValue} selectable>
              {value}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  // 세 열 이상인 표는 행마다 카드 하나 — 첫 열이 제목, 나머지는 "열 이름: 값"으로 읽힙니다.
  const [, ...fieldHeaders] = block.headers;
  return (
    <View style={styles.cardList}>
      {block.rows.map(([rowTitle, ...values]) => (
        <View key={rowTitle} style={styles.card}>
          <Text style={styles.cardTitle}>{rowTitle}</Text>
          {values.map((value, i) => (
            <View key={fieldHeaders[i]} style={styles.field}>
              <Text style={styles.fieldLabel}>{fieldHeaders[i]}</Text>
              <Text style={styles.fieldValue}>{value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** "**굵게**" 표시가 들어간 문장을 굵은 부분만 따로 그립니다. */
function RichText({
  text,
  style,
  boldStyle,
}: {
  text: string;
  style: React.ComponentProps<typeof Text>["style"];
  boldStyle: React.ComponentProps<typeof Text>["style"];
}) {
  const parts = text.split("**");
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={boldStyle}>
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { padding: spacing.xl, maxWidth: 720, width: "100%", alignSelf: "center" },
    title: { fontSize: 22, fontFamily: fontFamily.extraBold, color: colors.text, marginBottom: spacing.xs },
    meta: { fontSize: 13, fontFamily: fontFamily.medium, color: colors.textSecondary, marginBottom: spacing.lg },
    section: { marginTop: spacing.xl + spacing.xs, gap: spacing.md },
    sectionTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: colors.text },
    paragraph: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 22 },
    bold: { fontFamily: fontFamily.bold },
    bulletList: { gap: spacing.sm },
    bulletRow: { flexDirection: "row", gap: spacing.sm },
    bulletDot: { fontSize: 14, lineHeight: 22, color: colors.textSecondary },
    bulletText: { flex: 1 },
    cardList: { gap: spacing.sm + 2 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm + 2,
    },
    cardTitle: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
    field: { gap: 2 },
    fieldLabel: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textSecondary },
    fieldValue: { fontSize: 14, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 21 },
    pairRow: { flexDirection: "row", gap: spacing.md },
    pairLabel: { width: 56, fontSize: 14, fontFamily: fontFamily.medium, color: colors.textSecondary },
    pairValue: { flex: 1, fontSize: 14, fontFamily: fontFamily.semiBold, color: colors.text },
  });
}
