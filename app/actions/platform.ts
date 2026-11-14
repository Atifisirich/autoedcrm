"use server";
// Internal back office (PRD section 10). Every action is limited by internal role and written to the audit log.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatform, startSession } from "@/lib/auth";
import { insert, one, q } from "@/lib/db";
import { audit } from "@/lib/core";
import { flash, str } from "@/lib/guard";
import { createTenant, PACKS } from "@/lib/seed";

async function staff(...roles: string[]) {
  const u = await requirePlatform();
  if (roles.length && !roles.includes(u.platform_role)) throw new Error("Your internal role does not allow this.");
  return u;
}
const who = (u: any) => ({ id: u.id, name: u.name });

export async function createTenantAction(fd: FormData) {
  const u = await staff("super_admin", "implementation");
  const subdomain = str(fd, "subdomain").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const email = str(fd, "adminEmail").toLowerCase();
  if (!str(fd, "name") || subdomain.length < 3) return flash("Give the organisation a name and a sub-domain of at least three letters.", "error");
  if (await one("select 1 from tenants where subdomain=$1", [subdomain])) return flash("That sub-domain is taken.", "error");
  if (await one("select 1 from users where lower(email)=$1", [email])) return flash("That admin email already has an account.", "error");
  const password = "Welcome-" + Math.random().toString(36).slice(2, 8);
  const { tenant } = await createTenant({ name: str(fd, "name"), subdomain, plan: str(fd, "plan") || "growth", pack: PACKS[str(fd, "pack")] ? str(fd, "pack") : "cbse_day", region: str(fd, "region") || "in-south", adminName: str(fd, "adminName") || "School admin", adminEmail: email, adminPassword: password, branchName: str(fd, "branchName") || "Main campus", city: str(fd, "city") });
  await audit(null, who(u), "platform", "tenant", tenant.id, `Created tenant ${tenant.name} (${subdomain}) on ${tenant.plan}`);
  await flash(`Tenant created with its starter pack. First admin: ${email}, temporary password: ${password}`);
  redirect("/platform/" + tenant.id);
}

export async function tenantAction(fd: FormData) {
  const id = str(fd, "id"), what = str(fd, "what");
  const t = await one("select * from tenants where id=$1", [id]);
  if (!t) return;
  if (what === "status") {
    const u = await staff("super_admin", "finance");
    const status = str(fd, "status");
    if (!["trial", "active", "suspended", "cancelled", "archived"].includes(status)) return;
    await q("update tenants set status=$2 where id=$1", [id, status]);
    if (["cancelled", "archived"].includes(status)) await q("delete from sessions where user_id in (select id from users where tenant_id=$1)", [id]);
    await audit(id, who(u), "platform", "tenant", id, `AutoED changed account status from ${t.status} to ${status}`);
    await flash(`Status set to ${status}.` + (status === "suspended" ? " The school can read and export but not change data." : ""));
  } else if (what === "plan") {
    const u = await staff("super_admin", "finance");
    await q("update tenants set plan=$2 where id=$1", [id, str(fd, "plan")]);
    await audit(id, who(u), "platform", "tenant", id, `AutoED changed plan from ${t.plan} to ${str(fd, "plan")}`);
  } else if (what === "credits") {
    const u = await staff("super_admin", "finance");
    const amount = Number(str(fd, "amount"));
    if (!(amount > 0)) return flash("Enter the credit amount.", "error");
    await q("update tenants set wallet_balance=wallet_balance+$2 where id=$1", [id, amount]);
    await insert("wallet_ledger", { tenant_id: id, type: "credit", category: "recharge", amount, note: str(fd, "note") || "Recharge recorded by AutoED finance" });
    await audit(id, who(u), "platform", "wallet", id, `AutoED added ₹${amount} of credits`);
    await flash("Credits added to the wallet.");
  } else if (what === "flag") {
    const u = await staff("super_admin");
    const flags = { ...t.flags, [str(fd, "flag")]: fd.get("on") === "1" };
    await q("update tenants set flags=$2 where id=$1", [id, flags]);
    await audit(id, who(u), "platform", "flag", id, `AutoED turned ${str(fd, "flag")} ${fd.get("on") === "1" ? "on" : "off"}`);
  } else if (what === "onboarding") {
    const u = await staff("super_admin", "implementation");
    const onboarding = { ...t.onboarding, [str(fd, "item")]: fd.get("on") === "1" };
    await q("update tenants set onboarding=$2, go_live_date=$3 where id=$1", [id, onboarding, str(fd, "go_live") || t.go_live_date]);
    await audit(null, who(u), "platform", "onboarding", id, `Onboarding item ${str(fd, "item")} for ${t.name}`);
  }
  revalidatePath("/platform", "layout");
}

export async function replyTicket(fd: FormData) {
  const u = await staff("super_admin", "support", "implementation");
  await q("update tickets set reply=$2, status=$3 where id=$1", [str(fd, "id"), str(fd, "reply"), str(fd, "close") === "1" ? "closed" : "open"]);
  await audit(null, who(u), "platform", "ticket", str(fd, "id"), "Replied to a ticket");
  revalidatePath("/platform", "layout");
}

/** PS-02: support asks; only the school's admin can approve, for a fixed time. */
export async function requestAccess(fd: FormData) {
  const u = await staff("super_admin", "support", "implementation");
  const id = str(fd, "id");
  if (!str(fd, "reason")) return flash("Say why you need access; the school admin sees this.", "error");
  await insert("support_access", { tenant_id: id, requested_by: u.id, reason: str(fd, "reason") });
  for (const a of await q("select u.id from users u join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active' and r.permissions->>'admin'='F'", [id]))
    await insert("notifications", { tenant_id: id, user_id: a.id, category: "approval", title: `AutoED support asks for access: ${str(fd, "reason").slice(0, 60)}`, link: "/admin/help" });
  await audit(id, who(u), "support", "support_access", null, `AutoED support (${u.name}) requested access: ${str(fd, "reason")}`);
  await flash("Request sent to the school admin.");
  revalidatePath("/platform", "layout");
}

export async function impersonate(fd: FormData) {
  const u = await staff("super_admin", "support", "implementation");
  const id = str(fd, "id");
  const grant = await one("select * from support_access where tenant_id=$1 and requested_by=$2 and status='approved' and expires_at>now() order by expires_at desc limit 1", [id, u.id]);
  if (!grant) return flash("No approved, unexpired access for you on this tenant. Send a request first.", "error");
  const target = await one("select id, name from users where tenant_id=$1 and id=$2 and status='active'", [id, str(fd, "userId")]);
  if (!target) return flash("Choose a user to view as.", "error");
  const hours = Math.max(0.1, (new Date(grant.expires_at).getTime() - Date.now()) / 3600e3);
  await audit(id, who(u), "support", "user", target.id, `AutoED support (${u.name}) started viewing as ${target.name}`);
  await startSession(target.id, u.id, hours);
  redirect("/");
}
