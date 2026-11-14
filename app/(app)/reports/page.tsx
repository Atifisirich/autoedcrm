import Link from "next/link";
import { requireCtx, scopeSql } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { inr, num, pct } from "@/lib/fmt";
import { leadScope, lvl } from "@/lib/perm";
import { Bars, Empty, Meter, PageHeader, Stat } from "@/components/ui";

/**
 * Role dashboards and the standard report set (REP-01..03, KPI definitions in PRD section 16).
 * Every number links to the records behind it; everything follows the year and branch in the header.
 */
export default async function ReportsPage() {
  const ctx = await requireCtx("reports");
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps) + ` and e.year_id=$${ps.push(ctx.yearId)}`;
  const J = "from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id";
  const lead = "p.key<>'prospect'";
  const level = lvl(ctx.perms, "reports");
  const showCost = ["F", "T", "Mktg", "V"].includes(level);
  const showTeam = leadScope(ctx.perms) !== "own" && level !== "Fin.";

  const [k, phases, seats, branches, sources, team, reasons, ageing, fr, tasks] = await Promise.all([
    one(
      `select count(*) filter (where ${lead})::int as enquiries,
         count(*) filter (where ${lead} and exists (select 1 from activities a where a.enquiry_id=e.id and ((a.type='call' and a.outcome='connected') or a.meta->>'direction'='in')))::int as contacted,
         count(*) filter (where exists (select 1 from visits v where v.enquiry_id=e.id and v.status='done'))::int as visited,
         count(*) filter (where exists (select 1 from visits v where v.enquiry_id=e.id and v.status='done') and exists (select 1 from applications a where a.enquiry_id=e.id and a.status='submitted'))::int as visited_applied,
         count(*) filter (where exists (select 1 from applications a where a.enquiry_id=e.id and a.status='submitted'))::int as applied,
         count(*) filter (where s.is_won)::int as admitted,
         count(*) filter (where not s.is_closed and not s.is_won and ${lead})::int as open,
         coalesce(sum(s.probability) filter (where not s.is_closed and not s.is_won), 0)::float / 100 as weighted,
         count(*) filter (where e.reenquired)::int as reenquired
       ${J} where ${scope}`, ps),
    q(`select p.key, p.name, p.position, count(e.id)::int n ${J} where ${scope} group by p.key, p.name, p.position order by p.position`, ps),
    q(`select pr.grade, pr.grade_order, sum(pr.capacity)::int as capacity,
         (select count(*)::int ${J} where ${scope} and e.grade=pr.grade and s.is_won) as confirmed,
         (select count(*)::int ${J} where ${scope} and e.grade=pr.grade and p.key in ('application','evaluation','offer')) as pipeline
       from programmes pr where pr.tenant_id=$1 and pr.year_id=$${ps.length} ${ctx.branchId ? `and pr.branch_id='${ctx.branchId}'` : ""} group by pr.grade, pr.grade_order order by pr.grade_order`, ps),
    q(`select b.id, b.name, count(*) filter (where ${lead})::int as enquiries, count(*) filter (where exists (select 1 from visits v where v.enquiry_id=e.id and v.status='done'))::int as visited, count(*) filter (where s.is_won)::int as admitted
       ${J} join branches b on b.id=e.branch_id where ${scope} group by b.id, b.name order by b.name`, ps),
    q(`select t.channel, count(*)::int as leads, count(*) filter (where exists (select 1 from visits v where v.enquiry_id=e.id and v.status='done'))::int as visits, count(*) filter (where s.is_won)::int as admissions,
         (select coalesce(sum(cost),0)::float from sources so where so.tenant_id=$1 and so.channel=t.channel) as cost
       ${J} join lateral (select channel from source_touches t where t.enquiry_id=e.id order by t.created_at limit 1) t on true where ${scope} group by t.channel order by leads desc`, ps),
    q(`select u.id, u.name, count(*) filter (where not s.is_closed and not s.is_won)::int as open, count(*) filter (where s.is_won)::int as admitted, count(*)::int as total,
         (select count(*)::int from activities a where a.actor_id=u.id and a.type='call' and a.created_at>now()-interval '7 days') as calls,
         (select count(*)::int from activities a where a.actor_id=u.id and a.type='call' and a.outcome='connected' and a.created_at>now()-interval '7 days') as connected,
         (select count(*)::int from visits v where v.host_id=u.id and v.status='done' and v.slot_at>now()-interval '30 days') as visits,
         (select count(*)::int from tasks k where k.owner_id=u.id and k.status='open' and k.due_at<now()) as overdue
       ${J} join users u on u.id=e.owner_id where ${scope} group by u.id, u.name order by admitted desc, total desc`, ps),
    q(`select coalesce(e.closure_reason,'Not recorded') as reason, count(*)::int n ${J} where ${scope} and s.is_closed group by 1 order by n desc`, ps),
    q(`select case when now()-e.created_at < interval '1 hour' then '1. Under 1 hour' when now()-e.created_at < interval '1 day' then '2. 1 to 24 hours' when now()-e.created_at < interval '3 days' then '3. 1 to 3 days' else '4. Over 3 days' end as bucket, count(*)::int n
       ${J} where ${scope} and p.key='enquiry' and e.first_response_at is null group by 1 order by 1`, ps),
    one(`select percentile_cont(0.5) within group (order by extract(epoch from (e.first_response_at-e.created_at))/60)::float as median ${J} where ${scope} and e.first_response_at is not null and e.created_at > now() - interval '60 days'`, ps),
    one(`select count(*) filter (where k.status='done' and k.completed_at <= k.due_at + interval '1 day')::int as ontime, count(*) filter (where k.status='done' or k.due_at<now())::int as due
       from tasks k join enquiries e on e.id=k.enquiry_id where ${scope} and k.status<>'cancelled'`, ps),
  ]);
  const K = k!;
  const forecast = Math.round(K.admitted + K.weighted);
  const capacity = seats.reduce((a, r) => a + r.capacity, 0);
  const year = ctx.years.find((y) => y.id === ctx.yearId)?.name;
  return (
    <>
      <PageHeader title="Reports" sub={`${year}${ctx.branchId ? " · " + ctx.branches.find((b) => b.id === ctx.branchId)?.name : " · all your branches"} · live data. Click any number to see the records behind it.`}>
        <a className="btn" href="/api/export?open=1">Export open enquiries (CSV)</a>
      </PageHeader>
      {!K.enquiries && !K.admitted ? <div className="card"><Empty title="No enquiries in this year yet">Reports fill in as enquiries arrive. Switch the academic year in the header to see another season.</Empty></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Enquiries" value={num(K.enquiries)} href="/leads" />
            <Stat label="Contact rate" value={pct(K.contacted, K.enquiries)} sub="two-way conversation" />
            <Stat label="Enquiry to visit" value={pct(K.visited, K.enquiries)} href="/leads?visited=1" />
            <Stat label="Visit to application" value={pct(K.visited_applied, K.visited)} />
            <Stat label="Application to admission" value={pct(K.admitted, K.applied)} href="/leads?won=1" />
            <Stat label="Overall conversion" value={pct(K.admitted, K.enquiries)} tone="good" />
            <Stat label="Median first response" value={fr?.median != null ? `${Math.round(fr.median)} min` : "–"} sub="last 60 days" tone={fr?.median > 30 ? "bad" : undefined} />
            <Stat label="Follow-up compliance" value={pct(tasks!.ontime, tasks!.due)} sub="tasks done by due day" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <div className="card-h">Where enquiries stand now, by phase</div>
              <div className="p-4"><Bars rows={phases.map((p) => ({ label: p.name, value: p.n, href: `/leads?phase=${p.key}` }))} /></div>
            </section>
            <section className="card">
              <div className="card-h">Admissions forecast</div>
              <div className="grid grid-cols-3 gap-3 p-4">
                <Stat label="Confirmed" value={K.admitted} href="/leads?won=1" />
                <Stat label="Forecast" value={forecast} sub="confirmed + open × stage probability" />
                <Stat label="Seats" value={num(capacity)} sub={`${pct(K.admitted, capacity)} filled`} />
              </div>
              <p className="muted px-4 pb-4 text-xs">{K.open} open enquiries carry a weighted {K.weighted.toFixed(1)} expected admissions. Stage probabilities are set in Admin › Pipeline. Re-enquiry rate: {pct(K.reenquired, K.enquiries)}.</p>
            </section>
          </div>

          <section className="card overflow-x-auto">
            <div className="card-h">Seats against admissions, by grade</div>
            <table className="tbl">
              <thead><tr><th>Grade</th><th>Capacity</th><th>Confirmed</th><th>Seat fill</th><th>In application to offer</th><th>Seats left</th></tr></thead>
              <tbody>{seats.map((r) => (
                <tr key={r.grade}><td className="font-medium">{r.grade}</td><td>{r.capacity}</td><td><Link className="link" href={`/leads?grade=${encodeURIComponent(r.grade)}&won=1`}>{r.confirmed}</Link></td><td><Meter value={r.confirmed} max={r.capacity} /></td>
                  <td><Link className="link" href={`/leads?grade=${encodeURIComponent(r.grade)}&open=1`}>{r.pipeline}</Link></td><td className={r.capacity - r.confirmed <= 0 ? "font-semibold text-rose-700" : ""}>{r.capacity - r.confirmed <= 0 ? "Full" : r.capacity - r.confirmed}</td></tr>
              ))}</tbody>
            </table>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {branches.length > 1 && (
              <section className="card overflow-x-auto">
                <div className="card-h">Branch comparison</div>
                <table className="tbl"><thead><tr><th>Branch</th><th>Enquiries</th><th>Visited</th><th>Enquiry to visit</th><th>Admitted</th><th>Conversion</th></tr></thead>
                  <tbody>{branches.map((b) => <tr key={b.id}><td className="font-medium">{b.name}</td><td><Link className="link" href={`/leads?branch=${b.id}`}>{b.enquiries}</Link></td><td>{b.visited}</td><td>{pct(b.visited, b.enquiries)}</td><td>{b.admitted}</td><td>{pct(b.admitted, b.enquiries)}</td></tr>)}</tbody></table>
              </section>
            )}
            <section className="card">
              <div className="card-h">Why enquiries closed</div>
              <div className="p-4">{reasons.length ? <Bars rows={reasons.map((r) => ({ label: r.reason, value: r.n, href: `/leads?closed=1&reason=${encodeURIComponent(r.reason)}` }))} /> : <p className="muted">Nothing closed this year.</p>}</div>
            </section>
            <section className="card">
              <div className="card-h">Untouched enquiries, by how long they have waited</div>
              <div className="p-4">{ageing.length ? <Bars rows={ageing.map((r) => ({ label: r.bucket.slice(3), value: r.n, href: "/leads?chip=untouched" }))} /> : <p className="muted">Every enquiry has had a first response.</p>}</div>
            </section>
          </div>

          <section className="card overflow-x-auto">
            <div className="card-h">Sources: first-touch channel{showCost ? ", with cost" : ""}</div>
            <table className="tbl">
              <thead><tr><th>Channel</th><th>Leads</th><th>Visits</th><th>Admissions</th><th>Lead to admission</th>{showCost && <><th>Spend</th><th>Cost per lead</th><th>Cost per admission</th></>}</tr></thead>
              <tbody>{sources.map((r) => (
                <tr key={r.channel}><td className="font-medium">{r.channel}</td><td><Link className="link" href={`/leads?channel=${encodeURIComponent(r.channel)}`}>{r.leads}</Link></td><td>{r.visits}</td><td>{r.admissions}</td><td>{pct(r.admissions, r.leads)}</td>
                  {showCost && <><td>{r.cost ? inr(r.cost) : "–"}</td><td>{r.cost ? inr(r.cost / r.leads) : "–"}</td><td>{r.cost && r.admissions ? inr(r.cost / r.admissions) : "–"}</td></>}</tr>
              ))}</tbody>
            </table>
            {showCost && <p className="muted px-4 py-2 text-xs">Spend is the season total entered per source in Admin › Sources. It is not prorated to the selected branch.</p>}
          </section>

          {showTeam && (
            <section className="card overflow-x-auto">
              <div className="card-h">Counsellors: outcomes and effort</div>
              <table className="tbl">
                <thead><tr><th>Counsellor</th><th>Open</th><th>Admissions</th><th>Conversion</th><th>Calls, 7 days</th><th>Connected</th><th>Visits hosted, 30 days</th><th>Overdue tasks</th></tr></thead>
                <tbody>{team.map((u) => <tr key={u.id}><td className="font-medium">{u.name}</td><td><Link className="link" href={`/leads?owner=${u.id}&open=1`}>{u.open}</Link></td><td>{u.admitted}</td><td>{pct(u.admitted, u.total)}</td><td>{u.calls}</td><td>{u.connected}</td><td>{u.visits}</td><td className={u.overdue ? "font-semibold text-rose-700" : ""}>{u.overdue}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </>
  );
}
