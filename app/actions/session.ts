"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { login, logout, requireCtx, startSession } from "@/lib/auth";
import { insert, one, q } from "@/lib/db";
import { flash, guard, str } from "@/lib/guard";

export async function loginAction(_: any, fd: FormData) {
  const dest = await login(str(fd, "email"), str(fd, "password"));
  if (dest === "locked") return { error: "Too many wrong attempts. Wait ten minutes and try again, or ask your admin to reset the password." };
  if (!dest) return { error: "That email and password do not match an active account." };
  redirect(dest);
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get("aed_session")?.value;
  const s = token ? await one("select impersonator_id from sessions where token=$1", [token]) : null;
  await logout();
  // Ending a support session returns the agent to the platform console.
  if (s?.impersonator_id) {
    await startSession(s.impersonator_id);
    redirect("/platform");
  }
  redirect("/login");
}

export async function setYear(fd: FormData) {
  (await cookies()).set("aed_year", str(fd, "year"), { path: "/", maxAge: 86400 * 90 });
  revalidatePath("/", "layout");
}

export async function setBranch(fd: FormData) {
  (await cookies()).set("aed_branch", str(fd, "branch"), { path: "/", maxAge: 86400 * 90 });
  revalidatePath("/", "layout");
}

export async function markNotificationsRead() {
  const ctx = await requireCtx();
  await q("update notifications set read=true where tenant_id=$1 and user_id=$2", [ctx.tenantId, ctx.user.id]);
  revalidatePath("/", "layout");
}

export async function raiseTicket(fd: FormData) {
  const ctx = await guard();
  await insert("tickets", { tenant_id: ctx.tenantId, user_id: ctx.user.id, kind: str(fd, "kind") || "ticket", subject: str(fd, "subject"), body: str(fd, "body") });
  await flash(str(fd, "kind") === "feature" ? "Feature request sent to the AutoED team." : "Ticket raised. Our support team will reply here.");
  revalidatePath("/admin/help");
}
