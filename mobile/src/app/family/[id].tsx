// Household 360 on the phone: header, one action bar, tasks, visits and the unified timeline.
// Calling opens the dialler; when the counsellor comes back to the app it asks how the call went.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { act, api } from "@/lib/api";
import { dateTime, dueChoices, isPast, rel } from "@/lib/fmt";
import { useSession } from "@/lib/session";
import { TaskDone } from "@/lib/TaskDone";
import { Badge, Button, C, Chip, ErrorText, Field, Loading, Row, Section, Sheet, s, Temp } from "@/lib/ui";

type Enquiry = { id: string; stage_id: string; student: string; grade: string; board: string; stage: string; color: string; score: number; temperature: string | null; owner: string; branch: string; year: string; reenquired: boolean; is_closed: boolean; is_won: boolean; exempt_next_action: boolean; application_no: string | null; dob: string | null; closure_reason: string | null };
type Data = {
  household: { id: string; locality: string | null }; guardians: { name: string; relation: string; mobile: string; email: string | null; consent: any }[]; current: string;
  enquiries: Enquiry[]; timeline: { id: string; type: string; content: string; direction: string | null; failed: boolean; at: string; actor: string | null }[];
  tasks: { id: string; title: string; type: string; due_at: string; status: string; outcome: string | null; priority: string; owner: string }[];
  visits: { id: string; slot_at: string; status: string; type: string; checked_in_at: string | null; outcome: string | null; host: string | null }[];
  score: { score: number; parts: { key: string; label: string; count: number; points: number }[] }; needsNextAction: boolean;
};

const ICON: Record<string, string> = { call: "📞", whatsapp: "💬", sms: "✉", email: "📧", note: "📝", visit: "🏫", stage_change: "➜", field_change: "✎", payment: "₹", document: "📎", system: "⚙", form: "📄", touch: "◎", task: "✓" };
const OUTCOMES: [string, string][] = [["connected", "Connected"], ["not_answered", "Not answered"], ["busy", "Busy"], ["switched_off", "Switched off"], ["wrong_number", "Wrong number"]];

