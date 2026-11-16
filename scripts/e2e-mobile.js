// Drives the Android app's web build at phone size against a running AutoED server.
// Usage: node scripts/e2e-mobile.js <appUrl> <serverUrl> [screenshotDir]
const { chromium } = require("playwright");
const path = require("path");

const [APP = "http://localhost:8081", SERVER = "http://localhost:3000", out] = process.argv.slice(2);
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message.slice(0, 200)); failures++; });
  const shot = (n) => out && page.screenshot({ path: path.join(out, `app-${n}.png`) });
  const text = () => page.locator("body").innerText();
  const stamp = String(Date.now()).slice(-7);

  await page.goto(APP, { waitUntil: "networkidle" });
  await page.getByText("Using a different server?").click();
  await page.locator("input").nth(2).fill(SERVER);
  await page.getByTestId("email").fill("priya@greenfield.demo");
  await page.getByTestId("password").fill("wrong-password");
  await page.getByTestId("signin").click();
  await page.waitForSelector("text=do not match", { timeout: 20000 });
  ok("Wrong password is refused with a plain message", true);
  await page.getByTestId("password").fill("demo1234");
  await page.getByTestId("signin").click();
  await page.waitForSelector("text=Hello, Priya", { timeout: 30000 });
  ok("Counsellor signs in and lands on My day", (await text()).includes("Awaiting first response"));
  await shot("myday");

  // Quick add with live duplicate check, then the family page opens.
  await page.getByText("+ Quick add enquiry").first().click();
  await page.getByTestId("mobile").fill("96" + stamp + "7");
  await page.getByPlaceholder("10-digit mobile").press("Tab");
  await page.locator("input").nth(1).fill("App Child " + stamp);
  await page.locator("input").nth(2).fill("App Parent");
  await page.getByText("Grade 2", { exact: true }).click();
  await page.getByText("Front desk walk-in", { exact: true }).click();
  await page.getByTestId("save").click();
  await page.waitForSelector(`text=App Child ${stamp}`, { timeout: 30000 });
  await page.waitForSelector("text=Timeline");
  ok("Quick add creates the family and opens its page with a next action", (await text()).includes("First call to the parent"));
  await shot("family");

  // Log a call: New moves to Connected.
  await page.getByText("Log a call", { exact: true }).click();
  await page.getByText("Connected", { exact: true }).first().click();
  await page.getByPlaceholder("What did the parent say?").fill("Wants a visit on Saturday " + stamp);
  await page.getByText("Log call", { exact: true }).click();
  await page.waitForSelector("text=How did the call go?", { state: "detached", timeout: 20000 });
  await page.waitForSelector("text=Stage moved from New to Connected", { timeout: 20000 }).catch(() => {});
  const afterCall = await text();
  ok("Call outcome logs to the timeline and moves the stage", afterCall.includes("Stage moved from New to Connected"), afterCall.includes("Stage moved") ? "" : afterCall.slice(0, 500).replace(/\n/g, " | "));

  // Note.
  await page.getByText("📝 Note", { exact: true }).click();
  await page.getByPlaceholder("Type @firstname to notify a colleague").fill("Prefers WhatsApp after 6 pm " + stamp);
  await page.getByText("Save note", { exact: true }).click();
  await page.waitForSelector("text=Add a note", { state: "detached", timeout: 20000 });
  await page.waitForSelector(`text=Prefers WhatsApp after 6 pm ${stamp}`, { timeout: 20000 });
  ok("Note saves to the timeline", true);

  // Finish the last open task: the app insists on a next action.
  for (let i = 0; i < 5; i++) {
    const done = page.locator(':text-is("Done"):visible');
    if ((await done.count()) === 0) break;
    await done.first().click();
    await page.getByPlaceholder("Outcome").fill("Spoke to parent");
    const lastOpen = (await page.getByText("Nothing more", { exact: true }).count()) === 0;
    if (lastOpen) {
      ok("Last open task requires a next action (no 'Nothing more')", true);
      await page.getByText("Complete task", { exact: true }).click();
      await page.waitForSelector("text=Complete: ", { state: "detached", timeout: 20000 });
      break;
    }
    await page.getByText("Nothing more", { exact: true }).click();
    await page.getByText("Complete task", { exact: true }).click();
    await page.waitForSelector("text=Complete: ", { state: "detached", timeout: 20000 });
  }
  const afterTask = await text();
  ok("After completing, the task is done and a new follow-up is planned", afterTask.includes("Done: Spoke to parent") && afterTask.includes("Follow-up call") && !afterTask.includes("No next action is planned"));

  await shot("after-task");
  // Message: SMS template goes through the simulator.
  await page.getByText("💬 Message", { exact: true }).click();
  await page.getByText("SMS", { exact: true }).click();
  await page.getByText("Welcome", { exact: true }).click();
  await page.getByText("Send", { exact: true }).click();
  await page.waitForSelector("text=Sent on SMS", { timeout: 20000 });
  ok("Template message sends and shows confirmation", true);

  // Leads tab and search.
  await page.goBack();
  await page.locator(':text-is("Leads"):visible').last().click();
  await page.getByLabel("Search leads").fill("App Child " + stamp);
  await page.waitForSelector(`text=App Child ${stamp}`, { timeout: 20000 });
  ok("Leads search finds the new family", true);
  await shot("leads");

  await page.locator(':text-is("Alerts"):visible').last().click();
  await page.waitForTimeout(800);
  ok("Alerts tab loads", (await text()).includes("Alerts"));
  await page.locator(':text-is("Me"):visible').last().click();
  await page.getByText("Sign out", { exact: true }).click();
  await page.waitForSelector("text=Sign in", { timeout: 20000 });
  ok("Sign out returns to the sign-in screen", true);

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
