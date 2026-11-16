import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

export const C = {
  brand: "#0f6e6e", brandDark: "#0a3d3f", brandLight: "#eef8f7", text: "#1e293b", muted: "#64748b", line: "#e2e8f0", bg: "#f8fafc", white: "#ffffff",
  red: "#be123c", redBg: "#fff1f2", amber: "#b45309", amberBg: "#fffbeb", green: "#15803d", greenBg: "#f0fdf4",
};

const TONES: Record<string, [string, string]> = {
  slate: ["#f1f5f9", "#334155"], sky: ["#e0f2fe", "#075985"], violet: ["#ede9fe", "#5b21b6"], amber: ["#fef3c7", "#92400e"], orange: ["#ffedd5", "#9a3412"],
  teal: ["#ccfbf1", "#115e59"], green: ["#dcfce7", "#166534"], rose: ["#ffe4e6", "#9f1239"], red: ["#fee2e2", "#b91c1c"],
};

export function Badge({ tone = "slate", children }: { tone?: string; children: ReactNode }) {
  const [bg, fg] = TONES[tone] ?? TONES.slate;
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeText, { color: fg }]}>{children}</Text></View>;
}

export function Temp({ t }: { t?: string | null }) {
  if (!t) return null;
  return <Badge tone={t === "Hot" ? "red" : t === "Warm" ? "amber" : "slate"}>{t === "Hot" ? "▲ " : t === "Warm" ? "● " : "▽ "}{t}</Badge>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={s.sectionHead}><Text style={s.sectionTitle}>{title}</Text>{right}</View>
      {children}
    </Card>
  );
}

export function Button({ title, onPress, kind = "default", disabled, small, testID }: { title: string; onPress: () => void; kind?: "default" | "primary" | "danger"; disabled?: boolean; small?: boolean; testID?: string }) {
  const bg = kind === "primary" ? C.brand : C.white;
  const fg = kind === "primary" ? C.white : kind === "danger" ? C.red : C.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, borderColor: kind === "primary" ? C.brand : kind === "danger" ? "#fda4af" : "#cbd5e1", opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { color: C.brand }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#94a3b8" {...props} style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: "top" }, props.style]} />
    </View>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <Text accessibilityRole="alert" style={s.error}>{children}</Text>;
}

export function Loading() {
  return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={C.brand} /></View>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <View style={{ padding: 24, alignItems: "center" }}><Text style={{ fontWeight: "600", color: C.text }}>{title}</Text>{children ? <Text style={[s.muted, { textAlign: "center", marginTop: 4 }]}>{children}</Text> : null}</View>;
}

/** Bottom sheet used for every action form, so the user never leaves the record. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.sheetHead}><Text style={s.sheetTitle}>{title}</Text><Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={{ fontSize: 22, color: C.muted }}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, style]}>{children}</View>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 12 },
  h1: { fontSize: 22, fontWeight: "700", color: C.text },
  muted: { color: C.muted, fontSize: 13 },
  text: { color: C.text, fontSize: 15 },
  card: { backgroundColor: C.white, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  sectionTitle: { fontWeight: "700", color: C.text, fontSize: 15 },
  row: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  btn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, alignItems: "center", justifyContent: "center", minHeight: 44 },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 34 },
  btnText: { fontWeight: "600", fontSize: 15 },
  chip: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.white },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandLight },
  chipText: { fontSize: 13, fontWeight: "600", color: "#475569" },
  label: { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: C.white },
  error: { backgroundColor: C.redBg, color: C.red, padding: 10, borderRadius: 8, marginBottom: 12 },
  scrim: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "88%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: C.text, flex: 1 },
});
