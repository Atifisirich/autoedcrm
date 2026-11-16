// Workflow engine (PRD 7.14) and the recipe library shipped with every tenant (Appendix D).
import { insert, one, q, type Row } from "./db";
import { addTask, changeStage, getEnquiry, headsFor, notify, renderTemplate, sendMessage, stageByName, assignOwner, logActivity } from "./core";

export type Step =
  | { type: "send"; channel: "whatsapp" | "sms" | "email"; template: string; fallback?: ("sms" | "email")[] }
  | { type: "task"; title: string; taskType?: string; dueMins: number; priority?: string }
  | { type: "wait"; mins: number }
  | { type: "notify"; who: "owner" | "head"; title: string }
  | { type: "stage"; stage: string }
  | { type: "tag"; tag: string }
  | { type: "reassign" };

export const TRIGGERS: Record<string, string> = {
  enquiry_created: "Enquiry created (working hours)",
  out_of_hours: "Enquiry created outside working hours",
  missed_call: "Missed inbound call",
  call_not_answered: "Call outcome is not answered",
  visit_scheduled: "Visit scheduled",
  visit_no_show: "Visit marked no-show",
  visit_done: "Visit done",
  form_started: "Application form started",
  form_submitted: "Application form submitted",
  payment_failed: "Payment failed",
  sla_breach: "No human activity within SLA",
  hot_lead: "Score crosses the hot threshold",
  parent_replied: "Parent replied",
  re_enquiry: "New source touch on an existing household",
  sibling_enquiry: "Enquiry created for a sibling",
  admission_confirmed: "Admission confirmed",
  enquiry_closed: "Enquiry closed",
  stage_changed: "Stage changed",
};

const DAY = 1440;
type Recipe = { key: string; name: string; description: string; trigger: string; conditions?: Row[]; steps: Step[] };

