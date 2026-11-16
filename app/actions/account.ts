"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/core";
import { flash, str } from "@/lib/guard";
import { decrypt, encrypt } from "@/lib/secrets";
import { newSecret, verifyCode } from "@/lib/totp";

export async function start2fa() {
  const ctx = await requireCtx();
  await q("update users set totp_pending_enc=$2 where id=$1", [ctx.user.id, encrypt(newSecret())]);
  revalidatePath("/account");
}

export async function confirm2fa(fd: FormData) {
  const ctx = await requireCtx();
  const pending = ctx.user.totp_pending_enc ? decrypt(ctx.user.totp_pending_enc) : null;
  if (!pending) return flash("Start again: the setup expired.", "error");
  if (!verifyCode(pending, str(fd, "code"))) return flash("That code is not right. Check the time on your phone and try the newest code.", "error");
  await q("update users set totp_secret_enc=totp_pending_enc, totp_pending_enc=null, totp_enabled=true where id=$1", [ctx.user.id]);
  // Other signed-in devices must sign in again with the code.
  await q("delete from sessions where user_id=$1 and token<>$2", [ctx.user.id, (await cookies()).get("aed_session")?.value ?? ""]);
  await audit(ctx.tenantId, { id: ctx.user.id, name: ctx.user.name }, "permission", "user", ctx.user.id, "Turned on two-factor sign-in");
  await flash("Two-factor sign-in is on. You will be asked for a code each time you sign in.");
  revalidatePath("/", "layout");
}

export async function disable2fa(fd: FormData) {
  const ctx = await requireCtx();
  if (ctx.tenant.settings.require_2fa_admins && ctx.user.totp_enabled) {
    const { adminSections } = await import("@/lib/perm");
    if (adminSections(ctx.perms).some((s) => s !== "help")) return flash("Your school requires two-factor sign-in for admins, so it cannot be turned off.", "error");
  }
  const secret = ctx.user.totp_secret_enc ? decrypt(ctx.user.totp_secret_enc) : null;
  if (!secret || !verifyCode(secret, str(fd, "code"))) return flash("Enter a current code to turn two-factor sign-in off.", "error");
  await q("update users set totp_secret_enc=null, totp_pending_enc=null, totp_enabled=false where id=$1", [ctx.user.id]);
  await audit(ctx.tenantId, { id: ctx.user.id, name: ctx.user.name }, "permission", "user", ctx.user.id, "Turned off two-factor sign-in");
  await flash("Two-factor sign-in is off.");
  revalidatePath("/", "layout");
}
