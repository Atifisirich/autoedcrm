"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth";
import { insert, one, q, update } from "@/lib/db";
import { assignOwner, audit, captureEnquiry, changeStage, findHousehold, logActivity, normMobile, stageByName, validMobile } from "@/lib/core";
import { actorOf, flash, guard, str } from "@/lib/guard";
import { adminSections, CAPS, isFullAdmin } from "@/lib/perm";
import { PACKS, seedProgrammes } from "@/lib/seed";
import { hashKey, parseCsv } from "@/lib/util";

async function admin(section: string) {
  const ctx = await guard();
  if (!adminSections(ctx.perms).includes(section)) throw new Error("Your role cannot change this setting.");
  return ctx;
}
const log = (ctx: Awaited<ReturnType<typeof guard>>, entity: string, summary: string, before?: any, after?: any) => audit(ctx.tenantId, actorOf(ctx), "config", entity, null, summary, before, after);
const done = (path = "/admin") => revalidatePath(path, "layout");

// ----- organisation, branches, years -----

export async function saveOrg(fd: FormData) {
  const ctx = await admin("org");
  const s = { ...ctx.tenant.settings, legal_name: str(fd, "legal_name"), gstin: str(fd, "gstin"), first_response_mins: Number(str(fd, "first_response_mins")) || 30, reopen_on_reenquiry: fd.get("reopen") === "on", call_recording: fd.get("call_recording") === "on",
    fees: { registration: Number(str(fd, "fee_registration")) || 0, admission: Number(str(fd, "fee_admission")) || 0 }, app_no_prefix: str(fd, "app_no_prefix") || "APP", receipt_prefix: str(fd, "receipt_prefix") || "RCPT",
    closure_reasons: str(fd, "closure_reasons").split("\n").map((x) => x.trim()).filter(Boolean), doc_types: str(fd, "doc_types").split("\n").map((x) => x.trim()).filter(Boolean),
    privacy_notice: str(fd, "privacy_notice") };
  await q("update tenants set name=$2, settings=$3, branding=$4 where id=$1", [ctx.tenantId, str(fd, "name") || ctx.tenant.name, s, { ...ctx.tenant.branding, color: str(fd, "color") || "#0f6e6e" }]);
  await log(ctx, "organisation", "Updated organisation settings", ctx.tenant.settings, s);
  await flash("Organisation settings saved.");
  done();
}

export async function saveBranch(fd: FormData) {
  const ctx = await admin("org");
  const data = { name: str(fd, "name"), city: str(fd, "city"), address: str(fd, "address"), phone: str(fd, "phone"), open_hour: Number(str(fd, "open_hour")) || 9, close_hour: Number(str(fd, "close_hour")) || 18, visit_capacity: Number(str(fd, "visit_capacity")) || 3 };
  if (!data.name) return flash("Give the branch a name.", "error");
  if (str(fd, "id")) await update("branches", ctx.tenantId, str(fd, "id"), data);
  else {
    const limit = { starter: 1, growth: 5, group: 50 }[ctx.tenant.plan as string] ?? 1;
    const n = await one("select count(*)::int n from branches where tenant_id=$1 and active", [ctx.tenantId]);
    if (n!.n >= limit) return flash(`Your ${ctx.tenant.plan} plan includes ${limit} branch${limit === 1 ? "" : "es"}. Contact AutoED to add more.`, "error");
    const b = await insert("branches", { tenant_id: ctx.tenantId, ...data, boards: ctx.tenant.settings.boards ?? [] });
    for (const y of ctx.years.filter((x) => x.status === "open")) await seedProgrammes(ctx.tenantId, b.id, y.id, PACKS[ctx.tenant.pack] ? ctx.tenant.pack : "cbse_day", Number(y.name.slice(0, 4)));
  }
  await log(ctx, "branch", `Saved branch "${data.name}"`);
  await flash("Branch saved.");
  done();
}

