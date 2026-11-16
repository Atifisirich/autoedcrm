// Domain logic shared by the staff app, public forms, the REST API, the workflow engine and tests.
// Nothing here imports Next.js, so it can run anywhere.
import { insert, one, q, update, type Row } from "./db";

export type Actor = { id: string; name: string } | null;

// ---------- small helpers ----------

/** Indian mobiles: keep the last ten digits so +91 / 0 prefixes match the same parent. */
export function normMobile(s: string | null | undefined): string {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
/** Schools in this release run on India time whatever the server's zone is. */
export const hourIST = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(d)) % 24;
export const validMobile = (m: string) => /^[6-9]\d{9}$/.test(m);

const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Fuzzy student match used for duplicate and sibling detection (DUP-01). */
export function sameStudent(a: { name: string; dob?: string | null }, b: { name: string; dob?: string | null }): boolean {
  const x = normName(a.name), y = normName(b.name);
  if (!x || !y) return false;
  if (a.dob && b.dob && a.dob !== b.dob) return false;
  if (x === y) return true;
  if (lev(x, y) <= 2 && Math.min(x.length, y.length) >= 5) return true;
  const fa = a.name.trim().toLowerCase().split(/\s+/)[0], fb = b.name.trim().toLowerCase().split(/\s+/)[0];
  return fa === fb && fa.length >= 3 && (x.startsWith(y) || y.startsWith(x));
}

export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

export async function tenantSettings(tenantId: string): Promise<Row> {
  return (await one("select settings from tenants where id=$1", [tenantId]))?.settings ?? {};
}

export async function audit(tenantId: string | null, actor: Actor, action: string, entity: string, entityId: string | null, summary: string, before?: any, after?: any) {
  await insert("audit_events", { tenant_id: tenantId, user_id: actor?.id ?? null, user_name: actor?.name ?? "System", action, entity, entity_id: entityId, summary, before: before ?? null, after: after ?? null });
}

export async function notify(tenantId: string, userId: string, category: string, title: string, link?: string) {
  await insert("notifications", { tenant_id: tenantId, user_id: userId, category, title, link: link ?? null });
  await pushToPhones(userId, title, link);
}

/** Sends the alert to the user's Android app through Expo's push service. Never blocks or fails the caller. */
async function pushToPhones(userId: string, title: string, link?: string) {
  if (process.env.PUSH_DISABLED === "1") return;
  const tokens = await q("select token from push_tokens where user_id=$1", [userId]).catch(() => []);
  if (!tokens.length) return;
  try {
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(tokens.map((t) => ({ to: t.token, title: "AutoED", body: title, data: { link: link ?? "/" }, sound: "default", channelId: "default" }))),
      signal: AbortSignal.timeout(4000),
    });
    const res = await r.json().catch(() => null);
    // Expo reports uninstalled apps per token; forget those so we stop sending to them.
    (res?.data ?? []).forEach((d: any, i: number) => { if (d?.details?.error === "DeviceNotRegistered") q("delete from push_tokens where token=$1", [tokens[i].token]).catch(() => {}); });
  } catch { /* push is best effort */ }
}

/** Admission heads and admins who should hear about escalations for a branch. */
export async function headsFor(tenantId: string, branchId: string): Promise<Row[]> {
  return q(
    `select u.* from users u join roles r on r.id=u.role_id
     where u.tenant_id=$1 and u.status='active' and r.permissions->>'reassign' in ('F','T')
       and (u.branch_ids='[]'::jsonb or u.branch_ids @> to_jsonb($2::text))`,
    [tenantId, branchId],
  );
}

// ---------- duplicates ----------

export async function findHousehold(tenantId: string, k: { mobile?: string; altMobile?: string; email?: string }): Promise<Row | null> {
  const mobiles = [normMobile(k.mobile), normMobile(k.altMobile)].filter((m) => m.length >= 10);
  const email = (k.email ?? "").trim().toLowerCase();
  if (!mobiles.length && !email) return null;
  return one(
    `select g.household_id, g.name as guardian_name, g.mobile from guardians g
     where g.tenant_id=$1 and (g.mobile in (select jsonb_array_elements_text($2::jsonb))
        or g.alt_mobile in (select jsonb_array_elements_text($2::jsonb))
        or ($3<>'' and lower(g.email)=$3))
     order by g.is_primary desc limit 1`,
    [tenantId, mobiles, email],
  );
}

