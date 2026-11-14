// Application, documents, payments and admission confirmation (PRD 7.9 - 7.11).
// Used by staff actions and by the parent-facing public pages, so it takes a tenant id, not a session.
import { insert, one, q, update, type Row } from "./db";
import { addTask, changeStage, emit, getEnquiry, logActivity, needsNextAction, stageByName, tenantSettings, type Actor } from "./core";

export const APPLICATION_SECTIONS: { title: string; fields: { key: string; label: string; required?: boolean; type?: string; options?: string[] }[] }[] = [
  { title: "Student", fields: [
    { key: "previous_school", label: "Current / previous school" }, { key: "previous_grade", label: "Current grade" },
    { key: "mother_tongue", label: "Mother tongue", required: true }, { key: "medical", label: "Medical conditions or allergies (write None if none)", required: true },
  ] },
  { title: "Parents", fields: [
    { key: "father_name", label: "Father's name", required: true }, { key: "father_occupation", label: "Father's occupation" },
    { key: "mother_name", label: "Mother's name", required: true }, { key: "mother_occupation", label: "Mother's occupation" },
  ] },
  { title: "Address and transport", fields: [
    { key: "address", label: "Home address", required: true }, { key: "pincode", label: "PIN code", required: true },
    { key: "transport", label: "School transport needed?", type: "select", options: ["Yes", "No", "Not sure"], required: true },
  ] },
];
const REQUIRED = APPLICATION_SECTIONS.flatMap((s) => s.fields.filter((f) => f.required).map((f) => f.key));

/** Atomically takes the next number from a per-tenant series (application numbers, receipts). */
export async function nextNumber(tenantId: string, counter: "next_app_no" | "next_receipt_no"): Promise<number> {
  const r = await one(
    `update tenants set settings = jsonb_set(settings, array[$2::text], to_jsonb(coalesce((settings->>$2)::int, 1) + 1)) where id=$1
     returning coalesce((settings->>$2)::int, 2) - 1 as n`,
    [tenantId, counter],
  );
  return r!.n;
}

async function advance(tenantId: string, enquiryId: string, from: string[], to: string, actor: Actor) {
  const e = await getEnquiry(tenantId, enquiryId);
  const st = await stageByName(tenantId, to);
  if (e && st && from.includes(e.stage_name)) await changeStage(tenantId, enquiryId, st.id, actor);
}

export async function startApplication(tenantId: string, enquiryId: string, actor: Actor): Promise<Row> {
  const existing = await one("select * from applications where tenant_id=$1 and enquiry_id=$2", [tenantId, enquiryId]);
  if (existing) return existing;
  const e = await getEnquiry(tenantId, enquiryId);
  if (!e) throw new Error("Enquiry not found");
  const s = await tenantSettings(tenantId);
  const hh = await one("select address, pincode from households where id=$1", [e.household_id]);
  const st = await one("select current_school, current_grade from students where id=$1", [e.student_id]);
  // APP-02: prefill from what the school already knows.
  const answers = { address: hh?.address ?? "", pincode: hh?.pincode ?? "", previous_school: st?.current_school ?? "", previous_grade: st?.current_grade ?? "", transport: e.custom?.transport_required ?? "" };
  const app = await insert("applications", { tenant_id: tenantId, enquiry_id: enquiryId, answers, progress: progressOf(answers) });
  if (!e.application_no) {
    const n = await nextNumber(tenantId, "next_app_no");
    const yy = (await one("select name from academic_years where id=$1", [e.year_id]))?.name.slice(2, 4) ?? "";
    await q("update enquiries set application_no=$2 where id=$1", [enquiryId, `${s.app_no_prefix ?? "APP"}-${yy}-${String(n).padStart(4, "0")}`]);
  }
  for (const type of (s.doc_types ?? []) as string[]) await insert("documents", { tenant_id: tenantId, enquiry_id: enquiryId, type });
  await logActivity(tenantId, { householdId: e.household_id, enquiryId, type: "form", outcome: "started", actorId: actor?.id, content: actor ? `Application started by ${actor.name} (assisted).` : "Application form started by the parent." });
  const stage = await stageByName(tenantId, "Form started");
  if (stage && ["prospect", "enquiry", "visit"].includes(e.phase_key)) await changeStage(tenantId, enquiryId, stage.id, actor);
  await emit(tenantId, "form_started", enquiryId);
  return app;
}

