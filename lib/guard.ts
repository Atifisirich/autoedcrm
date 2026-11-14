import { cookies } from "next/headers";
import { assertWritable, requireCtx, scopeSql, type Ctx } from "./auth";
import { one, type Row } from "./db";
import type { Actor } from "./core";
import { has, type Cap } from "./perm";

/** Entry point for every staff server action: signed in, tenant writable, capability present. */
export async function guard(cap?: Cap): Promise<Ctx> {
  const ctx = await requireCtx();
  assertWritable(ctx);
  if (cap && !has(ctx.perms, cap)) throw new Error("Your role does not allow this action.");
  return ctx;
}
export const actorOf = (ctx: Ctx): Actor => ({ id: ctx.user.id, name: ctx.user.name });

/** Loads an enquiry only if the user's record scope covers it. */
export async function findEnquiry(ctx: Ctx, id: string): Promise<Row> {
  const params: any[] = [];
  const where = scopeSql(ctx, params, "e", false);
  params.push(id);
  const e = await one("select e.* from enquiries e where " + where + " and e.id=$" + params.length, params);
  if (!e) throw new Error("This record is not available to you.");
  return e;
}

/** One-line confirmation shown as a toast after the next render. */
export async function flash(message: string, kind: "ok" | "error" = "ok") {
  (await cookies()).set("aed_flash", encodeURIComponent(JSON.stringify({ message, kind })), { path: "/", maxAge: 20 });
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