export async function yearAction(fd: FormData) {
  const ctx = await admin("org");
  const id = str(fd, "id"), what = str(fd, "what");
  if (what === "default") { await q("update academic_years set is_default=(id=$2) where tenant_id=$1", [ctx.tenantId, id]); await q("update academic_years set status='open' where id=$1", [id]); }
  else await update("academic_years", ctx.tenantId, id, { status: what === "close" ? "closed" : "open" });
  await log(ctx, "academic_year", `Academic year: ${what}`);
  done();
}

/**
 * Rollover wizard: creates the next academic year, copies programmes and seats, and carries
 * forward last year's "not now" families into the new year's Prospect phase with full history (HUB-03).
 */
export async function rollover(fd: FormData) {
  const ctx = await admin("org");
  const from = ctx.years.find((y) => y.id === str(fd, "from"));
  const name = str(fd, "name");
  if (!from || !/^\d{4}-\d{2}$/.test(name)) return flash("Enter the new year as, for example, 2028-29.", "error");
  if (ctx.years.some((y) => y.name === name)) return flash("That academic year already exists.", "error");
  const year = await insert("academic_years", { tenant_id: ctx.tenantId, name, status: "open", position: Math.max(...ctx.years.map((y) => y.position)) + 1 });
  await q(
    `insert into programmes (tenant_id, branch_id, year_id, board, grade, grade_order, capacity, min_age_years, age_cutoff)
     select tenant_id, branch_id, $3, board, grade, grade_order, capacity, min_age_years, age_cutoff + interval '1 year' from programmes where tenant_id=$1 and year_id=$2`,
    [ctx.tenantId, from.id, year.id],
  );
  let carried = 0;
  if (fd.get("carry") === "on") {
    const start = await stageByName(ctx.tenantId, "New data");
    const lost = await q(
      `select e.* from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.year_id=$2
       and ((s.is_closed and e.closure_reason in ('Undecided','Fee too high','No response','No seat available')) or (not s.is_closed and not s.is_won))`,
      [ctx.tenantId, from.id],
    );
    for (const e of lost) {
      const n = await insert("enquiries", { tenant_id: ctx.tenantId, household_id: e.household_id, student_id: e.student_id, branch_id: e.branch_id, year_id: year.id, board: e.board, grade: e.grade, stage_id: start!.id, owner_id: e.owner_id, custom: e.custom, tags: ["carried forward"] });
      await insert("source_touches", { tenant_id: ctx.tenantId, enquiry_id: n.id, channel: "Data", source: `Carried forward from ${from.name}` });
      await logActivity(ctx.tenantId, { householdId: e.household_id, enquiryId: n.id, type: "system", content: `Carried forward from ${from.name} as a prospect for ${name}. Earlier history stays on this family's timeline.` });
      carried++;
    }
  }
  if (fd.get("makeDefault") === "on") await q("update academic_years set is_default=(id=$2) where tenant_id=$1", [ctx.tenantId, year.id]);
  await log(ctx, "academic_year", `Rolled over ${from.name} to ${name}; ${carried} families carried forward`);
  await flash(`${name} created with programmes and seats copied. ${carried} famil${carried === 1 ? "y" : "ies"} carried forward as prospects.`);
  done("/");
}

export async function saveProgramme(fd: FormData) {
  const ctx = await admin("org");
  await update("programmes", ctx.tenantId, str(fd, "id"), { capacity: Number(str(fd, "capacity")) || 0, min_age_years: str(fd, "min_age_years") ? Number(str(fd, "min_age_years")) : null });
  done();
}

// ----- users and roles -----