export const progressOf = (answers: Row) => Math.round((REQUIRED.filter((k) => String(answers[k] ?? "").trim()).length / REQUIRED.length) * 100);

/** Age on the programme's cut-off date against its minimum age (APP-06). Null means eligible or not checkable. */
export async function ageIssue(tenantId: string, e: Row): Promise<string | null> {
  const st = await one("select dob::text as dob from students where id=$1", [e.student_id]);
  const pr = await one("select min_age_years, age_cutoff::text as cutoff from programmes where tenant_id=$1 and branch_id=$2 and year_id=$3 and grade=$4", [tenantId, e.branch_id, e.year_id, e.grade]);
  if (!st?.dob || !pr?.cutoff || pr.min_age_years == null) return null;
  const years = (new Date(pr.cutoff).getTime() - new Date(st.dob).getTime()) / (365.25 * 86400e3);
  return years < Number(pr.min_age_years) ? `The child will be ${years.toFixed(1)} years old on the cut-off date; ${e.grade} needs ${pr.min_age_years} years.` : null;
}

export async function saveApplication(tenantId: string, enquiryId: string, answers: Row, opts: { submit: boolean; declaration: boolean; overrideAge?: boolean }, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const app = await one("select * from applications where tenant_id=$1 and enquiry_id=$2", [tenantId, enquiryId]);
  if (!app) return { ok: false, error: "Start the application first." };
  if (app.status === "submitted") return { ok: false, error: "This application is already submitted." };
  const merged = { ...app.answers, ...answers };
  const progress = progressOf(merged);
  const e = (await getEnquiry(tenantId, enquiryId))!;
  if (opts.submit) {
    if (progress < 100) return { ok: false, error: "Some required answers are missing. They are marked on the form." };
    if (!opts.declaration) return { ok: false, error: "Please tick the declaration to submit." };
    const issue = await ageIssue(tenantId, e);
    if (issue && !opts.overrideAge) return { ok: false, error: issue + (actor ? " Someone with override permission can still submit." : " Please speak to the admissions office.") };
  }
  await update("applications", tenantId, app.id, { answers: merged, progress, updated_at: new Date(), ...(opts.submit ? { status: "submitted", declaration: true, submitted_at: new Date() } : {}) });
  if (merged.address) await q("update households set address=$2, pincode=$3 where id=$1", [e.household_id, merged.address, merged.pincode ?? null]);
  if (opts.submit) {
    await logActivity(tenantId, { householdId: e.household_id, enquiryId, type: "form", outcome: "submitted", actorId: actor?.id, content: "Application form submitted with declaration." });
    const stage = await stageByName(tenantId, "Form submitted");
    if (stage && e.stage_name === "Form started") await changeStage(tenantId, enquiryId, stage.id, actor);
    const s = await tenantSettings(tenantId);
    if (!(await one("select 1 from payments where enquiry_id=$1 and purpose='Registration fee'", [enquiryId]))) await insert("payments", { tenant_id: tenantId, enquiry_id: enquiryId, purpose: "Registration fee", amount: s.fees?.registration ?? 1500 });
    if (await needsNextAction(tenantId, enquiryId)) await addTask(tenantId, { enquiryId, title: "Review the submitted application", dueAt: new Date(Date.now() + 4 * 3600e3) });
    await emit(tenantId, "form_submitted", enquiryId);
  }
  return { ok: true };
}