/** What the create forms show while the user types. */
export async function duplicatePreview(tenantId: string, k: { mobile?: string; altMobile?: string; email?: string }) {
  const hit = await findHousehold(tenantId, k);
  if (!hit) return null;
  const enquiries = await q(
    `select e.id, s.name as student, e.grade, st.name as stage, u.name as owner, y.name as year, b.name as branch
     from enquiries e join students s on s.id=e.student_id join stages st on st.id=e.stage_id
     join users u on u.id=e.owner_id join academic_years y on y.id=e.year_id join branches b on b.id=e.branch_id
     where e.tenant_id=$1 and e.household_id=$2 order by e.created_at desc`,
    [tenantId, hit.household_id],
  );
  return { householdId: hit.household_id as string, guardian: hit.guardian_name as string, mobile: hit.mobile as string, enquiries };
}

// ---------- assignment (ASG-01..03, ASG-06) ----------

export type AssignAttrs = { branchId: string; board?: string | null; grade?: string | null; channel?: string | null; householdId?: string | null };

const ruleMatches = (c: Row, a: AssignAttrs) =>
  (!c.branch_id || c.branch_id === a.branchId) && (!c.board || c.board === a.board) && (!c.channel || c.channel === a.channel) && (!c.grades?.length || c.grades.includes(a.grade));

/**
 * Picks an owner. Order: sticky owner for the family, then the first matching rule with
 * an available counsellor (active, not on leave, under daily capacity), then least-loaded fallback.
 * dryRun explains the decision without advancing round-robin pointers.
 */
export async function assignOwner(tenantId: string, a: AssignAttrs, dryRun = false): Promise<{ ownerId: string; ownerName: string; reason: string }> {
  if (a.householdId) {
    const sticky = await one(
      `select u.id, u.name from enquiries e join users u on u.id=e.owner_id
       where e.tenant_id=$1 and e.household_id=$2 and u.status='active' and not u.on_leave order by e.created_at desc limit 1`,
      [tenantId, a.householdId],
    );
    if (sticky) return { ownerId: sticky.id, ownerName: sticky.name, reason: "Sticky owner: this family already works with " + sticky.name };
  }
  const users = await q(
    `select u.id, u.name, u.daily_capacity, u.on_leave, u.branch_ids, r.permissions->>'leads' as lead_level,
       (select count(*)::int from enquiries e where e.owner_id=u.id and e.created_at::date=now()::date) as today,
       (select count(*)::int from enquiries e join stages s on s.id=e.stage_id where e.owner_id=u.id and not s.is_closed and not s.is_won) as open_load
     from users u join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active'`,
    [tenantId],
  );
  const inBranch = (u: Row) => !u.branch_ids.length || u.branch_ids.includes(a.branchId);
  const available = (u: Row) => !u.on_leave && u.today < u.daily_capacity && inBranch(u);
  const rules = await q("select * from assignment_rules where tenant_id=$1 and active order by position", [tenantId]);
  for (const r of rules) {
    if (!ruleMatches(r.conditions, a)) continue;
    const pool = (r.user_ids as string[]).map((id) => users.find((u) => u.id === id)).filter((u): u is Row => !!u && available(u));
    if (!pool.length) continue;
    let pick: Row;
    if (r.method === "least_load") pick = [...pool].sort((x, y) => x.open_load - y.open_load)[0];
    else {
      // Round robin walks the configured order, skipping anyone unavailable today.
      const order = r.user_ids as string[];
      let p = r.pointer % order.length;
      for (let i = 0; i < order.length && !pool.some((u) => u.id === order[p]); i++) p = (p + 1) % order.length;
      pick = pool.find((u) => u.id === order[p])!;
      if (!dryRun) await q("update assignment_rules set pointer=$2 where id=$1", [r.id, (p + 1) % order.length]);
    }
    return { ownerId: pick.id, ownerName: pick.name, reason: `Rule "${r.name}" (${r.method === "least_load" ? "least open load" : "round robin"})` };
  }
  const fallback = users.filter((u) => ["O", "T"].includes(u.lead_level) && available(u)).sort((x, y) => x.open_load - y.open_load)[0] ?? users.filter((u) => ["F", "T"].includes(u.lead_level) && inBranch(u))[0] ?? users[0];
  return { ownerId: fallback.id, ownerName: fallback.name, reason: "Catch-all: least-loaded available person in the branch" };
}

// ---------- stages ----------

export async function stageByName(tenantId: string, name: string): Promise<Row | null> {
  return one("select s.*, p.key as phase_key from stages s join phases p on p.id=s.phase_id where s.tenant_id=$1 and s.name=$2 and s.active order by p.position limit 1", [tenantId, name]);
}

