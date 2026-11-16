"use server";
import { revalidatePath } from "next/cache";
import { insert, one, q, update } from "@/lib/db";
import { addTask, audit, captureEnquiry, changeStage, completeTask, emit, getEnquiry, logActivity, needsNextAction, notify, receiveMessage, renderTemplate, sendMessage, stageByName } from "@/lib/core";
import { checklist, confirmAdmission, saveApplication, settlePayment, startApplication, APPLICATION_SECTIONS } from "@/lib/admissions";
import { actorOf, findEnquiry, flash, guard, str } from "@/lib/guard";
import { parseLocal, inr } from "@/lib/fmt";
import { canEditApplications, canEditLeads, canMessage, canTakePayment, canVerifyDocs, canVerifyPayment, canWorkTasks, isFullAdmin, lvl, seesSensitive } from "@/lib/perm";
import { mergeVars } from "@/lib/workflows";

const done = () => revalidatePath("/", "layout");

// ----- tasks -----

export async function addTaskAction(fd: FormData) {
  const ctx = await guard("tasks");
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  await addTask(ctx.tenantId, { enquiryId: e.id, type: str(fd, "type") || "call_back", title: str(fd, "title") || "Follow-up", dueAt: parseLocal(str(fd, "dueAt")), priority: str(fd, "priority") || "normal", ownerId: str(fd, "ownerId") || undefined });
  await flash("Task added.");
  done();
}

/**
 * Completes a task. If that leaves an open enquiry with nothing planned, the same submit must
 * carry the next task or a stage move; otherwise nothing is saved (TSK-03).
 */
export async function completeTaskAction(_: any, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const ctx = await guard("tasks");
  if (!canWorkTasks(ctx.perms)) return { ok: false, error: "Your role cannot complete tasks." };
  const t = await one("select * from tasks where tenant_id=$1 and id=$2 and status='open'", [ctx.tenantId, str(fd, "taskId")]);
  if (!t) return { ok: false, error: "This task is already closed." };
  const next = str(fd, "next");
  const actor = actorOf(ctx);
  if (t.enquiry_id) {
    const e = (await getEnquiry(ctx.tenantId, t.enquiry_id))!;
    const others = await one("select count(*)::int n from tasks where tenant_id=$1 and enquiry_id=$2 and status='open' and id<>$3", [ctx.tenantId, t.enquiry_id, t.id]);
    const mustPlan = !e.is_closed && !e.is_won && !e.exempt_next_action && others!.n === 0;
    if (next === "task") {
      if (!str(fd, "nextDue")) return { ok: false, error: "Pick a date and time for the next action." };
      await addTask(ctx.tenantId, { enquiryId: e.id, type: str(fd, "nextType") || "call_back", title: str(fd, "nextTitle") || "Follow-up", dueAt: parseLocal(str(fd, "nextDue")) });
    } else if (next === "stage") {
      if (!str(fd, "stageId")) return { ok: false, error: "Choose the stage to move to." };
      const target = await one("select exempt_next_action from stages where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "stageId")]);
      if (mustPlan && !target?.exempt_next_action) return { ok: false, error: "That stage still needs a next action. Schedule a task, or close the enquiry with a reason." };
      const res = await changeStage(ctx.tenantId, e.id, str(fd, "stageId"), actor, { closure_reason: str(fd, "closure_reason") || undefined });
      if (!res.ok) return { ok: false, error: res.missing ? "Choose a closure reason to close this enquiry." : res.error };
    } else if (mustPlan) return { ok: false, error: "This enquiry would be left with no next action. Schedule the next task, or close it with a reason." };
  }
  await completeTask(ctx.tenantId, t.id, actor, str(fd, "outcome"));
  await flash("Task completed.");
  done();
  return { ok: true };
}

export async function rescheduleTask(taskId: string, dueIso: string) {
  const ctx = await guard("tasks");
  await update("tasks", ctx.tenantId, taskId, { due_at: new Date(dueIso) });
  done();
}

// ----- timeline entries -----

export async function addNote(fd: FormData) {
  const ctx = await guard("leads");
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  const text = str(fd, "note");
  if (!text) return;
  await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "note", actorId: ctx.user.id, content: text });
  // @mentions loop in a colleague (L360-07).
  for (const m of text.matchAll(/@([a-z]+)/gi)) {
    const u = await one("select id from users where tenant_id=$1 and lower(split_part(name,' ',1))=lower($2) and status='active'", [ctx.tenantId, m[1]]);
    if (u) await notify(ctx.tenantId, u.id, "mention", `${ctx.user.name} mentioned you: ${text.slice(0, 70)}`, `/households/${e.household_id}?e=${e.id}`);
  }
  done();
}

