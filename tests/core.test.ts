// Acceptance criteria from PRD Appendix E, run against the embedded database.
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { insert, one, q } from "@/lib/db";
import { addTask, assignOwner, captureEnquiry, changeStage, completeTask, emit, needsNextAction, receiveMessage, sameStudent, sendMessage, stageByName, normMobile } from "@/lib/core";
import { confirmAdmission, saveApplication, settlePayment, startApplication } from "@/lib/admissions";
import { createTenant } from "@/lib/seed";
import { runDueJobs, testRun } from "@/lib/workflows";
import { parseCsv } from "@/lib/util";

let t: string, branchId: string, roles: Record<string, string>, users: string[] = [];
let n = 0;
const mobile = () => "98" + String(10000000 + ++n).padStart(8, "0");
const lead = (over: Record<string, any> = {}) => captureEnquiry(t, { studentName: "Asha Verma", guardianName: "Ritu Verma", mobile: mobile(), branchId, grade: "Grade 1", channel: "Website", source: "Test", ...over });

beforeAll(async () => {
  const made = await createTenant({ name: "Test School", subdomain: "test-" + Date.now(), adminName: "Admin", adminEmail: `admin${Date.now()}@test.demo` });
  t = made.tenant.id; branchId = made.branch.id; roles = made.roles;
  const hash = await bcrypt.hash("x", 4);
  for (const [name, leave] of [["Counsellor A", false], ["Counsellor B", false], ["Counsellor C", true]] as const)
    users.push((await insert("users", { tenant_id: t, email: `${name.replace(" ", "").toLowerCase()}${Date.now()}@test.demo`, name, password_hash: hash, role_id: roles["Counsellor"], branch_ids: [branchId], on_leave: leave })).id);
  await q("delete from assignment_rules where tenant_id=$1", [t]);
  await insert("assignment_rules", { tenant_id: t, name: "Round robin", position: 1, conditions: {}, method: "round_robin", user_ids: users });
});