export async function getEnquiry(tenantId: string, id: string): Promise<Row | null> {
  return one(
    `select e.*, s.name as stage_name, s.is_closed, s.is_won, s.exempt_next_action, p.key as phase_key, st.name as student_name,
            u.name as owner_name, b.name as branch_name
     from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id join students st on st.id=e.student_id
     join users u on u.id=e.owner_id join branches b on b.id=e.branch_id where e.tenant_id=$1 and e.id=$2`,
    [tenantId, id],
  );
}

export const FIELD_LABELS: Record<string, string> = { closure_reason: "Closure reason", visit: "A booked campus visit", expected_decision: "Expected decision date" };

/** Moves a stage, asking only for what that stage requires (L360-05). */
export async function changeStage(tenantId: string, enquiryId: string, stageId: string, actor: Actor, extra: { closure_reason?: string; expected_decision?: string; note?: string } = {}): Promise<{ ok: boolean; missing?: string[]; error?: string }> {
  const e = await getEnquiry(tenantId, enquiryId);
  const to = await one("select s.*, p.key as phase_key from stages s join phases p on p.id=s.phase_id where s.tenant_id=$1 and s.id=$2", [tenantId, stageId]);
  if (!e || !to) return { ok: false, error: "Record or stage not found." };
  if (e.stage_id === to.id) return { ok: true };
  const missing: string[] = [];
  for (const f of to.required_fields as string[]) {
    if (f === "closure_reason" && !extra.closure_reason) missing.push(f);
    if (f === "expected_decision" && !extra.expected_decision && !e.expected_decision) missing.push(f);
    if (f === "visit" && !(await one("select 1 from visits where enquiry_id=$1 and status in ('scheduled','done')", [enquiryId]))) missing.push(f);
  }
  if (missing.length) return { ok: false, missing };
  await update("enquiries", tenantId, enquiryId, {
    stage_id: to.id,
    stage_entered_at: new Date(),
    updated_at: new Date(),
    closure_reason: to.is_closed ? extra.closure_reason ?? null : null,
    expected_decision: extra.expected_decision || undefined,
  });
  await logActivity(tenantId, {
    householdId: e.household_id,
    enquiryId,
    type: "stage_change",
    actorId: actor?.id,
    content: `Stage moved from ${e.stage_name} to ${to.name}` + (extra.closure_reason ? `. Reason: ${extra.closure_reason}` : "") + (extra.note ? `. ${extra.note}` : ""),
    meta: { from: e.stage_name, to: to.name },
  });
  if (to.is_closed || to.is_won) await q("update tasks set status='cancelled' where tenant_id=$1 and enquiry_id=$2 and status='open'", [tenantId, enquiryId]);
  await emit(tenantId, "stage_changed", enquiryId);
  if (to.is_won) await emit(tenantId, "admission_confirmed", enquiryId);
  if (to.is_closed) await emit(tenantId, "enquiry_closed", enquiryId);
  return { ok: true };
}

// ---------- timeline, scoring ----------

export const DEFAULT_SCORING: Record<string, number> = {
  call_connected: 10, call_attempt: 2, whatsapp_in: 12, whatsapp_out: 2, sms: 1, email: 1, note: 1,
  visit_booked: 15, visit_done: 25, form_started: 15, form_submitted: 25, payment: 30, re_enquiry: 10, sibling: 15,
};
export const SCORE_LABELS: Record<string, string> = {
  call_connected: "Connected calls", call_attempt: "Call attempts", whatsapp_in: "Parent WhatsApp replies", whatsapp_out: "WhatsApp sent", sms: "SMS sent", email: "Emails sent",
  note: "Notes", visit_booked: "Visit booked", visit_done: "Visit completed", form_started: "Application started", form_submitted: "Application submitted", payment: "Payment received",
  re_enquiry: "Re-enquired", sibling: "Sibling in school",
};

function scoreKey(a: Row): string | null {
  switch (a.type) {
    case "call": return a.outcome === "connected" ? "call_connected" : "call_attempt";
    case "whatsapp": return a.meta?.direction === "in" ? "whatsapp_in" : a.meta?.status === "failed" ? null : "whatsapp_out";
    case "sms": case "email": return a.meta?.status === "failed" ? null : a.type;
    case "note": return "note";
    case "visit": return a.outcome === "done" ? "visit_done" : a.outcome === "booked" ? "visit_booked" : null;
    case "form": return a.outcome === "submitted" ? "form_submitted" : a.outcome === "started" ? "form_started" : null;
    case "payment": return a.outcome === "paid" ? "payment" : null;
    case "touch": return a.outcome === "re_enquiry" ? "re_enquiry" : null;
    default: return null;
  }
}

