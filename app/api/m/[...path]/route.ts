// JSON API for the AutoED Android app. Authentication is the normal session token sent as
// "Authorization: Bearer <token>", so every role, branch and record rule of the web app applies.
// Writes go through the same server actions the web uses; nothing here duplicates business rules.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCtx, loginForToken, scopeSql, type Ctx } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { duplicatePreview, scoreBreakdown, TASK_TYPES } from "@/lib/core";
import { CHIPS, listLeads, pipeline, type SP } from "@/lib/leads";
import { canCreateLeads, canEditLeads, canMessage, canWorkTasks, has, leadScope, lvl, mask, seesSensitive } from "@/lib/perm";
import { isUuid } from "@/lib/util";
import { addNote, addTaskAction, bookVisit, completeTaskAction, logCall, sendMsg, visitUpdate } from "@/app/actions/record";
import { moveStage, quickAdd } from "@/app/actions/leads";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const fail = (error: string, status = 400) => json({ error }, status);

function capabilities(ctx: Ctx) {
  const p = ctx.perms;
  return {
    createLeads: canCreateLeads(p), editLeads: canEditLeads(p), message: canMessage(p), tasks: canWorkTasks(p),
    visits: has(p, "tasks"), reassign: ["F", "T"].includes(lvl(p, "reassign")), sensitive: seesSensitive(p), ownOnly: leadScope(p) === "own",
  };
}

async function me(ctx: Ctx) {
  return {
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    role: ctx.roleName, school: ctx.tenant.name, brand: ctx.tenant.branding?.color ?? "#0f6e6e",
    year: ctx.years.find((y) => y.id === ctx.yearId)?.name, branches: ctx.branches.map((b) => ({ id: b.id, name: b.name })),
    can: capabilities(ctx), readOnly: ctx.tenant.status === "suspended",
  };
}

async function options(ctx: Ctx) {
  const { stages } = await pipeline(ctx.tenantId);
  const s = ctx.tenant.settings;
  const [sources, templates] = await Promise.all([
    q("select id, name, channel from sources where tenant_id=$1 and active order by channel, name", [ctx.tenantId]),
    q("select id, name, channel, body from templates where tenant_id=$1 and status='approved' order by name", [ctx.tenantId]),
  ]);
  return {
    grades: s.grades ?? [], boards: s.boards ?? [], reasons: s.closure_reasons ?? [], sources, templates,
    branches: ctx.branches.map((b) => ({ id: b.id, name: b.name })),
    stages: stages.map((x) => ({ id: x.id, name: x.name, phase: x.phase_name, color: x.color, closed: x.is_closed, won: x.is_won, exempt: x.exempt_next_action, required: x.required_fields })),
    taskTypes: TASK_TYPES, chips: CHIPS,
  };
}

async function day(ctx: Ctx) {
  const t = ctx.tenantId;
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps);
  const y = ps.push(ctx.yearId);
  const [tasks, fresh, visits, unread, notes] = await Promise.all([
    q(`select k.id, k.title, k.type, k.due_at, k.priority, k.enquiry_id, e.household_id, st.name as student, g.mobile,
         (select count(*)::int from tasks o where o.enquiry_id=k.enquiry_id and o.status='open') as open_count, s.exempt_next_action as exempt
       from tasks k join enquiries e on e.id=k.enquiry_id join students st on st.id=e.student_id join stages s on s.id=e.stage_id
       left join lateral (select mobile from guardians g where g.household_id=e.household_id order by is_primary desc limit 1) g on true
       where k.tenant_id=$1 and k.owner_id=$2 and k.status='open' and k.due_at < now() + interval '36 hours' order by k.due_at limit 80`, [t, ctx.user.id]),
    q(`select e.id, e.household_id, e.created_at, e.grade, st.name as student, g.mobile from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id
       left join lateral (select mobile from guardians g where g.household_id=e.household_id order by is_primary desc limit 1) g on true
       where ${scope} and e.year_id=$${y} and p.key='enquiry' and e.first_response_at is null order by e.created_at limit 20`, ps),
    q(`select v.id, v.slot_at, v.status, v.checked_in_at, v.household_id, v.enquiry_id, st.name as student from visits v join enquiries e on e.id=v.enquiry_id join students st on st.id=e.student_id
       where ${scope} and v.status='scheduled' and (v.slot_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date order by v.slot_at`, ps.slice(0, y - 1)),
    one(`select count(distinct m.household_id)::int n from messages m join enquiries e on e.household_id=m.household_id where ${scope} and m.direction='in' and not m.read`, ps.slice(0, y - 1)),
    one("select count(*)::int n from notifications where tenant_id=$1 and user_id=$2 and not read", [t, ctx.user.id]),
  ]);
  return { tasks, fresh, visits, unreadReplies: unread!.n, unreadNotifications: notes!.n, slaMinutes: Number(ctx.tenant.settings.first_response_mins ?? 30) };
}