const CALL_TEXT: Record<string, string> = { connected: "Spoke to the parent.", not_answered: "Call not answered.", busy: "Line was busy.", wrong_number: "Wrong number.", switched_off: "Phone switched off or unreachable." };

export async function logCall(fd: FormData) {
  const ctx = await guard("leads");
  if (!canEditLeads(ctx.perms)) throw new Error("Your role cannot log calls.");
  const e = await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, str(fd, "enquiryId"))).id);
  const outcome = str(fd, "outcome") || "connected";
  await logActivity(ctx.tenantId, { householdId: e!.household_id, enquiryId: e!.id, type: "call", actorId: ctx.user.id, outcome, content: [CALL_TEXT[outcome], str(fd, "notes")].filter(Boolean).join(" ") });
  // Sensible default moves out of "New" so the board reflects reality without an extra click.
  if (e!.stage_name === "New") {
    const st = await stageByName(ctx.tenantId, outcome === "connected" ? "Connected" : "Contact attempted");
    if (st) await changeStage(ctx.tenantId, e!.id, st.id, actorOf(ctx));
  }
  if (outcome !== "connected") await emit(ctx.tenantId, "call_not_answered", e!.id);
  if (str(fd, "nextDue")) await addTask(ctx.tenantId, { enquiryId: e!.id, title: str(fd, "nextTitle") || "Follow-up call", dueAt: parseLocal(str(fd, "nextDue")) });
  await flash("Call logged.");
  done();
}

export async function sendMsg(fd: FormData) {
  const ctx = await guard("templates");
  if (!canMessage(ctx.perms)) throw new Error("Your role cannot send messages.");
  const e = (await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, str(fd, "enquiryId"))).id))!;
  let body = str(fd, "body");
  let channel = str(fd, "channel") || "whatsapp";
  let tpl: Record<string, any> | null = null;
  let vars: Record<string, string> = {};
  if (str(fd, "templateId")) {
    tpl = await one("select * from templates where tenant_id=$1 and id=$2 and status='approved'", [ctx.tenantId, str(fd, "templateId")]);
    if (!tpl) return flash("That template is not approved yet.", "error");
    vars = await mergeVars(ctx.tenantId, e);
    body = renderTemplate(tpl.body, vars);
    channel = tpl.channel;
  }
  if (!body) return flash("Write a message or pick a template.", "error");
  // WhatsApp rule: free text is only allowed within 24 hours of the parent's last message.
  if (channel === "whatsapp" && !str(fd, "templateId") && fd.get("note") !== "on") {
    const last = await one("select max(created_at) as at from messages where tenant_id=$1 and household_id=$2 and channel='whatsapp' and direction='in'", [ctx.tenantId, e.household_id]);
    if (!last?.at || Date.now() - new Date(last.at).getTime() > 24 * 3600e3) return flash("WhatsApp allows free text only within 24 hours of the parent's last message. Pick an approved template instead.", "error");
  }
  if (fd.get("note") === "on") {
    await insert("messages", { tenant_id: ctx.tenantId, household_id: e.household_id, enquiry_id: e.id, channel, direction: "out", body, status: "note", is_note: true, sender_id: ctx.user.id, read: true });
  } else {
    const r = await sendMessage(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, channel, body, actorId: ctx.user.id, template: tpl, vars });
    if (r.status === "failed") await flash("Not delivered: " + r.reason, "error");
    else await flash(`Sent on ${channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "email"}.`);
    await q("update messages set read=true where tenant_id=$1 and household_id=$2 and direction='in'", [ctx.tenantId, e.household_id]);
    await q("update households set inbox_status='waiting' where id=$1 and inbox_status='open'", [e.household_id]);
  }
  done();
}