describe("capture and duplicates", () => {
  it("normalises Indian mobiles and matches similar student names", () => {
    expect(normMobile("+91 98765-43210")).toBe("9876543210");
    expect(sameStudent({ name: "Aarav Reddy" }, { name: "aarav  reddy" })).toBe(true);
    expect(sameStudent({ name: "Aarav Reddy" }, { name: "Aarav Redy" })).toBe(true);
    expect(sameStudent({ name: "Aarav Reddy" }, { name: "Diya Reddy" })).toBe(false);
    expect(sameStudent({ name: "Aarav Reddy", dob: "2020-01-01" }, { name: "Aarav Reddy", dob: "2021-01-01" })).toBe(false);
  });

  it("DUP-01 / DM-01: an existing mobile adds a re-enquiry touch, never a second household", async () => {
    const m = mobile();
    const a = await captureEnquiry(t, { studentName: "Kabir Rao", guardianName: "Sunil Rao", mobile: m, branchId, grade: "UKG", channel: "Website", source: "Form" });
    const b = await captureEnquiry(t, { studentName: "Kabir Rao", guardianName: "S Rao", mobile: "+91" + m, branchId, grade: "UKG", channel: "Walk-in", source: "Front desk walk-in" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.status).toBe("re_enquiry");
    expect(b.householdId).toBe(a.householdId);
    expect(b.enquiryId).toBe(a.enquiryId);
    expect((await one("select count(*)::int n from guardians where tenant_id=$1 and mobile=$2", [t, m]))!.n).toBe(1);
    expect((await one("select count(*)::int n from source_touches where enquiry_id=$1", [a.enquiryId]))!.n).toBe(2);
    expect((await one("select reenquired from enquiries where id=$1", [a.enquiryId]))!.reenquired).toBe(true);
  });

  it("DM-02: a new child on a known mobile becomes a sibling with the family's counsellor", async () => {
    const m = mobile();
    const a = await captureEnquiry(t, { studentName: "Ira Shah", guardianName: "Neha Shah", mobile: m, branchId, grade: "Grade 2" });
    const b = await captureEnquiry(t, { studentName: "Vivaan Shah", guardianName: "Neha Shah", mobile: m, branchId, grade: "Nursery" });
    if (!a.ok || !b.ok) throw new Error("capture failed");
    expect(b.status).toBe("sibling_added");
    expect(b.householdId).toBe(a.householdId);
    expect(b.enquiryId).not.toBe(a.enquiryId);
    expect(b.ownerId).toBe(a.ownerId);
  });

  it("rejects an invalid mobile in plain language", async () => {
    const r = await lead({ mobile: "12345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/valid 10-digit/);
  });

  it("keeps tenants isolated: the same mobile in another school is a different family", async () => {
    const other = await createTenant({ name: "Other School", subdomain: "other-" + Date.now(), adminName: "A", adminEmail: `o${Date.now()}@test.demo` });
    const m = mobile();
    const a = await lead({ mobile: m });
    const b = await captureEnquiry(other.tenant.id, { studentName: "Asha Verma", guardianName: "Ritu Verma", mobile: m, branchId: other.branch.id });
    if (!a.ok || !b.ok) throw new Error("capture failed");
    expect(b.status).toBe("created");
    expect(b.householdId).not.toBe(a.householdId);
  });
});

describe("assignment", () => {
  it("ASG-03: round robin over three with one on leave gives ten leads as five and five", async () => {
    const before = await q("select owner_id, count(*)::int n from enquiries where tenant_id=$1 group by owner_id", [t]);
    const base = (id: string) => before.find((r) => r.owner_id === id)?.n ?? 0;
    for (let i = 0; i < 10; i++) await lead({ studentName: "Student " + i });
    const after = await q("select owner_id, count(*)::int n from enquiries where tenant_id=$1 group by owner_id", [t]);
    const got = (id: string) => (after.find((r) => r.owner_id === id)?.n ?? 0) - base(id);
    expect(got(users[0])).toBe(5);
    expect(got(users[1])).toBe(5);
    expect(got(users[2])).toBe(0);
  });

  it("ASG-06: the simulator explains the decision without assigning", async () => {
    const p = (await one("select pointer from assignment_rules where tenant_id=$1", [t]))!.pointer;
    const r = await assignOwner(t, { branchId }, true);
    expect(r.reason).toMatch(/Round robin/);
    expect((await one("select pointer from assignment_rules where tenant_id=$1", [t]))!.pointer).toBe(p);
  });

  it("respects daily capacity", async () => {
    await q("update users set daily_capacity=0 where id=$1", [users[0]]);
    const r = await lead({ studentName: "Capacity Check" });
    await q("update users set daily_capacity=25 where id=$1", [users[0]]);
    if (!r.ok) throw new Error("capture failed");
    expect(r.ownerId).toBe(users[1]);
  });
});

describe("next action and stages", () => {
  it("DM-03 / TSK-03: a new enquiry has one owner, one stage and a next action", async () => {
    const r = await lead({ studentName: "Next Action" });
    if (!r.ok) throw new Error("capture failed");
    expect(await needsNextAction(t, r.enquiryId)).toBe(false);
    const tasks = await q("select id from tasks where enquiry_id=$1 and status='open'", [r.enquiryId]);
    expect(tasks.length).toBeGreaterThan(0);
    let res = { needsNext: false };
    for (const k of tasks) res = await completeTask(t, k.id, null, "Spoke to parent");
    expect(res.needsNext).toBe(true);
    await addTask(t, { enquiryId: r.enquiryId, title: "Follow-up", dueAt: new Date(Date.now() + 3600e3) });
    expect(await needsNextAction(t, r.enquiryId)).toBe(false);
  });

  it("L360-05: closing asks for a reason, then cancels open tasks and needs no next action", async () => {
    const r = await lead({ studentName: "Closing Case" });
    if (!r.ok) throw new Error("capture failed");
    const closed = (await stageByName(t, "Not interested"))!;
    const miss = await changeStage(t, r.enquiryId, closed.id, null);
    expect(miss.ok).toBe(false);
    expect(miss.missing).toEqual(["closure_reason"]);
    expect((await changeStage(t, r.enquiryId, closed.id, null, { closure_reason: "Fee too high" })).ok).toBe(true);
    expect((await one("select count(*)::int n from tasks where enquiry_id=$1 and status='open'", [r.enquiryId]))!.n).toBe(0);
    expect(await needsNextAction(t, r.enquiryId)).toBe(false);
    expect((await one("select count(*)::int n from activities where enquiry_id=$1 and type='stage_change'", [r.enquiryId]))!.n).toBe(1);
  });

  it("DUP-02: a re-enquiry re-opens a closed enquiry", async () => {
    const m = mobile();
    const a = await lead({ mobile: m, studentName: "Reopen Me" });
    if (!a.ok) throw new Error("capture failed");
    await changeStage(t, a.enquiryId, (await stageByName(t, "Not interested"))!.id, null, { closure_reason: "Undecided" });
    await lead({ mobile: m, studentName: "Reopen Me" });
    const e = await one("select s.name, s.is_closed from enquiries e join stages s on s.id=e.stage_id where e.id=$1", [a.enquiryId]);
    expect(e!.is_closed).toBe(false);
    expect(await needsNextAction(t, a.enquiryId)).toBe(false);
  });
});

describe("messaging", () => {
  it("L360-03: an undeliverable WhatsApp message is explained in plain words with a next step", async () => {
    const r = await lead({ mobile: "9812345600", studentName: "No WhatsApp" });
    if (!r.ok) throw new Error("capture failed");
    const res = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "whatsapp", body: "Hello" });
    expect(res.status).toBe("failed");
    expect(res.reason).toBe("This number cannot receive WhatsApp messages. Try SMS or call.");
    const a = await one("select content from activities where enquiry_id=$1 and type='whatsapp' and meta->>'status'='failed' order by created_at desc limit 1", [r.enquiryId]);
    expect(a!.content).toMatch(/^Not delivered: This number cannot receive WhatsApp/);
  });

  it("CMPL-07: STOP opts the parent out and later sends are blocked; the wallet is only charged for delivered messages", async () => {
    const r = await lead({ studentName: "Opt Out" });
    if (!r.ok) throw new Error("capture failed");
    const bal = async () => Number((await one("select wallet_balance from tenants where id=$1", [t]))!.wallet_balance);
    const b0 = await bal();
    expect((await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "whatsapp", body: "Hi" })).status).toBe("delivered");
    expect(await bal()).toBeCloseTo(b0 - 0.8, 2);
    await receiveMessage(t, r.householdId, "whatsapp", "STOP");
    const res = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "whatsapp", body: "Hi again" });
    expect(res.status).toBe("failed");
    expect(res.reason).toMatch(/opted out/);
    expect(await bal()).toBeCloseTo(b0 - 0.8, 2);
  });
});

