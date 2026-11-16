// End-to-end check of the main flows through the real UI. Needs the app running on BASE (default http://localhost:3000)
// with the demo data. Usage: node scripts/e2e.js [screenshotDir]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2];
let browser, failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message.slice(0, 200)); failures++; });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "demo1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("form button.btn-primary")]);
  return page;
}
const shot = (page, name) => out && page.screenshot({ path: path.join(out, name + ".png") });
const text = (page) => page.locator("body").innerText();
const settle = (page) => page.waitForLoadState("networkidle");

(async () => {
  browser = await chromium.launch();
  const stamp = String(Date.now()).slice(-7);
  const mobile = "97" + stamp + "1";

  // --- Counsellor: quick add, duplicate warning, 360 actions, next-action rule ---
  const p = await session("priya@greenfield.demo");
  await p.goto(BASE + "/leads", { waitUntil: "networkidle" });
  const existing = (await p.locator("table tbody tr td span.muted").first().innerText()).trim();
  await p.keyboard.press("n");
  await p.fill("dialog[open] input[name=mobile]", existing);
  await p.waitForSelector("text=This family is already with us", { timeout: 15000 });
  ok("Quick add shows the duplicate before saving", true);
  await p.fill("dialog[open] input[name=mobile]", mobile);
  await p.waitForSelector("text=This family is already with us", { state: "detached" });
  await p.fill("dialog[open] input[name=studentName]", "Tara Example");
  await p.fill("dialog[open] input[name=guardianName]", "Rohit Example");
  await p.selectOption("dialog[open] select[name=grade]", "Grade 3");
  await p.selectOption("dialog[open] select[name=sourceId]", { index: 1 });
  await p.click("dialog[open] button.btn-primary");
  await p.waitForURL(/\/households\//, { timeout: 60000 });
  await settle(p);
  const hhUrl = p.url();
  let body = await text(p);
  ok("Quick add creates the household and opens the 360 page", body.includes("Rohit Example") && body.includes("Tara Example"));
  ok("New enquiry has an owner and a next action", /Owner\s*\n?\s*Priya Sharma|Arjun Mehta/.test(body) && !body.includes("This enquiry has no next action"));
  ok("Sensitive date of birth is masked for a counsellor", (await p.locator('input[name="s_dob"]').count()) === 0);

  await p.click("button:has-text('Call')");
  await p.selectOption("select[name=outcome]", "connected");
  await p.fill("input[name=notes]", "Wants a campus visit on Saturday");
  await p.click("button:has-text('Log call')");
  await p.waitForSelector("text=Wants a campus visit on Saturday");
  await settle(p);
  body = await text(p);
  ok("Logging a connected call moves New to Connected and writes the timeline", body.includes("Stage moved from New to Connected"));

  // Complete every open task but the last, then check the last one cannot close without a next action.
  for (let i = 0; i < 6 && (await p.locator("button:has-text('✓ Done')").count()) > 1; i++) {
    await p.locator("button:has-text('✓ Done')").first().click();
    await p.fill("dialog[open] input[name=outcome]", "Done");
    if (await p.locator("dialog[open] input[value=none]").count()) await p.check("dialog[open] input[value=none]");
    await p.click("dialog[open] button:has-text('Complete task')");
    await p.waitForSelector("dialog[open]", { state: "detached" });
    await settle(p);
  }
  await p.locator("button:has-text('✓ Done')").first().click();
  ok("Last open task offers no 'Nothing more' option", (await p.locator("dialog[open] input[value=none]").count()) === 0);
  await p.fill("dialog[open] input[name=outcome]", "Spoke to parent");
  await p.check("dialog[open] input[value=stage]");
  ok("Moving stage from the last task only offers stages that need no next action", !(await p.locator("dialog[open] select[name=stageId]").innerText()).includes("Enquiry: Interested"));
  await p.check("dialog[open] input[value=task]");
  await p.click("dialog[open] button:has-text('Complete task')");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  await settle(p);
  ok("Completing with a next task keeps the enquiry planned", !(await text(p)).includes("This enquiry has no next action"));

  await p.click("button:has-text('Book visit')");
  // A slot of its own, so repeated runs do not hit the per-hour visit capacity.
  const slot = new Date(Date.now() + (3 + Math.floor(Math.random() * 300)) * 86400e3 + Math.floor(Math.random() * 8) * 3600e3).toISOString().slice(0, 16);
  await p.fill("input[name=slotAt]", slot);
  await p.click("form button.btn-primary:has-text('Book visit')");
  await p.waitForSelector("text=Stage moved from Connected to Visit scheduled");
  ok("Booking a visit moves the stage and logs it", true);

  await p.click("button:has-text('Message')");
  await p.selectOption("select[name=templateId]", { label: "Fee structure" });
  await p.click("button.btn-primary:has-text('Send')");
  await p.waitForSelector("text=here is the fee structure for Grade 3");
  ok("Template message is merged and appears on the timeline", true);
  await shot(p, "e2e-360");

  await p.click("button:has-text('Change stage')");
  await p.locator("form select").filter({ hasText: "Closed: Not interested" }).selectOption({ label: "Closed: Not interested" });
  ok("Closing asks for a closure reason", (await p.locator("select[name=closure_reason]").count()) === 1);
  await p.selectOption("select[name=closure_reason]", "Fee too high");
  await p.click("button.btn-primary:has-text('Move')");
  await p.waitForSelector("text=Reason: Fee too high");
  ok("Closed with reason on the timeline", true);
  ok("Counsellor cannot open the admin console", !(await text(p)).includes("Admin console"));
  await p.goto(BASE + "/admin/users", { waitUntil: "networkidle" });
  ok("Direct URL to admin is refused for a counsellor", p.url().includes("denied"));

  // --- Public form: re-enquiry reopens the closed record ---
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(BASE + "/f/greenfield-enquiry?utm_source=google&utm_campaign=e2e", { waitUntil: "networkidle" });
  await anon.fill("input[name=student_name]", "Tara Example");
  await anon.fill("input[name=guardian_name]", "Rohit Example");
  await anon.fill("input[name=mobile]", mobile);
  await anon.selectOption("select[name=grade]", "Grade 3");
  await anon.check("input[name=consent]");
  await anon.waitForTimeout(2200);
  await anon.click("button:has-text('Send enquiry')");
  await anon.waitForSelector("text=Thank you");
  await p.goto(hhUrl, { waitUntil: "networkidle" });
  body = await text(p);
  ok("Public form re-enquiry lands on the same record, reopens it and tags it", body.includes("Re-enquired") && body.includes("Re-opened automatically") && !body.includes("Not interested\n"));
  ok("UTM campaign is kept on the source touch", body.includes("Campaign: e2e"));

  // --- Front office: walk-in on an existing mobile ---
  const f = await session("farah@greenfield.demo");
  await f.goto(BASE + "/walkin", { waitUntil: "networkidle" });
  await f.fill("main input[name=mobile]", mobile);
  await f.waitForSelector("text=This family is already with us");
  await f.fill("main input[name=studentName]", "Tara Example");
  await f.click("button:has-text('Check in this family')");
  await f.waitForSelector("text=Visitor token");
  ok("Walk-in on a known mobile gives a token and no new household", (await text(f)).includes("Existing family"));

  // --- Admin: custom field live on the record, test run, import with review queue and undo ---
  const a = await session("anita@greenfield.demo");
  const field = "Bus stop " + stamp;
  await a.goto(BASE + "/admin/fields", { waitUntil: "networkidle" });
  await a.locator("main form").first().locator("input[name=label]").fill(field);
  await a.click("button:has-text('Add field')");
  await a.waitForSelector(`input[value="${field}"]`);
  await a.goto(hhUrl, { waitUntil: "networkidle" });
  ok("CF-01: a new custom field is live on the 360 page without a deploy", (await text(a)).includes(field));
  ok("Admin sees the date of birth field", (await a.locator('input[name="s_dob"]').count()) === 1);

  await a.goto(BASE + "/admin/workflows", { waitUntil: "networkidle" });
  await a.click("a:has-text('Instant welcome')");
  await a.click("button:has-text('Test run on a sample record')");
  await a.waitForSelector("text=Would send on whatsapp");
  ok("Workflow test run shows what would happen without sending", true);
  await shot(a, "e2e-workflow");

  const csv = path.join(out ?? ".", "e2e-import.csv");
  fs.writeFileSync(csv, `Student name,Parent name,Mobile,Grade,Stage,Sub stage\nImport One,Parent One,96${stamp}1,Grade 2,Follow-up (2026),Campus visit planned\nImport Two,Parent Two,96${stamp}2,Grade 2,Interested,Hot\nTara Example,Rohit Example,${mobile},Grade 3,Untouched,\nBad Row,Nobody,12345,Grade 2,Junk,\n`);
  await a.goto(BASE + "/admin/data", { waitUntil: "networkidle" });
  await a.setInputFiles("input[name=file]", csv);
  await a.fill("input[name=consent_basis]", "E2E test list");
  await a.click("button:has-text('Import')");
  await a.waitForSelector("text=Duplicate review queue");
  body = await text(a);
  ok("Import: 2 created, duplicate sent to review, bad row explained", body.includes("Duplicate review queue · 1") && body.includes("not a valid 10-digit Indian mobile"));
  await a.goto(BASE + "/leads?year=all&q=Import%20One", { waitUntil: "networkidle" });
  ok("Imported stage is mapped (Follow-up / Campus visit planned -> Visit scheduled)", (await text(a)).includes("Visit scheduled"));
  await a.goto(BASE + "/admin/data", { waitUntil: "networkidle" });
  await a.click("button:has-text('Undo import')");
  await a.waitForSelector("text=Undone");
  await a.goto(BASE + "/leads?year=all&q=Import%20One", { waitUntil: "networkidle" });
  ok("Undo import removes the records it created", (await text(a)).includes("No leads match"));
  await a.goto(BASE + "/admin/data", { waitUntil: "networkidle" });
  if (await a.locator("button:has-text('Discard all')").count()) { await a.click("button:has-text('Discard all')"); await settle(a); }

  // --- Reports drill-down and CSV export ---
  await a.goto(BASE + "/reports", { waitUntil: "networkidle" });
  await a.click('main a[href="/leads?phase=visit"]');
  await a.waitForURL(/\/leads\?phase=visit/, { timeout: 30000 }).catch(() => {});
  ok("Report numbers drill down to the lead list", a.url().includes("/leads?"));
  const res = await a.request.get(BASE + "/api/export?open=1");
  const exported = await res.text();
  ok("CSV export works and carries the exporter watermark", res.status() === 200 && exported.includes("Exported by Anita Rao"));
  const denied = await p.request.get(BASE + "/api/export?open=1");
  ok("Counsellor cannot export", denied.status() === 403);

  // --- REST API ---
  await a.goto(BASE + "/admin/integrations", { waitUntil: "networkidle" });
  await a.fill("main input[name=name]", "E2E key " + stamp);
  await a.click("button:has-text('Create key')");
  await a.waitForSelector("text=Copy this key now");
  const key = (await text(a)).match(/aed_[A-Za-z0-9_-]+/g).sort((x, y) => y.length - x.length)[0];
  const post = (b, h = {}) => fetch(BASE + "/api/v1/enquiries", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json", ...h }, body: JSON.stringify(b) });
  const r1 = await post({ student_name: "Api Child", guardian_name: "Api Parent", mobile: "95" + stamp + "9", grade: "Grade 4", branch: "Kondapur campus" });
  const j1 = await r1.json();
  const r2 = await post({ student_name: "Api Child", guardian_name: "Api Parent", mobile: "95" + stamp + "9", grade: "Grade 4", branch: "Kondapur campus" });
  const j2 = await r2.json();
  ok("API creates an enquiry, then reports a re-enquiry instead of a duplicate", r1.status === 201 && j1.status === "created" && j2.status === "re_enquiry" && j2.enquiry_id === j1.enquiry_id, JSON.stringify(j2));
  ok("API rejects a bad key", (await fetch(BASE + "/api/v1/enquiries", { headers: { authorization: "Bearer nope" } })).status === 401);
  const list = await (await fetch(BASE + "/api/v1/enquiries?limit=2", { headers: { authorization: "Bearer " + key } })).json();
  ok("API lists with a cursor and without sensitive fields", list.data.length === 2 && !!list.next_cursor && !("dob" in list.data[0]));

  // --- Platform: consent-based support access ---
  const s = await session("support@autoed.demo");
  ok("Platform staff land on the platform console", s.url().includes("/platform"));
  await s.click("a:has-text('Greenfield Schools')");
  await settle(s);
  ok("No impersonation before approval", (await s.locator("button:has-text('Start session')").count()) === 0);
  await s.fill("input[name=reason]", "E2E: checking a template issue");
  await s.click("button:has-text('Request access')");
  await settle(s);
  await a.goto(BASE + "/admin/help", { waitUntil: "networkidle" });
  await a.click("button:has-text('Approve')");
  await a.waitForSelector("text=Active, ends");
  await s.reload({ waitUntil: "networkidle" });
  await s.click("button:has-text('Start session')");
  await s.waitForURL((u) => u.pathname === "/");
  ok("After approval support can view as a user, with a visible banner", (await text(s)).includes("AutoED support session"));
  await a.reload({ waitUntil: "networkidle" });
  await a.click("button:has-text('Revoke now')");
  await a.waitForSelector("button:has-text('Revoke now')", { state: "detached" });
  await s.goto(BASE + "/leads");
  ok("Revoking ends the support session immediately", !s.url().includes("/leads"), s.url());
  await a.goto(BASE + "/admin/audit?action=support", { waitUntil: "networkidle" });
  ok("Support access is visible in the school's audit log", (await text(a)).includes("started viewing as"));
  ok("A school user cannot open the platform console", await (async () => { await a.goto(BASE + "/platform"); return !a.url().endsWith("/platform"); })());

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error("E2E crashed:", e.message.split("\n").slice(0, 6).join("\n")); await browser?.close(); process.exit(1); });
