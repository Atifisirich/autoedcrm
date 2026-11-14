// End-to-end check, part two: application to confirmed admission, inbox, campaign, Kanban, rollover.
// Usage: node scripts/e2e-admissions.js [screenshotDir]   (app running on BASE with demo data; demo payments enabled)
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2];
let browser, failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) failures++; };
const text = (page) => page.locator("body").innerText();
const shot = (page, name) => out && page.screenshot({ path: path.join(out, name + ".png") });

async function session(email) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message.slice(0, 200)); failures++; });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "demo1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("form button.btn-primary")]);
  return page;
}

(async () => {
  browser = await chromium.launch();
  const stamp = String(Date.now()).slice(-7);
  const a = await session("anita@greenfield.demo");

  // New family, then the whole admission path.
  await a.goto(BASE + "/leads", { waitUntil: "networkidle" });
  await a.keyboard.press("n");
  await a.fill("dialog[open] input[name=mobile]", "94" + stamp + "3");
  await a.fill("dialog[open] input[name=studentName]", "Admit Flow " + stamp);
  await a.fill("dialog[open] input[name=guardianName]", "Parent Flow");
  await a.selectOption("dialog[open] select[name=grade]", "Grade 5");
  await a.selectOption("dialog[open] select[name=sourceId]", { index: 1 });
  await a.click("dialog[open] button.btn-primary");
  await a.waitForURL(/\/households\//);
  const hhUrl = a.url();
  const enquiryId = new URL(hhUrl).searchParams.get("e");
  await a.click("button:has-text('Form / payment')");
  await a.click("button:has-text('Start application')");
  await a.waitForSelector("text=Stage moved from New to Form started");
  ok("Starting an application assigns a number and moves the stage", /APP-\d\d-\d{4}/.test(await text(a)));

  // Parent fills the form on the public link.
  await a.goto(`${BASE}/applications/${enquiryId}`, { waitUntil: "networkidle" });
  const token = (await text(a)).match(/\/apply\/([a-f0-9]{32})/)[1];
  const parent = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await parent.goto(`${BASE}/apply/${token}`, { waitUntil: "networkidle" });
  await parent.click("button:has-text('Submit application')");
  await parent.waitForSelector("text=Some required answers are missing");
  ok("Parent cannot submit an incomplete application", true);
  for (const [k, v] of [["mother_tongue", "Telugu"], ["medical", "None"], ["father_name", "Parent Flow"], ["mother_name", "Mother Flow"], ["address", "12 Lake Road"], ["pincode", "500084"]]) await parent.fill(`input[name=${k}]`, v);
  await parent.selectOption("select[name=transport]", "Yes");
  await parent.click("button:has-text('Save and continue later')");
  await parent.waitForSelector("text=Saved.");
  await parent.reload({ waitUntil: "networkidle" });
  ok("Save and resume keeps the parent's answers", (await parent.inputValue("input[name=father_name]")) === "Parent Flow");
  await parent.check("input[name=declaration]");
  await parent.click("button:has-text('Submit application')");
  await parent.waitForSelector("text=Your application is submitted");
  await shot(parent, "e2e-parent-apply");
  ok("Parent submits the application on a phone-width screen", true);
  await parent.setInputFiles('input[type=file] >> nth=0', { name: "birth-certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 demo") });
  await parent.click("button:has-text('Send') >> nth=0");
  await parent.waitForSelector("text=Received, being checked");
  ok("Parent can send a document from the link", true);

  // Parent pays the registration fee through the link (failure, then success).
  await a.goto(hhUrl, { waitUntil: "networkidle" });
  await a.click("button:has-text('Form / payment')");
  await a.selectOption("form select[name=mode]", "link");
  await a.click("form button.btn-primary:has-text('Continue')");
  await a.waitForSelector("text=Payment link for Registration fee");
  await a.goto(`${BASE}/applications/${enquiryId}`, { waitUntil: "networkidle" });
  const payToken = (await text(a)).match(/\/pay\/([a-f0-9]{32})/)[1];
  await parent.goto(`${BASE}/pay/${payToken}`, { waitUntil: "networkidle" });
  await parent.click("button:has-text('Simulate a failed payment')");
  await parent.waitForSelector("text=No money was taken");
  await parent.click("button:has-text('Simulate a successful payment')");
  await parent.waitForSelector("text=Payment received");
  ok("Failed payment is explained, retry succeeds and issues a receipt", /RCPT-\d{5}/.test(await text(parent)));

  // Staff: cannot confirm early; verify documents, take the admission fee, confirm.
  await a.goto(`${BASE}/applications/${enquiryId}`, { waitUntil: "networkidle" });
  ok("Confirm admission is locked until the checklist is complete", await a.locator("button:has-text('Confirm admission')").isDisabled());
  ok("Payment moved the stage to Fee paid", (await text(a)).includes("Fee paid"));
  for (let i = 0; i < 8; i++) {
    const add = a.locator("main form:has(input[type=file])").first();
    if (!(await add.count())) break;
    await add.locator("input[type=file]").setInputFiles({ name: `doc-${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF demo") });
    await add.locator("button").click();
    await a.waitForLoadState("networkidle");
    await a.waitForTimeout(300);
  }
  for (let i = 0; i < 8 && (await a.locator("button:has-text('Verify')").count()); i++) {
    const n = await a.locator("button:has-text('Verify')").count();
    await a.locator("button:has-text('Verify')").first().click();
    await a.waitForFunction((c) => document.querySelectorAll("button[value=verify]").length < c, n).catch(() => {});
  }
  ok("All documents verified", (await text(a)).includes("Documents verified (5 of 5)"), (await text(a)).match(/Documents verified \(\d of \d\)/)?.[0]);
  await a.selectOption("main form select[name=purpose]", "Admission fee");
  await a.selectOption("main form select[name=mode]", "cheque");
  await a.click("button:has-text('Request / record')");
  await a.waitForSelector("text=Payment recorded and receipt issued");
  await a.waitForSelector("button:has-text('Confirm admission'):not([disabled])");
  await a.click("button:has-text('Confirm admission')");
  await a.waitForSelector("text=Admission confirmed");
  await shot(a, "e2e-application");
  await a.goto(hhUrl, { waitUntil: "networkidle" });
  const body = await text(a);
  ok("Admission confirmed; welcome workflow ran; no next action demanded", body.includes("Admission confirmed") && body.includes("admission to Grade 5 is confirmed") && !body.includes("This enquiry has no next action"));

  // Inbox: simulated parent reply shows up, reply sends, STOP opts out.
  await a.goto(BASE + "/inbox?f=all", { waitUntil: "networkidle" });
  await a.fill("main form input[name=body]", "Is the bus available from Miyapur? " + stamp);
  await a.click("button:has-text('Receive reply')");
  await a.waitForSelector(`text=Is the bus available from Miyapur? ${stamp}`);
  await a.fill("main textarea[name=body]", "Yes, route 4 covers Miyapur. " + stamp);
  await a.click("main button.btn-primary:has-text('Send')");
  await a.waitForSelector(`text=Yes, route 4 covers Miyapur. ${stamp}`);
  ok("Inbox: parent reply received and answered in the thread", true);
  await a.fill("main form input[name=body]", "STOP");
  await a.click("button:has-text('Receive reply')");
  await a.waitForLoadState("networkidle");
  await a.fill("main textarea[name=body]", "One more message");
  await a.click("main button.btn-primary:has-text('Send')");
  await a.waitForSelector("text=opted out of WhatsApp");
  ok("Inbox: STOP opts the parent out and the next send is blocked with a reason", true);

  // Campaign draft with audience count and cost, then send.
  await a.goto(BASE + "/campaigns", { waitUntil: "networkidle" });
  await a.fill("main input[name=name]", "E2E campaign " + stamp);
  await a.selectOption("main select[name=audience]", "chip=hot");
  await a.click("button:has-text('Create draft')");
  await a.waitForSelector(`text=E2E campaign ${stamp}`);
  ok("Campaign draft shows audience size and cost before sending", (await text(a)).includes("Estimated cost"));
  await a.locator("section", { hasText: "E2E campaign " + stamp }).locator("button:has-text('Send now')").click();
  await a.waitForSelector("text=Campaign sent to", { timeout: 120000 });
  ok("Campaign sends and reports delivered counts", true);

  // Kanban drag from Connected to Interested.
  await a.goto(BASE + "/leads?view=kanban&phase=enquiry", { waitUntil: "networkidle" });
  const card = a.locator("section[aria-label='Connected'] article").first();
  const name = await card.locator("a").innerText();
  await card.dragTo(a.locator("section[aria-label='Interested']"));
  await a.waitForFunction((n) => [...document.querySelectorAll("section[aria-label='Interested'] article a")].some((x) => x.textContent === n), name, { timeout: 30000 }).catch(() => {});
  ok("Kanban: dragging a card changes its stage", (await a.locator("section[aria-label='Interested']").innerText()).includes(name));
  await shot(a, "e2e-kanban");

  // Rollover: new year, carried-forward prospects, one pipeline.
  await a.goto(BASE + "/admin/org", { waitUntil: "networkidle" });
  const newYear = await a.inputValue("main form input[name=name] >> nth=-1");
  if (!(await text(a)).includes("\n" + newYear + "\n")) {
    await a.click("button:has-text('Create year')");
    await a.waitForSelector("text=carried forward as prospects");
  }
  ok("Rollover creates the next academic year and carries families forward", (await a.locator("select[name=year]").innerText()).includes(newYear), newYear);

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error("E2E crashed:", e.message.split("\n").slice(0, 8).join("\n")); await browser?.close(); process.exit(1); });