export const RECIPES: Recipe[] = [
  { key: "instant_welcome", name: "Instant welcome", trigger: "enquiry_created", description: "Sends the branch welcome on WhatsApp (falls back to SMS, then email) and creates a call task due in 5 minutes.",
    steps: [{ type: "send", channel: "whatsapp", template: "Welcome", fallback: ["sms", "email"] }, { type: "task", title: "First call to the parent", dueMins: 5, priority: "high" }] },
  { key: "out_of_hours", name: "Out-of-hours acknowledgement", trigger: "out_of_hours", description: "Acknowledges the enquiry with a call-back time and queues the call for the next shift.",
    steps: [{ type: "send", channel: "whatsapp", template: "Out of hours", fallback: ["sms"] }, { type: "task", title: "Call back: enquiry came in after hours", dueMins: 12 * 60, priority: "high" }] },
  { key: "missed_call", name: "Missed call rescue", trigger: "missed_call", description: "Sends a \"we missed you\" message, creates an urgent call-back and escalates if it is not done in 30 minutes.",
    steps: [{ type: "send", channel: "whatsapp", template: "Missed call", fallback: ["sms"] }, { type: "task", title: "Urgent: return missed call", dueMins: 10, priority: "high" }, { type: "wait", mins: 30 }, { type: "notify", who: "head", title: "Missed call not returned in 30 minutes" }] },
  { key: "no_contact", name: "No-contact ladder", trigger: "call_not_answered", description: "Three attempts at different times over two days with a message in between, then moves to Contact attempted and alerts the head.",
    steps: [{ type: "task", title: "Call attempt 2 (try a different time)", dueMins: 4 * 60 }, { type: "send", channel: "whatsapp", template: "Tried calling", fallback: ["sms"] }, { type: "wait", mins: DAY }, { type: "task", title: "Call attempt 3", dueMins: 60 }, { type: "wait", mins: DAY }, { type: "stage", stage: "Contact attempted" }, { type: "notify", who: "head", title: "Could not reach the parent after three attempts" }] },
  { key: "visit_reminders", name: "Visit reminders", trigger: "visit_scheduled", description: "Confirmation now with the location pin and a notification to the host.",
    steps: [{ type: "send", channel: "whatsapp", template: "Visit confirmation", fallback: ["sms"] }, { type: "notify", who: "owner", title: "Campus visit booked" }] },
  { key: "no_show", name: "No-show recovery", trigger: "visit_no_show", description: "Apology with a one-tap rebook link and a task for the counsellor next day.",
    steps: [{ type: "send", channel: "whatsapp", template: "Missed visit", fallback: ["sms"] }, { type: "task", title: "Rebook the campus visit", taskType: "visit", dueMins: DAY }] },
  { key: "post_visit", name: "Post-visit nurture", trigger: "visit_done", description: "If no application starts within 2 days, sends decision-helper content over 10 days. Stops on reply or application.",
    steps: [{ type: "wait", mins: 2 * DAY }, { type: "send", channel: "whatsapp", template: "After your visit" }, { type: "wait", mins: 4 * DAY }, { type: "send", channel: "whatsapp", template: "Parent stories" }, { type: "wait", mins: 4 * DAY }, { type: "task", title: "Post-visit check-in call", dueMins: 60 }] },
  { key: "abandoned_form", name: "Abandoned application", trigger: "form_started", description: "Nudges at 1, 3 and 7 days and offers assisted filling. Stops when the form is submitted.",
    steps: [{ type: "wait", mins: DAY }, { type: "send", channel: "whatsapp", template: "Finish your application" }, { type: "wait", mins: 2 * DAY }, { type: "send", channel: "whatsapp", template: "Finish your application" }, { type: "wait", mins: 4 * DAY }, { type: "task", title: "Offer to fill the application with the parent", dueMins: 60 }] },
  { key: "payment_failed", name: "Payment failed", trigger: "payment_failed", description: "Sends a retry link immediately and creates a task for the counsellor after 2 hours.",
    steps: [{ type: "send", channel: "whatsapp", template: "Payment retry", fallback: ["sms"] }, { type: "wait", mins: 120 }, { type: "task", title: "Help the parent complete payment", taskType: "payment_chase", dueMins: 30 }] },
  { key: "document_chase", name: "Document chase", trigger: "form_submitted", description: "Three days after submission, lists what is missing and creates a task for the counsellor.",
    steps: [{ type: "wait", mins: 3 * DAY }, { type: "send", channel: "whatsapp", template: "Documents pending" }, { type: "task", title: "Chase pending documents", taskType: "document_chase", dueMins: DAY }] },
  { key: "untouched", name: "Untouched escalation", trigger: "sla_breach", description: "Notifies the owner, then the head, then reassigns if still untouched.",
    steps: [{ type: "notify", who: "owner", title: "Enquiry waiting past the response time" }, { type: "wait", mins: 30 }, { type: "notify", who: "head", title: "Enquiry still untouched" }, { type: "wait", mins: 60 }, { type: "reassign" }] },
  { key: "hot_lead", name: "Hot lead alert", trigger: "hot_lead", description: "Notifies the owner and creates a priority task.",
    steps: [{ type: "notify", who: "owner", title: "This family just turned hot" }, { type: "task", title: "Priority call: hot lead", dueMins: 15, priority: "high" }] },
  { key: "re_enquiry", name: "Re-enquiry alert", trigger: "re_enquiry", description: "Tags the record and notifies the owner. Re-opening closed enquiries is controlled in Admin > Pipeline.",
    steps: [{ type: "tag", tag: "re-enquired" }, { type: "notify", who: "owner", title: "Family enquired again" }] },
  { key: "sibling", name: "Sibling welcome", trigger: "sibling_enquiry", description: "Applies the sibling concession tag. Routing to the family's counsellor is automatic.",
    steps: [{ type: "tag", tag: "sibling concession" }, { type: "send", channel: "whatsapp", template: "Sibling welcome" }] },
  { key: "admission_welcome", name: "Admission welcome", trigger: "admission_confirmed", description: "Welcome message with the onboarding form and orientation invite.",
    steps: [{ type: "send", channel: "whatsapp", template: "Admission welcome", fallback: ["sms", "email"] }, { type: "notify", who: "head", title: "Admission confirmed" }] },
  { key: "win_back", name: "Lost-lead win-back", trigger: "enquiry_closed", conditions: [{ field: "closure_reason", op: "in", value: ["Undecided", "Fee too high"] }], description: "60 days after closing as undecided or fee, sends one check-in message.",
    steps: [{ type: "wait", mins: 60 * DAY }, { type: "send", channel: "whatsapp", template: "Checking in" }] },
];

