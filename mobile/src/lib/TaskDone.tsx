// Complete a task with its outcome. When it is the enquiry's last open task, the same sheet asks for
// the next action and the server refuses to save without one (TSK-03, same rule as the web).
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { act } from "./api";
import { dueChoices } from "./fmt";
import { useSession } from "./session";
import { Button, C, Chip, ErrorText, Field, Row, Sheet, s } from "./ui";

const OUTCOMES = ["Spoke to parent, interested", "Not answered", "Asked to call later", "Visit planned", "Shared fee details", "Not interested"];

export function TaskDone({ task, lastOpen, onClose, onDone }: { task: { id: string; title: string } | null; lastOpen: boolean; onClose: () => void; onDone: (message?: string) => void }) {
  const { options } = useSession();
  const [outcome, setOutcome] = useState("");
  const [next, setNext] = useState<"task" | "stage" | "none">(lastOpen ? "task" : "none");
  const [title, setTitle] = useState("Follow-up call");
  const [due, setDue] = useState(dueChoices()[2].iso);
  const [stageId, setStageId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The sheet stays mounted between tasks, so start fresh each time it opens.
  useEffect(() => {
    if (!task) return;
    setOutcome(""); setError(""); setStageId(""); setReason(""); setTitle("Follow-up call"); setDue(dueChoices()[2].iso);
    setNext(lastOpen ? "task" : "none");
  }, [task?.id, lastOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const stages = (options?.stages ?? []).filter((x) => !lastOpen || x.exempt);
  const stage = stages.find((x) => x.id === stageId);

  const save = async () => {
    if (!task) return;
    setBusy(true); setError("");
    try {
      const r = await act("task_done", { taskId: task.id, outcome, next, nextTitle: title, nextDue: due, nextType: "call_back", stageId, closure_reason: reason });
      if (!r.ok) setError(r.error ?? "Could not save.");
      else { onDone(r.message); setOutcome(""); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Sheet visible={!!task} title={`Complete: ${task?.title ?? ""}`} onClose={onClose}>
      <Field label="What happened?" value={outcome} onChangeText={setOutcome} placeholder="Outcome" />
      <Row style={{ marginTop: -4, marginBottom: 14 }}>{OUTCOMES.map((o) => <Chip key={o} label={o} on={outcome === o} onPress={() => setOutcome(o)} />)}</Row>
      <Text style={s.label}>{lastOpen ? "Next action (required: this is the last open task)" : "Next action"}</Text>
      <Row style={{ marginBottom: 14 }}>
        <Chip label="Schedule a task" on={next === "task"} onPress={() => setNext("task")} />
        <Chip label="Move stage / close" on={next === "stage"} onPress={() => setNext("stage")} />
        {!lastOpen && <Chip label="Nothing more" on={next === "none"} onPress={() => setNext("none")} />}
      </Row>
      {next === "task" && (
        <View>
          <Field label="Task" value={title} onChangeText={setTitle} />
          <Text style={s.label}>Due</Text>
          <Row style={{ marginBottom: 14 }}>{dueChoices().map((d) => <Chip key={d.label} label={d.label} on={due === d.iso} onPress={() => setDue(d.iso)} />)}</Row>
        </View>
      )}
      {next === "stage" && (
        <View>
          <Text style={s.label}>Move to</Text>
          <Row style={{ marginBottom: 14 }}>{stages.map((x) => <Chip key={x.id} label={`${x.phase}: ${x.name}`} on={stageId === x.id} onPress={() => setStageId(x.id)} />)}</Row>
          {stage?.closed && (
            <>
              <Text style={s.label}>Closure reason</Text>
              <Row style={{ marginBottom: 14 }}>{(options?.reasons ?? []).map((r) => <Chip key={r} label={r} on={reason === r} onPress={() => setReason(r)} />)}</Row>
            </>
          )}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? "Saving…" : "Complete task"} kind="primary" onPress={save} disabled={busy || !outcome} />
      <Text style={[s.muted, { marginTop: 8, color: C.muted }]}>The parent's record and timeline update straight away.</Text>
    </Sheet>
  );
}