/** Marks a payment paid or failed, issues the receipt and moves the stage (FEE-03, FEE-04). */
export async function settlePayment(tenantId: string, paymentId: string, success: boolean, actor: Actor, reference?: string): Promise<Row | null> {
  const p = await one("select * from payments where tenant_id=$1 and id=$2", [tenantId, paymentId]);
  if (!p || p.status === "paid") return p;
  const e = (await getEnquiry(tenantId, p.enquiry_id))!;
  const amount = "₹" + new Intl.NumberFormat("en-IN").format(Number(p.amount));
  if (!success) {
    await update("payments", tenantId, paymentId, { status: "failed" });
    await logActivity(tenantId, { householdId: e.household_id, enquiryId: e.id, type: "payment", outcome: "failed", content: `${p.purpose} payment of ${amount} did not go through. No money was taken. The parent can retry from the same link.` });
    await emit(tenantId, "payment_failed", e.id);
    return one("select * from payments where id=$1", [paymentId]);
  }
  const s = await tenantSettings(tenantId);
  const receipt = `${s.receipt_prefix ?? "RCPT"}-${String(await nextNumber(tenantId, "next_receipt_no")).padStart(5, "0")}`;
  await update("payments", tenantId, paymentId, { status: "paid", receipt_no: receipt, paid_at: new Date(), verified_by: actor?.id ?? null, reference: reference ?? p.reference });
  await logActivity(tenantId, { householdId: e.household_id, enquiryId: e.id, type: "payment", outcome: "paid", actorId: actor?.id, content: `${p.purpose} of ${amount} received. Receipt ${receipt}.` });
  if (p.purpose === "Registration fee") await advance(tenantId, e.id, ["Form submitted", "Form started"], "Fee paid", actor);
  return one("select * from payments where id=$1", [paymentId]);
}

export async function checklist(tenantId: string, enquiryId: string): Promise<{ label: string; done: boolean }[]> {
  const fee = await one("select 1 from payments where tenant_id=$1 and enquiry_id=$2 and purpose='Admission fee' and status='paid'", [tenantId, enquiryId]);
  const docs = await one("select count(*)::int total, count(*) filter (where status='verified')::int ok from documents where tenant_id=$1 and enquiry_id=$2", [tenantId, enquiryId]);
  const app = await one("select declaration, status from applications where tenant_id=$1 and enquiry_id=$2", [tenantId, enquiryId]);
  return [
    { label: "Application submitted with signed declaration", done: app?.status === "submitted" && app.declaration },
    { label: `Documents verified (${docs!.ok} of ${docs!.total})`, done: docs!.total > 0 && docs!.ok === docs!.total },
    { label: "Admission fee paid", done: !!fee },
  ];
}

export async function seatUse(tenantId: string, branchId: string, yearId: string, grade: string | null): Promise<{ capacity: number; confirmed: number } | null> {
  const pr = await one("select capacity from programmes where tenant_id=$1 and branch_id=$2 and year_id=$3 and grade=$4", [tenantId, branchId, yearId, grade]);
  if (!pr) return null;
  const c = await one("select count(*)::int n from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.branch_id=$2 and e.year_id=$3 and e.grade=$4 and s.is_won", [tenantId, branchId, yearId, grade]);
  return { capacity: pr.capacity, confirmed: c!.n };
}

/** ENR-01: one action, allowed only when the checklist is complete and a seat is free. */
export async function confirmAdmission(tenantId: string, enquiryId: string, actor: Actor, allowOverCapacity = false): Promise<{ ok: boolean; error?: string }> {
  const e = await getEnquiry(tenantId, enquiryId);
  if (!e) return { ok: false, error: "Record not found." };
  const missing = (await checklist(tenantId, enquiryId)).filter((c) => !c.done);
  if (missing.length) return { ok: false, error: "Not ready to confirm. Still pending: " + missing.map((m) => m.label).join("; ") + "." };
  const seats = await seatUse(tenantId, e.branch_id, e.year_id, e.grade);
  if (seats && seats.confirmed >= seats.capacity && !allowOverCapacity) return { ok: false, error: `${e.grade} is full (${seats.confirmed} of ${seats.capacity} seats). A group admin can confirm above capacity.` };
  const st = await stageByName(tenantId, "Admission confirmed");
  if (!st) return { ok: false, error: "The pipeline has no \"Admission confirmed\" stage." };
  return changeStage(tenantId, enquiryId, st.id, actor);
}