function conditionsPass(conds: Row[], e: Row): boolean {
  return conds.every((c) => {
    const v = e[c.field];
    if (c.op === "in") return (c.value as any[]).includes(v);
    if (c.op === "ne") return v !== c.value;
    return v === c.value;
  });
}

export async function runTrigger(tenantId: string, event: string, enquiryId: string) {
  const wfs = await q("select * from workflows where tenant_id=$1 and trigger=$2 and status='published'", [tenantId, event]);
  if (!wfs.length) return;
  const e = await getEnquiry(tenantId, enquiryId);
  if (!e) return;
  for (const wf of wfs) {
    if (!conditionsPass(wf.conditions, e)) continue;
    // Reliability rule: never run the same workflow twice at once for one record.
    if (await one("select 1 from workflow_runs where workflow_id=$1 and enquiry_id=$2 and status='running' and not test", [wf.id, enquiryId])) continue;
    const run = await insert("workflow_runs", { tenant_id: tenantId, workflow_id: wf.id, enquiry_id: enquiryId, entry_stage_id: e.stage_id });
    await runSteps(run, wf, 0);
  }
}

/** Dry run on a sample record: nothing is sent or changed; the log says what would happen (AUT-05). */
export async function testRun(tenantId: string, workflowId: string, enquiryId: string): Promise<Row> {
  const wf = await one("select * from workflows where tenant_id=$1 and id=$2", [tenantId, workflowId]);
  const e = await getEnquiry(tenantId, enquiryId);
  if (!wf || !e) throw new Error("Workflow or sample record not found");
  const run = await insert("workflow_runs", { tenant_id: tenantId, workflow_id: wf.id, enquiry_id: enquiryId, entry_stage_id: e.stage_id, test: true });
  await runSteps(run, wf, 0);
  return (await one("select * from workflow_runs where id=$1", [run.id]))!;
}

async function finish(run: Row, status: string, log: Row[]) {
  await q("update workflow_runs set status=$2, log=$3 where id=$1", [run.id, status, log]);
}

