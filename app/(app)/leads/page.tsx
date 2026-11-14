import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, rel } from "@/lib/fmt";
import { CHIPS, countLeads, listLeads, pipeline, qs, stageCounts, type SP } from "@/lib/leads";
import { canEditLeads, canMessage, has, lvl } from "@/lib/perm";
import { Badge, Empty, PageHeader, Temp } from "@/components/ui";
import { deleteView, saveView } from "@/app/actions/leads";
import { Kanban, LeadTable, type Lead } from "./LeadsClient";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx("leads");
  const sp = await searchParams;
  const view = sp.view ?? "table";
  const { phases, stages } = await pipeline(ctx.tenantId);
  // The board shows working stages by default: prospects and closed records stay in the table.
  const boardPhases = sp.phase ? [sp.phase] : ["enquiry", "visit", "application", "evaluation", "offer"];
  const filter: SP = view === "kanban" && !sp.phase && !sp.stage ? { ...sp } : sp;
  const page = Math.max(1, Number(sp.page ?? 1));
  const size = view === "kanban" ? 400 : 50;
  const [rows, total, counts, users, templates, views, channels] = await Promise.all([
    listLeads(ctx, filter, size, (page - 1) * size),
    countLeads(ctx, filter),
    stageCounts(ctx, sp),
    q("select u.id, u.name from users u join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active' and r.permissions->>'leads' in ('F','T','O') order by u.name", [ctx.tenantId]),
    q("select id, name || ' (' || channel || ')' as name from templates where tenant_id=$1 and status='approved' order by name", [ctx.tenantId]),
    q("select * from saved_views where tenant_id=$1 and (user_id=$2 or shared) order by name", [ctx.tenantId, ctx.user.id]),
    q("select distinct channel from sources where tenant_id=$1 order by 1", [ctx.tenantId]),
  ]);
  const now = Date.now();
  const leads: Lead[] = rows.map((r) => ({
    id: r.id, household_id: r.household_id, student: r.student, guardian: r.guardian, mobile: r.mobile, grade: r.grade, branch: r.branch, stage: r.stage, stage_id: r.stage_id, color: r.color, phase: r.phase,
    owner: r.owner, score: r.score, temperature: r.temperature, source: r.source, created: fmtDate(r.created_at), next: r.next_due ? rel(r.next_due) : null, nextTitle: r.next_title,
    overdue: !!r.next_due && new Date(r.next_due).getTime() < now, reenquired: r.reenquired, family: r.family_size, untouched: !r.first_response_at, tags: r.tags,
  }));
  const chips = (sp.chip ?? "").split(",").filter(Boolean);
  const toggleChip = (c: string) => (chips.includes(c) ? chips.filter((x) => x !== c) : [...chips, c]).join(",") || undefined;
  const phaseCount = (pid: string) => stages.filter((s) => s.phase_id === pid).reduce((n, s) => n + (counts[s.id] ?? 0), 0);
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const current = phases.find((p) => p.key === sp.phase);
  const queryString = qs(sp, { view: undefined, page: undefined }).slice(1);
  const year = ctx.years.find((y) => y.id === ctx.yearId);
  const can = { bulk: has(ctx.perms, "bulk"), reassign: ["F", "T"].includes(lvl(ctx.perms, "reassign")), edit: canEditLeads(ctx.perms), message: canMessage(ctx.perms), export: ["F", "T", "Part"].includes(lvl(ctx.perms, "bulk")) };
  const reasons: string[] = ctx.tenant.settings.closure_reasons ?? [];
  const filtered = Object.keys(sp).some((k) => !["view", "page", "sort"].includes(k));

  return (
    <>
      <PageHeader title="Leads" sub={<>{total} record{total === 1 ? "" : "s"} · {sp.year === "all" ? "all academic years" : year?.name}{ctx.branchId ? ` · ${ctx.branches.find((b) => b.id === ctx.branchId)?.name}` : ""}</>}>
        {["F", "T"].includes(lvl(ctx.perms, "leads")) && <Link href={qs(sp, { year: sp.year === "all" ? undefined : "all" })} className={`chip ${sp.year === "all" ? "chip-on" : ""}`}>All years</Link>}
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
          {[["table", "Table"], ["kanban", "Kanban"], ["cards", "Cards"]].map(([k, label]) => <Link key={k} href={qs(sp, { view: k === "table" ? undefined : k, page: undefined })} className={`rounded px-2.5 py-1 text-xs font-medium ${view === k ? "bg-brand-600 text-white" : "text-slate-600"}`}>{label}</Link>)}
          <Link href="/tasks?view=calendar" className="rounded px-2.5 py-1 text-xs font-medium text-slate-600">Calendar</Link>
        </div>
      </PageHeader>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
        <Link href={qs(sp, { phase: undefined, stage: undefined, page: undefined })} className={`tab ${!sp.phase && !sp.stage ? "tab-on" : ""}`}>All <span className="muted">{allCount}</span></Link>
        {phases.map((p) => <Link key={p.id} href={qs(sp, { phase: p.key, stage: undefined, page: undefined })} className={`tab ${sp.phase === p.key ? "tab-on" : ""}`}>{p.name} <span className="muted">{phaseCount(p.id)}</span></Link>)}
      </div>
      {current && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {stages.filter((s) => s.phase_id === current.id).map((s) => <Link key={s.id} href={qs(sp, { stage: sp.stage === s.id ? undefined : s.id, page: undefined })} className={`chip ${sp.stage === s.id ? "chip-on" : ""}`}>{s.name} · {counts[s.id] ?? 0}</Link>)}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {CHIPS.map(([k, label]) => <Link key={k} href={qs(sp, { chip: toggleChip(k), page: undefined })} className={`chip ${chips.includes(k) ? "chip-on" : ""}`}>{label}</Link>)}
        <span className="mx-1 h-4 w-px bg-slate-300" />
        {views.map((v) => (
          <span key={v.id} className="chip">
            <Link href={`/leads?${v.query}`}>★ {v.name}{v.shared ? " (shared)" : ""}</Link>
            {v.user_id === ctx.user.id && <form action={deleteView}><input type="hidden" name="id" value={v.id} /><button aria-label={`Delete view ${v.name}`} className="text-slate-400 hover:text-rose-600">×</button></form>}
          </span>
        ))}
      </div>

      <details className="card mb-3" open={!!(sp.q || sp.owner || sp.grade || sp.channel || sp.temp || sp.from || sp.to || sp.minscore)}>
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-600">Filters and saved views</summary>
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-4 py-3">
          <form className="flex flex-wrap items-end gap-2">
            {["view", "phase", "stage", "chip", "year"].map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
            <label><span className="label">Search</span><input name="q" defaultValue={sp.q} placeholder="Name, mobile, email" className="input w-44" /></label>
            <label><span className="label">Owner</span><select name="owner" defaultValue={sp.owner ?? ""} className="input w-36"><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label><span className="label">Grade</span><select name="grade" defaultValue={sp.grade ?? ""} className="input w-28"><option value="">Any</option>{(ctx.tenant.settings.grades ?? []).map((g: string) => <option key={g}>{g}</option>)}</select></label>
            <label><span className="label">Channel</span><select name="channel" defaultValue={sp.channel ?? ""} className="input w-32"><option value="">Any</option>{channels.map((c) => <option key={c.channel}>{c.channel}</option>)}</select></label>
            <label><span className="label">Temperature</span><select name="temp" defaultValue={sp.temp ?? ""} className="input w-24"><option value="">Any</option><option>Hot</option><option>Warm</option><option>Cold</option></select></label>
            <label><span className="label">Min score</span><input name="minscore" type="number" min={0} max={100} defaultValue={sp.minscore} className="input w-20" /></label>
            <label><span className="label">Created from</span><input name="from" type="date" defaultValue={sp.from} className="input w-36" /></label>
            <label><span className="label">to</span><input name="to" type="date" defaultValue={sp.to} className="input w-36" /></label>
            <button className="btn btn-primary">Apply</button>
            {filtered && <Link href={qs({ view: sp.view })} className="btn">Clear all</Link>}
          </form>
          {filtered && (
            <form action={saveView} className="ml-auto flex items-end gap-2">
              <input type="hidden" name="query" value={queryString} />
              <label><span className="label">Save this as a view</span><input name="name" required placeholder="View name" className="input w-40" /></label>
              {can.bulk && <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="shared" /> Share with team</label>}
              <button className="btn">Save view</button>
            </form>
          )}
        </div>
      </details>

      {!leads.length ? (
        <div className="card"><Empty title={filtered ? "No leads match these filters" : "No leads yet for this year"}>{filtered ? <>Try removing a filter, or <Link className="link" href="/leads">see all leads</Link>.</> : "Leads arrive from your website form, ads, WhatsApp and walk-ins. Press N to add the first one."}</Empty></div>
      ) : view === "kanban" ? (
        <Kanban leads={leads} stages={stages.filter((s) => (sp.stage ? s.id === sp.stage : boardPhases.includes(s.phase_key))) as any} reasons={reasons} canEdit={can.edit} />
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {leads.map((l) => (
            <Link key={l.id} href={`/households/${l.household_id}?e=${l.id}`} className="card block p-3 hover:border-brand-500">
              <div className="flex items-start justify-between gap-2"><span className="font-semibold text-slate-900">{l.student}</span><Badge tone={l.color}>{l.stage}</Badge></div>
              <div className="muted">{l.grade} · {l.branch}</div>
              <div className="mt-2">{l.guardian} · {l.mobile}</div>
              <div className="mt-2 flex items-center justify-between text-xs"><span><Temp t={l.temperature} /> <span className="muted ml-1">Score {l.score} · {l.owner}</span></span><span className={l.overdue ? "font-medium text-rose-700" : "muted"}>{l.next ? (l.overdue ? "Overdue: " : "Next: ") + l.next : "No next action"}</span></div>
            </Link>
          ))}
        </div>
      ) : (
        <LeadTable leads={leads} total={total} query={queryString} stages={stages as any} users={users as any} templates={templates as any} reasons={reasons} can={can} />
      )}
      {view !== "kanban" && total > size && (
        <div className="mt-3 flex items-center justify-between">
          <span className="muted">Showing {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}</span>
          <div className="flex gap-2">{page > 1 && <Link className="btn" href={qs(sp, { page: String(page - 1) })}>Previous</Link>}{page * size < total && <Link className="btn" href={qs(sp, { page: String(page + 1) })}>Next</Link>}</div>
        </div>
      )}
    </>
  );
}
