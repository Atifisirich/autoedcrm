// Meta integration tests. Meta's Graph API is replaced by a fake fetch, so these run offline.
import crypto from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { insert, one, q } from "@/lib/db";
import { captureEnquiry, sendMessage } from "@/lib/core";
import { createTenant } from "@/lib/seed";
import { handleMetaWebhook, mapLeadFields, toMetaBody, verifySignature, waErrorText } from "@/lib/meta";
import { setSecret } from "@/lib/secrets";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/webhooks/meta/[key]/route";

let t: string, branchId: string, webhookKey: string;
let n = 0;
const mobile = () => "97" + String(20000000 + ++n).padStart(8, "0");
const calls: { url: string; body: any }[] = [];

function fakeMeta(handler: (url: string, body: any) => { status?: number; json: any }) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
}

beforeAll(async () => {
  const made = await createTenant({ name: "Meta School", subdomain: "meta-" + Date.now(), adminName: "Admin", adminEmail: `meta${Date.now()}@test.demo`, status: "active" });
  t = made.tenant.id; branchId = made.branch.id;
  webhookKey = (await one("select webhook_key from tenants where id=$1", [t]))!.webhook_key;
  await q("update tenants set settings = settings || $2::jsonb where id=$1", [t, { integrations: { whatsapp: { enabled: true, phone_number_id: "PNID", waba_id: "WABA" } } }]);
  await setSecret(t, "wa_token", "token-123");
  await setSecret(t, "meta_app_secret", "app-secret");
  await setSecret(t, "meta_verify_token", "verify-abc");
  await setSecret(t, "meta_page_token", "page-token");
});

afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

describe("helpers", () => {
  it("turns named variables into Meta's positional ones, reusing repeats", () => {
    expect(toMetaBody("Hi {{guardian_name}}, {{student_name}} ({{guardian_name}})")).toEqual({ text: "Hi {{1}}, {{2}} ({{1}})", vars: ["guardian_name", "student_name"] });
  });
  it("checks Meta's webhook signature", () => {
    const raw = '{"a":1}';
    const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(raw).digest("hex");
    expect(verifySignature(raw, sig, "s3cret")).toBe(true);
    expect(verifySignature(raw, sig, "other")).toBe(false);
    expect(verifySignature(raw, null, "s3cret")).toBe(false);
  });
  it("explains error codes in plain words", () => {
    expect(waErrorText(131026)).toBe("This number cannot receive WhatsApp messages. Try SMS or call.");
    expect(waErrorText(999999, "Weird")).toMatch(/could not deliver this message \(Weird\)/);
  });
  it("maps common lead form questions", () => {
    const m = mapLeadFields(
      [{ name: "full_name", values: ["Ritu Verma"] }, { name: "phone_number", values: ["+919812300001"] }, { name: "child's_name", values: ["Asha"] }, { name: "which_class?", values: ["Grade 2"] }, { name: "preferred_campus", values: ["Whitefield"] }, { name: "budget", values: ["2-3L"] }],
      ["Grade 1", "Grade 2"], [{ id: "b1", name: "Kondapur campus" }, { id: "b2", name: "Whitefield campus" }],
    );
    expect(m).toMatchObject({ guardianName: "Ritu Verma", mobile: "+919812300001", studentName: "Asha", grade: "Grade 2", branchId: "b2" });
    expect(m.extra).toEqual(["budget: 2-3L"]);
  });
});