describe("workflows", () => {
  it("AUT-05: when the parent replies, pending steps are cancelled and the run log says why", async () => {
    const r = await lead({ studentName: "Workflow Case" });
    if (!r.ok) throw new Error("capture failed");
    await emit(t, "missed_call", r.enquiryId);
    const run = await one("select r.* from workflow_runs r join workflows w on w.id=r.workflow_id where r.enquiry_id=$1 and w.recipe_key='missed_call'", [r.enquiryId]);
    expect(run!.status).toBe("running");
    await receiveMessage(t, r.householdId, "whatsapp", "Please call me at 5");
    await q("update jobs set run_at=now() - interval '1 minute' where tenant_id=$1 and status='queued' and payload->>'runId'=$2", [t, run!.id]);
    await runDueJobs(t);
    const after = await one("select status, log from workflow_runs where id=$1", [run!.id]);
    expect(after!.status).toBe("cancelled");
    expect(JSON.stringify(after!.log)).toMatch(/the parent replied/);
    expect((await one("select count(*)::int n from notifications where tenant_id=$1 and title like 'Missed call not returned%'", [t]))!.n).toBe(0);
  });

  it("does not start the same workflow twice for one record, and test runs change nothing", async () => {
    const r = await lead({ studentName: "Twice" });
    if (!r.ok) throw new Error("capture failed");
    await emit(t, "missed_call", r.enquiryId);
    await emit(t, "missed_call", r.enquiryId);
    expect((await one("select count(*)::int n from workflow_runs r join workflows w on w.id=r.workflow_id where r.enquiry_id=$1 and w.recipe_key='missed_call'", [r.enquiryId]))!.n).toBe(1);
    const wf = await one("select id from workflows where tenant_id=$1 and recipe_key='instant_welcome'", [t]);
    const msgs = (await one("select count(*)::int n from messages where tenant_id=$1", [t]))!.n;
    const test = await testRun(t, wf!.id, r.enquiryId);
    expect(test.status).toBe("tested");
    expect(JSON.stringify(test.log)).toMatch(/Would send/);
    expect((await one("select count(*)::int n from messages where tenant_id=$1", [t]))!.n).toBe(msgs);
  });
});