async function runSteps(run: Row, wf: Row, from: number) {
  const tenantId = run.tenant_id as string;
  const steps = wf.steps as Step[];
  const log: Row[] = [...(run.log ?? [])];
  const say = (i: number, text: string, ok = true) => log.push({ step: i + 1, at: new Date().toISOString(), text, ok });
  try {
    for (let i = from; i < steps.length; i++) {
      const s = steps[i];
      const e = await getEnquiry(tenantId, run.enquiry_id);
      if (!e) return finish(run, "cancelled", [...log, { text: "Record no longer exists." }]);
      const test = run.test as boolean;
      if (s.type === "wait") {
        if (test) { say(i, `Would wait ${fmtMins(s.mins)}, then re-check that the record is still in "${e.stage_name}" and the parent has not replied.`); continue; }
        say(i, `Waiting ${fmtMins(s.mins)}.`);
        await insert("jobs", { tenant_id: tenantId, run_at: new Date(Date.now() + s.mins * 60000), kind: "workflow_resume", payload: { runId: run.id, step: i + 1 } });
        return finish(run, "running", log);
      }
      if (s.type === "send") {
        const tpl = await one("select * from templates where tenant_id=$1 and name=$2 and status='approved' order by (channel=$3) desc limit 1", [tenantId, s.template, s.channel]);
        if (!tpl) { say(i, `Skipped: no approved template named "${s.template}".`, false); continue; }
        const vars = await mergeVars(tenantId, e);
        const body = renderTemplate(tpl.body, vars);
        if (test) { say(i, `Would send on ${s.channel}: "${body}"`); continue; }
        let res = await sendMessage(tenantId, { householdId: e.household_id, enquiryId: e.id, channel: s.channel, body, template: tpl, vars });
        let used: string = s.channel;
        for (const fb of s.fallback ?? []) {
          if (res.status !== "failed") break;
          const fbTpl = await one("select * from templates where tenant_id=$1 and name=$2 and channel=$3 and status='approved'", [tenantId, s.template, fb]);
          res = await sendMessage(tenantId, { householdId: e.household_id, enquiryId: e.id, channel: fb, body: fbTpl ? renderTemplate(fbTpl.body, vars) : body, template: fbTpl, vars });
          used = fb;
        }
        say(i, res.status !== "failed" ? `Sent "${s.template}" on ${used}.` : `Could not send "${s.template}": ${res.reason}`, res.status !== "failed");
      } else if (s.type === "task") {
        if (test) { say(i, `Would create task "${s.title}" for ${e.owner_name}, due in ${fmtMins(s.dueMins)}.`); continue; }
        await addTask(tenantId, { enquiryId: e.id, title: s.title, type: s.taskType, dueAt: new Date(Date.now() + s.dueMins * 60000), priority: s.priority });
        say(i, `Created task "${s.title}" for ${e.owner_name}.`);
      } else if (s.type === "notify") {
        const targets = s.who === "owner" ? [{ id: e.owner_id, name: e.owner_name }] : await headsFor(tenantId, e.branch_id);
        if (test) { say(i, `Would notify ${targets.map((t) => t.name).join(", ") || "nobody (no head set)"}: "${s.title}".`); continue; }
        for (const t of targets) await notify(tenantId, t.id, s.who === "head" ? "escalation" : "assigned", `${s.title}: ${e.student_name}`, `/households/${e.household_id}?e=${e.id}`);
        say(i, `Notified ${targets.map((t) => t.name).join(", ") || "nobody"}.`);
      } else if (s.type === "stage") {
        const st = await stageByName(tenantId, s.stage);
        if (!st) { say(i, `Skipped: stage "${s.stage}" does not exist.`, false); continue; }
        if (test) { say(i, `Would move the record to "${s.stage}".`); continue; }
        // Only move forward from the first contact stage; never drag a progressed record backwards.
        if (e.stage_name === "New") { await changeStage(tenantId, e.id, st.id, null, { note: `By workflow "${wf.name}"` }); await q("update workflow_runs set entry_stage_id=$2 where id=$1", [run.id, st.id]); run.entry_stage_id = st.id; say(i, `Moved to "${s.stage}".`); }
        else say(i, `Left the stage alone: record is already in "${e.stage_name}".`);
      } else if (s.type === "tag") {
        if (test) { say(i, `Would add tag "${s.tag}".`); continue; }
        await q("update enquiries set tags = case when tags @> to_jsonb($2::text) then tags else tags || to_jsonb($2::text) end where id=$1", [e.id, s.tag]);
        say(i, `Added tag "${s.tag}".`);
      } else if (s.type === "reassign") {
        if (e.first_response_at) { say(i, "No reassignment needed: the owner has responded."); continue; }
        if (test) { say(i, "Would reassign to the next available counsellor."); continue; }
        const a = await assignOwner(tenantId, { branchId: e.branch_id, board: e.board, grade: e.grade });
        if (a.ownerId !== e.owner_id) {
          await q("update enquiries set owner_id=$2 where id=$1", [e.id, a.ownerId]);
          await q("update tasks set owner_id=$2 where enquiry_id=$1 and status='open'", [e.id, a.ownerId]);
          await logActivity(tenantId, { householdId: e.household_id, enquiryId: e.id, type: "system", content: `Reassigned from ${e.owner_name} to ${a.ownerName} because the enquiry was untouched past the response time.` });
          await notify(tenantId, a.ownerId, "assigned", `Reassigned to you: ${e.student_name}`, `/households/${e.household_id}?e=${e.id}`);
        }
        say(i, `Reassigned to ${a.ownerName}.`);
      }
    }
    await finish(run, run.test ? "tested" : "completed", log);
  } catch (err: any) {
    say(-1, "Stopped on an error: " + (err?.message ?? "unknown"), false);
    await finish(run, "error", log);
  }
}

const fmtMins = (m: number) => (m >= DAY ? `${Math.round(m / DAY)} day${m >= 2 * DAY ? "s" : ""}` : m >= 60 ? `${Math.round(m / 60)} hour${m >= 120 ? "s" : ""}` : `${m} minutes`);

export async function mergeVars(tenantId: string, e: Row): Promise<Record<string, string>> {
  const g = await one("select name from guardians where tenant_id=$1 and household_id=$2 order by is_primary desc limit 1", [tenantId, e.household_id]);
  const t = await one("select name from tenants where id=$1", [tenantId]);
  const base = process.env.APP_URL ?? "";
  return {
    guardian_name: g?.name ?? "Parent", student_name: e.student_name, grade: e.grade ?? "", branch: e.branch_name, counsellor: e.owner_name, school: t?.name ?? "",
    apply_link: `${base}/apply/${e.public_token}`, year: "",
  };
}