describe("sending", () => {
  it("refuses free text outside the 24-hour window and says why", async () => {
    const r = await captureEnquiry(t, { studentName: "A", guardianName: "P", mobile: mobile(), branchId });
    if (!r.ok) throw new Error(r.error);
    fakeMeta(() => ({ json: {} }));
    const res = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "whatsapp", body: "Hello" });
    expect(res.status).toBe("failed");
    expect(res.reason).toMatch(/24 hours/);
    expect(calls.filter((c) => c.url.includes("/messages")).length).toBe(0);
  });

  it("sends an approved template with parameters in Meta's order, and does not charge the wallet", async () => {
    const m = mobile();
    const r = await captureEnquiry(t, { studentName: "Kabir", guardianName: "Neha", mobile: m, branchId });
    if (!r.ok) throw new Error(r.error);
    const tpl = await insert("templates", { tenant_id: t, channel: "whatsapp", name: "Hello test", body: "Hi {{guardian_name}}, about {{student_name}}", meta_name: "hello_test", meta_status: "APPROVED", meta_vars: ["guardian_name", "student_name"] });
    const wallet = Number((await one("select wallet_balance from tenants where id=$1", [t]))!.wallet_balance);
    fakeMeta(() => ({ json: { messages: [{ id: "wamid.TEST1" }] } }));
    const res = await sendMessage(t, { householdId: r.householdId, enquiryId: r.enquiryId, channel: "whatsapp", body: "Hi Neha, about Kabir", template: tpl, vars: { guardian_name: "Neha", student_name: "Kabir" } });
    expect(res.status).toBe("sent");
    const sent = calls.find((c) => c.url.endsWith("/PNID/messages"))!;
    expect(sent.body).toMatchObject({ to: "91" + m, type: "template", template: { name: "hello_test", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Neha" }, { type: "text", text: "Kabir" }] }] } });
    expect((await one("select status, provider_id from messages where provider_id='wamid.TEST1'"))).toMatchObject({ status: "sent" });
    expect(Number((await one("select wallet_balance from tenants where id=$1", [t]))!.wallet_balance)).toBe(wallet);
  });
});

describe("webhook", () => {
  const sign = (raw: string) => "sha256=" + crypto.createHmac("sha256", "app-secret").update(raw).digest("hex");
  const post = (payload: any, sig?: string) => {
    const raw = JSON.stringify(payload);
    return webhookPost(new Request(`http://x/api/webhooks/meta/${webhookKey}`, { method: "POST", body: raw, headers: { "x-hub-signature-256": sig ?? sign(raw) } }), { params: Promise.resolve({ key: webhookKey }) });
  };
  const wa = (value: any) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] });

  it("answers Meta's verification only with the right token", async () => {
    const ok = await webhookGet(new Request(`http://x/?hub.mode=subscribe&hub.verify_token=verify-abc&hub.challenge=42`), { params: Promise.resolve({ key: webhookKey }) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await webhookGet(new Request(`http://x/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`), { params: Promise.resolve({ key: webhookKey }) });
    expect(bad.status).toBe(403);
  });

  it("rejects calls without a valid signature", async () => {
    expect((await post(wa({}), "sha256=deadbeef")).status).toBe(401);
  });

  it("an unknown number messaging the school becomes a new enquiry; a retried delivery is ignored", async () => {
    const from = "91" + mobile();
    const payload = wa({ contacts: [{ wa_id: from, profile: { name: "Farah K" } }], messages: [{ id: "wamid.IN1", from, type: "text", text: { body: "Is Grade 3 open?" } }] });
    expect((await post(payload)).status).toBe(200);
    expect((await post(payload)).status).toBe(200);
    const g = await one("select household_id, name from guardians where tenant_id=$1 and mobile=$2", [t, from.slice(2)]);
    expect(g!.name).toBe("Farah K");
    expect((await one("select count(*)::int n from messages where tenant_id=$1 and household_id=$2 and direction='in'", [t, g!.household_id]))!.n).toBe(1);
  });

  it("delivery, read and failure statuses update the message; failures read in plain words on the timeline", async () => {
    const r = await captureEnquiry(t, { studentName: "S", guardianName: "G", mobile: mobile(), branchId });
    if (!r.ok) throw new Error(r.error);
    await insert("messages", { tenant_id: t, household_id: r.householdId, enquiry_id: r.enquiryId, channel: "whatsapp", direction: "out", body: "x", status: "sent", provider_id: "wamid.OUT1" });
    await insert("messages", { tenant_id: t, household_id: r.householdId, enquiry_id: r.enquiryId, channel: "whatsapp", direction: "out", body: "y", status: "sent", provider_id: "wamid.OUT2" });
    await post(wa({ statuses: [{ id: "wamid.OUT1", status: "delivered" }, { id: "wamid.OUT1", status: "read" }, { id: "wamid.OUT2", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }] }));
    expect((await one("select status, read_at is not null as r from messages where provider_id='wamid.OUT1'"))).toMatchObject({ status: "read", r: true });
    expect((await one("select status, fail_reason from messages where provider_id='wamid.OUT2'"))).toMatchObject({ status: "failed", fail_reason: "This number cannot receive WhatsApp messages. Try SMS or call." });
    expect((await one("select content from activities where enquiry_id=$1 and content like 'Not delivered: This number%'", [r.enquiryId]))!.content).toMatch(/cannot receive WhatsApp/);
  });

  it("template review results update the template", async () => {
    await insert("templates", { tenant_id: t, channel: "whatsapp", name: "Review me", body: "Hi", meta_name: "review_me", meta_status: "PENDING", status: "pending" });
    await post({ entry: [{ changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_name: "review_me" } }] }] });
    expect(await one("select status, meta_status from templates where tenant_id=$1 and meta_name='review_me'", [t])).toMatchObject({ status: "approved", meta_status: "APPROVED" });
  });

  it("a lead ad becomes an enquiry with source and campaign; the same lead twice is imported once", async () => {
    const m = mobile();
    fakeMeta((url) => url.includes("LEAD77")
      ? { json: { platform: "ig", campaign_name: "Admissions Open", form_id: "F1", field_data: [{ name: "full_name", values: ["Arun Rao"] }, { name: "phone_number", values: ["+91" + m] }, { name: "student_name", values: ["Diya"] }, { name: "grade", values: ["Grade 1"] }] } }
      : { status: 404, json: { error: { message: "unknown" } } });
    const payload = { object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LEAD77", form_id: "F1", page_id: "P1" } }] }] };
    await post(payload);
    await post(payload);
    const e = await one("select e.id, e.grade, st.name as student from enquiries e join students st on st.id=e.student_id join guardians g on g.household_id=e.household_id where e.tenant_id=$1 and g.mobile=$2", [t, m]);
    expect(e).toMatchObject({ grade: "Grade 1", student: "Diya" });
    const touch = await one("select channel, source, campaign from source_touches where enquiry_id=$1", [e!.id]);
    expect(touch).toMatchObject({ channel: "Meta ads", source: "Instagram lead form", campaign: "Admissions Open" });
    expect((await one("select count(*)::int n from meta_leads where leadgen_id='LEAD77'"))!.n).toBe(1);
    expect(calls.filter((c) => c.url.includes("LEAD77")).length).toBe(1);
  });
});
