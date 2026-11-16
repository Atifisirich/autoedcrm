"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { quickAdd } from "@/app/actions/leads";
import { markNotificationsRead } from "@/app/actions/session";

/** Phone layout: the sidebar becomes a drawer opened from the top bar. */
export function MenuButton() {
  const path = usePathname();
  useEffect(() => { setNav(false); }, [path]);
  useEffect(() => {
    const scrim = document.getElementById("nav-scrim");
    const close = () => setNav(false);
    scrim?.addEventListener("click", close);
    return () => scrim?.removeEventListener("click", close);
  }, []);
  return <button type="button" onClick={() => setNav(true)} className="btn px-2.5 md:hidden" aria-label="Open menu">☰</button>;
}
function setNav(open: boolean) {
  document.getElementById("sidebar")?.classList.toggle("-translate-x-full", !open);
  document.getElementById("nav-scrim")?.classList.toggle("hidden", !open);
}

export function NavLink({ href, children, badge }: { href: string; children: ReactNode; badge?: number }) {
  const path = usePathname();
  const on = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${on ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10"}`}>
      <span>{children}</span>
      {!!badge && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-slate-900">{badge}</span>}
    </Link>
  );
}

/** Reads the one-shot confirmation cookie set by server actions. */
export function Toast() {
  const [msg, setMsg] = useState<{ message: string; kind: string } | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const m = document.cookie.match(/(?:^|; )aed_flash=([^;]+)/);
      if (!m) return;
      document.cookie = "aed_flash=; path=/; max-age=0";
      try {
        const m2 = JSON.parse(decodeURIComponent(decodeURIComponent(m[1])));
        setMsg(m2);
        if (m2.kind !== "keep") setTimeout(() => setMsg(null), 6000);
      } catch { /* ignore a malformed cookie */ }
    }, 400);
    return () => clearInterval(t);
  }, []);
  if (!msg) return null;
  if (msg.kind === "keep")
    return (
      <div role="alertdialog" aria-label="Important" className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-2xl rounded-md bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
        <p className="select-all break-all font-medium">{msg.message}</p>
        <button onClick={() => setMsg(null)} className="mt-2 rounded bg-white px-2.5 py-1 text-xs font-semibold text-slate-900">I have copied it</button>
      </div>
    );
  return (
    <div role="status" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-lg ${msg.kind === "error" ? "bg-rose-700" : "bg-slate-900"}`}>
      {msg.kind === "error" ? "⚠ " : "✓ "}{msg.message}
    </div>
  );
}

type Opt = { id: string; name: string };
export type QuickAddData = { branches: Opt[]; grades: string[]; boards: string[]; sources: { id: string; name: string; channel: string }[]; branchId: string | null; canCreate: boolean; fields?: { key: string; label: string; options: string[]; required: boolean }[] };

type Dup = { householdId: string; guardian: string; enquiries: { id: string; student: string; grade: string; stage: string; owner: string; year: string }[] } | null;

/** Live duplicate lookup while the mobile number is typed (DUP-01). */
export function useDuplicate(mobile: string, email = "") {
  const [dup, setDup] = useState<Dup>(null);
  useEffect(() => {
    const m = mobile.replace(/\D/g, "");
    if (m.length < 10 && !email.includes("@")) { setDup(null); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/dedupe?mobile=${m}&email=${encodeURIComponent(email)}`, { signal: c.signal }).then((r) => r.json()).then((d) => setDup(d.match)).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); c.abort(); };
  }, [mobile, email]);
  return dup;
}

export function DuplicateNotice({ dup }: { dup: Dup }) {
  if (!dup) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-semibold text-amber-900">This family is already with us: {dup.guardian}</p>
      <ul className="mt-1 space-y-0.5 text-amber-900">
        {dup.enquiries.map((e) => (
          <li key={e.id}>{e.student} · {e.grade ?? "grade not set"} · {e.stage} · owner {e.owner} · {e.year}</li>
        ))}
      </ul>
      <p className="mt-1 text-amber-800">Saving will not create a duplicate. Same child: adds a re-enquiry to the existing record. New child: adds a sibling to this household.</p>
      <Link href={`/households/${dup.householdId}`} className="link mt-1 inline-block">Open the household</Link>
    </div>
  );
}