/** Rule-based score with the breakdown shown to users as "what moved it" (AI-01). */
export async function scoreBreakdown(tenantId: string, enquiryId: string): Promise<{ score: number; parts: { key: string; label: string; count: number; points: number }[] }> {
  const rules = { ...DEFAULT_SCORING, ...((await tenantSettings(tenantId)).scoring ?? {}) };
  const acts = await q("select type, outcome, meta from activities where tenant_id=$1 and enquiry_id=$2", [tenantId, enquiryId]);
  const counts: Record<string, number> = {};
  for (const a of acts) {
    const k = scoreKey(a);
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  const hh = await one("select h.sibling_in_school from enquiries e join households h on h.id=e.household_id where e.id=$1", [enquiryId]);
  if (hh?.sibling_in_school) counts.sibling = 1;
  // Repeated activity of one kind counts at most three times so a chatty thread cannot max the score.
  const parts = Object.entries(counts).map(([key, count]) => ({ key, label: SCORE_LABELS[key] ?? key, count, points: Math.min(count, 3) * (rules[key] ?? 0) })).filter((p) => p.points).sort((a, b) => b.points - a.points);
  return { score: Math.min(100, parts.reduce((s, p) => s + p.points, 0)), parts };
}

export const temperatureFor = (score: number, s: Row) => (score >= (s.hot_at ?? 60) ? "Hot" : score >= (s.warm_at ?? 30) ? "Warm" : "Cold");

export async function rescore(tenantId: string, enquiryId: string) {
  const { score } = await scoreBreakdown(tenantId, enquiryId);
  const settings = await tenantSettings(tenantId);
  const before = await one("select temperature, owner_id, household_id from enquiries where id=$1", [enquiryId]);
  const temperature = temperatureFor(score, settings);
  await q("update enquiries set score=$2, temperature=$3 where id=$1", [enquiryId, score, temperature]);
  if (before && before.temperature !== "Hot" && temperature === "Hot") await emit(tenantId, "hot_lead", enquiryId);
}

const HUMAN_CONTACT = ["call", "whatsapp", "sms", "email"];

export async function logActivity(tenantId: string, a: { householdId: string; enquiryId?: string | null; type: string; actorId?: string | null; outcome?: string | null; content?: string | null; meta?: Row; at?: Date }): Promise<Row> {
  const row = await insert("activities", {
    tenant_id: tenantId, household_id: a.householdId, enquiry_id: a.enquiryId ?? null, type: a.type, actor_id: a.actorId ?? null,
    outcome: a.outcome ?? null, content: a.content ?? null, meta: a.meta ?? {}, created_at: a.at,
  });
  if (a.enquiryId) {
    const human = !!a.actorId && HUMAN_CONTACT.includes(a.type) && a.meta?.direction !== "in";
    await q(
      `update enquiries set last_activity_at=now(), updated_at=now(),
         first_response_at = case when $2 and first_response_at is null then now() else first_response_at end where id=$1`,
      [a.enquiryId, human],
    );
    await rescore(tenantId, a.enquiryId);
  }
  return row;
}

// ---------- tasks (TSK-01..03) ----------

export const TASK_TYPES: Record<string, string> = {
  call_back: "Call back", whatsapp_follow_up: "WhatsApp follow-up", visit: "Visit", document_chase: "Document chase", payment_chase: "Payment chase", interaction: "Interaction", custom: "Other",
};

export async function addTask(tenantId: string, t: { enquiryId: string; type?: string; title: string; dueAt: Date; ownerId?: string; priority?: string }): Promise<Row> {
  const e = await one("select household_id, owner_id from enquiries where tenant_id=$1 and id=$2", [tenantId, t.enquiryId]);
  if (!e) throw new Error("Enquiry not found");
  return insert("tasks", { tenant_id: tenantId, enquiry_id: t.enquiryId, household_id: e.household_id, type: t.type ?? "call_back", title: t.title, due_at: t.dueAt, owner_id: t.ownerId ?? e.owner_id, priority: t.priority ?? "normal" });
}

/** True when an open enquiry in a non-exempt stage has no open task left. */
export async function needsNextAction(tenantId: string, enquiryId: string): Promise<boolean> {
  const e = await getEnquiry(tenantId, enquiryId);
  if (!e || e.is_closed || e.is_won || e.exempt_next_action) return false;
  return !(await one("select 1 from tasks where tenant_id=$1 and enquiry_id=$2 and status='open'", [tenantId, enquiryId]));
}

export async function completeTask(tenantId: string, taskId: string, actor: Actor, outcome: string): Promise<{ enquiryId: string | null; needsNext: boolean }> {
  const t = await one("select * from tasks where tenant_id=$1 and id=$2", [tenantId, taskId]);
  if (!t || t.status !== "open") return { enquiryId: t?.enquiry_id ?? null, needsNext: false };
  await update("tasks", tenantId, taskId, { status: "done", outcome, completed_at: new Date() });
  await logActivity(tenantId, { householdId: t.household_id, enquiryId: t.enquiry_id, type: "task", actorId: actor?.id, outcome: "done", content: `Task done: ${t.title}${outcome ? ` — ${outcome}` : ""}` });
  return { enquiryId: t.enquiry_id, needsNext: t.enquiry_id ? await needsNextAction(tenantId, t.enquiry_id) : false };
}

// ---------- capture (CAP-01..08, DUP-01..03, DM-01..03) ----------

export type CaptureInput = {
  studentName: string; guardianName: string; mobile: string; altMobile?: string; email?: string; relation?: string; dob?: string; gender?: string;
  branchId: string; yearId?: string; board?: string; grade?: string; locality?: string; currentSchool?: string;
  sourceId?: string; channel?: string; source?: string; campaign?: string; utm?: Row; heardAbout?: string;
  consent?: { source: string; wording?: string }; note?: string; custom?: Row; asProspect?: boolean; tags?: string[];
  /** Set when the person entering the lead should own it (a counsellor adding their own enquiry). Sticky family owners still win. */
  preferOwnerId?: string;
};
export type CaptureResult = { ok: true; status: "created" | "sibling_added" | "re_enquiry"; householdId: string; enquiryId: string; ownerId: string; ownerName: string } | { ok: false; error: string };

export async function captureEnquiry(tenantId: string, input: CaptureInput, actor: Actor = null): Promise<CaptureResult> {
  const mobile = normMobile(input.mobile);
  if (!validMobile(mobile)) return { ok: false, error: "Enter a valid 10-digit mobile number." };
  if (!input.studentName?.trim()) return { ok: false, error: "Student name is required." };
  const branch = await one("select * from branches where tenant_id=$1 and id=$2", [tenantId, input.branchId]);
  if (!branch) return { ok: false, error: "Choose a branch." };
  const year = input.yearId ? await one("select id from academic_years where tenant_id=$1 and id=$2", [tenantId, input.yearId]) : await one("select id from academic_years where tenant_id=$1 order by is_default desc, position desc limit 1", [tenantId]);
  if (!year) return { ok: false, error: "No academic year is open for admissions." };
  const src = input.sourceId ? await one("select * from sources where tenant_id=$1 and id=$2", [tenantId, input.sourceId]) : null;
  const channel = src?.channel ?? input.channel ?? "Direct";
  const sourceName = src?.name ?? input.source ?? "Manual entry";
  const touch = (enquiryId: string) => insert("source_touches", { tenant_id: tenantId, enquiry_id: enquiryId, source_id: src?.id ?? null, channel, source: sourceName, campaign: input.campaign ?? null, utm: input.utm ?? {} });
  const now = new Date();
  const consent = { whatsapp: true, sms: true, email: true, call: true, source: input.consent?.source ?? (actor ? "Recorded by staff at entry" : "Web form"), wording: input.consent?.wording ?? "v1", at: now.toISOString() };

  const existing = await findHousehold(tenantId, { mobile, altMobile: input.altMobile, email: input.email });
  if (existing) {
    const householdId = existing.household_id as string;
    const students = await q("select id, name, dob::text as dob from students where tenant_id=$1 and household_id=$2", [tenantId, householdId]);
    const student = students.find((s) => sameStudent(s as { name: string; dob: string | null }, { name: input.studentName, dob: input.dob }));
    const prior = student ? await one("select e.*, s.is_closed, s.name as stage_name from enquiries e join stages s on s.id=e.stage_id where e.student_id=$1 and e.year_id=$2 and e.branch_id=$3", [student.id, year.id, branch.id]) : null;
    if (prior) {
      // DM-01: never a silent duplicate. Add a touch, flag the re-enquiry and tell the owner.
      await touch(prior.id);
      await q("update enquiries set reenquired=true, updated_at=now() where id=$1", [prior.id]);
      await logActivity(tenantId, { householdId, enquiryId: prior.id, type: "touch", actorId: actor?.id, outcome: "re_enquiry", content: `Re-enquired through ${sourceName} (${channel})` + (input.note ? `. ${input.note}` : "") });
      const settings = await tenantSettings(tenantId);
      if (prior.is_closed && settings.reopen_on_reenquiry !== false) {
        const st = await stageByName(tenantId, "New");
        if (st) await changeStage(tenantId, prior.id, st.id, null, { note: "Re-opened automatically because the family enquired again" });
      }
      const owner = await one("select id, name from users where id=$1", [prior.owner_id]);
      await notify(tenantId, prior.owner_id, "assigned", `${existing.guardian_name} enquired again for ${student!.name}`, `/households/${householdId}?e=${prior.id}`);
      if (await needsNextAction(tenantId, prior.id)) await addTask(tenantId, { enquiryId: prior.id, title: "Call back: family re-enquired", dueAt: new Date(Date.now() + 15 * 60000), priority: "high" });
      await emit(tenantId, "re_enquiry", prior.id);
      return { ok: true, status: "re_enquiry", householdId, enquiryId: prior.id, ownerId: owner!.id, ownerName: owner!.name };
    }
    const studentId = student?.id ?? (await insert("students", { tenant_id: tenantId, household_id: householdId, name: input.studentName.trim(), dob: input.dob || null, gender: input.gender ?? null, current_school: input.currentSchool ?? null })).id;
    const made = await createEnquiry(householdId, studentId);
    return { ok: true, status: student ? "created" : "sibling_added", householdId, ...made };
  }

  const hh = await insert("households", { tenant_id: tenantId, locality: input.locality ?? null, heard_about: input.heardAbout ?? null });
  await insert("guardians", { tenant_id: tenantId, household_id: hh.id, name: input.guardianName?.trim() || "Parent", relation: input.relation ?? "Parent", mobile, alt_mobile: normMobile(input.altMobile) || null, email: input.email?.trim().toLowerCase() || null, consent });
  const st = await insert("students", { tenant_id: tenantId, household_id: hh.id, name: input.studentName.trim(), dob: input.dob || null, gender: input.gender ?? null, current_school: input.currentSchool ?? null });
  const made = await createEnquiry(hh.id, st.id);
  return { ok: true, status: "created", householdId: hh.id, ...made };

  async function createEnquiry(householdId: string, studentId: string) {
    const stage = await stageByName(tenantId, input.asProspect ? "New data" : "New");
    if (!stage) throw new Error("Pipeline has no starting stage");
    let owner = await assignOwner(tenantId, { branchId: branch!.id, board: input.board, grade: input.grade, channel, householdId: existing ? householdId : null });
    if (input.preferOwnerId && !owner.reason.startsWith("Sticky")) {
      const self = await one("select id, name from users where tenant_id=$1 and id=$2 and status='active'", [tenantId, input.preferOwnerId]);
      if (self) owner = { ownerId: self.id, ownerName: self.name, reason: "Added by the counsellor themselves" };
    }
    const e = await insert("enquiries", { tenant_id: tenantId, household_id: householdId, student_id: studentId, branch_id: branch!.id, year_id: year!.id, board: input.board ?? branch!.boards?.[0] ?? null, grade: input.grade ?? null, stage_id: stage.id, owner_id: owner.ownerId, custom: input.custom ?? {}, tags: input.tags ?? [] });
    await touch(e.id);
    await logActivity(tenantId, { householdId, enquiryId: e.id, type: "touch", actorId: actor?.id, outcome: "created", content: `Enquiry created from ${sourceName} (${channel}). Assigned to ${owner.ownerName}: ${owner.reason}.` + (input.note ? ` Note: ${input.note}` : "") });
    await notify(tenantId, owner.ownerId, "assigned", `New enquiry: ${input.studentName} (${input.grade ?? "grade not set"})`, `/households/${householdId}?e=${e.id}`);
    if (!input.asProspect) {
      const hour = hourIST(now);
      const outOfHours = hour < branch!.open_hour || hour >= branch!.close_hour;
      await emit(tenantId, outOfHours ? "out_of_hours" : "enquiry_created", e.id);
      // TSK-03: an open enquiry always has a next action, even if no workflow created one.
      if (await needsNextAction(tenantId, e.id)) await addTask(tenantId, { enquiryId: e.id, title: "First call to the parent", dueAt: new Date(Date.now() + 5 * 60000), priority: "high" });
      if (existing) await emit(tenantId, "sibling_enquiry", e.id);
    }
    await dispatchWebhooks(tenantId, "enquiry.created", { enquiry_id: e.id, household_id: householdId, student: input.studentName, grade: input.grade, channel, source: sourceName });
    return { enquiryId: e.id as string, ownerId: owner.ownerId, ownerName: owner.ownerName };
  }
}

// ---------- messaging (WA-04, MSG-01..05, L360-03) ----------

export const MESSAGE_COST: Record<string, number> = { whatsapp: 0.8, sms: 0.25, email: 0.02 };
const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "email" };

