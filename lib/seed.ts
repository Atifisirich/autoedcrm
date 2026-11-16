// Tenant provisioning (PT-01) and the demo school group used for trials, tours and tests.
import bcrypt from "bcryptjs";
import { insert, one, q, type Row } from "./db";
import { DEFAULT_ROLES } from "./perm";
import { DEFAULT_SCORING, scoreBreakdown, temperatureFor } from "./core";
import { RECIPES } from "./workflows";

export const DEMO_PASSWORD = "demo1234";

const ALL_GRADES = ["Playgroup", "Nursery", "LKG", "UKG", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
export const PACKS: Record<string, { label: string; boards: string[]; grades: string[] }> = {
  cbse_day: { label: "CBSE day school", boards: ["CBSE"], grades: ALL_GRADES.slice(1, 14) },
  cambridge: { label: "Cambridge / international", boards: ["Cambridge", "IB"], grades: ALL_GRADES.slice(1, 14) },
  preschool: { label: "Pre-school chain", boards: ["Play-based"], grades: ALL_GRADES.slice(0, 4) },
  residential: { label: "Residential school", boards: ["CBSE"], grades: ALL_GRADES.slice(8) },
};

const PIPELINE: [string, string, [string, string, number, Partial<Row>?][]][] = [
  ["prospect", "Prospect", [["New data", "slate", 2, { exempt_next_action: true }], ["Verified", "slate", 4, { exempt_next_action: true }], ["Nurturing", "slate", 6, { exempt_next_action: true }]]],
  ["enquiry", "Enquiry", [["New", "sky", 8, { sla_hours: 1 }], ["Contact attempted", "sky", 10, { sla_hours: 48 }], ["Connected", "sky", 15, { sla_hours: 72 }], ["Interested", "sky", 25, { sla_hours: 120 }]]],
  ["visit", "Visit", [["Visit scheduled", "violet", 35, { required_fields: ["visit"] }], ["Visit done", "violet", 45], ["No-show", "violet", 15]]],
  ["application", "Application", [["Form started", "amber", 50], ["Form submitted", "amber", 60], ["Fee paid", "amber", 70], ["Documents pending", "amber", 70], ["Documents verified", "amber", 75]]],
  ["evaluation", "Evaluation", [["Interaction scheduled", "orange", 78], ["Interaction completed", "orange", 82], ["Decision pending", "orange", 85]]],
  ["offer", "Offer", [["Offer made", "teal", 88], ["Offer accepted", "teal", 95], ["Waitlisted", "teal", 40]]],
  ["enrolled", "Enrolled", [["Admission confirmed", "green", 100, { is_won: true, exempt_next_action: true }], ["Sent to ERP", "green", 100, { is_won: true, exempt_next_action: true }]]],
  ["closed", "Closed", ["Not interested", "Joined another school", "Not eligible", "Junk / duplicate", "Cancelled / refunded"].map((n) => [n, "rose", 0, { is_closed: true, exempt_next_action: true, required_fields: ["closure_reason"] }] as [string, string, number, Partial<Row>])],
];

const SOURCES: [string, string, number][] = [
  ["Meta ads", "Facebook lead form", 85000], ["Meta ads", "Instagram lead form", 42000], ["Google", "Google Ads search", 96000], ["Google", "Google Business Profile", 0],
  ["Website", "Website enquiry form", 0], ["WhatsApp", "School WhatsApp number", 0], ["Walk-in", "Front desk walk-in", 0], ["Phone", "Inbound call", 0],
  ["Referral", "Parent referral", 15000], ["Events", "Open house", 60000], ["Events", "Society activation", 35000], ["Offline", "Newspaper ad", 50000], ["Data", "Pre-school tie-up list", 20000],
];

const TEMPLATES: [string, string, string, string][] = [
  ["whatsapp", "Welcome", "utility", "Hello {{guardian_name}}, thank you for your interest in {{school}}, {{branch}} for {{student_name}}. {{counsellor}} from our admissions team will call you shortly. Reply here any time with questions."],
  ["sms", "Welcome", "utility", "Thank you for enquiring at {{school}} {{branch}}. {{counsellor}} will call you shortly."],
  ["whatsapp", "Out of hours", "utility", "Hello {{guardian_name}}, we have received your enquiry for {{student_name}}. Our admissions office is closed right now; {{counsellor}} will call you when we open."],
  ["whatsapp", "Missed call", "utility", "Hello {{guardian_name}}, sorry we missed your call to {{school}}. {{counsellor}} will call you back within a few minutes."],
  ["whatsapp", "Tried calling", "utility", "Hello {{guardian_name}}, {{counsellor}} from {{school}} tried to reach you about admission for {{student_name}}. What is a good time to call?"],
  ["whatsapp", "Visit confirmation", "utility", "Your campus visit at {{school}}, {{branch}} is confirmed. {{counsellor}} will meet you at the front office. Reply here if you need to reschedule."],
  ["whatsapp", "Missed visit", "utility", "Hello {{guardian_name}}, sorry we missed you at the campus today. Reply with a day that suits you and we will rebook your visit."],
  ["whatsapp", "After your visit", "marketing", "Hello {{guardian_name}}, it was lovely meeting you. Here is a short guide on what a day in {{grade}} looks like at {{school}}."],
  ["whatsapp", "Parent stories", "marketing", "Hello {{guardian_name}}, hear from parents of {{grade}} students about their first year at {{school}}."],
  ["whatsapp", "Finish your application", "utility", "Hello {{guardian_name}}, the application for {{student_name}} is saved. Continue here: {{apply_link}} — or reply and {{counsellor}} will fill it with you."],
  ["whatsapp", "Payment retry", "utility", "Hello {{guardian_name}}, the payment for {{student_name}}'s application did not go through. No money was taken. Please try again from the link we sent."],
  ["whatsapp", "Documents pending", "utility", "Hello {{guardian_name}}, a few documents are still pending for {{student_name}}'s application. {{counsellor}} will share the list."],
  ["whatsapp", "Sibling welcome", "utility", "Hello {{guardian_name}}, wonderful to see {{student_name}} joining the {{school}} family too. A sibling concession applies to this admission."],
  ["whatsapp", "Admission welcome", "utility", "Welcome to {{school}}! {{student_name}}'s admission to {{grade}} is confirmed. We will share the onboarding form and orientation date soon."],
  ["whatsapp", "Checking in", "marketing", "Hello {{guardian_name}}, admissions for {{grade}} at {{school}} are still open. Would you like {{counsellor}} to call you?"],
  ["whatsapp", "Fee structure", "utility", "Hello {{guardian_name}}, here is the fee structure for {{grade}} at {{school}}, {{branch}}. {{counsellor}} can walk you through it."],
  ["whatsapp", "Payment link", "utility", "Hello {{guardian_name}}, here is the secure link to pay the {{purpose}} of {{amount}} for {{student_name}}: {{pay_link}}"],
  ["whatsapp", "Application link", "utility", "Hello {{guardian_name}}, you can fill the application for {{student_name}} here: {{apply_link}}"],
  ["sms", "Visit reminder", "utility", "Reminder: your campus visit at {{school}} {{branch}} is tomorrow. See you there."],
  ["email", "Welcome", "utility", "Dear {{guardian_name}},\n\nThank you for your interest in {{school}}, {{branch}} for {{student_name}}. {{counsellor}} from our admissions team will be in touch.\n\nWarm regards,\nAdmissions Office"],
  ["whatsapp", "Open house invite", "marketing", "Hello {{guardian_name}}, you are invited to our Open House at {{school}}, {{branch}} this Saturday. Meet the teachers and tour the campus."],
];

export const defaultSettings = (pack: string) => ({
  closure_reasons: ["Fee too high", "Distance / transport", "Joined another school", "Undecided", "Not eligible by age", "No seat available", "No response", "Other"],
  scoring: DEFAULT_SCORING, hot_at: 60, warm_at: 30, first_response_mins: 30, reopen_on_reenquiry: true,
  grades: PACKS[pack].grades, boards: PACKS[pack].boards,
  doc_types: ["Birth certificate", "Previous report card", "Transfer certificate", "Address proof", "Photographs"],
  fees: { registration: 1500, admission: 25000 },
  modules: { visits: true, applications: true, payments: true, campaigns: true, workflows: true },
  app_no_prefix: "APP", receipt_prefix: "RCPT", next_app_no: 1, next_receipt_no: 1,
  call_recording: false, quiet_hours: { from: 21, to: 8 },
});

export type NewTenant = { name: string; subdomain: string; plan?: string; pack?: string; region?: string; status?: string; adminName: string; adminEmail: string; adminPassword?: string; branchName?: string; city?: string; wallet?: number };

/** Creates an organisation with its starter configuration pack and first admin. */
export async function createTenant(o: NewTenant): Promise<{ tenant: Row; admin: Row; branch: Row; year: Row; roles: Record<string, string> }> {
  const pack = o.pack && PACKS[o.pack] ? o.pack : "cbse_day";
  const tenant = await insert("tenants", {
    name: o.name, subdomain: o.subdomain, plan: o.plan ?? "growth", pack, region: o.region ?? "in-south", status: o.status ?? "trial", settings: defaultSettings(pack),
    branding: { color: "#0f6e6e" }, wallet_balance: o.wallet ?? 500,
    onboarding: { branches: true, users: false, whatsapp: false, dlt: false, telephony: false, forms: true, migration: false, training: false },
    flags: { ai_summary: false, parent_portal: false, voice_agent: false },
  });
  const t = tenant.id;
  await insert("wallet_ledger", { tenant_id: t, type: "credit", category: "recharge", amount: o.wallet ?? 500, note: "Starting credits included in plan" });
  const roles: Record<string, string> = {};
  for (const [name, permissions] of DEFAULT_ROLES) roles[name] = (await insert("roles", { tenant_id: t, name, permissions, is_system: true })).id;
  for (let i = 0; i < PIPELINE.length; i++) {
    const [key, name, stages] = PIPELINE[i];
    const ph = await insert("phases", { tenant_id: t, key, name, position: i });
    for (let j = 0; j < stages.length; j++) {
      const [sn, color, probability, extra] = stages[j];
      await insert("stages", { tenant_id: t, phase_id: ph.id, name: sn, position: j, color, probability, ...(extra ?? {}) });
    }
  }
  for (const [channel, name] of SOURCES) await insert("sources", { tenant_id: t, channel, name });
  for (const [channel, name, category, body] of TEMPLATES) await insert("templates", { tenant_id: t, channel, name, category, body });
  for (const r of RECIPES) await insert("workflows", { tenant_id: t, recipe_key: r.key, name: r.name, description: r.description, trigger: r.trigger, conditions: r.conditions ?? [], steps: r.steps, status: "published" });
  const branch = await insert("branches", { tenant_id: t, name: o.branchName ?? "Main campus", city: o.city ?? null, boards: PACKS[pack].boards });
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const year = await insert("academic_years", { tenant_id: t, name: `${start}-${String(start + 1).slice(2)}`, status: "open", is_default: true, position: 1 });
  await seedProgrammes(t, branch.id, year.id, pack, start);
  const admin = await insert("users", { tenant_id: t, email: o.adminEmail.toLowerCase(), name: o.adminName, password_hash: await bcrypt.hash(o.adminPassword ?? DEMO_PASSWORD, 8), role_id: roles["Group Admin"] });
  const web = await one("select id from sources where tenant_id=$1 and name='Website enquiry form'", [t]);
  await insert("forms", { tenant_id: t, slug: `${o.subdomain}-enquiry`, name: "Website enquiry form", source_id: web!.id, fields: ["student_name", "guardian_name", "mobile", "email", "grade", "branch", "heard_about"] });
  await insert("assignment_rules", { tenant_id: t, name: "Everyone, round robin", position: 99, conditions: {}, method: "round_robin", user_ids: [] });
  return { tenant, admin, branch, year, roles };
}

export async function seedProgrammes(tenantId: string, branchId: string, yearId: string, pack: string, startYear: number) {
  const { boards, grades } = PACKS[pack];
  for (let i = 0; i < grades.length; i++) {
    const order = ALL_GRADES.indexOf(grades[i]);
    await insert("programmes", { tenant_id: tenantId, branch_id: branchId, year_id: yearId, board: boards[0], grade: grades[i], grade_order: order, capacity: order < 4 ? 40 : 30, min_age_years: order + 2, age_cutoff: `${startYear}-06-01` });
  }
}

// ---------- demo data ----------

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FIRST = ["Aarav", "Vihaan", "Aditya", "Ishaan", "Reyansh", "Arjun", "Kabir", "Rohan", "Dhruv", "Krish", "Ananya", "Diya", "Aadhya", "Saanvi", "Myra", "Ira", "Kiara", "Anika", "Navya", "Riya", "Zoya", "Ayaan", "Meher", "Tara", "Nikhil", "Advik", "Samaira", "Pari", "Vivaan", "Aryan"];
const PARENT = ["Rajesh", "Suresh", "Lakshmi", "Priya", "Imran", "Fatima", "Deepak", "Sunita", "Vikram", "Neha", "Karthik", "Divya", "Manoj", "Pooja", "Sanjay", "Rekha", "Arun", "Swati", "Farhan", "Geeta", "Harish", "Nisha", "Joseph", "Anjali", "Ramesh", "Shalini"];
const LAST = ["Reddy", "Sharma", "Iyer", "Khan", "Patel", "Nair", "Rao", "Gupta", "Menon", "Verma", "Naidu", "Fernandes", "Chowdary", "Mehta", "Pillai", "Joshi", "Shaikh", "Bhat", "Kulkarni", "Das"];
const LOCALITIES = ["Kondapur", "Gachibowli", "Madhapur", "Miyapur", "Kukatpally", "Whitefield", "Marathahalli", "Varthur", "Brookefield", "Hoodi"];

/** Platform staff, the Greenfield demo group with a season of data, and a second small tenant. */
export async function seedDemo() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 8);
  await insert("users", { email: "ops@autoed.demo", name: "Asha (AutoED ops)", password_hash: hash, platform_role: "super_admin" });
  await insert("users", { email: "support@autoed.demo", name: "Dev (AutoED support)", password_hash: hash, platform_role: "support" });

  const { tenant, admin, branch: b1, year: cur, roles } = await createTenant({ name: "Greenfield Schools", subdomain: "greenfield", plan: "group", status: "active", adminName: "Anita Rao", adminEmail: "anita@greenfield.demo", branchName: "Kondapur campus", city: "Hyderabad", wallet: 4200 });
  const t = tenant.id as string;
  await q("update tenants set go_live_date=now()::date - 40, onboarding=$2 where id=$1", [t, { branches: true, users: true, whatsapp: true, dlt: true, telephony: false, forms: true, migration: true, training: false }]);
  await q("update branches set address='Botanical Garden Road, Kondapur', phone='04040001234' where id=$1", [b1.id]);
  const b2 = await insert("branches", { tenant_id: t, name: "Whitefield campus", city: "Bengaluru", address: "ITPL Main Road, Whitefield", phone: "08040005678", boards: ["CBSE"] });
  const startYear = Number(cur.name.slice(0, 4));
  const prev = await insert("academic_years", { tenant_id: t, name: `${startYear - 1}-${String(startYear).slice(2)}`, status: "closed", position: 0 });
  await seedProgrammes(t, b2.id, cur.id, "cbse_day", startYear);
  for (const b of [b1, b2]) await seedProgrammes(t, b.id, prev.id, "cbse_day", startYear - 1);

  const mk = (name: string, email: string, role: string, branches: Row[], extra: Row = {}) =>
    insert("users", { tenant_id: t, email: `${email}@greenfield.demo`, name, password_hash: hash, role_id: roles[role], branch_ids: branches.map((b) => b.id), last_login: new Date(Date.now() - 3600e3 * (1 + (name.length % 30))), ...extra });
  const ravi = await mk("Ravi Kumar", "ravi", "Branch Admin", [b1]);
  const meera = await mk("Meera Nair", "meera", "Admission Head", [b1]);
  const priya = await mk("Priya Sharma", "priya", "Counsellor", [b1], { reports_to: meera.id });
  const arjun = await mk("Arjun Mehta", "arjun", "Counsellor", [b1], { reports_to: meera.id });
  const sana = await mk("Sana Sheikh", "sana", "Admission Head", [b2]);
  const kavya = await mk("Kavya Iyer", "kavya", "Counsellor", [b2], { reports_to: sana.id });
  const rahul = await mk("Rahul Das", "rahul", "Counsellor", [b2], { reports_to: sana.id, on_leave: true });
  await mk("Farah Ali", "farah", "Front Office", [b1]);
  await mk("Dr. S. Rao", "principal", "Principal", [b1]);
  await mk("Nikhil Jain", "nikhil", "Marketing", []);
  await mk("Sunita Pillai", "sunita", "Accounts", []);
  await mk("Vikram Shah", "vikram", "Read-only Management", []);
  await q("delete from assignment_rules where tenant_id=$1", [t]);
  await insert("assignment_rules", { tenant_id: t, name: "Kondapur counsellors", position: 1, conditions: { branch_id: b1.id }, method: "round_robin", user_ids: [priya.id, arjun.id] });
  await insert("assignment_rules", { tenant_id: t, name: "Whitefield counsellors", position: 2, conditions: { branch_id: b2.id }, method: "least_load", user_ids: [kavya.id, rahul.id] });
  await insert("custom_fields", { tenant_id: t, key: "transport_required", label: "Transport required", type: "select", options: ["Yes", "No", "Not sure"], position: 1 });
  await insert("custom_fields", { tenant_id: t, key: "second_language", label: "Preferred second language", type: "select", options: ["Hindi", "Telugu", "Kannada", "French"], position: 2 });
  await insert("custom_fields", { tenant_id: t, key: "family_income", label: "Annual family income band", type: "text", sensitive: true, position: 3 });

  const stages = await q("select s.*, p.key as phase_key, p.position as ppos from stages s join phases p on p.id=s.phase_id where s.tenant_id=$1", [t]);
  const S = (n: string) => stages.find((s) => s.name === n)!;
  const sources = await q("select * from sources where tenant_id=$1", [t]);
  const r = rng(20261114);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const ago = (days: number) => new Date(Date.now() - days * 86400e3);
  const grades = PACKS.cbse_day.grades.slice(0, 9);
  let seq = 0, appNo = 1, rcpt = 1;

  const plan: [string, number][] = [
    ["New data", 12], ["Verified", 6], ["Nurturing", 6], ["New", 9], ["Contact attempted", 12], ["Connected", 14], ["Interested", 16], ["Visit scheduled", 10], ["Visit done", 10], ["No-show", 4],
    ["Form started", 8], ["Form submitted", 6], ["Fee paid", 5], ["Documents pending", 4], ["Interaction scheduled", 3], ["Decision pending", 2], ["Offer made", 3], ["Offer accepted", 2],
    ["Admission confirmed", 10], ["Not interested", 4], ["Joined another school", 3], ["Junk / duplicate", 1],
  ];
  const oldPlan: [string, number][] = [["Admission confirmed", 22], ["Not interested", 10], ["Joined another school", 8], ["Not eligible", 3]];

  async function makeEnquiry(stageName: string, year: Row, opts: { household?: Row; branch?: Row; daysBack: number }) {
    seq++;
    const st = S(stageName);
    const rank = st.ppos as number; // 0 prospect .. 6 enrolled, 7 closed
    const branch = opts.branch ?? (r() < 0.62 ? b1 : b2);
    const owner = branch.id === b1.id ? (seq % 2 ? priya : arjun) : kavya;
    const last = pick(LAST);
    const created = ago(opts.daysBack);
    let hh = opts.household;
    if (!hh) {
      hh = await insert("households", { tenant_id: t, locality: pick(LOCALITIES), address: `${10 + Math.floor(r() * 300)}, ${pick(["Lake View Residency", "Palm Meadows", "Green Park Colony", "Sunrise Towers"])}`, pincode: String(500000 + Math.floor(r() * 99)), home_language: pick(["Telugu", "Hindi", "English", "Kannada", "Urdu"]), heard_about: pick(["Friend or relative", "Online search", "Social media", "Hoarding", "Newspaper"]), sibling_in_school: r() < 0.08, created_at: created });
      const mobile = seq === 7 || seq === 31 ? `98${String(10000000 + seq * 7919).slice(0, 6)}00` : `9${String(100000000 + Math.floor(r() * 899999999))}`;
      const pn = pick(PARENT);
      await insert("guardians", { tenant_id: t, household_id: hh.id, name: `${pn} ${last}`, relation: pick(["Father", "Mother"]), mobile, email: r() < 0.7 ? `${pn.toLowerCase()}.${last.toLowerCase()}${seq}@example.com` : null, occupation: pick(["Software engineer", "Doctor", "Business owner", "Bank manager", "Teacher", "Government officer"]), consent: { whatsapp: true, sms: true, email: true, call: true, source: "Web form", wording: "v1", at: created.toISOString() } });
      hh.last = last;
    }
    const grade = pick(grades);
    const gi = ALL_GRADES.indexOf(grade);
    const student = await insert("students", { tenant_id: t, household_id: hh.id, name: `${pick(FIRST)} ${hh.last ?? last}`, dob: `${startYear - gi - 2}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`, gender: pick(["Girl", "Boy"]), current_school: gi > 2 ? pick(["Little Stars School", "Oakwood Public School", "St. Mary's", "Sunshine Montessori"]) : null });
    const closed = rank === 7;
    const reached = closed ? 1 + Math.floor(r() * 2) : rank;
    const src = pick(sources);
    const e = await insert("enquiries", {
      tenant_id: t, household_id: hh.id, student_id: student.id, branch_id: branch.id, year_id: year.id, board: "CBSE", grade, stage_id: st.id, owner_id: owner.id,
      closure_reason: closed ? (stageName === "Joined another school" ? "Joined another school" : pick(["Fee too high", "Distance / transport", "Undecided", "No response"])) : null,
      custom: r() < 0.6 ? { transport_required: pick(["Yes", "No", "Not sure"]) } : {}, created_at: created, stage_entered_at: ago(opts.daysBack * r() * 0.6),
      first_response_at: stageName === "New" || rank === 0 ? null : new Date(created.getTime() + (2 + r() * 40) * 60000), last_activity_at: ago(opts.daysBack * r() * 0.5),
      application_no: reached >= 3 && !closed ? `APP-${String(startYear).slice(2)}-${String(appNo++).padStart(4, "0")}` : null,
      tags: rank === 0 ? [pick(["pre-school tie-up", "society event", "previous-year lost"])] : [],
    });
    await insert("source_touches", { tenant_id: t, enquiry_id: e.id, source_id: src.id, channel: src.channel, source: src.name, campaign: src.channel === "Meta ads" || src.channel === "Google" ? pick(["Admissions Open", "Early Bird", "Open House Nov"]) : null, created_at: created });
    const act = (type: string, outcome: string | null, content: string, frac: number, actor: Row | null = owner, meta: Row = {}) =>
      insert("activities", { tenant_id: t, household_id: hh!.id, enquiry_id: e.id, type, outcome, content, actor_id: actor?.id ?? null, meta, created_at: ago(opts.daysBack * (1 - frac)) });
    await act("touch", "created", `Enquiry created from ${src.name} (${src.channel}). Assigned to ${owner.name}.`, 0, null);
    if (rank === 0) return e;
    if (stageName !== "New") {
      await act("whatsapp", null, `Hello, thank you for your interest in Greenfield Schools. ${owner.name} will call you shortly.`, 0.01, null, { direction: "out", status: "delivered", automated: true });
      await act("call", "not_answered", "Call not answered.", 0.05);
    }
    if (reached >= 1 && !["New", "Contact attempted"].includes(stageName)) {
      await act("call", "connected", pick(["Spoke to the parent. Interested in a campus visit; asked about transport routes.", "Parent wants fee details and timings. Shared brochure.", "Discussed curriculum and class size. Will discuss with spouse."]), 0.15);
      const doneAt = ago(opts.daysBack * 0.8);
      await insert("tasks", { tenant_id: t, enquiry_id: e.id, household_id: hh.id, title: "First call to the parent", due_at: new Date(doneAt.getTime() + (r() < 0.85 ? 2 : -30) * 3600e3), owner_id: owner.id, status: "done", outcome: "Spoke to parent", completed_at: doneAt });
      if (r() < 0.5) await act("note", null, pick(["Mother is the decision maker. Prefers WhatsApp after 6 pm.", "Comparing with one other school nearby.", "Elder cousin studies here."]), 0.2);
    }
    if (reached >= 2 || stageName === "Visit scheduled") {
      const done = stageName !== "Visit scheduled" && stageName !== "No-show";
      const slot = stageName === "Visit scheduled" ? new Date(Date.now() + (seq % 5 === 0 ? -1 : 1 + (seq % 6) * 9) * 3600e3) : ago(opts.daysBack * 0.6);
      await insert("visits", { tenant_id: t, enquiry_id: e.id, household_id: hh.id, branch_id: branch.id, slot_at: slot, host_id: owner.id, status: done ? "done" : stageName === "No-show" ? "no_show" : "scheduled", checked_in_at: done ? slot : null, outcome: done ? pick(["Liked the campus; wants fee quote", "Positive; will apply this week", "Concerned about distance"]) : null });
      await act("visit", "booked", "Campus visit booked.", 0.3);
      if (done) await act("visit", "done", "Family visited the campus and met the counsellor.", 0.4);
    }
    if (reached >= 3) {
      const submitted = !["Form started"].includes(stageName);
      await insert("applications", { tenant_id: t, enquiry_id: e.id, progress: submitted ? 100 : 30 + Math.floor(r() * 50), status: submitted ? "submitted" : "started", declaration: submitted, submitted_at: submitted ? ago(opts.daysBack * 0.4) : null, answers: { previous_school: student.current_school ?? "", father_name: "", mother_name: "", medical: "None" }, created_at: ago(opts.daysBack * 0.5) });
      await act("form", "started", "Application form started.", 0.5, null);
      if (submitted) await act("form", "submitted", "Application form submitted.", 0.6, null);
      const verifiedAll = reached >= 4 || stageName === "Documents verified";
      for (const d of defaultSettings("cbse_day").doc_types) {
        const status = !submitted ? "pending" : verifiedAll ? "verified" : pick(["pending", "uploaded", "verified", "verified"]);
        await insert("documents", { tenant_id: t, enquiry_id: e.id, type: d, status, file_name: status === "pending" ? null : d.toLowerCase().replace(/ /g, "-") + ".pdf" });
      }
      if (submitted && stageName !== "Form submitted") {
        await insert("payments", { tenant_id: t, enquiry_id: e.id, purpose: "Registration fee", amount: 1500, mode: pick(["link", "upi", "cash"]), status: "paid", receipt_no: `RCPT-${String(rcpt++).padStart(5, "0")}`, reference: "DEMO" + seq, paid_at: ago(opts.daysBack * 0.35), created_at: ago(opts.daysBack * 0.36) });
        await act("payment", "paid", "Registration fee of ₹1,500 received.", 0.65, null);
      } else if (stageName === "Form submitted") {
        await insert("payments", { tenant_id: t, enquiry_id: e.id, purpose: "Registration fee", amount: 1500, mode: "link", status: seq % 2 ? "pending" : "failed" });
      }
    }
    if (reached >= 6) {
      await insert("payments", { tenant_id: t, enquiry_id: e.id, purpose: "Admission fee", amount: 25000, mode: pick(["link", "bank_transfer", "cheque"]), status: "paid", receipt_no: `RCPT-${String(rcpt++).padStart(5, "0")}`, reference: "DEMO-A" + seq, paid_at: ago(opts.daysBack * 0.15), created_at: ago(opts.daysBack * 0.16) });
      await act("payment", "paid", "Admission fee of ₹25,000 received.", 0.85, null);
    }
    if (closed) await act("stage_change", null, `Stage moved to ${stageName}. Reason: ${e.closure_reason}`, 0.9);
    if (!closed && !st.exempt_next_action && year.id === cur.id) {
      const offs = [-50, -26, -4, -1, 1, 2, 4, 20, 28, 50];
      const titles: Record<string, string> = { enquiry: stageName === "New" ? "First call to the parent" : "Follow-up call", visit: stageName === "Visit scheduled" ? "Confirm tomorrow's visit" : "Post-visit follow-up", application: "Help complete the application", evaluation: "Confirm interaction slot", offer: "Follow up on the offer" };
      await insert("tasks", { tenant_id: t, enquiry_id: e.id, household_id: hh.id, type: st.phase_key === "application" && stageName === "Documents pending" ? "document_chase" : "call_back", title: titles[st.phase_key] ?? "Follow-up", due_at: new Date(Date.now() + (stageName === "New" ? 0.05 : offs[seq % offs.length]) * 3600e3), owner_id: owner.id, priority: stageName === "New" || reached >= 3 ? "high" : "normal" });
    }
    return e;
  }

  for (const [stage, n] of plan) for (let i = 0; i < n; i++) await makeEnquiry(stage, cur, { daysBack: stage === "New" ? r() * 0.02 : 1 + r() * 55 });
  for (const [stage, n] of oldPlan) for (let i = 0; i < n; i++) await makeEnquiry(stage, prev, { daysBack: 250 + r() * 150 });
  // Siblings: the household model in action.
  const families = await q("select h.*, e.branch_id, (select split_part(g.name, ' ', 2) from guardians g where g.household_id=h.id limit 1) as last from households h join enquiries e on e.household_id=h.id where h.tenant_id=$1 and e.year_id=$2 order by h.created_at limit 14", [t, cur.id]);
  for (const f of families) await makeEnquiry(pick(["Connected", "Interested", "Visit done"]), cur, { household: f, branch: f.branch_id === b1.id ? b1 : b2, daysBack: 2 + r() * 20 });

  // WhatsApp threads for the team inbox.
  const chatty = await q("select e.id, e.household_id, e.owner_id from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id where e.tenant_id=$1 and e.year_id=$2 and p.key in ('enquiry','visit','application') and s.name<>'New' order by e.created_at desc limit 12", [t, cur.id]);
  const asks = ["Hi, what are the school timings for this grade?", "Can you share the fee structure please?", "Is transport available from Miyapur?", "We would like to visit on Saturday. Is that possible?", "Thank you. Is there a sibling discount?", "What documents are needed for admission?"];
  for (let i = 0; i < chatty.length; i++) {
    const c = chatty[i];
    const open = i < 7;
    const m = (direction: string, body: string, mins: number, extra: Row = {}) => insert("messages", { tenant_id: t, household_id: c.household_id, enquiry_id: c.id, channel: "whatsapp", direction, body, status: direction === "out" ? "delivered" : "received", created_at: new Date(Date.now() - mins * 60000), read: direction === "out" || !open || i > 3, ...extra });
    await m("out", "Hello, thank you for your interest in Greenfield Schools. Our admissions team will call you shortly.", 3000 + i * 50);
    await m("in", pick(asks), 2900 + i * 40);
    await m("out", "Happy to help. Sharing the details here; I will also call you to walk through them.", 2880 + i * 40, { sender_id: c.owner_id });
    if (open) {
      const body = asks[i % asks.length];
      await m("in", body, 8 + i * 37);
      await insert("activities", { tenant_id: t, household_id: c.household_id, enquiry_id: c.id, type: "whatsapp", content: body, meta: { direction: "in" }, created_at: new Date(Date.now() - (8 + i * 37) * 60000) });
      await q("update households set inbox_status='open' where id=$1", [c.household_id]);
    }
  }

  // Scores from the seeded timeline, without firing workflows.
  const settings = defaultSettings("cbse_day");
  for (const e of await q("select id from enquiries where tenant_id=$1", [t])) {
    const { score } = await scoreBreakdown(t, e.id);
    await q("update enquiries set score=$2, temperature=$3 where id=$1", [e.id, score, temperatureFor(score, settings)]);
  }
  await q("update tenants set settings = settings || $2::jsonb where id=$1", [t, { next_app_no: appNo, next_receipt_no: rcpt }]);
  for (const [name, cost] of SOURCES.map(([, n, c]) => [n, c] as const)) await q("update sources set cost=$3 where tenant_id=$1 and name=$2", [t, name, cost]);

  const tpl = await one("select id from templates where tenant_id=$1 and name='Open house invite'", [t]);
  await insert("campaigns", { tenant_id: t, name: "Open House — November", channel: "whatsapp", template_id: tpl!.id, audience: { view: "interested" }, status: "sent", sent_at: ago(9), created_by: admin.id, cost: 268.8, stats: { targeted: 342, sent: 336, delivered: 318, read: 251, replied: 64, visits: 31, applications: 12, admissions: 4 } });
  await insert("campaigns", { tenant_id: t, name: "Early bird closes Friday", channel: "sms", template_id: tpl!.id, audience: { view: "hot" }, status: "sent", sent_at: ago(21), created_by: admin.id, cost: 53, stats: { targeted: 220, sent: 212, delivered: 204, read: 0, replied: 9, visits: 11, applications: 6, admissions: 2 } });
  for (const [cat, amt, note, d] of [["whatsapp", 268.8, "Campaign: Open House — November", 9], ["sms", 53, "Campaign: Early bird closes Friday", 21], ["recharge", 5000, "Wallet recharge (GST invoice INV-0042)", 30]] as const)
    await insert("wallet_ledger", { tenant_id: t, type: cat === "recharge" ? "credit" : "debit", category: cat, amount: amt, note, created_at: ago(d) });
  for (const u of [priya, arjun, kavya, meera]) {
    await insert("notifications", { tenant_id: t, user_id: u.id, category: "system", title: "Welcome to AutoED CRM. Press Ctrl+K to search or jump anywhere.", link: "/" });
  }
  await insert("notifications", { tenant_id: t, user_id: admin.id, category: "system", title: "Your workspace is ready with sample data.", link: "/admin" });
  await insert("tickets", { tenant_id: t, user_id: ravi.id, kind: "ticket", subject: "WhatsApp template stuck in review", body: "Our 'Fee structure' template has been pending for two days.", priority: "high" });
  await insert("tickets", { tenant_id: t, user_id: admin.id, kind: "feature", subject: "Bus route map on the 360 page", body: "Counsellors want to see the nearest bus stop for a family." });
  await insert("audit_events", { tenant_id: t, user_id: admin.id, user_name: admin.name, action: "config", entity: "custom_field", summary: "Added field \"Transport required\" to Enquiry", created_at: ago(12) });
  await insert("audit_events", { tenant_id: t, user_id: ravi.id, user_name: ravi.name, action: "export", entity: "enquiry", summary: "Exported 214 enquiries (Kondapur campus)", created_at: ago(3) });
  await insert("saved_views", { tenant_id: t, user_id: admin.id, name: "Hot and unvisited", shared: true, query: "chip=hot&phase=enquiry" });

  // A second, smaller customer so the platform console has more than one tenant.
  const second = await createTenant({ name: "Little Oaks Pre-school", subdomain: "littleoaks", plan: "starter", pack: "preschool", status: "trial", adminName: "Rhea Kapoor", adminEmail: "rhea@littleoaks.demo", branchName: "Indiranagar centre", city: "Bengaluru", wallet: 300 });
  await insert("tickets", { tenant_id: second.tenant.id, user_id: second.admin.id, subject: "How do we import our Excel enquiry sheet?", body: "We have about 400 rows from last year." });
}
