"use server";
import { revalidatePath } from "next/cache";
import { insert, one, q } from "@/lib/db";
import { addTask, audit, captureEnquiry, changeStage, logActivity, notify, renderTemplate, sendMessage, getEnquiry } from "@/lib/core";
import { actorOf, findEnquiry, flash, guard, str } from "@/lib/guard";
import { leadIds, type SP } from "@/lib/leads";
import { canCreateLeads, canEditLeads, canMessage, has, leadScope, lvl } from "@/lib/perm";
import { parseLocal } from "@/lib/fmt";
import { mergeVars } from "@/lib/workflows";

export async function quickAdd(_: any, fd: FormData) {
  const ctx = await guard("leads");
  if (!canCreateLeads(ctx.perms)) return { ok: false as const, error: "Your role cannot add enquiries." };
  const branchId = str(fd, "branchId");
  if (!ctx.branches.some((b) => b.id === branchId)) return { ok: false as const, error: "Choose one of your branches." };
  const res = await captureEnquiry(
    ctx.tenantId,
    {
      studentName: str(fd, "studentName"), guardianName: str(fd, "guardianName"), mobile: str(fd, "mobile"), branchId, yearId: ctx.yearId, grade: str(fd, "grade") || undefined, board: str(fd, "board") || undefined,
      sourceId: str(fd, "sourceId") || undefined, heardAbout: str(fd, "heardAbout") || undefined, note: str(fd, "note") || undefined, dob: str(fd, "dob") || undefined,
      consent: { source: fd.get("consent") ? "Verbal consent recorded by " + ctx.user.name : "Not recorded" },
      preferOwnerId: leadScope(ctx.perms) === "own" ? ctx.user.id : undefined,
    },
    actorOf(ctx),
  );
  if (!res.ok) return res;
  // Someone who only sees their own records cannot open a family that belongs to a colleague.
  const canOpen = leadScope(ctx.perms) !== "own" || res.ownerId === ctx.user.id;
  const what = res.status === "re_enquiry" ? `Existing family: re-enquiry added. Owner ${res.ownerName} has been alerted.` : res.status === "sibling_added" ? `Sibling added to the existing household. Owner: ${res.ownerName}.` : `Enquiry saved and assigned to ${res.ownerName}.`;
  await flash(what);
  revalidatePath("/", "layout");
  return { ...res, canOpen };
}