export async function inboxStatus(fd: FormData) {
  const ctx = await guard("leads");
  await q("update households set inbox_status=$3 where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "householdId"), str(fd, "status")]);
  await q("update messages set read=true where tenant_id=$1 and household_id=$2", [ctx.tenantId, str(fd, "householdId")]);
  done();
}

/** Stands in for the provider webhook so the inbox, opt-out and stop-on-reply rules can be tried without a live number. */
export async function simulateReply(fd: FormData) {
  const ctx = await guard("leads");
  if (process.env.DATABASE_URL && process.env.DEMO_PAYMENTS !== "1") return flash("Simulated replies are only available in demo mode.", "error");
  await receiveMessage(ctx.tenantId, str(fd, "householdId"), "whatsapp", str(fd, "body") || "Thank you, please call me after 5 pm.");
  await flash("Simulated parent reply received.");
  done();
}

// ----- visits -----

export async function bookVisit(fd: FormData) {
  const ctx = await guard("tasks");
  const e = (await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, str(fd, "enquiryId"))).id))!;
  const slot = parseLocal(str(fd, "slotAt"));
  if (isNaN(slot.getTime()) || slot.getTime() < Date.now() - 3600e3) return flash("Pick a visit time in the future.", "error");
  const branch = await one("select * from branches where id=$1", [e.branch_id]);
  const taken = await one("select count(*)::int n from visits where tenant_id=$1 and branch_id=$2 and status='scheduled' and date_trunc('hour', slot_at)=date_trunc('hour', $3::timestamptz)", [ctx.tenantId, e.branch_id, slot]);
  if (taken!.n >= branch!.visit_capacity) return flash(`That hour is full (${branch!.visit_capacity} visits). Pick another slot.`, "error");
  const host = str(fd, "hostId") || e.owner_id;
  await q("update visits set status='cancelled' where tenant_id=$1 and enquiry_id=$2 and status='scheduled'", [ctx.tenantId, e.id]);
  await insert("visits", { tenant_id: ctx.tenantId, enquiry_id: e.id, household_id: e.household_id, branch_id: e.branch_id, type: str(fd, "type") || "campus_tour", slot_at: slot, host_id: host });
  await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "visit", outcome: "booked", actorId: ctx.user.id, content: `Campus visit booked for ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(slot)}.` });
  const st = await stageByName(ctx.tenantId, "Visit scheduled");
  if (st && (["prospect", "enquiry"].includes(e.phase_key) || e.stage_name === "No-show")) await changeStage(ctx.tenantId, e.id, st.id, actorOf(ctx));
  await q("update tasks set status='cancelled' where tenant_id=$1 and enquiry_id=$2 and status='open' and type='visit'", [ctx.tenantId, e.id]);
  await addTask(ctx.tenantId, { enquiryId: e.id, type: "visit", title: "Host the campus visit", dueAt: slot, ownerId: host });
  await emit(ctx.tenantId, "visit_scheduled", e.id);
  await flash("Visit booked. The parent gets a confirmation.");
  done();
}

