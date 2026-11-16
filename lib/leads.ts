// One place that turns the workspace filters into SQL, so the list, Kanban, bulk actions,
// exports and report drill-downs always mean the same set of records.
import { scopeSql, type Ctx } from "./auth";
import { q, type Row } from "./db";
import { lvl } from "./perm";

export type SP = Record<string, string | undefined>;

export const CHIPS: [string, string][] = [
  ["my", "My leads"], ["due_today", "Due today"], ["overdue", "Overdue"], ["untouched", "Untouched"], ["hot", "Hot"], ["visit_week", "Visit this week"], ["reenquired", "Re-enquired"], ["no_next", "No next action"],
];

export function leadFilter(ctx: Ctx, sp: SP): { where: string; params: any[] } {
  const params: any[] = [];
  let where = scopeSql(ctx, params);
  const add = (sql: string, v: any) => { params.push(v); where += " and " + sql.replace("?", "$" + params.length); };
  const allYears = sp.year === "all" && ["F", "T"].includes(lvl(ctx.perms, "leads"));
  if (!allYears) add("e.year_id=?", ctx.yearId);
  if (sp.stage) add("e.stage_id=?", sp.stage);
  if (sp.phase) add("p.key=?", sp.phase);
  if (sp.owner) add("e.owner_id=?", sp.owner);
  if (sp.grade) add("e.grade=?", sp.grade);
  if (sp.temp) add("e.temperature=?", sp.temp);
  if (sp.branch) add("e.branch_id=?", sp.branch);
  if (sp.channel) add("exists (select 1 from source_touches t where t.enquiry_id=e.id and t.channel=?)", sp.channel);
  if (sp.source) add("exists (select 1 from source_touches t where t.enquiry_id=e.id and t.source=?)", sp.source);
  if (sp.reason) add("e.closure_reason=?", sp.reason);
  if (sp.tag) add("e.tags @> to_jsonb(?::text)", sp.tag);
  if (sp.from) add("e.created_at >= ?::date", sp.from);
  if (sp.to) add("e.created_at < ?::date + 1", sp.to);
  if (sp.minscore) add("e.score >= ?", Number(sp.minscore) || 0);
  if (sp.cf && sp.cfv) { params.push(sp.cf); where += ` and e.custom->>$${params.length}`; params.push(sp.cfv); where += `=$${params.length}`; }
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith("cf_") || !v || !/^cf_[a-z0-9_]{1,60}$/.test(k)) continue;
    params.push(k.slice(3)); where += ` and e.custom->>$${params.length}`; params.push(v); where += `=$${params.length}`;
  }
  if (sp.open === "1") where += " and not s.is_closed and not s.is_won";
  if (sp.won === "1") where += " and s.is_won";
  if (sp.closed === "1") where += " and s.is_closed";
  if (sp.visited === "1") where += " and exists (select 1 from visits v where v.enquiry_id=e.id and v.status='done')";
  if (sp.applied === "1") where += " and exists (select 1 from applications a where a.enquiry_id=e.id and a.status='submitted')";
  if (sp.ids) add("e.id::text in (select jsonb_array_elements_text(?::jsonb))", sp.ids.split(",").filter(Boolean));
  if (sp.q) {
    params.push("%" + sp.q.toLowerCase() + "%");
    const n = "$" + params.length;
    where += ` and (lower(st.name) like ${n} or e.application_no ilike ${n} or exists (select 1 from guardians g where g.household_id=e.household_id and (lower(g.name) like ${n} or g.mobile like ${n} or lower(g.email) like ${n})))`;
  }
  for (const chip of (sp.chip ?? "").split(",").filter(Boolean)) {
    if (chip === "my") add("e.owner_id=?", ctx.user.id);
    if (chip === "hot") where += " and e.temperature='Hot' and not s.is_closed and not s.is_won";
    if (chip === "reenquired") where += " and e.reenquired";
    if (chip === "untouched") where += " and e.first_response_at is null and p.key='enquiry'";
    if (chip === "overdue") where += " and exists (select 1 from tasks k where k.enquiry_id=e.id and k.status='open' and k.due_at<now())";
    if (chip === "due_today") where += " and exists (select 1 from tasks k where k.enquiry_id=e.id and k.status='open' and (k.due_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date)";
    if (chip === "visit_week") where += " and exists (select 1 from visits v where v.enquiry_id=e.id and v.status='scheduled' and v.slot_at between now() - interval '1 day' and now() + interval '7 days')";
    if (chip === "no_next") where += " and not s.is_closed and not s.is_won and not s.exempt_next_action and not exists (select 1 from tasks k where k.enquiry_id=e.id and k.status='open')";
  }
  return { where, params };
}

