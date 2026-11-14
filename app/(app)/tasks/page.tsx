import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { TASK_TYPES } from "@/lib/core";
import { dayKey, fmtDateTime, fmtTime, localInput, rel } from "@/lib/fmt";
import { pipeline } from "@/lib/leads";
import { canWorkTasks, lvl } from "@/lib/perm";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { TaskDone } from "@/components/TaskDone";
import { TaskCalendar } from "./TaskCalendar";

const TABS = [["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["done", "Done"]];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx("tasks");
  const sp = await searchParams;
  const tab = sp.tab ?? "today";
  const teamAllowed = ["F", "T"].includes(lvl(ctx.perms, "tasks"));
  const team = teamAllowed && sp.who === "team";
  const calendar = sp.view === "calendar";
  const ps: any[] = [ctx.tenantId];
  let where = "k.tenant_id=$1";
  if (!team) { ps.push(ctx.user.id); where += ` and k.owner_id=$${ps.length}`; }
  else if (ctx.branchIds.length) { ps.push(ctx.branchIds); where += ` and e.branch_id::text in (select jsonb_array_elements_text($${ps.length}::jsonb))`; }
  const today = "(k.due_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date";
  const cond = calendar ? "k.status='open' and k.due_at > now() - interval '35 days' and k.due_at < now() + interval '45 days'"
    : { today: `k.status='open' and ${today}`, overdue: "k.status='open' and k.due_at < now()", upcoming: `k.status='open' and k.due_at > now() and not ${today}`, done: "k.status='done' and k.completed_at > now() - interval '14 days'" }[tab] ?? `k.status='open' and ${today}`;
  const rows = await q(
    `select k.*, st.name as student, e.household_id, u.name as owner, s.exempt_next_action,
       (select count(*)::int from tasks o where o.enquiry_id=k.enquiry_id and o.status='open') as open_count
     from tasks k join enquiries e on e.id=k.enquiry_id join students st on st.id=e.student_id join users u on u.id=k.owner_id join stages s on s.id=e.stage_id
     where ${where} and ${cond} order by ${tab === "done" ? "k.completed_at desc" : "k.due_at"} limit 300`,
    ps,
  );
  const { stages } = await pipeline(ctx.tenantId);
  const stageOpts = stages.map((x) => ({ id: x.id, name: x.name, phase_name: x.phase_name, is_closed: x.is_closed, exempt_next_action: x.exempt_next_action }));
  const due = localInput(new Date(Date.now() + 24 * 3600e3));
  const link = (patch: Record<string, string | undefined>) => "/tasks?" + new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Tasks" sub={team ? "Everyone in your team" : "Your follow-ups, visits and chases"}>
        {teamAllowed && <div className="flex rounded-md border border-slate-300 bg-white p-0.5">{[["", "Mine"], ["team", "Team"]].map(([k, l]) => <Link key={l} href={link({ who: k || undefined })} className={`rounded px-2.5 py-1 text-xs font-medium ${(sp.who ?? "") === k ? "bg-brand-600 text-white" : "text-slate-600"}`}>{l}</Link>)}</div>}
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5">{[["", "List"], ["calendar", "Calendar"]].map(([k, l]) => <Link key={l} href={link({ view: k || undefined })} className={`rounded px-2.5 py-1 text-xs font-medium ${(sp.view ?? "") === k ? "bg-brand-600 text-white" : "text-slate-600"}`}>{l}</Link>)}</div>
      </PageHeader>
      {calendar ? (
        <TaskCalendar today={dayKey(new Date())} tasks={rows.map((k) => ({ id: k.id, title: k.title, student: k.student, day: dayKey(k.due_at), time: fmtTime(k.due_at), iso: new Date(k.due_at).toISOString(), href: `/households/${k.household_id}?e=${k.enquiry_id}`, owner: k.owner, overdue: new Date(k.due_at) < new Date() }))} showOwner={!!team} />
      ) : (
        <>
          <div className="mb-3 flex gap-1 border-b border-slate-200">{TABS.map(([k, l]) => <Link key={k} href={link({ tab: k })} className={`tab ${tab === k ? "tab-on" : ""}`}>{l}</Link>)}</div>
          <div className="card">
            {!rows.length ? <Empty title={tab === "overdue" ? "Nothing overdue" : "No tasks here"}>Tasks are created when you plan a next action, book a visit, or when a workflow asks for a follow-up.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Task</th><th>Student</th><th>Type</th>{team && <th>Owner</th>}<th>{tab === "done" ? "Outcome" : "Due"}</th><th></th></tr></thead>
                <tbody>{rows.map((k) => (
                  <tr key={k.id}>
                    <td className="font-medium">{k.title}{k.priority === "high" && <span className="ml-1.5"><Badge tone="red">High</Badge></span>}</td>
                    <td><Link className="link" href={`/households/${k.household_id}?e=${k.enquiry_id}`}>{k.student}</Link></td>
                    <td>{TASK_TYPES[k.type] ?? k.type}</td>
                    {team && <td>{k.owner}</td>}
                    <td className={k.status === "open" && new Date(k.due_at) < new Date() ? "font-medium text-rose-700" : ""}>{tab === "done" ? k.outcome : <>{fmtDateTime(k.due_at)} <span className="muted">({rel(k.due_at)})</span></>}</td>
                    <td className="text-right">{k.status === "open" && canWorkTasks(ctx.perms) && <TaskDone taskId={k.id} title={k.title} lastOpen={k.open_count === 1 && !k.exempt_next_action} stages={stageOpts} reasons={ctx.tenant.settings.closure_reasons ?? []} defaultDue={due} />}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