/**
 * Resumes waiting runs. Safeguards (AUT-05): if the parent replied or the record left the
 * stage it entered the workflow in, all pending steps are cancelled and the log says why.
 */
export async function runDueJobs(tenantId: string): Promise<number> {
  const jobs = await q("update jobs set status='running' where tenant_id=$1 and status='queued' and run_at<=now() returning *", [tenantId]);
  for (const j of jobs) {
    let result = "done";
    try {
      if (j.kind === "workflow_resume") {
        const run = await one("select * from workflow_runs where id=$1", [j.payload.runId]);
        const wf = run && (await one("select * from workflows where id=$1", [run.workflow_id]));
        if (!run || !wf || run.status !== "running") result = "skipped";
        else if (wf.status !== "published") { await finish(run, "cancelled", [...run.log, { text: "Cancelled: the workflow was paused." }]); result = "cancelled"; }
        else {
          const e = await getEnquiry(tenantId, run.enquiry_id);
          const replied = await one("select 1 from messages where tenant_id=$1 and household_id=$2 and direction='in' and created_at>$3", [tenantId, e?.household_id, run.created_at]);
          if (!e || e.stage_id !== run.entry_stage_id) { await finish(run, "cancelled", [...run.log, { text: `Cancelled: the record moved out of the stage it entered in${e ? ` (now "${e.stage_name}")` : ""}.` }]); result = "cancelled"; }
          else if (replied && wf.trigger !== "sla_breach") { await finish(run, "cancelled", [...run.log, { text: "Cancelled: the parent replied, so automated follow-ups stopped." }]); result = "cancelled"; }
          else await runSteps(run, wf, j.payload.step);
        }
      }
    } catch (err: any) {
      result = "error: " + (err?.message ?? "unknown");
    }
    await q("update jobs set status=$2, result=$3 where id=$1", [j.id, result.startsWith("error") ? "failed" : "done", result]);
  }
  return jobs.length;
}

/** Periodic checks: first-response SLA breaches and visits nobody checked in to. */
export async function sweep(tenantId: string) {
  const t = await one("select settings from tenants where id=$1", [tenantId]);
  const sla = Number(t?.settings?.first_response_mins ?? 30);
  const late = await q(
    `select e.id from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id
     where e.tenant_id=$1 and p.key='enquiry' and e.first_response_at is null and e.created_at < now() - ($2 || ' minutes')::interval
       and e.created_at > now() - interval '3 days' and not e.tags @> '["sla breached"]'::jsonb limit 50`,
    [tenantId, String(sla)],
  );
  for (const e of late) {
    await q("update enquiries set tags = tags || '[\"sla breached\"]'::jsonb where id=$1", [e.id]);
    await runTrigger(tenantId, "sla_breach", e.id);
  }
  const missed = await q("select * from visits where tenant_id=$1 and status='scheduled' and slot_at < now() - interval '3 hours' limit 50", [tenantId]);
  for (const v of missed) {
    await q("update visits set status='no_show' where id=$1", [v.id]);
    await logActivity(tenantId, { householdId: v.household_id, enquiryId: v.enquiry_id, type: "visit", outcome: "no_show", content: "Visit marked no-show automatically: nobody checked in." });
    const st = await stageByName(tenantId, "No-show");
    const e = await getEnquiry(tenantId, v.enquiry_id);
    if (st && e?.phase_key === "visit") await changeStage(tenantId, v.enquiry_id, st.id, null);
    await runTrigger(tenantId, "visit_no_show", v.enquiry_id);
  }
  await runDueJobs(tenantId);
}

const g = globalThis as unknown as { __aedTick?: Record<string, number> };
/** Called from page loads; runs the sweep at most once a minute per tenant. A cron hitting /api/cron does the same. */
export async function tick(tenantId: string) {
  g.__aedTick ??= {};
  if (Date.now() - (g.__aedTick[tenantId] ?? 0) < 60000) return;
  g.__aedTick[tenantId] = Date.now();
  try { await sweep(tenantId); } catch (e) { console.error("sweep failed", e); }
}