/**
 * Sends through the tenant's provider. The bundled provider is a simulator: it records the
 * message and charges the wallet but does not reach a real phone. Failures are stored in
 * plain language with a suggested next step; provider codes never reach counsellors.
 */
/**
 * Sends a message to the household's primary guardian.
 * WhatsApp goes through the school's own Meta Cloud API account when connected; otherwise, and for
 * SMS and email until those providers are connected, the bundled simulator records it and charges the
 * wallet without reaching a phone. Failures are stored in plain language with a suggested next step.
 */
export async function sendMessage(
  tenantId: string,
  m: { householdId: string; enquiryId?: string | null; channel: string; body: string; actorId?: string | null; campaignId?: string | null; template?: Row | null; vars?: Record<string, string | null | undefined>; deferred?: boolean },
): Promise<{ status: "sent" | "delivered" | "queued" | "failed"; reason?: string }> {
  const g = await one("select * from guardians where tenant_id=$1 and household_id=$2 order by is_primary desc limit 1", [tenantId, m.householdId]);
  const tenant = await one("select wallet_balance from tenants where id=$1", [tenantId]);
  // Automated messages (workflows) respect the school's quiet hours and a daily cap per family (MSG-05).
  if (!m.actorId && !m.campaignId && !m.deferred) {
    const settings = await tenantSettings(tenantId);
    const quiet = settings.quiet_hours ?? { from: 21, to: 8 };
    const h = hourIST();
    const inQuiet = quiet.from > quiet.to ? h >= quiet.from || h < quiet.to : h >= quiet.from && h < quiet.to;
    if (inQuiet) {
      const wait = ((quiet.to - h + 24) % 24 || 24) * 3600e3 - new Date().getMinutes() * 60e3;
      await insert("jobs", { tenant_id: tenantId, run_at: new Date(Date.now() + wait), kind: "send_message", payload: { ...m, templateId: m.template?.id ?? null, template: undefined } });
      return { status: "queued", reason: `Held until ${quiet.to}:00 because of the school's quiet hours.` };
    }
    const cap = Number(settings.max_auto_per_day ?? 4);
    const today = await one(
      "select count(*)::int n from messages where tenant_id=$1 and household_id=$2 and direction='out' and sender_id is null and campaign_id is null and status<>'failed' and created_at > now() - interval '24 hours'",
      [tenantId, m.householdId],
    );
    if (today!.n >= cap) return { status: "failed", reason: `Skipped: this family already got ${cap} automated messages in the last 24 hours.` };
  }
  const { waConfig, waSendTemplate, waSendText } = await import("./meta");
  const live = m.channel === "whatsapp" ? await waConfig(tenantId) : null;
  const cost = live ? 0 : MESSAGE_COST[m.channel] ?? 0; // the school's own Meta account bills the school directly
  let reason: string | undefined;
  let providerId: string | null = null;
  if (!g) reason = "No guardian contact on this household.";
  else if (g.consent?.[m.channel] === false) reason = `This parent has opted out of ${CHANNEL_NAME[m.channel]} messages. Use another channel they have agreed to.`;
  else if (m.channel === "email" && !g.email) reason = "No email address on file. Ask the parent for one or use WhatsApp.";
  else if (live) {
    const lastIn = await one("select max(created_at) as at from messages where tenant_id=$1 and household_id=$2 and channel='whatsapp' and direction='in'", [tenantId, m.householdId]);
    const windowOpen = !!lastIn?.at && Date.now() - new Date(lastIn.at).getTime() < 24 * 3600e3;
    const tpl = m.template && m.template.channel === "whatsapp" && m.template.meta_status === "APPROVED" && m.template.meta_name ? m.template : null;
    const res = tpl ? await waSendTemplate(live, g.mobile, tpl, m.vars ?? {}) : windowOpen ? await waSendText(live, g.mobile, m.body) : null;
    if (!res) reason = m.template ? "This template is not approved on WhatsApp yet, and it is more than 24 hours since the parent last wrote. Ask your admin to sync templates, or call." : "More than 24 hours since the parent last wrote, so only an approved template can be sent.";
    else if (!res.ok) reason = res.reason;
    else providerId = res.id;
  } else if (Number(tenant!.wallet_balance) < cost) reason = "Message credits have run out. Ask your admin to recharge the wallet.";
  else if (m.channel === "whatsapp" && g.mobile.endsWith("00")) reason = "This number cannot receive WhatsApp messages. Try SMS or call.";
  const status = reason ? "failed" : live ? "sent" : "delivered";
  await insert("messages", { tenant_id: tenantId, household_id: m.householdId, enquiry_id: m.enquiryId ?? null, channel: m.channel, direction: "out", body: m.body, status, fail_reason: reason ?? null, campaign_id: m.campaignId ?? null, sender_id: m.actorId ?? null, read: true, provider_id: providerId });
  if (!reason && cost > 0) {
    await q("update tenants set wallet_balance=wallet_balance-$2 where id=$1", [tenantId, cost]);
    await insert("wallet_ledger", { tenant_id: tenantId, type: "debit", category: m.channel, amount: cost, note: m.campaignId ? "Campaign message" : "Message" });
  }
  await logActivity(tenantId, {
    householdId: m.householdId, enquiryId: m.enquiryId, type: m.channel, actorId: m.actorId,
    content: reason ? `Not delivered: ${reason}` : m.body, meta: { direction: "out", status, body: reason ? m.body : undefined, automated: !m.actorId },
  });
  return { status, reason };
}

