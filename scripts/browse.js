// Dev helper: signs in as a demo user, opens pages, reports errors and saves screenshots.
// Usage: node scripts/browse.js <email> <outDir> <path> [<path> ...]
const { chromium } = require("playwright");

(async () => {
  const [email, out, ...paths] = process.argv.slice(2);
  const base = process.env.BASE ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 300)));
  await page.goto(base + "/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "demo1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("form button")]);
  for (const p of paths) {
    errors.length = 0;
    const res = await page.goto(base + p, { waitUntil: "networkidle", timeout: 90000 });
    const text = await page.locator("body").innerText();
    const bad = /That did not work|Application error|Unhandled Runtime Error|This page could not be found/.test(text);
    const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    console.log(`${res.status()} ${bad ? "BROKEN" : "ok"} ${p}${errors.length ? "\n   " + errors.slice(0, 3).join("\n   ") : ""}${bad ? "\n   " + text.slice(0, 400).replace(/\n/g, " | ") : ""}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