export default function Family() {
  const { id, e } = useLocalSearchParams<{ id: string; e?: string }>();
  const { me, options } = useSession();
  const router = useRouter();
  const [enquiryId, setEnquiryId] = useState(e || "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState<"" | "call" | "message" | "note" | "task" | "stage" | "visit">("");
  const [doing, setDoing] = useState<Data["tasks"][number] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const callStarted = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>(`household/${id}${enquiryId ? `?e=${enquiryId}` : ""}`);
      setData(d); setError("");
      if (!enquiryId) setEnquiryId(d.current);
    } catch (err: any) { setError(err.message); }
  }, [id, enquiryId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Back from the dialler: ask for the call outcome (a disposition is required after every call).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && callStarted.current && Date.now() - callStarted.current > 3000) { setSheet("call"); }
    });
    return () => sub.remove();
  }, []);

  if (!data) return <View style={s.screen}>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</View>;
  const enq = data.enquiries.find((x) => x.id === data.current) ?? data.enquiries[0];
  const g = data.guardians[0];
  const openTasks = data.tasks.filter((t) => t.status === "open");
  const next = [...openTasks].sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at))[0];
  const can = me?.can;

  const run = async (kind: string, fields: Record<string, unknown>, okText: string) => {
    try {
      const r = await act(kind, { enquiryId: enq.id, ...fields });
      if (!r.ok) return r.missing?.includes("visit") ? "This stage needs a booked visit. Book the visit and the stage moves by itself." : r.missing?.includes("closure_reason") ? "Choose a closure reason." : r.error ?? "Could not save.";
      setSheet(""); setToast(r.message ?? okText); load();
      return "";
    } catch (err: any) { return err.message as string; }
  };

  const call = () => { callStarted.current = Date.now(); Linking.openURL(`tel:+91${g.mobile}`); };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: `${g?.name ?? "Family"}` }} />
      {toast ? <Text style={[s.card, { padding: 10, marginBottom: 10 }]} onPress={() => setToast("")}>✓ {toast}</Text> : null}
      <Text style={s.muted}>{g?.relation} · +91 {g?.mobile}{data.household.locality ? ` · ${data.household.locality}` : ""}</Text>

      {data.enquiries.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
          {data.enquiries.map((x) => <Chip key={x.id} label={`${x.student} · ${x.grade}`} on={x.id === enq.id} onPress={() => setEnquiryId(x.id)} />)}
        </ScrollView>
      )}

      <View style={[s.card, { padding: 12, marginVertical: 8, gap: 6 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: C.text, flex: 1 }}>{enq.student}</Text>
          <Badge tone={enq.color}>{enq.stage}</Badge>
        </View>
        <Text style={s.muted}>{enq.grade} · {enq.board} · {enq.branch} · {enq.year}</Text>
        <Row><Temp t={enq.temperature} /><Text style={s.muted}>Score {enq.score} · Owner {enq.owner}</Text>{enq.reenquired && <Badge tone="amber">Re-enquired</Badge>}</Row>
        {data.score.parts.length > 0 && <Text style={s.muted}>Why: {data.score.parts.slice(0, 3).map((p) => `${p.label} +${p.points}`).join(", ")}</Text>}
        <Text style={[s.text, next && isPast(next.due_at) && { color: C.red, fontWeight: "600" }]}>Next: {next ? `${next.title} · ${rel(next.due_at)}` : data.needsNextAction ? "none planned" : "not needed in this stage"}</Text>
      </View>

      {data.needsNextAction && can?.tasks && (
        <View style={[s.card, { padding: 12, marginBottom: 10, borderColor: "#fda4af", backgroundColor: C.redBg }]}>
          <Text style={{ color: C.red, fontWeight: "700", marginBottom: 8 }}>No next action is planned. Plan one so this family is not forgotten.</Text>
          <Button title="Plan next action" kind="primary" onPress={() => setSheet("task")} />
        </View>
      )}

      <Row style={{ marginBottom: 12 }}>
        {can?.editLeads && <Button title="📞 Call" kind="primary" onPress={call} />}
        {can?.message && <Button title="💬 Message" onPress={() => setSheet("message")} />}
        <Button title="📝 Note" onPress={() => setSheet("note")} />
        {can?.tasks && <Button title="⏰ Task" onPress={() => setSheet("task")} />}
        {can?.visits && <Button title="🏫 Visit" onPress={() => setSheet("visit")} />}
        {can?.editLeads && <Button title="➜ Stage" onPress={() => setSheet("stage")} />}
        {can?.editLeads && <Button title="Log a call" onPress={() => setSheet("call")} />}
      </Row>

      <Section title={`Tasks · ${openTasks.length} open`}>
        {!data.tasks.length ? <Text style={[s.muted, { padding: 14 }]}>No tasks yet.</Text> : data.tasks.slice(0, 8).map((t) => (
          <View key={t.id} style={[s.row, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, t.status !== "open" && { color: C.muted, textDecorationLine: "line-through" }]}>{t.title}</Text>
              <Text style={[s.muted, t.status === "open" && isPast(t.due_at) && { color: C.red }]}>{t.status === "open" ? rel(t.due_at) : t.status === "done" ? `Done: ${t.outcome ?? ""}` : "Cancelled"} · {t.owner}</Text>
            </View>
            {t.status === "open" && can?.tasks && <Button small title="Done" onPress={() => setDoing(t)} />}
          </View>
        ))}
      </Section>

      {data.visits.length > 0 && (
        <Section title="Visits">
          {data.visits.map((v) => (
            <View key={v.id} style={[s.row, { gap: 6 }]}>
              <Row><Text style={{ fontWeight: "600" }}>{dateTime(v.slot_at)}</Text><Badge tone={v.status === "done" ? "green" : v.status === "scheduled" ? "violet" : "rose"}>{v.status === "no_show" ? "No-show" : v.status}</Badge></Row>
              <Text style={s.muted}>{v.type.replace("_", " ")} · host {v.host ?? "not set"}{v.outcome ? ` · ${v.outcome}` : ""}</Text>
              {v.status === "scheduled" && can?.visits && (
                <Row>
                  {!v.checked_in_at && <Button small title="Check in" onPress={() => run("visit", { visitId: v.id, what: "check_in" }, "Checked in.")} />}
                  <Button small title="Done" onPress={() => run("visit", { visitId: v.id, what: "done", outcome: "Visited the campus" }, "Visit marked done.")} />
                  <Button small title="No-show" onPress={() => run("visit", { visitId: v.id, what: "no_show" }, "Marked no-show.")} />
                </Row>
              )}
            </View>
          ))}
        </Section>
      )}

      <Section title="Timeline">
        {data.timeline.map((a) => (
          <View key={a.id} style={[s.row, { flexDirection: "row", gap: 10 }]}>
            <Text style={{ fontSize: 16 }}>{ICON[a.type] ?? "•"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.muted}>{a.actor ?? (a.direction === "in" ? g?.name : "Automatic")} · {dateTime(a.at)}</Text>
              <Text style={[s.text, a.failed && { color: C.red, fontWeight: "600" }]}>{a.content}</Text>
            </View>
          </View>
        ))}
      </Section>

      <CallSheet visible={sheet === "call"} onClose={() => { setSheet(""); callStarted.current = 0; }} onSave={(f) => { callStarted.current = 0; return run("call", f, "Call logged."); }} />
      <MessageSheet visible={sheet === "message"} templates={options?.templates ?? []} onClose={() => setSheet("")} onSave={(f) => run("message", f, "Message sent.")} />
      <NoteSheet visible={sheet === "note"} onClose={() => setSheet("")} onSave={(f) => run("note", f, "Note saved.")} />
      <TaskSheet visible={sheet === "task"} onClose={() => setSheet("")} onSave={(f) => run("task_add", f, "Task added.")} />
      <VisitSheet visible={sheet === "visit"} onClose={() => setSheet("")} onSave={(f) => run("visit_book", f, "Visit booked. The parent gets a confirmation.")} />
      <StageSheet visible={sheet === "stage"} current={enq.stage_id} onClose={() => setSheet("")} onSave={(f) => run("stage", f, "Stage changed.")} />
      <TaskDone task={doing} lastOpen={!!doing && openTasks.length === 1 && !enq.exempt_next_action} onClose={() => setDoing(null)} onDone={(m) => { setDoing(null); setToast(m ?? "Task completed."); load(); }} />
      <Pressable onPress={() => router.back()} style={{ padding: 12 }}><Text style={[s.muted, { textAlign: "center" }]}>Back</Text></Pressable>
    </ScrollView>
  );
}