async function household(ctx: Ctx, id: string, enquiryId: string | null) {
  const ps: any[] = [];
  const where = scopeSql(ctx, ps, "e", false);
  ps.push(id);
  const enquiries = await q(
    `select e.id, e.stage_id, e.grade, e.board, e.score, e.temperature, e.reenquired, e.closure_reason, e.application_no, e.created_at, e.owner_id, e.custom,
       st.name as student, st.dob::text as dob, s.name as stage, s.color, s.is_closed, s.is_won, s.exempt_next_action, u.name as owner, b.name as branch, y.name as year
     from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join users u on u.id=e.owner_id join branches b on b.id=e.branch_id join academic_years y on y.id=e.year_id
     where ${where} and e.household_id=$${ps.length} order by y.position desc, e.created_at`, ps);
  if (!enquiries.length) return null;
  const e = enquiries.find((x) => x.id === enquiryId) ?? enquiries[0];
  const t = ctx.tenantId;
  const [hh, guardians, acts, tasks, visits, score] = await Promise.all([
    one("select id, locality, address, sibling_in_school from households where tenant_id=$1 and id=$2", [t, id]),
    q("select name, relation, mobile, email, consent from guardians where tenant_id=$1 and household_id=$2 order by is_primary desc", [t, id]),
    q("select a.id, a.type, a.outcome, a.content, a.meta, a.created_at, u.name as actor from activities a left join users u on u.id=a.actor_id where a.tenant_id=$1 and a.household_id=$2 order by a.created_at desc limit 60", [t, id]),
    q("select k.id, k.title, k.type, k.due_at, k.status, k.outcome, k.priority, u.name as owner from tasks k join users u on u.id=k.owner_id where k.tenant_id=$1 and k.enquiry_id=$2 order by (k.status='open') desc, k.due_at desc limit 15", [t, e.id]),
    q("select v.id, v.slot_at, v.status, v.type, v.checked_in_at, v.outcome, u.name as host from visits v left join users u on u.id=v.host_id where v.tenant_id=$1 and v.enquiry_id=$2 order by v.slot_at desc", [t, e.id]),
    scoreBreakdown(t, e.id),
  ]);
  const sens = seesSensitive(ctx.perms);
  const openTasks = tasks.filter((k) => k.status === "open");
  return {
    household: hh, guardians, current: e.id,
    enquiries: enquiries.map((x) => ({ ...x, dob: sens ? x.dob : mask(x.dob) })),
    timeline: acts.map((a) => ({ id: a.id, type: a.type, outcome: a.outcome, content: a.content, direction: a.meta?.direction ?? null, failed: a.meta?.status === "failed", at: a.created_at, actor: a.actor })),
    tasks, visits, score,
    needsNextAction: !e.is_closed && !e.is_won && !e.exempt_next_action && openTasks.length === 0,
  };
}