export async function saveUser(fd: FormData) {
  const ctx = await admin("users");
  const id = str(fd, "id");
  const role = await one("select id, name, permissions from roles where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "roleId")]);
  if (!role) return flash("Choose a role.", "error");
  // A branch-scoped admin cannot mint organisation-wide admins or reach other branches.
  if (!isFullAdmin(ctx.perms) && role.permissions.admin === "F") return flash("Only a group admin can give that role.", "error");
  let branchIds = fd.getAll("branchIds").map(String).filter((b) => ctx.branches.some((x) => x.id === b));
  if (!isFullAdmin(ctx.perms) && !branchIds.length) branchIds = ctx.branchIds;
  const data = { name: str(fd, "name"), role_id: role.id, branch_ids: branchIds, daily_capacity: Number(str(fd, "daily_capacity")) || 25, on_leave: fd.get("on_leave") === "on", reports_to: str(fd, "reports_to") || null };
  if (id) {
    const before = await one("select name, role_id, branch_ids, on_leave, daily_capacity from users where tenant_id=$1 and id=$2", [ctx.tenantId, id]);
    await update("users", ctx.tenantId, id, data);
    await audit(ctx.tenantId, actorOf(ctx), "permission", "user", id, `Updated user ${data.name} (${role.name})`, before, data);
    await flash("User saved.");
  } else {
    const email = str(fd, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return flash("Enter a valid work email.", "error");
    if (await one("select 1 from users where lower(email)=$1", [email])) return flash("Someone already uses that email.", "error");
    const temp = crypto.randomBytes(6).toString("base64url");
    const u = await insert("users", { tenant_id: ctx.tenantId, email, password_hash: await hashPassword(temp), ...data });
    await audit(ctx.tenantId, actorOf(ctx), "permission", "user", u.id, `Invited ${data.name} as ${role.name}`);
    await flash(`${data.name} added. Temporary password: ${temp} (share it securely; email invitations need the email channel connected).`);
  }
  done();
}

export async function userAction(fd: FormData) {
  const ctx = await admin("users");
  const id = str(fd, "id"), what = str(fd, "what");
  if (id === ctx.user.id) return flash("You cannot pause or reset your own account here.", "error");
  const u = await one("select * from users where tenant_id=$1 and id=$2", [ctx.tenantId, id]);
  if (!u) return;
  if (what === "pause" || what === "activate") {
    await update("users", ctx.tenantId, id, { status: what === "pause" ? "paused" : "active" });
    if (what === "pause") {
      await q("delete from sessions where user_id=$1", [id]);
      const open = await one("select count(*)::int n from enquiries e join stages s on s.id=e.stage_id where e.owner_id=$1 and not s.is_closed and not s.is_won", [id]);
      await flash(`${u.name} is paused and signed out.` + (open!.n ? ` They still own ${open!.n} open enquiries: reassign them from Leads.` : ""));
    } else await flash(`${u.name} is active again.`);
  } else if (what === "reset") {
    const temp = crypto.randomBytes(6).toString("base64url");
    await update("users", ctx.tenantId, id, { password_hash: await hashPassword(temp) });
    await q("delete from sessions where user_id=$1", [id]);
    await flash(`New temporary password for ${u.name}: ${temp}`);
  }
  await audit(ctx.tenantId, actorOf(ctx), "permission", "user", id, `User ${u.name}: ${what}`);
  done();
}

export async function saveRoles(fd: FormData) {
  const ctx = await admin("roles");
  const roles = await q("select * from roles where tenant_id=$1", [ctx.tenantId]);
  for (const r of roles) {
    if (r.name === "Group Admin") continue; // the last full-access role cannot be weakened
    const perms = Object.fromEntries(CAPS.map(([k]) => [k, str(fd, `${r.id}:${k}`) || r.permissions[k] || "-"]));
    if (JSON.stringify(perms) !== JSON.stringify(r.permissions)) {
      await update("roles", ctx.tenantId, r.id, { permissions: perms });
      await audit(ctx.tenantId, actorOf(ctx), "permission", "role", r.id, `Changed permissions of role "${r.name}"`, r.permissions, perms);
    }
  }
  await flash("Permissions saved. They apply from each user's next page load.");
  done();
}

export async function cloneRole(fd: FormData) {
  const ctx = await admin("roles");
  const r = await one("select * from roles where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  const name = str(fd, "name");
  if (!r || !name) return flash("Name the new role.", "error");
  await insert("roles", { tenant_id: ctx.tenantId, name, permissions: r.permissions });
  await log(ctx, "role", `Created role "${name}" from "${r.name}"`);
  done();
}

// ----- fields -----

export async function saveField(fd: FormData) {
  const ctx = await admin("fields");
  const label = str(fd, "label");
  if (!label) return flash("Give the field a label.", "error");
  const options = str(fd, "options").split(",").map((x) => x.trim()).filter(Boolean);
  const type = str(fd, "type") || "text";
  if (type === "select" && !options.length) return flash("Add at least one dropdown value.", "error");
  if (str(fd, "id")) {
    await update("custom_fields", ctx.tenantId, str(fd, "id"), { label, options, sensitive: fd.get("sensitive") === "on", active: fd.get("active") === "on" });
    await log(ctx, "custom_field", `Edited field "${label}"`);
  } else {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (await one("select 1 from custom_fields where tenant_id=$1 and entity='enquiry' and key=$2", [ctx.tenantId, key])) return flash("A field with that name already exists.", "error");
    const n = await one("select count(*)::int n from custom_fields where tenant_id=$1", [ctx.tenantId]);
    await insert("custom_fields", { tenant_id: ctx.tenantId, key, label, type, options, sensitive: fd.get("sensitive") === "on", position: n!.n + 1 });
    await log(ctx, "custom_field", `Added field "${label}" to Enquiry`);
  }
  await flash("Field saved. It is live on the family page, in the API and in exports of that record now.");
  done();
}

// ----- pipeline (PL-01, PL-04) -----

export async function saveStage(fd: FormData) {
  const ctx = await admin("pipeline");
  const data = { name: str(fd, "name"), color: str(fd, "color") || "slate", probability: Math.min(100, Math.max(0, Number(str(fd, "probability")) || 0)), sla_hours: str(fd, "sla_hours") ? Number(str(fd, "sla_hours")) : null, exempt_next_action: fd.get("exempt") === "on" };
  if (!data.name) return flash("Give the stage a name.", "error");
  if (str(fd, "id")) {
    const before = await one("select name, color, probability, sla_hours, exempt_next_action from stages where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
    await update("stages", ctx.tenantId, str(fd, "id"), data);
    await log(ctx, "stage", `Edited stage "${data.name}"`, before, data);
  } else {
    const ph = await one("select * from phases where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "phaseId")]);
    if (!ph) return;
    const n = await one("select coalesce(max(position),0)+1 as n from stages where phase_id=$1", [ph.id]);
    await insert("stages", { tenant_id: ctx.tenantId, phase_id: ph.id, position: n!.n, ...data, is_closed: ph.key === "closed", is_won: ph.key === "enrolled", required_fields: ph.key === "closed" ? ["closure_reason"] : [], exempt_next_action: data.exempt_next_action || ["closed", "enrolled", "prospect"].includes(ph.key) });
    await log(ctx, "stage", `Added stage "${data.name}" to ${ph.name}`);
  }
  await flash("Stage saved.");
  done();
}

export async function moveStageOrder(fd: FormData) {
  const ctx = await admin("pipeline");
  const s = await one("select * from stages where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  if (!s) return;
  const list = await q("select id from stages where phase_id=$1 and active order by position", [s.phase_id]);
  const i = list.findIndex((x) => x.id === s.id), j = i + (str(fd, "dir") === "up" ? -1 : 1);
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) await q("update stages set position=$2 where id=$1", [list[k].id, k]);
  done();
}

/** Retiring a stage asks where its records go; they move with a timeline entry and history keeps the old name (PL-04). */
export async function retireStage(fd: FormData) {
  const ctx = await admin("pipeline");
  const s = await one("select * from stages where tenant_id=$1 and id=$2 and active", [ctx.tenantId, str(fd, "id")]);
  if (!s) return;
  if (["New", "New data", "Admission confirmed"].includes(s.name)) return flash(`"${s.name}" is used by the product logic and cannot be removed. You can rename it.`, "error");
  const records = await q("select id from enquiries where tenant_id=$1 and stage_id=$2", [ctx.tenantId, s.id]);
  const target = str(fd, "targetId");
  if (records.length && (!target || target === s.id)) return flash(`${records.length} records are in "${s.name}". Choose the stage they should move to.`, "error");
  for (const r of records) {
    const res = await changeStage(ctx.tenantId, r.id, target, actorOf(ctx), { closure_reason: "Other", note: `Stage "${s.name}" was retired by an admin` });
    if (!res.ok) return flash("Could not move every record to that stage (it needs information they do not have). Pick another target.", "error");
  }
  await update("stages", ctx.tenantId, s.id, { active: false });
  await log(ctx, "stage", `Retired stage "${s.name}"; ${records.length} records moved`);
  await flash(`"${s.name}" retired. ${records.length} record${records.length === 1 ? "" : "s"} moved; past timelines still show the old name.`);
  done();
}

// ----- sources, routing, scoring -----

export async function saveSource(fd: FormData) {
  const ctx = await admin("sources");
  const data = { channel: str(fd, "channel"), name: str(fd, "name"), cost: Number(str(fd, "cost")) || 0, active: fd.get("active") !== "off" };
  if (!data.channel || !data.name) return flash("Channel and source name are both needed.", "error");
  if (str(fd, "id")) await update("sources", ctx.tenantId, str(fd, "id"), data);
  else await insert("sources", { tenant_id: ctx.tenantId, ...data });
  await log(ctx, "source", `Saved source "${data.name}"`);
  done();
}

export async function saveRule(fd: FormData) {
  const ctx = await admin("routing");
  const what = str(fd, "what");
  if (what === "delete") await q("delete from assignment_rules where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  else {
    const users = fd.getAll("userIds").map(String);
    if (!users.length) return flash("Pick at least one person to receive leads.", "error");
    const data = { name: str(fd, "name") || "Rule", position: Number(str(fd, "position")) || 1, method: str(fd, "method") || "round_robin", user_ids: users, conditions: { branch_id: str(fd, "branch_id") || undefined, channel: str(fd, "channel") || undefined, grades: fd.getAll("grades").map(String) } };
    if (str(fd, "id")) await update("assignment_rules", ctx.tenantId, str(fd, "id"), data);
    else await insert("assignment_rules", { tenant_id: ctx.tenantId, ...data });
  }
  await log(ctx, "assignment_rule", `Assignment rule ${what === "delete" ? "deleted" : "saved"}: ${str(fd, "name")}`);
  await flash("Routing rules updated.");
  done();
}

/** "Which rule would this lead hit?" tester (ASG-06). Nothing is assigned. */
export async function simulateRule(_: any, fd: FormData): Promise<{ text: string }> {
  const ctx = await admin("routing");
  const r = await assignOwner(ctx.tenantId, { branchId: str(fd, "branch_id"), grade: str(fd, "grade") || null, channel: str(fd, "channel") || null }, true);
  return { text: `Would go to ${r.ownerName}. ${r.reason}.` };
}

export async function saveScoring(fd: FormData) {
  const ctx = await admin("routing");
  const scoring = Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("s_")).map(([k, v]) => [k.slice(2), Number(v) || 0]));
  const s = { ...ctx.tenant.settings, scoring, hot_at: Number(str(fd, "hot_at")) || 60, warm_at: Number(str(fd, "warm_at")) || 30 };
  await q("update tenants set settings=$2 where id=$1", [ctx.tenantId, s]);
  await log(ctx, "scoring", "Changed scoring rules", ctx.tenant.settings.scoring, scoring);
  await flash("Scoring saved. Scores refresh as each record gets new activity.");
  done();
}

// ----- templates, forms -----

export async function saveTemplate(fd: FormData) {
  const ctx = await admin("templates");
  const data = { name: str(fd, "name"), channel: str(fd, "channel") || "whatsapp", category: str(fd, "category") || "utility", language: str(fd, "language") || "English", body: str(fd, "body") };
  if (!data.name || !data.body) return flash("A template needs a name and a body.", "error");
  // WhatsApp templates need provider approval before use. Without a connected number this is recorded as "pending".
  if (str(fd, "id")) await update("templates", ctx.tenantId, str(fd, "id"), { ...data, status: str(fd, "status") || "approved" });
  else await insert("templates", { tenant_id: ctx.tenantId, ...data, status: data.channel === "whatsapp" ? "pending" : "approved" });
  await log(ctx, "template", `Saved template "${data.name}" (${data.channel})`);
  await flash(str(fd, "id") ? "Template saved." : data.channel === "whatsapp" ? "Template saved as pending approval." : "Template saved.");
  done();
}

export async function saveForm(fd: FormData) {
  const ctx = await admin("forms");
  const data = { name: str(fd, "name"), branch_id: str(fd, "branch_id") || null, source_id: str(fd, "source_id") || null, thank_you: str(fd, "thank_you") || "Thank you. Our admissions team will call you shortly.", active: fd.get("active") === "on", fields: ["student_name", "guardian_name", "mobile", ...fd.getAll("fields").map(String)] };
  if (str(fd, "id")) await update("forms", ctx.tenantId, str(fd, "id"), data);
  else {
    const slug = `${ctx.tenant.subdomain}-${(data.name || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomBytes(2).toString("hex")}`;
    await insert("forms", { tenant_id: ctx.tenantId, slug, ...data, active: true });
  }
  await log(ctx, "form", `Saved form "${data.name}"`);
  await flash("Form saved and live at its link.");
  done();
}

// ----- integrations -----

export async function createApiKey(fd: FormData) {
  const ctx = await admin("integrations");
  const key = "aed_" + crypto.randomBytes(24).toString("base64url");
  await insert("api_keys", { tenant_id: ctx.tenantId, name: str(fd, "name") || "API key", key_hash: hashKey(key), key_prefix: key.slice(0, 10), source_id: str(fd, "source_id") || null });
  await log(ctx, "api_key", `Created API key "${str(fd, "name")}"`);
  await flash(`Copy this key now; it is not shown again: ${key}`);
  done();
}

export async function integrationAction(fd: FormData) {
  const ctx = await admin("integrations");
  const what = str(fd, "what");
  if (what === "revoke_key") await q("delete from api_keys where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  if (what === "delete_hook") await q("delete from webhooks where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  if (what === "add_hook") {
    const url = str(fd, "url");
    if (!/^https:\/\//.test(url)) return flash("Webhook URLs must start with https://", "error");
    const secret = crypto.randomBytes(16).toString("hex");
    await insert("webhooks", { tenant_id: ctx.tenantId, url, secret, events: [] });
    await flash(`Webhook added. Signing secret (shown once): ${secret}`);
  }
  await log(ctx, "integration", `Integration change: ${what}`);
  done();
}

// ----- data: import with review queue and undo (CAP-08, DUP-03, HUB-04) -----

const ALIASES: Record<string, string[]> = { studentName: ["student", "student name", "child", "child name", "name"], guardianName: ["parent", "parent name", "guardian", "father name", "father", "mother name"], mobile: ["mobile", "phone", "mobile number", "contact", "phone number"], email: ["email", "email id"], grade: ["grade", "class", "course"], source: ["source", "lead source"] };

export async function importCsv(fd: FormData) {
  const ctx = await admin("data");
  const file = fd.get("file") as File | null;
  if (!file?.size) return flash("Choose a CSV file.", "error");
  if (file.size > 5_000_000) return flash("That file is over 5 MB. Split it and import in parts.", "error");
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return flash("The file needs a header row and at least one data row.", "error");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (k: string) => head.findIndex((h) => ALIASES[k].includes(h));
  if (col("mobile") < 0 || col("studentName") < 0) return flash("Could not find the columns. The header needs at least \"Student name\" and \"Mobile\" (also read: Parent name, Email, Grade, Source).", "error");
  const strategy = str(fd, "strategy") || "review";
  const branchId = str(fd, "branch_id") || ctx.branches[0].id;
  const batch = await insert("import_batches", { tenant_id: ctx.tenantId, file_name: file.name, total: rows.length - 1, created_by: ctx.user.id });
  const grades: string[] = ctx.tenant.settings.grades ?? [];
  let created = 0, duplicates = 0, failed = 0;
  const seen = new Set<string>();
  for (const r of rows.slice(1)) {
    if (r.every((c) => !c.trim())) continue;
    const get = (k: string) => (col(k) >= 0 ? (r[col(k)] ?? "").trim() : "");
    const data = { studentName: get("studentName"), guardianName: get("guardianName"), mobile: normMobile(get("mobile")), email: get("email"), grade: get("grade"), source: get("source") };
    const row = (status: string, extra: Record<string, any> = {}) => insert("import_rows", { tenant_id: ctx.tenantId, batch_id: batch.id, data, status, ...extra });
    const error = !data.studentName ? "Student name is missing." : !validMobile(data.mobile) ? "Mobile number is not a valid 10-digit Indian mobile." : data.grade && !grades.includes(data.grade) ? `Grade "${data.grade}" is not one of your grades (${grades.slice(0, 4).join(", ")}…).` : seen.has(data.mobile + data.studentName.toLowerCase()) ? "Same student and mobile appear earlier in this file." : null;
    if (error) { failed++; await row("failed", { error }); continue; }
    seen.add(data.mobile + data.studentName.toLowerCase());
    const match = await findHousehold(ctx.tenantId, { mobile: data.mobile, email: data.email });
    if (match && strategy !== "touch") { duplicates++; await row(strategy === "skip" ? "skipped" : "review", { match_household_id: match.household_id }); continue; }
    const res = await captureEnquiry(ctx.tenantId, { ...data, guardianName: data.guardianName || "Parent", grade: data.grade || undefined, branchId, yearId: ctx.yearId, channel: "Data", source: data.source || `Import: ${file.name}`, asProspect: fd.get("as") !== "enquiry", consent: { source: str(fd, "consent_basis") || "Imported list" }, tags: str(fd, "tag") ? [str(fd, "tag")] : [] }, actorOf(ctx));
    if (!res.ok) { failed++; await row("failed", { error: res.error }); }
    else if (res.status === "created") { created++; await row("created", { enquiry_id: res.enquiryId }); }
    else { duplicates++; await row("merged", { enquiry_id: res.enquiryId, match_household_id: res.householdId }); }
  }
  await update("import_batches", ctx.tenantId, batch.id, { created, duplicates, failed });
  await audit(ctx.tenantId, actorOf(ctx), "import", "enquiry", batch.id, `Imported ${file.name}: ${created} created, ${duplicates} duplicates, ${failed} failed`);
  await flash(`Import finished: ${created} created, ${duplicates} already known${strategy === "review" && duplicates ? " (in the review queue)" : ""}, ${failed} with problems.`);
  done("/");
}

export async function reviewRows(fd: FormData) {
  const ctx = await admin("data");
  const what = str(fd, "what");
  const rows = await q("select r.*, b.file_name from import_rows r join import_batches b on b.id=r.batch_id where r.tenant_id=$1 and r.status='review' and ($2='' or r.id::text=$2)", [ctx.tenantId, str(fd, "rowId")]);
  for (const r of rows) {
    if (what === "discard") { await update("import_rows", ctx.tenantId, r.id, { status: "discarded" }); continue; }
    // Merge: same child becomes a re-enquiry touch, a new name becomes a sibling in the matched household.
    const g = await one("select mobile from guardians where household_id=$1 order by is_primary desc limit 1", [r.match_household_id]);
    const res = await captureEnquiry(ctx.tenantId, { studentName: r.data.studentName, guardianName: r.data.guardianName, mobile: g?.mobile ?? r.data.mobile, grade: r.data.grade || undefined, branchId: ctx.branches[0].id, yearId: ctx.yearId, channel: "Data", source: `Import: ${r.file_name}`, asProspect: true }, actorOf(ctx));
    await update("import_rows", ctx.tenantId, r.id, { status: res.ok ? "merged" : "failed", error: res.ok ? null : res.error, enquiry_id: res.ok ? res.enquiryId : null });
  }
  await flash(`${rows.length} row${rows.length === 1 ? "" : "s"} ${what === "discard" ? "discarded" : "merged into existing households"}.`);
  done("/");
}

export async function undoImport(fd: FormData) {
  const ctx = await admin("data");
  const b = await one("select * from import_batches where tenant_id=$1 and id=$2 and status='done'", [ctx.tenantId, str(fd, "id")]);
  if (!b) return;
  const rows = await q("select enquiry_id from import_rows where batch_id=$1 and status='created' and enquiry_id is not null", [b.id]);
  let removed = 0;
  for (const r of rows) {
    const e = await one("select household_id, student_id from enquiries where tenant_id=$1 and id=$2", [ctx.tenantId, r.enquiry_id]);
    if (!e) continue;
    await q("delete from enquiries where id=$1", [r.enquiry_id]);
    await q("delete from students where id=$1 and not exists (select 1 from enquiries where student_id=$1)", [e.student_id]);
    await q("delete from households where id=$1 and not exists (select 1 from enquiries where household_id=$1)", [e.household_id]);
    removed++;
  }
  await update("import_batches", ctx.tenantId, b.id, { status: "undone" });
  await audit(ctx.tenantId, actorOf(ctx), "delete", "enquiry", b.id, `Undid import ${b.file_name}: removed ${removed} records`);
  await flash(`Import undone: ${removed} records it created were removed. Records that already existed were not touched.`);
  done("/");
}

/** Erasure request (CMPL-03): personal data is anonymised; counts and stage history stay for reporting. */
export async function eraseHousehold(fd: FormData) {
  const ctx = await admin("data");
  if (!isFullAdmin(ctx.perms)) throw new Error("Only a group admin can erase personal data.");
  const g = await one("select household_id, name from guardians where tenant_id=$1 and mobile=$2", [ctx.tenantId, normMobile(str(fd, "mobile"))]);
  if (!g) return flash("No household has that mobile number.", "error");
  if (str(fd, "confirm") !== "ERASE") return flash("Type ERASE to confirm. This cannot be undone.", "error");
  const h = g.household_id;
  await q("update guardians set name='Erased', mobile='x' || substr(replace(id::text,'-',''),1,12), alt_mobile=null, email=null, occupation=null, consent='{}'::jsonb where household_id=$1", [h]);
  await q("update students set name='Erased', dob=null, special_needs=null, current_school=null where household_id=$1", [h]);
  await q("update households set address=null, locality=null, pincode=null where id=$1", [h]);
  await q("delete from messages where household_id=$1", [h]);
  await q("update activities set content='[erased on request]', meta='{}'::jsonb where household_id=$1", [h]);
  await q("update applications set answers='{}'::jsonb where enquiry_id in (select id from enquiries where household_id=$1)", [h]);
  await audit(ctx.tenantId, actorOf(ctx), "delete", "household", h, "Erased personal data on a data-subject request");
  await flash("Personal data erased. Anonymous counts remain for reports.");
  done("/");
}

// ----- support access (PS-02) -----

export async function supportAccess(fd: FormData) {
  const ctx = await admin("help");
  const what = str(fd, "what");
  if (what === "approve") {
    const hours = Math.min(72, Number(str(fd, "hours")) || 2);
    await q("update support_access set status='approved', approved_by=$3, expires_at=now() + ($4 || ' hours')::interval where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id"), ctx.user.id, String(hours)]);
    await audit(ctx.tenantId, actorOf(ctx), "permission", "support_access", str(fd, "id"), `Approved AutoED support access for ${hours} hours`);
    await flash(`Support access approved for ${hours} hours. You can revoke it at any time.`);
  } else {
    await q("update support_access set status=$3, expires_at=now() where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id"), what === "deny" ? "denied" : "revoked"]);
    await q("delete from sessions where impersonator_id is not null and user_id in (select id from users where tenant_id=$1)", [ctx.tenantId]);
    await audit(ctx.tenantId, actorOf(ctx), "permission", "support_access", str(fd, "id"), `Support access ${what === "deny" ? "denied" : "revoked"}`);
    await flash(what === "deny" ? "Request denied." : "Access revoked. Any open support session was ended.");
  }
  done();
}