type Save = (fields: Record<string, unknown>) => Promise<string>;

function useSave(onSave: Save) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (f: Record<string, unknown>) => { setBusy(true); setError(await onSave(f)); setBusy(false); };
  return { error, busy, save, setError };
}

function CallSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: Save }) {
  const [outcome, setOutcome] = useState("connected");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const { error, busy, save } = useSave(onSave);
  return (
    <Sheet visible={visible} title="How did the call go?" onClose={onClose}>
      <Row style={{ marginBottom: 14 }}>{OUTCOMES.map(([k, l]) => <Chip key={k} label={l} on={outcome === k} onPress={() => setOutcome(k)} />)}</Row>
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="What did the parent say?" />
      <Text style={s.label}>Next follow-up (optional)</Text>
      <Row style={{ marginBottom: 14 }}>{dueChoices().map((d) => <Chip key={d.label} label={d.label} on={due === d.iso} onPress={() => setDue(due === d.iso ? "" : d.iso)} />)}</Row>
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : "Log call"} kind="primary" disabled={busy} onPress={() => save({ outcome, notes, nextDue: due, nextTitle: "Follow-up call" })} />
    </Sheet>
  );
}

function MessageSheet({ visible, templates, onClose, onSave }: { visible: boolean; templates: { id: string; name: string; channel: string; body: string }[]; onClose: () => void; onSave: Save }) {
  const [channel, setChannel] = useState("whatsapp");
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const { error, busy, save } = useSave(onSave);
  const list = templates.filter((t) => t.channel === channel);
  const tpl = list.find((t) => t.id === templateId);
  return (
    <Sheet visible={visible} title="Send a message" onClose={onClose}>
      <Row style={{ marginBottom: 12 }}>{[["whatsapp", "WhatsApp"], ["sms", "SMS"], ["email", "Email"]].map(([k, l]) => <Chip key={k} label={l} on={channel === k} onPress={() => { setChannel(k); setTemplateId(""); }} />)}</Row>
      <Text style={s.label}>Template</Text>
      <Row style={{ marginBottom: 12 }}><Chip label="Free text" on={!templateId} onPress={() => setTemplateId("")} />{list.map((t) => <Chip key={t.id} label={t.name} on={templateId === t.id} onPress={() => setTemplateId(t.id)} />)}</Row>
      {tpl ? <Text style={[s.card, { padding: 10, marginBottom: 12, color: "#475569" }]}>{tpl.body}</Text> : <Field label="Message" value={body} onChangeText={setBody} multiline />}
      {channel === "whatsapp" && !tpl && <Text style={[s.muted, { marginBottom: 10 }]}>Free text on WhatsApp only works within 24 hours of the parent's last message.</Text>}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Sending…" : "Send"} kind="primary" disabled={busy || (!tpl && !body.trim())} onPress={() => save({ channel, templateId, body })} />
    </Sheet>
  );
}

function NoteSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: Save }) {
  const [note, setNote] = useState("");
  const { error, busy, save } = useSave(async (f) => { const r = await onSave(f); if (!r) setNote(""); return r; });
  return (
    <Sheet visible={visible} title="Add a note" onClose={onClose}>
      <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="Type @firstname to notify a colleague" autoFocus />
      <Text style={[s.muted, { marginBottom: 10 }]}>Tip: use the microphone on your keyboard to dictate.</Text>
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : "Save note"} kind="primary" disabled={busy || !note.trim()} onPress={() => save({ note })} />
    </Sheet>
  );
}

function TaskSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: Save }) {
  const [title, setTitle] = useState("Follow-up call");
  const [due, setDue] = useState(dueChoices()[2].iso);
  const [high, setHigh] = useState(false);
  const { error, busy, save } = useSave(onSave);
  return (
    <Sheet visible={visible} title="Plan a task" onClose={onClose}>
      <Field label="Task" value={title} onChangeText={setTitle} />
      <Text style={s.label}>Due</Text>
      <Row style={{ marginBottom: 12 }}>{dueChoices().map((d) => <Chip key={d.label} label={d.label} on={due === d.iso} onPress={() => setDue(d.iso)} />)}</Row>
      <Row style={{ marginBottom: 14 }}><Chip label="Normal" on={!high} onPress={() => setHigh(false)} /><Chip label="High priority" on={high} onPress={() => setHigh(true)} /></Row>
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : "Add task"} kind="primary" disabled={busy || !title.trim()} onPress={() => save({ title, dueAt: due, type: "call_back", priority: high ? "high" : "normal" })} />
    </Sheet>
  );
}

function VisitSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: Save }) {
  const choices = dueChoices().slice(2);
  const [slot, setSlot] = useState(choices[0].iso);
  const [type, setType] = useState("campus_tour");
  const { error, busy, save } = useSave(onSave);
  return (
    <Sheet visible={visible} title="Book a campus visit" onClose={onClose}>
      <Text style={s.label}>Type</Text>
      <Row style={{ marginBottom: 12 }}>{[["campus_tour", "Campus tour"], ["counselling", "Counselling"], ["interaction", "Interaction"]].map(([k, l]) => <Chip key={k} label={l} on={type === k} onPress={() => setType(k)} />)}</Row>
      <Text style={s.label}>When</Text>
      <Row style={{ marginBottom: 14 }}>{choices.map((d) => <Chip key={d.label} label={`${d.label} · ${dateTime(d.iso)}`} on={slot === d.iso} onPress={() => setSlot(d.iso)} />)}</Row>
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Booking…" : "Book visit"} kind="primary" disabled={busy} onPress={() => save({ slotAt: slot, type })} />
    </Sheet>
  );
}

function StageSheet({ visible, current, onClose, onSave }: { visible: boolean; current: string; onClose: () => void; onSave: Save }) {
  const { options } = useSession();
  const [stageId, setStageId] = useState("");
  const [reason, setReason] = useState("");
  const { error, busy, save } = useSave(onSave);
  const stage = options?.stages.find((x) => x.id === stageId);
  const phases = [...new Set((options?.stages ?? []).map((x) => x.phase))];
  return (
    <Sheet visible={visible} title="Change stage" onClose={onClose}>
      {phases.map((p) => (
        <View key={p} style={{ marginBottom: 10 }}>
          <Text style={s.label}>{p}</Text>
          <Row>{options!.stages.filter((x) => x.phase === p && x.id !== current).map((x) => <Chip key={x.id} label={x.name} on={stageId === x.id} onPress={() => setStageId(x.id)} />)}</Row>
        </View>
      ))}
      {stage?.closed && (
        <>
          <Text style={s.label}>Why is this enquiry closing?</Text>
          <Row style={{ marginBottom: 14 }}>{(options?.reasons ?? []).map((r) => <Chip key={r} label={r} on={reason === r} onPress={() => setReason(r)} />)}</Row>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : "Move"} kind="primary" disabled={busy || !stageId || (stage?.closed && !reason)} onPress={() => save({ stageId, closure_reason: reason })} />
    </Sheet>
  );
}