export function QuickAdd({ data, open, onClose }: { data: QuickAddData; open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(quickAdd, null);
  const [mobile, setMobile] = useState("");
  const dup = useDuplicate(mobile);
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  useEffect(() => {
    if (state?.ok) { onClose(); setMobile(""); if (state.canOpen) router.push(`/households/${state.householdId}?e=${state.enquiryId}`); else router.refresh(); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <dialog ref={ref} onClose={onClose} className="m-0 ml-auto h-full max-h-full w-full max-w-md bg-white p-0 shadow-xl">
      <form action={action} className="flex h-full flex-col">
        <div className="card-h"><span>Quick add enquiry</span><button type="button" onClick={onClose} className="btn btn-sm" aria-label="Close">Esc</button></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block"><span className="label">Parent mobile</span>
            <input name="mobile" required inputMode="numeric" autoFocus value={mobile} onChange={(e) => setMobile(e.target.value)} className="input" placeholder="10-digit mobile" /></label>
          <DuplicateNotice dup={dup} />
          <label className="block"><span className="label">Student name</span><input name="studentName" required className="input" /></label>
          {!dup && <label className="block"><span className="label">Parent / guardian name</span><input name="guardianName" required className="input" /></label>}
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Branch</span>
              <select name="branchId" required defaultValue={data.branchId ?? data.branches[0]?.id} className="input">{data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block"><span className="label">Grade</span>
              <select name="grade" required className="input" defaultValue=""><option value="" disabled>Choose</option>{data.grades.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="block"><span className="label">Board</span>
              <select name="board" className="input">{data.boards.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="block"><span className="label">Source</span>
              <select name="sourceId" required className="input" defaultValue=""><option value="" disabled>Choose</option>{data.sources.map((s) => <option key={s.id} value={s.id}>{s.channel}: {s.name}</option>)}</select></label>
          </div>
          {(data.fields ?? []).length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {data.fields!.map((f) => (
                <label key={f.key} className="block"><span className="label">{f.label}{f.required ? "" : " (optional)"}</span>
                  <select name={`cf_${f.key}`} required={f.required} defaultValue="" className="input"><option value="">Choose</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select></label>
              ))}
            </div>
          )}
          <label className="block"><span className="label">How did they hear about us? (optional)</span><input name="heardAbout" className="input" /></label>
          <label className="block"><span className="label">Note (optional)</span><textarea name="note" rows={2} className="input" /></label>
          <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" name="consent" defaultChecked className="mt-0.5" /> The parent agreed to be contacted about admissions by call, WhatsApp, SMS and email.</label>
          {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">{state.error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-3">
          <button type="button" onClick={onClose} className="btn">Cancel</button>
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : dup ? "Save to this household" : "Save enquiry"}</button>
        </div>
      </form>
    </dialog>
  );
}

type Hit = { href: string; title: string; sub: string };
const JUMPS: Hit[] = [
  { href: "/", title: "My day", sub: "Go to" }, { href: "/leads", title: "Leads", sub: "Go to" }, { href: "/leads?view=kanban", title: "Leads: Kanban board", sub: "Go to" },
  { href: "/inbox", title: "Team inbox", sub: "Go to" }, { href: "/tasks", title: "Tasks", sub: "Go to" }, { href: "/visits", title: "Visits", sub: "Go to" }, { href: "/walkin", title: "Walk-in desk", sub: "Go to" },
  { href: "/applications", title: "Applications", sub: "Go to" }, { href: "/campaigns", title: "Campaigns", sub: "Go to" }, { href: "/reports", title: "Reports", sub: "Go to" }, { href: "/admin", title: "Admin console", sub: "Go to" },
];

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) { ref.current?.showModal(); setTerm(""); } else ref.current?.close(); }, [open]);
  useEffect(() => {
    const jumps = JUMPS.filter((j) => j.title.toLowerCase().includes(term.toLowerCase()));
    setSel(0);
    if (term.trim().length < 2) { setHits(jumps); return; }
    const c = new AbortController();
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: c.signal }).then((r) => r.json()).then((d) => setHits([...d.hits, ...jumps])).catch(() => {}), 120);
    return () => { clearTimeout(t); c.abort(); };
  }, [term]);
  const go = (h?: Hit) => { if (h) { onClose(); router.push(h.href); } };
  return (
    <dialog ref={ref} onClose={onClose} className="mx-auto mt-24 w-full max-w-xl rounded-lg bg-white p-0 shadow-2xl">
      <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search parent, student, mobile, email, application or receipt number…" className="w-full border-b border-slate-200 px-4 py-3 text-base outline-none"
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } if (e.key === "Enter") go(hits[sel]); }} />
      <ul className="max-h-80 overflow-y-auto py-1">
        {hits.map((h, i) => (
          <li key={h.href + i}><button onClick={() => go(h)} onMouseEnter={() => setSel(i)} className={`flex w-full items-center justify-between px-4 py-2 text-left ${i === sel ? "bg-brand-50" : ""}`}><span className="font-medium text-slate-800">{h.title}</span><span className="muted text-xs">{h.sub}</span></button></li>
        ))}
        {!hits.length && <li className="muted px-4 py-6 text-center">Nothing matches “{term}”. Try a mobile number or a student name.</li>}
      </ul>
    </dialog>
  );
}