export async function visitUpdate(fd: FormData) {
  const ctx = await guard("tasks");
  const v = await one("select * from visits where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "visitId")]);
  if (!v) return;
  const what = str(fd, "what");
  const actor = actorOf(ctx);
  const e = (await getEnquiry(ctx.tenantId, v.enquiry_id))!;
  const move = async (name: string) => { const st = await stageByName(ctx.tenantId, name); if (st && e.phase_key === "visit") await changeStage(ctx.tenantId, e.id, st.id, actor); };
  if (what === "check_in") {
    await update("visits", ctx.tenantId, v.id, { checked_in_at: new Date() });
    await logActivity(ctx.tenantId, { householdId: v.household_id, enquiryId: v.enquiry_id, type: "visit", outcome: "checked_in", actorId: ctx.user.id, content: "Family checked in at the front desk." });
    if (v.host_id) await notify(ctx.tenantId, v.host_id, "due", `${e.student_name}'s family has arrived for their visit`, `/households/${v.household_id}?e=${v.enquiry_id}`);
    await flash("Checked in. The host has been notified.");
  } else if (what === "done") {
    if (!str(fd, "outcome")) return flash("Add the visit outcome first.", "error");
    await update("visits", ctx.tenantId, v.id, { status: "done", outcome: str(fd, "outcome"), checked_in_at: v.checked_in_at ?? new Date() });
    await logActivity(ctx.tenantId, { householdId: v.household_id, enquiryId: v.enquiry_id, type: "visit", outcome: "done", actorId: ctx.user.id, content: "Visit completed. Outcome: " + str(fd, "outcome") });
    await q("update tasks set status='done', completed_at=now() where tenant_id=$1 and enquiry_id=$2 and status='open' and type='visit'", [ctx.tenantId, e.id]);
    await move("Visit done");
    if (await needsNextAction(ctx.tenantId, e.id)) await addTask(ctx.tenantId, { enquiryId: e.id, title: "Post-visit follow-up", dueAt: new Date(Date.now() + 24 * 3600e3) });
    await emit(ctx.tenantId, "visit_done", e.id);
    await flash("Visit marked done. A follow-up task was added for tomorrow.");
  } else if (what === "no_show") {
    await update("visits", ctx.tenantId, v.id, { status: "no_show" });
    await logActivity(ctx.tenantId, { householdId: v.household_id, enquiryId: v.enquiry_id, type: "visit", outcome: "no_show", actorId: ctx.user.id, content: "Family did not arrive for the visit." });
    await q("update tasks set status='cancelled' where tenant_id=$1 and enquiry_id=$2 and status='open' and type='visit'", [ctx.tenantId, e.id]);
    await move("No-show");
    await emit(ctx.tenantId, "visit_no_show", e.id);
    if (await needsNextAction(ctx.tenantId, e.id)) await addTask(ctx.tenantId, { enquiryId: e.id, type: "visit", title: "Rebook the campus visit", dueAt: new Date(Date.now() + 24 * 3600e3) });
    await flash("Marked no-show. A rebooking task was created.");
  } else if (what === "cancel") {
    await update("visits", ctx.tenantId, v.id, { status: "cancelled" });
    await q("update tasks set status='cancelled' where tenant_id=$1 and enquiry_id=$2 and status='open' and type='visit'", [ctx.tenantId, e.id]);
    await logActivity(ctx.tenantId, { householdId: v.household_id, enquiryId: v.enquiry_id, type: "visit", outcome: "cancelled", actorId: ctx.user.id, content: "Visit cancelled." });
    if (await needsNextAction(ctx.tenantId, e.id)) await addTask(ctx.tenantId, { enquiryId: e.id, title: "Call to rebook the visit", dueAt: new Date(Date.now() + 4 * 3600e3) });
  }
  done();
}

// ----- details, siblings, ownership -----

const EDITABLE: Record<string, [string, string][]> = {
  guardians: [["g_name", "name"], ["g_relation", "relation"], ["g_email", "email"], ["g_alt_mobile", "alt_mobile"], ["g_occupation", "occupation"], ["g_language", "language"]],
  households: [["h_address", "address"], ["h_locality", "locality"], ["h_pincode", "pincode"], ["h_heard_about", "heard_about"]],
  students: [["s_name", "name"], ["s_gender", "gender"], ["s_current_school", "current_school"], ["s_current_grade", "current_grade"]],
  enquiries: [["e_grade", "grade"], ["e_board", "board"], ["e_expected_decision", "expected_decision"]],
};
const SENSITIVE_STUDENT: [string, string][] = [["s_dob", "dob"], ["s_special_needs", "special_needs"]];

/** Saves the details panel. Only fields present in the form are touched; every change is written to the timeline and audit log (DM-04). */
export async function updateDetails(fd: FormData) {
  const ctx = await guard("leads");
  if (!canEditLeads(ctx.perms)) throw new Error("Your role cannot edit records.");
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  const g = await one("select * from guardians where household_id=$1 order by is_primary desc limit 1", [e.household_id]);
  const targets: Record<string, any> = { guardians: g, households: await one("select * from households where id=$1", [e.household_id]), students: await one("select *, dob::text as dob from students where id=$1", [e.student_id]), enquiries: e };
  const changes: string[] = [];
  const before: Record<string, any> = {}, after: Record<string, any> = {};
  for (const [table, fields] of Object.entries(EDITABLE)) {
    const all = table === "students" && seesSensitive(ctx.perms) ? [...fields, ...SENSITIVE_STUDENT] : fields;
    const patch: Record<string, any> = {};
    for (const [form, col] of all) {
      if (!fd.has(form)) continue;
      const v = str(fd, form) || null;
      const old = targets[table]?.[col] ?? null;
      if (String(old ?? "") !== String(v ?? "")) { patch[col] = v; before[col] = old; after[col] = v; changes.push(col.replace(/_/g, " ")); }
    }
    if (Object.keys(patch).length && targets[table]) await update(table, ctx.tenantId, targets[table].id, patch);
  }
  if (fd.has("h_sibling_in_school")) await q("update households set sibling_in_school=$2 where id=$1", [e.household_id, fd.get("h_sibling_in_school") === "yes"]);
  const fields = await q("select key, label, sensitive from custom_fields where tenant_id=$1 and entity='enquiry' and active", [ctx.tenantId]);
  const custom = { ...e.custom };
  for (const f of fields) {
    if (!fd.has("cf_" + f.key) || (f.sensitive && !seesSensitive(ctx.perms))) continue;
    const v = str(fd, "cf_" + f.key);
    if ((custom[f.key] ?? "") !== v) { before[f.key] = custom[f.key] ?? null; after[f.key] = v; custom[f.key] = v; changes.push(f.label); }
  }
  await q("update enquiries set custom=$2, updated_at=now() where id=$1", [e.id, custom]);
  if (changes.length) {
    await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "field_change", actorId: ctx.user.id, content: "Updated " + changes.join(", ") + "." });
    await audit(ctx.tenantId, actorOf(ctx), "edit", "enquiry", e.id, "Edited " + changes.join(", "), before, after);
    await flash("Details saved.");
  }
  done();
}

