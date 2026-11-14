"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bulkAction, moveStage } from "@/app/actions/leads";
import { Badge, DOTS, Temp } from "@/components/ui";

export type Lead = {
  id: string; household_id: string; student: string; guardian: string | null; mobile: string | null; grade: string | null; branch: string; stage: string; stage_id: string; color: string; phase: string;
  owner: string; score: number; temperature: string | null; source: string | null; created: string; next: string | null; nextTitle: string | null; overdue: boolean; reenquired: boolean; family: number; untouched: boolean; tags: string[];
};
type Stage = { id: string; name: string; color: string; phase_name: string; required_fields: string[]; is_closed: boolean };
type Opt = { id: string; name: string };

const COLS: [string, string][] = [["guardian", "Parent"], ["grade", "Grade"], ["branch", "Branch"], ["stage", "Stage"], ["owner", "Owner"], ["score", "Score"], ["next", "Next action"], ["source", "Source"], ["created", "Created"]];

function NextCell({ l }: { l: Lead }) {
  if (!l.next) return <span className="muted">None</span>;
  return <span className={l.overdue ? "font-medium text-rose-700" : ""} title={l.nextTitle ?? ""}>{l.overdue ? "Overdue: " : ""}{l.next}</span>;
}

export function LeadTable({ leads, total, query, stages, users, templates, reasons, can }: { leads: Lead[]; total: number; query: string; stages: Stage[]; users: Opt[]; templates: Opt[]; reasons: string[]; can: { bulk: boolean; reassign: boolean; edit: boolean; message: boolean; export: boolean } }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [dense, setDense] = useState(false);
  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem("aed_cols") ?? "[]")); setDense(localStorage.getItem("aed_dense") === "1"); } catch { /* first visit */ }
  }, []);
  const toggleCol = (k: string) => setHidden((h) => { const n = h.includes(k) ? h.filter((x) => x !== k) : [...h, k]; localStorage.setItem("aed_cols", JSON.stringify(n)); return n; });
  const show = (k: string) => !hidden.includes(k);
  const count = all ? total : sel.size;
  const pad = dense ? "!py-1" : "";
  const stage = stages.find((s) => s.id === action.split(":")[1]);
  return (
    <div className="card overflow-hidden">
      {can.bulk && count > 0 && (
        <form action={bulkAction} onSubmit={(e) => { if (!confirm(`Apply this to ${count} record${count === 1 ? "" : "s"}?`)) e.preventDefault(); else { setSel(new Set()); setAll(false); setAction(""); } }}
          className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-3 py-2">
          <input type="hidden" name="ids" value={[...sel].join(",")} /><input type="hidden" name="all" value={all ? "1" : "0"} /><input type="hidden" name="query" value={query} />
          <span className="font-semibold text-brand-900">{count} selected</span>
          {!all && sel.size === leads.length && total > leads.length && <button type="button" onClick={() => setAll(true)} className="link text-xs">Select all {total} matching this filter</button>}
          <select name="action" required value={action.split(":")[0]} onChange={(e) => setAction(e.target.value)} className="input w-auto">
            <option value="">Choose an action…</option>
            {can.edit && <option value="stage">Change stage</option>}
            {can.reassign && <option value="reassign">Reassign</option>}
            <option value="task">Add task</option>
            {can.message && <option value="message">Send template</option>}
            <option value="tag">Add tag</option>
          </select>
          {action.startsWith("stage") && <select name="stageId" required className="input w-auto" onChange={(e) => setAction("stage:" + e.target.value)}><option value="">Stage…</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.phase_name}: {s.name}</option>)}</select>}
          {stage?.required_fields.includes("closure_reason") && <select name="closure_reason" required className="input w-auto"><option value="">Closure reason…</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>}
          {action === "reassign" && <><select name="ownerId" required className="input w-auto"><option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><input name="reason" placeholder="Reason" required className="input w-40" /></>}
          {action === "task" && <><input name="title" placeholder="Task title" required className="input w-48" /><input type="datetime-local" name="dueAt" required className="input w-auto" /></>}
          {action === "message" && <select name="templateId" required className="input w-auto"><option value="">Template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
          {action === "tag" && <input name="tag" placeholder="Tag" required className="input w-40" />}
          <button className="btn btn-primary">Apply to {count}</button>
          {can.export && <a className="btn" href={`/api/export?${all ? query : "year=all&ids=" + [...sel].join(",")}`}>Export CSV</a>}
          <button type="button" className="btn" onClick={() => { setSel(new Set()); setAll(false); }}>Clear</button>
        </form>
      )}
      <div className="flex items-center justify-end gap-3 border-b border-slate-100 px-3 py-1.5 text-xs">
        <details className="relative">
          <summary className="link cursor-pointer list-none">Columns</summary>
          <div className="card absolute right-0 z-10 mt-1 w-44 p-2 shadow-lg">{COLS.map(([k, label]) => <label key={k} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={show(k)} onChange={() => toggleCol(k)} />{label}</label>)}</div>
        </details>
        <button className="link" onClick={() => setDense((d) => { localStorage.setItem("aed_dense", d ? "0" : "1"); return !d; })}>{dense ? "Comfortable rows" : "Compact rows"}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr>
            {can.bulk && <th className="w-8"><input type="checkbox" aria-label="Select all on this page" checked={leads.length > 0 && sel.size === leads.length} onChange={(e) => { setAll(false); setSel(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set()); }} /></th>}
            <th className="sticky left-0 bg-slate-50">Student</th>
            {COLS.filter(([k]) => show(k)).map(([k, label]) => <th key={k}>{label}</th>)}
          </tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                {can.bulk && <td className={pad}><input type="checkbox" aria-label={`Select ${l.student}`} checked={all || sel.has(l.id)} onChange={() => { setAll(false); setSel((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; }); }} /></td>}
                <td className={`sticky left-0 bg-white ${pad}`}>
                  <Link href={`/households/${l.household_id}?e=${l.id}`} className="link">{l.student}</Link>
                  {l.family > 1 && <span className="ml-1.5" title="More than one child in this household"><Badge tone="teal">Family of {l.family}</Badge></span>}
                  {l.reenquired && <span className="ml-1.5"><Badge tone="amber">Re-enquired</Badge></span>}
                </td>
                {show("guardian") && <td className={pad}>{l.guardian}<span className="muted block text-xs">{l.mobile}</span></td>}
                {show("grade") && <td className={pad}>{l.grade}</td>}
                {show("branch") && <td className={pad}>{l.branch}</td>}
                {show("stage") && <td className={pad}><Badge tone={l.color}>{l.stage}</Badge></td>}
                {show("owner") && <td className={pad}>{l.owner}</td>}
                {show("score") && <td className={pad}><span className="mr-1.5 tabular-nums">{l.score}</span><Temp t={l.temperature} /></td>}
                {show("next") && <td className={pad}><NextCell l={l} /></td>}
                {show("source") && <td className={pad}>{l.source}</td>}
                {show("created") && <td className={`${pad} whitespace-nowrap`}>{l.created}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Kanban({ leads, stages, reasons, canEdit }: { leads: Lead[]; stages: Stage[]; reasons: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(leads);
  const [over, setOver] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ lead: Lead; stage: Stage; missing: string[] } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => setItems(leads), [leads]);
  useEffect(() => { if (ask) dlg.current?.showModal(); else dlg.current?.close(); }, [ask]);
  const byStage = useMemo(() => { const m: Record<string, Lead[]> = {}; for (const l of items) (m[l.stage_id] ??= []).push(l); return m; }, [items]);

  const drop = (leadId: string, stage: Stage, extra: { closure_reason?: string } = {}) => {
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stage.id) return;
    start(async () => {
      const res = await moveStage(leadId, stage.id, extra);
      if (res.ok) { setItems((xs) => xs.map((l) => (l.id === leadId ? { ...l, stage_id: stage.id, stage: stage.name, color: stage.color } : l))); setAsk(null); setError(""); router.refresh(); }
      else if (res.missing) setAsk({ lead, stage, missing: res.missing });
      else setError(res.error ?? "Could not move this record.");
    });
  };
  return (
    <>
      {error && <p role="alert" className="mb-2 rounded-md bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
      <div className={`flex gap-3 overflow-x-auto pb-3 ${pending ? "opacity-70" : ""}`}>
        {stages.map((s) => (
          <section key={s.id} aria-label={s.name} onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); drop(e.dataTransfer.getData("text/plain"), s); }}
            className={`flex w-64 shrink-0 flex-col rounded-lg border bg-slate-100 ${over === s.id ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
            <header className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><span className={`h-2 w-2 rounded-full ${DOTS[s.color]}`} />{s.name}</span>
              <span className="text-xs font-semibold text-slate-500">{byStage[s.id]?.length ?? 0}</span>
            </header>
            <div className="max-h-[65vh] min-h-16 space-y-2 overflow-y-auto px-2 pb-2">
              {(byStage[s.id] ?? []).map((l) => (
                <article key={l.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)} className={`card p-2.5 shadow-xs ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}>
                  <Link href={`/households/${l.household_id}?e=${l.id}`} className="link">{l.student}</Link>
                  <div className="muted text-xs">{l.grade} · {l.guardian}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1"><Temp t={l.temperature} /><span className="text-xs text-slate-500">Score {l.score}</span></div>
                  <div className="mt-1.5 flex items-center justify-between text-xs"><span className="muted">{l.owner}</span><NextCell l={l} /></div>
                </article>
              ))}
              {!byStage[s.id]?.length && <p className="muted px-1 py-3 text-center text-xs">{canEdit ? "Drop a card here" : "No records"}</p>}
            </div>
          </section>
        ))}
      </div>
      <dialog ref={dlg} onClose={() => setAsk(null)} className="m-auto w-full max-w-sm rounded-lg bg-white p-0 shadow-xl">
        {ask && (
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); drop(ask.lead.id, ask.stage, { closure_reason: String(f.get("closure_reason") ?? "") || undefined }); }}>
            <div className="card-h">Move {ask.lead.student} to {ask.stage.name}</div>
            <div className="space-y-3 p-4">
              {ask.missing.includes("closure_reason") && <label className="block"><span className="label">Why is this enquiry closing?</span><select name="closure_reason" required className="input"><option value="">Choose a reason</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label>}
              {ask.missing.includes("visit") && <p>This stage needs a booked campus visit. <Link className="link" href={`/households/${ask.lead.household_id}?e=${ask.lead.id}&panel=visit`}>Book the visit</Link> and the record moves here by itself.</p>}
              {ask.missing.includes("expected_decision") && <p>This stage needs an expected decision date. Set it on the record first.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-3">
              <button type="button" className="btn" onClick={() => setAsk(null)}>Cancel</button>
              {ask.missing.includes("closure_reason") && <button className="btn btn-primary" disabled={pending}>Move</button>}
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