type Note = { id: string; title: string; link: string | null; category: string; read: boolean; when: string };

export function TopBar({ data, notes, unread, children, menu }: { data: QuickAddData; notes: Note[]; unread: number; children: ReactNode; menu?: ReactNode }) {
  const [add, setAdd] = useState(false);
  const [pal, setPal] = useState(false);
  const [bell, setBell] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal(true); }
      else if (!typing && e.key === "n" && data.canCreate) { e.preventDefault(); setAdd(true); }
      else if (!typing && e.key === "/") { e.preventDefault(); setPal(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.canCreate]);
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
      {menu}
      <button onClick={() => setPal(true)} className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-left text-slate-500 hover:bg-white md:max-w-md">
        <span className="truncate">Search…</span><kbd className="hidden rounded border border-slate-300 bg-white px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 md:flex">{children}</div>
        {data.canCreate && <button onClick={() => setAdd(true)} className="btn btn-primary" title="Shortcut: N" aria-label="Quick add enquiry">+<span className="hidden sm:inline"> Quick add</span></button>}
        <div className="relative">
          <button onClick={() => setBell((b) => !b)} className="btn relative" aria-label={`Notifications, ${unread} unread`}>
            <span className="hidden sm:inline">Alerts</span><span className="sm:hidden" aria-hidden>🔔</span>{unread > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
          </button>
          {bell && (
            <div className="card absolute right-0 mt-1 w-[min(24rem,calc(100vw-1.5rem))] shadow-lg">
              <div className="card-h"><span>Notifications</span>{unread > 0 && <form action={markNotificationsRead}><button className="link text-xs">Mark all read</button></form>}</div>
              <ul className="max-h-96 overflow-y-auto">
                {notes.map((n) => (
                  <li key={n.id} className={`border-b border-slate-100 px-4 py-2 ${n.read ? "" : "bg-brand-50/60"}`}>
                    <Link href={n.link ?? "/"} onClick={() => setBell(false)} className="block">
                      <span className="text-slate-800">{n.title}</span>
                      <span className="muted block text-xs">{n.category.replace("_", " ")} · {n.when}</span>
                    </Link>
                  </li>
                ))}
                {!notes.length && <li className="muted px-4 py-6 text-center">You are all caught up. Assignments, due tasks, parent replies and escalations appear here.</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      <QuickAdd data={data} open={add} onClose={() => setAdd(false)} />
      <Palette open={pal} onClose={() => setPal(false)} />
    </header>
  );
}

/** A select that submits its form on change (year and branch switchers). */
export function AutoSelect({ name, value, options, label }: { name: string; value: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <select name={name} defaultValue={value} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="input w-auto py-1.5 pr-7">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
