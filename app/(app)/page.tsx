import Link from "next/link";
import { requireCtx, scopeSql } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { TASK_TYPES } from "@/lib/core";
import { fmtTime, localInput, rel, age } from "@/lib/fmt";
import { pipeline } from "@/lib/leads";
import { canWorkTasks, has, leadScope, lvl } from "@/lib/perm";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { TaskDone } from "@/components/TaskDone";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const t = ctx.tenantId, me = ctx.user.id;
  const isHead = ["F", "T"].includes(lvl(ctx.perms, "reassign"));
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps);
  const y = ps.push(ctx.yearId);
  const [tasks, visits, fresh, replies, mine, team, { stages }] = await Promise.all([
    q(
      `select k.*, st.name as student, e.household_id, s.exempt_next_action,
         (select count(*)::int from tasks o where o.enquiry_id=k.enquiry_id and o.status='open') as open_count
       from tasks k join enquiries e on e.id=k.enquiry_id join students st on st.id=e.student_id join stages s on s.id=e.stage_id
       where k.tenant_id=$1 and k.owner_id=$2 and k.status='open' and k.due_at < now() + interval '36 hours' order by k.due_at limit 60`,
      [t, me],
    ),
    q(`select v.*, st.name as student, u.name as host from visits v join enquiries e on e.id=v.enquiry_id join students st on st.id=e.student_id left join users u on u.id=v.host_id
       where ${scope} and v.status='scheduled' and (v.slot_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date order by v.slot_at`, ps.slice(0, y - 1)),
    q(`select e.id, e.household_id, e.created_at, e.grade, st.name as student, u.name as owner from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id join users u on u.id=e.owner_id
       where ${scope} and e.year_id=$${y} and p.key='enquiry' and e.first_response_at is null order by e.created_at limit 12`, ps),
    q(`select m.household_id, max(m.created_at) as at, (array_agg(m.body order by m.created_at desc))[1] as body, min(st.name) as student
       from messages m join enquiries e on e.household_id=m.household_id join students st on st.id=e.student_id
       where ${scope} and m.direction='in' and not m.read group by m.household_id order by at desc limit 8`, ps.slice(0, y - 1)),
    one(
      `select count(*) filter (where e.owner_id=$2 and not s.is_closed and not s.is_won)::int as open,
              count(*) filter (where e.owner_id=$2 and s.is_won)::int as won,
              count(*) filter (where e.owner_id=$2 and e.created_at > now() - interval '7 days')::int as week
       from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.year_id=$3`,
      [t, me, ctx.yearId],
    ),
    isHead
      ? q(
          `select u.id, u.name, u.on_leave,
             count(e.id) filter (where not s.is_closed and not s.is_won)::int as open,
             count(e.id) filter (where s.is_won)::int as won,
             count(e.id) filter (where e.first_response_at is null and p.key='enquiry')::int as untouched,
             (select count(*)::int from tasks k where k.owner_id=u.id and k.status='open' and k.due_at<now()) as overdue
           from users u join roles r on r.id=u.role_id left join enquiries e on e.owner_id=u.id and e.year_id=$2 left join stages s on s.id=e.stage_id left join phases p on p.id=s.phase_id
           where u.tenant_id=$1 and u.status='active' and r.permissions->>'leads'='O' ${ctx.branchIds.length ? "and exists (select 1 from jsonb_array_elements_text(u.branch_ids) b where b in (select jsonb_array_elements_text($3::jsonb)))" : ""}
           group by u.id order by u.name`,
          ctx.branchIds.length ? [t, ctx.yearId, ctx.branchIds] : [t, ctx.yearId],
        )
      : Promise.resolve([]),
    pipeline(t),
  ]);
  const now = Date.now();
  const overdue = tasks.filter((k) => +new Date(k.due_at) < now);
  const dueNow = tasks.filter((k) => +new Date(k.due_at) >= now && +new Date(k.due_at) < now + 2 * 3600e3);
  const later = tasks.filter((k) => +new Date(k.due_at) >= now + 2 * 3600e3);
  const stageOpts = stages.map((x) => ({ id: x.id, name: x.name, phase_name: x.phase_name, is_closed: x.is_closed, exempt_next_action: x.exempt_next_action }));
  const reasons: string[] = ctx.tenant.settings.closure_reasons ?? [];
  const due = localInput(new Date(now + 24 * 3600e3));
  const sla = Number(ctx.tenant.settings.first_response_mins ?? 30);
  const List = ({ title, rows, tone }: { title: string; rows: typeof tasks; tone?: string }) => (
    <section className="card">
      <div className="card-h"><span className={tone}>{title}</span><span className="muted font-normal">{rows.length}</span></div>
      {!rows.length ? <p className="muted px-4 py-3">Nothing here.</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <Link href={`/households/${k.household_id}?e=${k.enquiry_id}`} className="link">{k.student}</Link> <span className="text-slate-700">· {k.title}</span>
                {k.priority === "high" && <span className="ml-1.5"><Badge tone="red">High</Badge></span>}
                <div className="muted text-xs">{TASK_TYPES[k.type] ?? k.type} · {rel(k.due_at)} ({fmtTime(k.due_at)})</div>
              </div>
              {canWorkTasks(ctx.perms) && <TaskDone taskId={k.id} title={k.title} lastOpen={k.open_count === 1 && !k.exempt_next_action} stages={stageOpts} reasons={reasons} defaultDue={due} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <>
      <PageHeader title={`My day`} sub={`${ctx.user.name} · ${ctx.roleName}`}>
        {has(ctx.perms, "reports") && <Link href="/reports" className="btn">Open dashboards</Link>}
      </PageHeader>
      {sp.denied && <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-amber-800">Your role does not have access to that area. Ask your admin if you need it.</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Overdue tasks" value={overdue.length} tone={overdue.length ? "bad" : undefined} href="/tasks?tab=overdue" />
        <Stat label="Due in the next 2 hours" value={dueNow.length} href="/tasks" />
        <Stat label="Awaiting first response" value={fresh.length} tone={fresh.length ? "bad" : undefined} sub={`Target: within ${sla} min`} href="/leads?chip=untouched" />
        <Stat label="Visits today" value={visits.length} href="/visits" />
        {leadScope(ctx.perms) === "own" ? <Stat label="My admissions this year" value={mine!.won} sub={`${mine!.open} open · ${mine!.week} new this week`} tone="good" href="/leads?chip=my&won=1" /> : <Stat label="Unread parent replies" value={replies.length} href="/inbox" />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <List title="Overdue" rows={overdue} tone="text-rose-700" />
          <List title="Due now" rows={dueNow} />
          <List title="Later today and tomorrow" rows={later} />
        </div>
        <div className="space-y-4">
          <section className="card">
            <div className="card-h"><span>New leads awaiting first response</span><Link href="/leads?chip=untouched" className="link text-xs">See all</Link></div>
            {!fresh.length ? <Empty title="Every new enquiry has had a response" /> : (
              <ul className="divide-y divide-slate-100">{fresh.map((e) => {
                const mins = Math.round((now - +new Date(e.created_at)) / 60000);
                return <li key={e.id} className="flex items-center justify-between px-4 py-2"><span><Link className="link" href={`/households/${e.household_id}?e=${e.id}&panel=call`}>{e.student}</Link> <span className="muted">· {e.grade} · {e.owner}</span></span><span className={mins > sla ? "font-semibold text-rose-700" : "text-amber-700"}>⏱ waiting {age(e.created_at)}{mins > sla ? " (past target)" : ""}</span></li>;
              })}</ul>
            )}
          </section>
          <section className="card">
            <div className="card-h"><span>Visits today</span><Link href="/visits" className="link text-xs">Visit calendar</Link></div>
            {!visits.length ? <Empty title="No visits today">Book one from any family's page.</Empty> : (
              <ul className="divide-y divide-slate-100">{visits.map((v) => <li key={v.id} className="flex items-center justify-between px-4 py-2"><span><b>{fmtTime(v.slot_at)}</b> · <Link className="link" href={`/households/${v.household_id}?e=${v.enquiry_id}`}>{v.student}</Link> <span className="muted">· host {v.host}</span></span>{v.checked_in_at ? <Badge tone="green">Arrived</Badge> : <Badge>Expected</Badge>}</li>)}</ul>
            )}
          </section>
          <section className="card">
            <div className="card-h"><span>Unread parent replies</span><Link href="/inbox" className="link text-xs">Team inbox</Link></div>
            {!replies.length ? <Empty title="No unread replies" /> : (
              <ul className="divide-y divide-slate-100">{replies.map((m) => <li key={m.household_id} className="px-4 py-2"><Link className="link" href={`/inbox?h=${m.household_id}`}>{m.student}</Link> <span className="muted text-xs">· {rel(m.at)}</span><div className="truncate text-slate-700">{m.body}</div></li>)}</ul>
            )}
          </section>
          {isHead && (
            <section className="card">
              <div className="card-h">Team today</div>
              <table className="tbl"><thead><tr><th>Counsellor</th><th>Open</th><th>Untouched</th><th>Overdue tasks</th><th>Admissions</th></tr></thead>
                <tbody>{team.map((u) => <tr key={u.id}><td>{u.name}{u.on_leave && <span className="ml-1.5"><Badge tone="amber">On leave</Badge></span>}</td><td><Link className="link" href={`/leads?owner=${u.id}&open=1`}>{u.open}</Link></td><td className={u.untouched ? "font-semibold text-rose-700" : ""}>{u.untouched}</td><td className={u.overdue ? "font-semibold text-rose-700" : ""}>{u.overdue}</td><td>{u.won}</td></tr>)}</tbody></table>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