/** Stage move from the Kanban board or the 360 page. Returns what is missing instead of failing silently. */
export async function moveStage(enquiryId: string, stageId: string, extra: { closure_reason?: string; expected_decision?: string } = {}) {
  const ctx = await guard("leads");
  if (!canEditLeads(ctx.perms)) return { ok: false, error: "Your role can view leads but not change their stage." };
  await findEnquiry(ctx, enquiryId);
  const res = await changeStage(ctx.tenantId, enquiryId, stageId, actorOf(ctx), extra);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function bulkAction(fd: FormData) {
  const ctx = await guard("bulk");
  const action = str(fd, "action");
  // Either explicit ids, or "everything matching the current filter".
  const sp: SP = fd.get("all") === "1" ? Object.fromEntries(new URLSearchParams(str(fd, "query"))) : { ids: str(fd, "ids"), year: "all" };
  const ids = await leadIds(ctx, sp);
  if (!ids.length) return flash("No records selected.", "error");
  const actor = actorOf(ctx);
  let done = 0, skipped = 0;
  if (action === "stage") {
    if (!canEditLeads(ctx.perms)) throw new Error("Your role cannot change stages.");
    for (const id of ids) ((await changeStage(ctx.tenantId, id, str(fd, "stageId"), actor, { closure_reason: str(fd, "closure_reason") || undefined })).ok ? done++ : skipped++);
    await flash(`Stage changed for ${done} record${done === 1 ? "" : "s"}` + (skipped ? `; ${skipped} skipped because the stage needs information they do not have.` : "."));
  } else if (action === "reassign") {
    if (!["F", "T"].includes(lvl(ctx.perms, "reassign"))) throw new Error("Your role cannot reassign leads.");
    const to = await one("select id, name from users where tenant_id=$1 and id=$2 and status='active'", [ctx.tenantId, str(fd, "ownerId")]);
    if (!to) return flash("Choose who to assign to.", "error");
    const reason = str(fd, "reason") || "Bulk reassignment";
    for (const id of ids) {
      const e = await getEnquiry(ctx.tenantId, id);
      if (!e || e.owner_id === to.id) { skipped++; continue; }
      await q("update enquiries set owner_id=$2, updated_at=now() where id=$1", [id, to.id]);
      await q("update tasks set owner_id=$2 where enquiry_id=$1 and status='open'", [id, to.id]);
      await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: id, type: "system", actorId: ctx.user.id, content: `Reassigned from ${e.owner_name} to ${to.name}. Reason: ${reason}` });
      done++;
    }
    if (done) await notify(ctx.tenantId, to.id, "assigned", `${done} enquir${done === 1 ? "y" : "ies"} reassigned to you by ${ctx.user.name}`, "/leads?chip=my");
    await flash(`Reassigned ${done} record${done === 1 ? "" : "s"} to ${to.name}.`);
  } else if (action === "task") {
    const due = parseLocal(str(fd, "dueAt"));
    for (const id of ids) { await addTask(ctx.tenantId, { enquiryId: id, title: str(fd, "title") || "Follow-up", dueAt: due }); done++; }
    await flash(`Task added to ${done} record${done === 1 ? "" : "s"}.`);
  } else if (action === "tag") {
    const tag = str(fd, "tag").toLowerCase();
    if (!tag) return flash("Type a tag first.", "error");
    await q("update enquiries set tags = tags || to_jsonb($2::text) where tenant_id=$1 and id::text in (select jsonb_array_elements_text($3::jsonb)) and not tags @> to_jsonb($2::text)", [ctx.tenantId, tag, ids]);
    await flash(`Tag "${tag}" added to ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
  } else if (action === "message") {
    if (!canMessage(ctx.perms)) throw new Error("Your role cannot send messages.");
    const tpl = await one("select * from templates where tenant_id=$1 and id=$2 and status='approved'", [ctx.tenantId, str(fd, "templateId")]);
    if (!tpl) return flash("Choose an approved template.", "error");
    for (const id of ids) {
      const e = await getEnquiry(ctx.tenantId, id);
      if (!e) continue;
      const vars = await mergeVars(ctx.tenantId, e);
      const r = await sendMessage(ctx.tenantId, { householdId: e.household_id, enquiryId: id, channel: tpl.channel, body: renderTemplate(tpl.body, vars), actorId: ctx.user.id, template: tpl, vars });
      r.status !== "failed" ? done++ : skipped++;
    }
    await flash(`"${tpl.name}" sent to ${done} famil${done === 1 ? "y" : "ies"}` + (skipped ? `; ${skipped} not delivered (see each timeline for why).` : "."));
  }
  await audit(ctx.tenantId, actor, "bulk", "enquiry", null, `Bulk ${action} on ${ids.length} enquiries`);
  revalidatePath("/leads");
}

export async function saveView(fd: FormData) {
  const ctx = await guard("leads");
  const name = str(fd, "name");
  if (!name) return flash("Give the view a name.", "error");
  await insert("saved_views", { tenant_id: ctx.tenantId, user_id: ctx.user.id, name, shared: fd.get("shared") === "on" && has(ctx.perms, "bulk"), query: str(fd, "query") });
  await flash(`View "${name}" saved.`);
  revalidatePath("/leads");
}

export async function deleteView(fd: FormData) {
  const ctx = await guard("leads");
  await q("delete from saved_views where tenant_id=$1 and id=$2 and user_id=$3", [ctx.tenantId, str(fd, "id"), ctx.user.id]);
  revalidatePath("/leads");
}

/** Front-desk walk-in. An existing mobile adds a walk-in touch and a task for the owner; it never creates a second household (CAP-02). */
export async function walkIn(_: any, fd: FormData) {
  const ctx = await guard("leads");
  if (!canCreateLeads(ctx.perms)) return { ok: false as const, error: "Your role cannot add walk-ins." };
  const res = await captureEnquiry(
    ctx.tenantId,
    { studentName: str(fd, "studentName"), guardianName: str(fd, "guardianName"), mobile: str(fd, "mobile"), branchId: str(fd, "branchId"), yearId: ctx.yearId, grade: str(fd, "grade"), sourceId: str(fd, "sourceId") || undefined, channel: "Walk-in", source: "Front desk walk-in", consent: { source: fd.get("consent") ? "Verbal consent at front desk" : "Not recorded" } },
    actorOf(ctx),
  );
  if (!res.ok) return res;
  await addTask(ctx.tenantId, { enquiryId: res.enquiryId, type: "visit", title: "Walk-in waiting at the front desk", dueAt: new Date(), priority: "high" });
  await notify(ctx.tenantId, res.ownerId, "due", "Walk-in at the front desk: " + str(fd, "studentName"), "/households/" + res.householdId + "?e=" + res.enquiryId);
  const n = await one("select count(*)::int n from source_touches where tenant_id=$1 and channel='Walk-in' and (created_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date", [ctx.tenantId]);
  revalidatePath("/", "layout");
  return { ...res, token: "W-" + String(n!.n).padStart(2, "0"), message: res.status === "re_enquiry" ? "Existing family. Walk-in added to their record." : res.status === "sibling_added" ? "Existing family. New child added to their household." : "New enquiry saved." };
}
