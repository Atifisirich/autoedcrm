"use server";
// Parent-facing actions. No session: each is authorised by an unguessable form slug or record token.
import { revalidatePath } from "next/cache";
import { one, q } from "@/lib/db";
import { captureEnquiry, logActivity } from "@/lib/core";
import { APPLICATION_SECTIONS, saveApplication, settlePayment, startApplication } from "@/lib/admissions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function submitForm(_: any, fd: FormData): Promise<{ ok: boolean; error?: string; message?: string }> {
  // Spam protection: bots fill the hidden field, and no person submits within two seconds of load.
  if (str(fd, "website") || Date.now() - Number(str(fd, "loaded")) < 2000) return { ok: true, message: "Thank you." };
  const form = await one("select f.*, t.status as tenant_status from forms f join tenants t on t.id=f.tenant_id where f.slug=$1 and f.active", [str(fd, "slug")]);
  if (!form || !["active", "trial"].includes(form.tenant_status)) return { ok: false, error: "This form is no longer accepting enquiries. Please contact the school." };
  if (fd.get("consent") !== "on") return { ok: false, error: "Please tick the box to let the school contact you." };
  const branch = form.branch_id ?? str(fd, "branch") ?? "";
  const b = await one("select id from branches where tenant_id=$1 and (id::text=$2 or $2='') and active order by name limit 1", [form.tenant_id, branch]);
  if (!b) return { ok: false, error: "Please choose a campus." };
  let utm: Record<string, string> = {};
  try { utm = JSON.parse(str(fd, "utm") || "{}"); } catch { /* ignore malformed tracking data */ }
  const res = await captureEnquiry(form.tenant_id, {
    studentName: str(fd, "student_name"), guardianName: str(fd, "guardian_name"), mobile: str(fd, "mobile"), email: str(fd, "email") || undefined, grade: str(fd, "grade") || undefined, dob: str(fd, "dob") || undefined,
    locality: str(fd, "locality") || undefined, heardAbout: str(fd, "heard_about") || undefined, branchId: b.id, sourceId: form.source_id ?? undefined, channel: "Website", source: form.name,
    campaign: utm.utm_campaign, utm, consent: { source: `Web form: ${form.name}`, wording: "form-v1" },
  });
  if (!res.ok) return res;
  await q("update forms set submissions=submissions+1 where id=$1", [form.id]);
  return { ok: true, message: form.thank_you };
}

async function byToken(token: string) {
  return one("select e.id, e.tenant_id, e.household_id from enquiries e join tenants t on t.id=e.tenant_id where e.public_token=$1 and t.status in ('active','trial')", [token]);
}

export async function parentApplication(_: any, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const e = await byToken(str(fd, "token"));
  if (!e) return { ok: false, error: "This link is not valid any more. Please ask the school for a new one." };
  await startApplication(e.tenant_id, e.id, null);
  const answers = Object.fromEntries(APPLICATION_SECTIONS.flatMap((s) => s.fields).filter((f) => fd.has(f.key)).map((f) => [f.key, str(fd, f.key)]));
  const res = await saveApplication(e.tenant_id, e.id, answers, { submit: fd.get("submit") === "1", declaration: fd.get("declaration") === "on" }, null);
  // Re-render so the parent sees the saved answers, or the submitted state, straight away.
  if (res.ok) revalidatePath("/apply/" + str(fd, "token"));
  return res;
}

/**
 * Demo checkout. Only enabled on the embedded demo database or when DEMO_PAYMENTS=1, because it
 * lets the payer declare the result. A real gateway calls settlePayment from its verified webhook.
 */
export async function demoPay(fd: FormData) {
  if (process.env.DATABASE_URL && process.env.DEMO_PAYMENTS !== "1") return;
  const p = await one("select p.id, p.tenant_id, p.enquiry_id, p.status from payments p where p.token=$1", [str(fd, "token")]);
  if (!p || p.status === "paid") return;
  await settlePayment(p.tenant_id, p.id, fd.get("result") === "success", null, "DEMO-" + Date.now());
  revalidatePath("/pay/" + str(fd, "token"));
}

export async function parentUpload(fd: FormData) {
  const e = await byToken(str(fd, "token"));
  const file = fd.get("file") as File | null;
  if (!e || !file?.name) return;
  await q("update documents set status='uploaded', file_name=$3, reject_reason=null, updated_at=now() where tenant_id=$1 and id=$2 and enquiry_id=$4 and status in ('pending','rejected')", [e.tenant_id, str(fd, "docId"), file.name, e.id]);
  await logActivity(e.tenant_id, { householdId: e.household_id, enquiryId: e.id, type: "document", content: `Parent sent a document (${file.name}).` });
  revalidatePath("/apply/" + str(fd, "token"));
}