/** DM-02: one action from the household page; guardian and address are reused, not retyped. */
export async function addSibling(fd: FormData) {
  const ctx = await guard("leads");
  const g = await one("select * from guardians where tenant_id=$1 and household_id=$2 order by is_primary desc limit 1", [ctx.tenantId, str(fd, "householdId")]);
  if (!g) throw new Error("Household not found.");
  const res = await captureEnquiry(ctx.tenantId, { studentName: str(fd, "studentName"), guardianName: g.name, mobile: g.mobile, branchId: str(fd, "branchId"), yearId: ctx.yearId, grade: str(fd, "grade"), dob: str(fd, "dob") || undefined, source: "Sibling added by staff", channel: "Referral" }, actorOf(ctx));
  await flash(res.ok ? (res.status === "re_enquiry" ? "That child already has an enquiry for this year; it was flagged as a re-enquiry." : "Sibling added to this household.") : res.error, res.ok ? "ok" : "error");
  done();
}

export async function reassignOne(fd: FormData) {
  const ctx = await guard("reassign");
  if (!["F", "T"].includes(lvl(ctx.perms, "reassign"))) throw new Error("Your role cannot reassign leads.");
  const e = (await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, str(fd, "enquiryId"))).id))!;
  const to = await one("select id, name from users where tenant_id=$1 and id=$2 and status='active'", [ctx.tenantId, str(fd, "ownerId")]);
  if (!to || to.id === e.owner_id) return;
  await q("update enquiries set owner_id=$2, updated_at=now() where id=$1", [e.id, to.id]);
  await q("update tasks set owner_id=$2 where enquiry_id=$1 and status='open'", [e.id, to.id]);
  await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "system", actorId: ctx.user.id, content: `Reassigned from ${e.owner_name} to ${to.name}. Reason: ${str(fd, "reason") || "not given"}` });
  await notify(ctx.tenantId, to.id, "assigned", `${e.student_name} reassigned to you by ${ctx.user.name}`, `/households/${e.household_id}?e=${e.id}`);
  await flash(`Reassigned to ${to.name}.`);
  done();
}

