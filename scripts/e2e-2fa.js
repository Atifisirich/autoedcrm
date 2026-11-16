// Two-factor sign-in through the real UI: turn it on, sign in with a code, refuse a wrong code, turn it off.
// Usage: node scripts/e2e-2fa.js   (web app running on BASE with demo data)
const { chromium } = require("playwright");
const crypto = require("crypto");
const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

function totp(secret, t = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac("sha1", key).update(ctr).digest();
  const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message); failures++; });
  const signIn = async () => {
    await page.goto(BASE + "/login");
    await page.fill("input[name=email]", "vikram@greenfield.demo");
    await page.fill("input[name=password]", "demo1234");
    await page.click("form button.btn-primary");
  };
  await signIn();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(BASE + "/account", { waitUntil: "networkidle" });
  if (await page.locator("text=Turn off").count()) { console.log("Two-factor was left on by an earlier run; turn it off by hand first."); process.exit(1); }
  await page.click("button:has-text('Set up two-factor sign-in')");
  await page.waitForSelector("img[alt='QR code for your authenticator app']");
  const secret = (await page.locator("code.select-all").first().innerText()).trim();
  ok("Setup shows a QR code and a manual key", /^[A-Z2-7]{32}$/.test(secret));
  await page.fill("input[name=code]", "000000");
  await page.click("button:has-text('Turn on')");
  await page.waitForSelector("text=That code is not right");
  ok("A wrong code does not turn it on", true);
  await page.fill("input[name=code]", totp(secret));
  await page.click("button:has-text('Turn on')");
  await page.waitForSelector("text=Two-factor sign-in is on");
  ok("The right code turns two-factor on", true);

  await page.click("button:has-text('Sign out')");
  await signIn();
  await page.waitForSelector("input[name=code]");
  ok("Signing in now asks for a code", page.url().includes("/login"));
  await page.fill("input[name=code]", "111111");
  await page.click("form button.btn-primary");
  await page.waitForSelector("text=That code is not right");
  ok("A wrong code is refused", page.url().includes("/login"));
  await page.fill("input[name=code]", totp(secret));
  await page.click("form button.btn-primary");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  ok("The right code signs in", true);

  const api = await fetch(BASE + "/api/m/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "vikram@greenfield.demo", password: "demo1234" }) });
  const body = await api.json();
  ok("The mobile API asks for the code too", api.status === 401 && body.need2fa === true);
  const api2 = await fetch(BASE + "/api/m/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "vikram@greenfield.demo", password: "demo1234", code: totp(secret) }) });
  ok("The mobile API accepts the right code", api2.status === 200 && !!(await api2.json()).token);

  await page.goto(BASE + "/account", { waitUntil: "networkidle" });
  await page.fill("input[name=code]", totp(secret));
  await page.click("button:has-text('Turn off')");
  await page.waitForSelector("text=Two-factor sign-in is off");
  ok("Two-factor can be turned off with a current code", true);

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
