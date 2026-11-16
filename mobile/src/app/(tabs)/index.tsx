import { useCallback, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { act, api } from "@/lib/api";
import { isPast, rel, time } from "@/lib/fmt";
import { useSession } from "@/lib/session";
import { TaskDone } from "@/lib/TaskDone";
import { Badge, Button, C, Empty, ErrorText, Loading, Row, Section, s } from "@/lib/ui";

type Task = { id: string; title: string; type: string; due_at: string; priority: string; enquiry_id: string; household_id: string; student: string; mobile: string | null; open_count: number; exempt: boolean };
type Day = { tasks: Task[]; fresh: { id: string; household_id: string; created_at: string; grade: string; student: string; mobile: string }[]; visits: { id: string; slot_at: string; checked_in_at: string | null; household_id: string; enquiry_id: string; student: string }[]; unreadReplies: number; unreadNotifications: number; slaMinutes: number };

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <View style={[s.card, { flex: 1, padding: 10, minWidth: 140 }]}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: "700", color: bad ? C.red : C.text }}>{value}</Text>
    </View>
  );
}

export default function MyDay() {
  const { me } = useSession();
  const router = useRouter();
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [doing, setDoing] = useState<Task | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try { setDay(await api<Day>("day")); setError(""); } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (household: string, enquiry: string) => router.push({ pathname: "/family/[id]", params: { id: household, e: enquiry } });
  const checkIn = async (visitId: string) => {
    const r = await act("visit", { visitId, what: "check_in" }).catch((e) => ({ ok: false, error: e.message }));
    setToast(r.ok ? "Checked in. The host was notified." : r.error ?? "Could not check in.");
    load();
  };

  if (!day && !error) return <Loading />;
  const now = Date.now();
  const overdue = day?.tasks.filter((t) => isPast(t.due_at)) ?? [];
  const soon = day?.tasks.filter((t) => !isPast(t.due_at) && new Date(t.due_at).getTime() < now + 2 * 3600e3) ?? [];
  const later = day?.tasks.filter((t) => new Date(t.due_at).getTime() >= now + 2 * 3600e3) ?? [];

  const TaskList = ({ title, rows, bad }: { title: string; rows: Task[]; bad?: boolean }) => (
    <Section title={`${title} · ${rows.length}`}>
      {!rows.length ? <Text style={[s.muted, { padding: 14 }]}>Nothing here.</Text> : rows.map((t) => (
        <View key={t.id} style={[s.row, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
          <Pressable style={{ flex: 1 }} onPress={() => open(t.household_id, t.enquiry_id)}>
            <Text style={{ fontWeight: "600", color: C.brand }}>{t.student}</Text>
            <Text style={s.text}>{t.title}{t.priority === "high" ? "  " : ""}{t.priority === "high" ? <Text style={{ color: C.red, fontSize: 12 }}>High</Text> : null}</Text>
            <Text style={[s.muted, bad && { color: C.red }]}>{rel(t.due_at)} · {time(t.due_at)}</Text>
          </Pressable>
          {t.mobile && <Button small title="Call" onPress={() => Linking.openURL(`tel:+91${t.mobile}`)} />}
          {me?.can.tasks && <Button small title="Done" onPress={() => setDoing(t)} />}
        </View>
      ))}
    </Section>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h1}>Hello, {me?.user.name.split(" ")[0]}</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>{me?.role} · {me?.school} · {me?.year}</Text>
      <ErrorText>{error}</ErrorText>
      {toast ? <Text style={[s.card, { padding: 10, marginBottom: 12, color: C.text }]} onPress={() => setToast("")}>✓ {toast}</Text> : null}
      {day && (
        <>
          <Row style={{ marginBottom: 12 }}>
            <Stat label="Overdue" value={overdue.length} bad={overdue.length > 0} />
            <Stat label="Awaiting first response" value={day.fresh.length} bad={day.fresh.length > 0} />
            <Stat label="Visits today" value={day.visits.length} />
            <Stat label="Unread replies" value={day.unreadReplies} />
          </Row>
          {me?.can.createLeads && <View style={{ marginBottom: 12 }}><Button title="+ Quick add enquiry" kind="primary" onPress={() => router.push("/add")} /></View>}
          <Section title="New leads waiting for a first call">
            {!day.fresh.length ? <Empty title="Every new enquiry has had a response" /> : day.fresh.map((f) => {
              const mins = Math.round((now - new Date(f.created_at).getTime()) / 60000);
              return (
                <View key={f.id} style={[s.row, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <Pressable style={{ flex: 1 }} onPress={() => open(f.household_id, f.id)}>
                    <Text style={{ fontWeight: "600", color: C.brand }}>{f.student}</Text>
                    <Text style={[s.muted, mins > day.slaMinutes && { color: C.red, fontWeight: "600" }]}>{f.grade} · waiting {rel(f.created_at).replace(" ago", "")}{mins > day.slaMinutes ? " (past target)" : ""}</Text>
                  </Pressable>
                  {f.mobile && <Button small kind="primary" title="Call" onPress={() => open(f.household_id, f.id)} />}
                </View>
              );
            })}
          </Section>
          <TaskList title="Overdue" rows={overdue} bad />
          <TaskList title="Due in the next 2 hours" rows={soon} />
          <TaskList title="Later today and tomorrow" rows={later} />
          <Section title="Visits today">
            {!day.visits.length ? <Empty title="No visits today" /> : day.visits.map((v) => (
              <View key={v.id} style={[s.row, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                <Pressable style={{ flex: 1 }} onPress={() => open(v.household_id, v.enquiry_id)}>
                  <Text style={{ fontWeight: "600", color: C.text }}>{time(v.slot_at)} · <Text style={{ color: C.brand }}>{v.student}</Text></Text>
                </Pressable>
                {v.checked_in_at ? <Badge tone="green">Arrived</Badge> : me?.can.visits ? <Button small title="Check in" onPress={() => checkIn(v.id)} /> : <Badge>Expected</Badge>}
              </View>
            ))}
          </Section>
        </>
      )}
      <TaskDone task={doing} lastOpen={!!doing && doing.open_count === 1 && !doing.exempt} onClose={() => setDoing(null)} onDone={(m) => { setDoing(null); setToast(m ?? "Task completed."); load(); }} />
    </ScrollView>
  );
}