// ----- application, documents, payments, admission -----

export async function startApplicationAction(fd: FormData) {
  const ctx = await guard("applications");
  if (!canEditApplications(ctx.perms)) throw new Error("Your role cannot start applications.");
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  await startApplication(ctx.tenantId, e.id, actorOf(ctx));
  await flash("Application started. Fill it with the parent or send them the link.");
  done();
}

export async function saveApplicationAction(_: any, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const ctx = await guard("applications");
  if (!canEditApplications(ctx.perms)) return { ok: false, error: "Your role cannot edit applications." };
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  const answers = Object.fromEntries(APPLICATION_SECTIONS.flatMap((s) => s.fields).filter((f) => fd.has(f.key)).map((f) => [f.key, str(fd, f.key)]));
  const res = await saveApplication(ctx.tenantId, e.id, answers, { submit: fd.get("submit") === "1", declaration: fd.get("declaration") === "on", overrideAge: fd.get("overrideAge") === "on" && ["F", "T", "Decide"].includes(lvl(ctx.perms, "applications")) }, actorOf(ctx));
  if (res.ok) { await flash(fd.get("submit") === "1" ? "Application submitted." : "Progress saved."); done(); }
  return res;
}

export async function docAction(fd: FormData) {
  const ctx = await guard("applications");
  const d = await one("select * from documents where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "docId")]);
  if (!d) return;
  const e = (await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, d.enquiry_id)).id))!;
  const what = str(fd, "what");
  if (what === "upload") {
    if (!canEditApplications(ctx.perms)) throw new Error("Your role cannot add documents.");
    const file = fd.get("file") as File | null;
    if (!file?.name) return flash("Choose a file first.", "error");
    await update("documents", ctx.tenantId, d.id, { status: "uploaded", file_name: file.name, reject_reason: null, updated_at: new Date() });
    await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "document", actorId: ctx.user.id, content: `${d.type} received (${file.name}).` });
  } else {
    if (!canVerifyDocs(ctx.perms)) throw new Error("Your role cannot verify documents.");
    if (what === "reject" && !str(fd, "reason")) return flash("Say why the document is rejected so the parent knows what to fix.", "error");
    await update("documents", ctx.tenantId, d.id, { status: what === "verify" ? "verified" : "rejected", reject_reason: what === "reject" ? str(fd, "reason") : null, verifier_id: ctx.user.id, updated_at: new Date() });
    await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "document", actorId: ctx.user.id, content: what === "verify" ? `${d.type} verified.` : `${d.type} rejected: ${str(fd, "reason")}` });
    if (what === "reject") await addTask(ctx.tenantId, { enquiryId: e.id, type: "document_chase", title: `Ask the parent to resend: ${d.type}`, dueAt: new Date(Date.now() + 24 * 3600e3) });
    const left = await one("select count(*)::int n from documents where enquiry_id=$1 and status<>'verified'", [e.id]);
    const st = await stageByName(ctx.tenantId, left!.n === 0 ? "Documents verified" : "Documents pending");
    if (st && ["Fee paid", "Documents pending"].includes(e.stage_name)) await changeStage(ctx.tenantId, e.id, st.id, actorOf(ctx));
  }
  done();
}

