import Link from "next/link";
import { requireCtx, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { dayKey, fmtDay, fmtTime } from "@/lib/fmt";
import { canWorkTasks } from "@/lib/perm";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { visitUpdate } from "@/app/actions/record";

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ find?: string }> }) {
  const ctx = await requireCtx("tasks");
  const { find } = await searchParams;
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps);
  const rows = await q(
    `select v.*, st.name as student, e.grade, u.name as host, b.name as branch, b.visit_capacity, g.name as guardian, g.mobile
     from visits v join enquiries e on e.id=v.enquiry_id join students st on st.id=e.student_id join branches b on b.id=v.branch_id left join users u on u.id=v.host_id
     left join lateral (select name, mobile from guardians g where g.household_id=v.household_id order by is_primary desc limit 1) g on true
     where ${scope} and v.slot_at > now() - interval '7 days' and v.slot_at < now() + interval '14 days' and v.status<>'cancelled' order by v.slot_at`,
    ps,
  );
  const today = dayKey(new Date());
  const todays = rows.filter((v) => dayKey(v.slot_at) === today);
  const shown = find ? todays.filter((v) => v.mobile?.includes(find.replace(/\D/g, "")) || v.student.toLowerCase().includes(find.toLowerCase())) : todays;
  const upcoming = rows.filter((v) => dayKey(v.slot_at) > today && v.status === "scheduled");
  const past = rows.filter((v) => dayKey(v.slot_at) < today);
  const byDay: Record<string, typeof rows> = {};
  for (const v of upcoming) (byDay[dayKey(v.slot_at)] ??= []).push(v);
  const can = canWorkTasks(ctx.perms);
  return (
    <>
      <PageHeader title="Visits" sub="Front-desk check-in and the visit calendar for the next two weeks" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Expected today" value={todays.length} />
        <Stat label="Arrived" value={todays.filter((v) => v.checked_in_at).length} tone="good" />
        <Stat label="Booked, next 14 days" value={upcoming.length} />
        <Stat label="No-shows, last 7 days" value={past.filter((v) => v.status === "no_show").length} tone={past.some((v) => v.status === "no_show") ? "bad" : undefined} />
      </div>
      <section className="card mb-4">
        <div className="card-h">
          <span>Today's arrivals</span>
          <form className="flex gap-2"><input name="find" defaultValue={find} placeholder="Find by mobile or student" className="input w-56" aria-label="Find a visitor" /><button className="btn">Find</button></form>
        </div>
        {!shown.length ? <Empty title={find ? "No visit today matches that" : "No visits today"}>{find ? <Link className="link" href="/walkin">Not booked? Add them as a walk-in.</Link> : "Counsellors book visits from a family's page. Walk-ins go through the walk-in desk."}</Empty> : (
          <table className="tbl">
            <thead><tr><th>Time</th><th>Family</th><th>Grade</th><th>Host</th><th>Status</th><th></th></tr></thead>
            <tbody>{shown.map((v) => (
              <tr key={v.id}>
                <td className="font-semibold">{fmtTime(v.slot_at)}</td>
                <td><Link className="link" href={`/households/${v.household_id}?e=${v.enquiry_id}`}>{v.student}</Link><span className="muted block text-xs">{v.guardian} · {v.mobile}</span></td>
                <td>{v.grade}</td><td>{v.host}</td>
                <td>{v.status === "done" ? <Badge tone="green">Done</Badge> : v.status === "no_show" ? <Badge tone="rose">No-show</Badge> : v.checked_in_at ? <Badge tone="green">Arrived {fmtTime(v.checked_in_at)}</Badge> : <Badge>Expected</Badge>}</td>
                <td>{can && v.status === "scheduled" && (
                  <form action={visitUpdate} className="flex justify-end gap-1.5">
                    <input type="hidden" name="visitId" value={v.id} />
                    {!v.checked_in_at ? <button name="what" value="check_in" className="btn btn-sm btn-primary">Check in</button> : <><input name="outcome" placeholder="Visit outcome" required className="input !w-44 !py-1 text-xs" /><button name="what" value="done" className="btn btn-sm btn-primary">Mark done</button></>}
                    {!v.checked_in_at && <button name="what" value="no_show" className="btn btn-sm">No-show</button>}
                  </form>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <section className="card">
        <div className="card-h">Coming up</div>
        {!upcoming.length && <Empty title="No visits booked for the coming days" />}
        <div className="divide-y divide-slate-100">
          {Object.entries(byDay).map(([day, list]) => (
            <div key={day} className="grid gap-2 px-4 py-3 md:grid-cols-[10rem_1fr]">
              <div><div className="font-semibold">{fmtDay(list[0].slot_at)}</div><div className="muted text-xs">{list.length} visit{list.length === 1 ? "" : "s"}</div></div>
              <div className="flex flex-wrap gap-2">{list.map((v) => <Link key={v.id} href={`/households/${v.household_id}?e=${v.enquiry_id}`} className="rounded-md border border-slate-200 px-2.5 py-1.5 hover:border-brand-500"><b>{fmtTime(v.slot_at)}</b> {v.student} <span className="muted text-xs">· {v.host?.split(" ")[0]} · {v.branch}</span></Link>)}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