/** Runs one web server action with form fields from the app and returns its result in JSON. */
async function action(body: Record<string, any>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null && k !== "kind") fd.set(k, String(v));
  const jar = await cookies();
  jar.delete("aed_flash");
  let result: { ok: boolean; error?: string; missing?: string[]; [k: string]: any } = { ok: true };
  switch (body.kind) {
    case "call": await logCall(fd); break;
    case "note": await addNote(fd); break;
    case "task_add": await addTaskAction(fd); break;
    case "task_done": result = await completeTaskAction(null, fd); break;
    case "message": await sendMsg(fd); break;
    case "visit_book": await bookVisit(fd); break;
    case "visit": await visitUpdate(fd); break;
    case "stage": result = await moveStage(String(body.enquiryId), String(body.stageId), { closure_reason: body.closure_reason || undefined }); break;
    case "quick_add": result = (await quickAdd(null, fd)) as any; break;
    default: return { ok: false, error: "Unknown action." };
  }
  // Actions report outcomes such as "Not delivered: ..." through the flash message the web shows as a toast.
  const flash = jar.get("aed_flash")?.value;
  if (flash) {
    try {
      const f = JSON.parse(decodeURIComponent(flash));
      result = { ...result, message: f.message, ...(f.kind === "error" ? { ok: false, error: result.error ?? f.message } : {}) };
    } catch { /* ignore */ }
  }
  return result;
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [route, arg] = (await params).path;
  const ctx = await getCtx();
  if (!ctx) return fail("Please sign in again.", 401);
  const u = new URL(req.url);
  switch (route) {
    case "me": return json(await me(ctx));
    case "options": return json(await options(ctx));
    case "day": return json(await day(ctx));
    case "leads": {
      if (!has(ctx.perms, "leads")) return fail("Your role cannot see leads.", 403);
      const sp: SP = Object.fromEntries([...u.searchParams.entries()].filter(([k]) => ["q", "chip", "phase", "stage", "grade", "temp"].includes(k)));
      const page = Math.max(1, Number(u.searchParams.get("page") ?? 1));
      const rows = await listLeads(ctx, { ...sp, sort: sp.q ? "name" : "created" }, 30, (page - 1) * 30);
      return json({ leads: rows.map((r) => ({ id: r.id, householdId: r.household_id, student: r.student, guardian: r.guardian, mobile: r.mobile, grade: r.grade, stage: r.stage, color: r.color, temperature: r.temperature, score: r.score, owner: r.owner, next: r.next_due, nextTitle: r.next_title, reenquired: r.reenquired })), page });
    }
    case "household": {
      if (!isUuid(arg)) return fail("Not found.", 404);
      const h = await household(ctx, arg, isUuid(u.searchParams.get("e")) ? u.searchParams.get("e") : null);
      return h ? json(h) : fail("This family is not available to you.", 404);
    }
    case "dedupe": return json({ match: await duplicatePreview(ctx.tenantId, { mobile: u.searchParams.get("mobile") ?? "" }) });
    case "notifications": {
      const rows = await q("select id, category, title, link, read, created_at from notifications where tenant_id=$1 and user_id=$2 order by created_at desc limit 50", [ctx.tenantId, ctx.user.id]);
      return json({ notifications: rows });
    }
    default: return fail("Not found.", 404);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [route] = (await params).path;
  const body = await req.json().catch(() => ({}));
  if (route === "login") {
    const r = await loginForToken(String(body.email ?? ""), String(body.password ?? ""), String(body.device ?? ""), String(body.code ?? ""));
    return "token" in r ? json(r) : json({ error: r.error, need2fa: r.need2fa ?? false }, r.status);
  }
  const ctx = await getCtx();
  if (!ctx) return fail("Please sign in again.", 401);
  switch (route) {
    case "logout": {
      const h = req.headers.get("authorization")?.slice(7);
      if (h) await q("delete from sessions where token=$1", [h]);
      if (body.pushToken) await q("delete from push_tokens where token=$1", [String(body.pushToken)]);
      return json({ ok: true });
    }
    case "push": {
      const token = String(body.token ?? "");
      if (!/^ExponentPushToken\[[\w-]+\]$/.test(token)) return fail("Not a push token.");
      await q("insert into push_tokens (token, user_id, platform) values ($1,$2,$3) on conflict (token) do update set user_id=excluded.user_id, updated_at=now()", [token, ctx.user.id, String(body.platform ?? "android")]);
      return json({ ok: true });
    }
    case "notifications-read": {
      await q("update notifications set read=true where tenant_id=$1 and user_id=$2", [ctx.tenantId, ctx.user.id]);
      return json({ ok: true });
    }
    case "action": {
      if (ctx.tenant.status === "suspended") return fail("This account is read-only.", 403);
      try {
        const r = await action(body);
        return json(r, r.ok ? 200 : 422);
      } catch (e: any) {
        return fail(e?.message ?? "That did not work.", 422);
      }
    }
    default: return fail("Not found.", 404);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}