describe("admission", () => {
  it("ENR-01: confirm admission only when form, documents and fee are complete", async () => {
    const r = await lead({ studentName: "Admit Me", dob: "2015-01-01" });
    if (!r.ok) throw new Error("capture failed");
    await startApplication(t, r.enquiryId, null);
    expect((await one("select application_no from enquiries where id=$1", [r.enquiryId]))!.application_no).toMatch(/^APP-\d\d-\d{4}$/);
    const early = await saveApplication(t, r.enquiryId, { father_name: "A" }, { submit: true, declaration: true }, null);
    expect(early.ok).toBe(false);
    const full = { mother_tongue: "Hindi", medical: "None", father_name: "A", mother_name: "B", address: "1 Road", pincode: "500001", transport: "No" };
    expect((await saveApplication(t, r.enquiryId, full, { submit: true, declaration: true }, null)).ok).toBe(true);
    const not = await confirmAdmission(t, r.enquiryId, null);
    expect(not.ok).toBe(false);
    expect(not.error).toMatch(/Documents verified/);
    await q("update documents set status='verified' where enquiry_id=$1", [r.enquiryId]);
    const reg = await one("select id from payments where enquiry_id=$1 and purpose='Registration fee'", [r.enquiryId]);
    const paid = await settlePayment(t, reg!.id, true, null);
    expect(paid!.receipt_no).toMatch(/^RCPT-\d{5}$/);
    const fee = await insert("payments", { tenant_id: t, enquiry_id: r.enquiryId, purpose: "Admission fee", amount: 25000 });
    await settlePayment(t, fee.id, true, null);
    expect((await confirmAdmission(t, r.enquiryId, null)).ok).toBe(true);
    const e = await one("select s.is_won from enquiries e join stages s on s.id=e.stage_id where e.id=$1", [r.enquiryId]);
    expect(e!.is_won).toBe(true);
  });
});

describe("csv", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv('Student name,Mobile\r\n"Rao, Aarav",9876543210\n"He said ""hi""",1')).toEqual([["Student name", "Mobile"], ["Rao, Aarav", "9876543210"], ['He said "hi"', "1"]]);
  });
});

describe("message safeguards and team scope", () => {
  it("MSG-05: automated messages wait for quiet hours to end, and are capped per family per day", async () => {
    const { hourIST } = await import("@/lib/core");
    const h = hourIST();
    const r = await lead({ studentName: "Quiet Hours" });
    if (!r.ok) throw new Error("capture failed");
    await q("update tenants set settings = settings || $2::jsonb where id=$1", [t, { quiet_hours: { from: h, to: (h + 1) % 24 } }]);
    const held = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "sms", body: "Automated hello" });
    expect(held.status).toBe("queued");
    expect((await one("select count(*)::int n from jobs where tenant_id=$1 and kind='send_message' and payload->>'householdId'=$2", [t, r.householdId]))!.n).toBe(1);
    const manual = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "sms", body: "Hello from staff", actorId: users[0] });
    expect(manual.status).toBe("delivered");
    await q("update tenants set settings = settings || $2::jsonb where id=$1", [t, { quiet_hours: { from: (h + 2) % 24, to: (h + 3) % 24 }, max_auto_per_day: 1 }]);
    const r2 = await lead({ studentName: "Cap Check" });
    if (!r2.ok) throw new Error("capture failed");
    await q("delete from messages where household_id=$1", [r2.householdId]);
    expect((await sendMessage(t, { householdId: r2.householdId, enquiryId: r2.enquiryId, channel: "sms", body: "one" })).status).toBe("delivered");
    const second = await sendMessage(t, { householdId: r2.householdId, enquiryId: r2.enquiryId, channel: "sms", body: "two" });
    expect(second.status).toBe("failed");
    expect(second.reason).toMatch(/already got 1 automated/);
    await q("update tenants set settings = settings || $2::jsonb where id=$1", [t, { max_auto_per_day: 4 }]);
  });

  it("RB-02: someone limited to their own records also sees their team's", async () => {
    const { scopeSql } = await import("@/lib/auth");
    const lead1 = await one("select id from users where tenant_id=$1 and id=$2", [t, users[1]]);
    await q("update users set reports_to=$2 where id=$1", [users[1], users[0]]);
    const ctx: any = { tenantId: t, perms: { leads: "O" }, user: { id: users[0] }, branchIds: [], branchId: null };
    const params: any[] = [];
    const where = scopeSql(ctx, params);
    const seen = await q(`select distinct e.owner_id from enquiries e where ${where}`, params);
    expect(seen.map((x) => x.owner_id).sort()).toEqual([users[0], lead1!.id].sort());
    await q("update users set reports_to=null where id=$1", [users[1]]);
  });
});

describe("workflow conditions", () => {
  it("can test standard and custom fields", async () => {
    const { conditionsPass } = await import("@/lib/workflows");
    const e = { grade: "Grade 1", custom: { transport_required: "Yes" } };
    expect(conditionsPass([{ field: "custom.transport_required", op: "in", value: ["Yes"] }], e)).toBe(true);
    expect(conditionsPass([{ field: "custom.transport_required", op: "ne", value: "Yes" }], e)).toBe(false);
    expect(conditionsPass([{ field: "grade", op: "in", value: ["Grade 2", "Grade 3"] }], e)).toBe(false);
  });
});