const OPT_OUT = /^\s*(stop|unsubscribe|opt ?out)\s*$/i;

/** Inbound parent message from the provider webhook (or the demo "parent replies" button). */
export async function receiveMessage(tenantId: string, householdId: string, channel: string, body: string) {
  const e = await one("select e.id, e.owner_id from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.household_id=$2 order by s.is_closed, e.created_at desc limit 1", [tenantId, householdId]);
  await insert("messages", { tenant_id: tenantId, household_id: householdId, enquiry_id: e?.id ?? null, channel, direction: "in", body });
  await q("update households set inbox_status='open' where id=$1", [householdId]);
  if (OPT_OUT.test(body)) {
    await q("update guardians set consent = consent || jsonb_build_object($2::text, false) where tenant_id=$1 and household_id=$3", [tenantId, channel, householdId]);
    await logActivity(tenantId, { householdId, enquiryId: e?.id, type: "system", content: `Parent opted out of ${CHANNEL_NAME[channel]} messages. No further ${CHANNEL_NAME[channel]} messages will be sent.` });
  }
  await logActivity(tenantId, { householdId, enquiryId: e?.id, type: channel, content: body, meta: { direction: "in" } });
  if (e) {
    await notify(tenantId, e.owner_id, "parent_replied", "Parent replied: " + body.slice(0, 60), `/inbox?h=${householdId}`);
    await emit(tenantId, "parent_replied", e.id);
  }
}

