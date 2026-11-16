// Quick add with the same live duplicate check as the web (DUP-01): a known mobile shows the family first.
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { act, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, C, Chip, ErrorText, Field, Row, s } from "@/lib/ui";

type Dup = { householdId: string; guardian: string; enquiries: { id: string; student: string; grade: string; stage: string; owner: string; year: string }[] } | null;

export default function Add() {
  const { me, options } = useSession();
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [student, setStudent] = useState("");
  const [guardian, setGuardian] = useState("");
  const [grade, setGrade] = useState("");
  const [branchId, setBranchId] = useState(me?.branches[0]?.id ?? "");
  const [sourceId, setSourceId] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(true);
  const [dup, setDup] = useState<Dup>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = mobile.replace(/\D/g, "");
    if (m.length < 10) { setDup(null); return; }
    const t = setTimeout(() => api<{ match: Dup }>(`dedupe?mobile=${m}`).then((r) => setDup(r.match)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [mobile]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      const r = await act("quick_add", { mobile, studentName: student, guardianName: guardian || dup?.guardian || "Parent", grade, branchId, sourceId, note, consent: consent ? "on" : "" });
      if (!r.ok) setError(r.error ?? "Could not save.");
      else if (r.canOpen !== false) router.replace({ pathname: "/family/[id]", params: { id: r.householdId, e: r.enquiryId } });
      else router.back();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const walkinSources = (options?.sources ?? []).filter((x) => ["Walk-in", "Phone", "Referral", "Events", "WhatsApp"].includes(x.channel));
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Field label="Parent mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="10-digit mobile" autoFocus testID="mobile" />
      {dup && (
        <View style={[s.card, { padding: 12, marginBottom: 12, borderColor: "#fcd34d", backgroundColor: C.amberBg }]}>
          <Text style={{ fontWeight: "700", color: C.amber }}>This family is already with us: {dup.guardian}</Text>
          {dup.enquiries.map((x) => <Text key={x.id} style={{ color: C.amber }}>{x.student} · {x.grade ?? "grade not set"} · {x.stage} · {x.owner}</Text>)}
          <Text style={{ color: C.amber, marginTop: 4 }}>Saving will not create a duplicate. Same child: adds a re-enquiry. New child: adds a sibling.</Text>
        </View>
      )}
      <Field label="Student name" value={student} onChangeText={setStudent} />
      {!dup && <Field label="Parent / guardian name" value={guardian} onChangeText={setGuardian} />}
      <Text style={s.label}>Grade</Text>
      <Row style={{ marginBottom: 12 }}>{(options?.grades ?? []).map((x) => <Chip key={x} label={x} on={grade === x} onPress={() => setGrade(x)} />)}</Row>
      {(me?.branches.length ?? 0) > 1 && (
        <>
          <Text style={s.label}>Branch</Text>
          <Row style={{ marginBottom: 12 }}>{me!.branches.map((b) => <Chip key={b.id} label={b.name} on={branchId === b.id} onPress={() => setBranchId(b.id)} />)}</Row>
        </>
      )}
      <Text style={s.label}>Source</Text>
      <Row style={{ marginBottom: 12 }}>{(walkinSources.length ? walkinSources : options?.sources ?? []).map((x) => <Chip key={x.id} label={x.name} on={sourceId === x.id} onPress={() => setSourceId(x.id)} />)}</Row>
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
      <Row style={{ marginBottom: 14 }}><Chip label={consent ? "✓ Parent agreed to be contacted" : "Parent agreed to be contacted?"} on={consent} onPress={() => setConsent(!consent)} /></Row>
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : dup ? "Save to this household" : "Save enquiry"} kind="primary" onPress={save} disabled={busy || !mobile || !student || !grade || !sourceId} testID="save" />
    </ScrollView>
  );
}