export async function paymentAction(fd: FormData) {
  const ctx = await guard("payments");
  const what = str(fd, "what");
  const actor = actorOf(ctx);
  if (what === "create") {
    if (!canTakePayment(ctx.perms)) throw new Error("Your role cannot request or collect payments.");
    const e = (await getEnquiry(ctx.tenantId, (await findEnquiry(ctx, str(fd, "enquiryId"))).id))!;
    const amount = Number(str(fd, "amount"));
    if (!(amount > 0)) return flash("Enter the amount.", "error");
    const mode = str(fd, "mode") || "link";
    const p = await insert("payments", { tenant_id: ctx.tenantId, enquiry_id: e.id, purpose: str(fd, "purpose") || "Registration fee", amount, mode, reference: str(fd, "reference") || null, status: mode === "link" ? "pending" : "awaiting_verification" });
    if (mode === "link") {
      const link = `${process.env.APP_URL ?? ""}/pay/${p.token}`;
      const payTpl = await one("select * from templates where tenant_id=$1 and channel='whatsapp' and name='Payment link' and status='approved'", [ctx.tenantId]);
      const vars = { ...(await mergeVars(ctx.tenantId, e)), purpose: p.purpose, amount: inr(amount), pay_link: link };
      const r = await sendMessage(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, channel: "whatsapp", body: payTpl ? renderTemplate(payTpl.body, vars) : `Payment link for ${p.purpose} (${inr(amount)}): ${link}`, actorId: ctx.user.id, template: payTpl, vars });
      await flash(r.status !== "failed" ? "Payment link sent on WhatsApp." : "Link created but not delivered: " + r.reason, r.status !== "failed" ? "ok" : "error");
    } else if (canVerifyPayment(ctx.perms)) {
      await settlePayment(ctx.tenantId, p.id, true, actor);
      await flash("Payment recorded and receipt issued.");
    } else {
      await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: e.id, type: "payment", outcome: "collected", actorId: ctx.user.id, content: `${p.purpose} of ${inr(amount)} collected by ${mode.replace("_", " ")}. Waiting for accounts to verify.` });
      await flash("Recorded. Accounts will verify and issue the receipt.");
    }
  } else {
    if (!canVerifyPayment(ctx.perms)) throw new Error("Only accounts or an admin can verify payments.");
    const p = await one("select enquiry_id from payments where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "paymentId")]);
    if (!p) return;
    await settlePayment(ctx.tenantId, str(fd, "paymentId"), what === "verify", actor, str(fd, "reference") || undefined);
    await flash(what === "verify" ? "Payment verified and receipt issued." : "Payment marked as failed.");
  }
  done();
}

export async function confirmAdmissionAction(fd: FormData) {
  const ctx = await guard("applications");
  if (!["F", "T", "Decide"].includes(lvl(ctx.perms, "applications"))) throw new Error("Your role cannot confirm admissions.");
  const e = await findEnquiry(ctx, str(fd, "enquiryId"));
  const res = await confirmAdmission(ctx.tenantId, e.id, actorOf(ctx), isFullAdmin(ctx.perms));
  await flash(res.ok ? "Admission confirmed. The welcome workflow has started." : res.error ?? "Could not confirm.", res.ok ? "ok" : "error");
  done();
}

export async function checklistFor(enquiryId: string) {
  const ctx = await guard("applications");
  return checklist(ctx.tenantId, (await findEnquiry(ctx, enquiryId)).id);
}