const FROM = `from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id join students st on st.id=e.student_id
  join users u on u.id=e.owner_id join branches b on b.id=e.branch_id`;

export async function listLeads(ctx: Ctx, sp: SP, limit = 100, offset = 0): Promise<Row[]> {
  const { where, params } = leadFilter(ctx, sp);
  const sort = { score: "e.score desc", created: "e.created_at desc", next: "next_due asc nulls last", name: "st.name asc", stage: "p.position, s.position" }[sp.sort ?? ""] ?? "e.created_at desc";
  params.push(limit, offset);
  return q(
    `select e.id, e.household_id, e.grade, e.board, e.score, e.temperature, e.reenquired, e.created_at, e.last_activity_at, e.first_response_at, e.stage_entered_at, e.application_no, e.tags, e.custom, e.closure_reason, e.owner_id, e.stage_id,
       st.name as student, s.name as stage, s.color, p.key as phase_key, p.name as phase, u.name as owner, b.name as branch,
       g.name as guardian, g.mobile,
       (select min(k.due_at) from tasks k where k.enquiry_id=e.id and k.status='open') as next_due,
       (select k.title from tasks k where k.enquiry_id=e.id and k.status='open' order by k.due_at limit 1) as next_title,
       (select t.source from source_touches t where t.enquiry_id=e.id order by t.created_at limit 1) as source,
       (select count(*)::int from enquiries x where x.household_id=e.household_id) as family_size
     ${FROM} left join lateral (select name, mobile from guardians g where g.household_id=e.household_id order by is_primary desc limit 1) g on true
     where ${where} order by ${sort} limit $${params.length - 1} offset $${params.length}`,
    params,
  );
}

export async function countLeads(ctx: Ctx, sp: SP): Promise<number> {
  const { where, params } = leadFilter(ctx, sp);
  return (await q(`select count(*)::int n ${FROM} where ${where}`, params))[0].n;
}

export async function leadIds(ctx: Ctx, sp: SP): Promise<string[]> {
  const { where, params } = leadFilter(ctx, sp);
  return (await q(`select e.id ${FROM} where ${where} limit 5000`, params)).map((r) => r.id);
}

/** Counts per stage for the tabs, ignoring any stage / phase filter already applied. */
export async function stageCounts(ctx: Ctx, sp: SP): Promise<Record<string, number>> {
  const { where, params } = leadFilter(ctx, { ...sp, stage: undefined, phase: undefined });
  const rows = await q(`select e.stage_id, count(*)::int n ${FROM} where ${where} group by e.stage_id`, params);
  return Object.fromEntries(rows.map((r) => [r.stage_id, r.n]));
}

export async function pipeline(tenantId: string): Promise<{ phases: Row[]; stages: Row[] }> {
  const phases = await q("select * from phases where tenant_id=$1 order by position", [tenantId]);
  const stages = await q("select s.*, p.key as phase_key, p.name as phase_name, p.position as ppos from stages s join phases p on p.id=s.phase_id where s.tenant_id=$1 and s.active order by p.position, s.position", [tenantId]);
  return { phases, stages };
}

/** Builds a query string from the current filters with some keys changed or removed. */
export function qs(sp: SP, patch: SP = {}): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) out.set(k, v);
  const s = out.toString();
  return s ? "?" + s : "";
}