// ---------- events ----------

export async function emit(tenantId: string, event: string, enquiryId: string) {
  const { runTrigger } = await import("./workflows");
  await runTrigger(tenantId, event, enquiryId);
}

/** Outbound webhooks (API-02). Best effort with a short timeout; the last result is stored per endpoint. */
export async function dispatchWebhooks(tenantId: string, event: string, payload: Row) {
  const hooks = await q("select * from webhooks where tenant_id=$1 and active", [tenantId]);
  if (!hooks.length) return;
  const crypto = await import("node:crypto");
  const body = JSON.stringify({ event, sent_at: new Date().toISOString(), data: payload });
  await Promise.all(
    hooks.filter((h) => !h.events.length || h.events.includes(event)).map(async (h) => {
      let status = "failed";
      try {
        const sig = crypto.createHmac("sha256", h.secret).update(body).digest("hex");
        const r = await fetch(h.url, { method: "POST", headers: { "content-type": "application/json", "x-autoed-signature": sig }, body, signal: AbortSignal.timeout(4000) });
        status = r.ok ? "ok" : "HTTP " + r.status;
      } catch {
        status = "Could not reach the endpoint";
      }
      await q("update webhooks set last_status=$2 where id=$1", [h.id, `${status} · ${event} · ${new Date().toISOString()}`]);
    }),
  );
}
