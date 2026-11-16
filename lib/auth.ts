import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { one, q, type Row } from "./db";
import { type Cap, type Perms, has, leadScope } from "./perm";

const COOKIE = "aed_session";

export type Ctx = {
  user: Row;
  tenant: Row;
  tenantId: string;
  perms: Perms;
  roleName: string;
  /** Branches this user may see. Empty means every branch in the organisation. */
  branchIds: string[];
  years: Row[];
  branches: Row[];
  yearId: string;
  /** Branch picked in the header, or null for all permitted branches. */
  branchId: string | null;
  impersonatorId: string | null;
};

const fails = ((globalThis as any).__aedFails ??= new Map<string, { n: number; t: number }>()) as Map<string, { n: number; t: number }>;

/** Returns the landing path, null for bad credentials, or "locked" after five failures in ten minutes. */
export async function login(email: string, password: string): Promise<string | null> {
  const key = email.trim().toLowerCase();
  const f = fails.get(key);
  if (f && f.n >= 5 && Date.now() - f.t < 10 * 60000) return "locked";
  const u = await one("select * from users where lower(email)=$1 and status='active'", [key]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    fails.set(key, { n: f && Date.now() - f.t < 10 * 60000 ? f.n + 1 : 1, t: Date.now() });
    return null;
  }
  fails.delete(key);
  await startSession(u.id);
  await q("update users set last_login=now() where id=$1", [u.id]);
  return u.platform_role ? "/platform" : "/";
}

/**
 * Mobile app sign-in: same checks and lockout as the web, but returns a bearer token instead of
 * setting a cookie. Platform staff cannot use the school app.
 */
export async function loginForToken(email: string, password: string, device: string): Promise<{ token: string } | { error: string; status: number }> {
  const key = email.trim().toLowerCase();
  const f = fails.get(key);
  if (f && f.n >= 5 && Date.now() - f.t < 10 * 60000) return { error: "Too many wrong attempts. Wait ten minutes and try again.", status: 429 };
  const u = await one("select * from users where lower(email)=$1 and status='active'", [key]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    fails.set(key, { n: f && Date.now() - f.t < 10 * 60000 ? f.n + 1 : 1, t: Date.now() });
    return { error: "That email and password do not match an active account.", status: 401 };
  }
  if (!u.tenant_id) return { error: "AutoED staff accounts cannot use the school app.", status: 403 };
  fails.delete(key);
  const token = crypto.randomBytes(32).toString("hex");
  await q("insert into sessions (token,user_id,expires_at,device) values ($1,$2, now() + interval '30 days', $3)", [token, u.id, device.slice(0, 120) || "Mobile app"]);
  await q("update users set last_login=now() where id=$1", [u.id]);
  return { token };
}

export async function startSession(userId: string, impersonatorId?: string, hours = 24 * 7) {
  const token = crypto.randomBytes(32).toString("hex");
  await q("insert into sessions (token,user_id,impersonator_id,expires_at) values ($1,$2,$3, now() + ($4 || ' hours')::interval)", [token, userId, impersonatorId ?? null, String(hours)]);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: hours * 3600 });
}

export async function logout() {
  const jar = await cookies();
  const token = await sessionToken();
  if (token) await q("delete from sessions where token=$1", [token]);
  jar.delete(COOKIE);
}

/** Browser sessions use the cookie; the mobile app sends the same token as "Authorization: Bearer". */
async function sessionToken(): Promise<string | undefined> {
  const fromCookie = (await cookies()).get(COOKIE)?.value;
  if (fromCookie) return fromCookie;
  const h = (await headers()).get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

const sessionUser = cache(async () => {
  const token = await sessionToken();
  if (!token) return null;
  const s = await one("select s.impersonator_id, u.* from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>now() and u.status='active'", [token]);
  return s;
});

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const user = await sessionUser();
  if (!user || !user.tenant_id) return null;
  const [tenant, role, years, allBranches] = await Promise.all([
    one("select * from tenants where id=$1", [user.tenant_id]),
    one("select * from roles where id=$1", [user.role_id]),
    q("select * from academic_years where tenant_id=$1 order by position", [user.tenant_id]),
    q("select * from branches where tenant_id=$1 and active order by name", [user.tenant_id]),
  ]);
  if (!tenant) return null;
  const perms: Perms = role?.permissions ?? {};
  const own: string[] = user.branch_ids ?? [];
  const wide = leadScope(perms) === "all" || own.length === 0;
  const branches = wide ? allBranches : allBranches.filter((b) => own.includes(b.id));
  const jar = await cookies();
  const y = jar.get("aed_year")?.value;
  const b = jar.get("aed_branch")?.value;
  const yearId = years.find((x) => x.id === y)?.id ?? years.find((x) => x.is_default)?.id ?? years[0]?.id;
  const branchId = branches.find((x) => x.id === b)?.id ?? (branches.length === 1 ? branches[0].id : null);
  return { user, tenant, tenantId: tenant.id, perms, roleName: role?.name ?? "", branchIds: wide ? [] : own, years, branches, yearId, branchId, impersonatorId: user.impersonator_id ?? null };
});

export async function requireCtx(cap?: Cap): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) {
    const u = await sessionUser();
    redirect(u?.platform_role ? "/platform" : "/login");
  }
  if (ctx.tenant.status === "cancelled" || ctx.tenant.status === "archived") redirect("/login?e=closed");
  if (cap && !has(ctx.perms, cap)) redirect("/?denied=" + cap);
  return ctx;
}

export async function requirePlatform(): Promise<Row> {
  const u = await sessionUser();
  if (!u || !u.platform_role || u.impersonator_id) redirect("/login");
  return u;
}

/** Suspended tenants are read-only (PT-02). */
export function assertWritable(ctx: Ctx) {
  if (ctx.tenant.status === "suspended") throw new Error("This account is suspended and is read-only. Contact AutoED support.");
}

/**
 * SQL fragment restricting enquiries (alias e) to what this user may see:
 * tenant, record scope from the role, and the branch picked in the header.
 */
export function scopeSql(ctx: Ctx, params: any[], alias = "e", useHeaderBranch = true): string {
  params.push(ctx.tenantId);
  let sql = `${alias}.tenant_id=$${params.length}`;
  const scope = leadScope(ctx.perms);
  if (scope === "none") sql += " and false";
  if (scope === "own") {
    params.push(ctx.user.id);
    sql += ` and ${alias}.owner_id=$${params.length}`;
  }
  if (ctx.branchIds.length) {
    params.push(ctx.branchIds);
    sql += ` and ${alias}.branch_id::text in (select jsonb_array_elements_text($${params.length}::jsonb))`;
  }
  if (useHeaderBranch && ctx.branchId) {
    params.push(ctx.branchId);
    sql += ` and ${alias}.branch_id=$${params.length}`;
  }
  return sql;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 8);
