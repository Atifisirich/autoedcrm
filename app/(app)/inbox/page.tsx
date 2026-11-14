import Link from "next/link";
import { requireCtx, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime, rel } from "@/lib/fmt";
import { canMessage, leadScope } from "@/lib/perm";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { inboxStatus, sendMsg, simulateReply } from "@/app/actions/record";

/** Shared WhatsApp team inbox (WA-02): owner, status, unread, SLA timer, 24-hour window, notes, quick replies. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ h?: string; f?: string }> }) {
  const ctx = await requireCtx("leads");
  const { h, f = "open" } = await searchParams;
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps);
  const convs = await q(
    `select hh.id, hh.inbox_status, g.name as guardian, g.mobile, min(st.name) as student, min(u.name) as owner,
       max(m.created_at) as last_at, max(m.created_at) filter (where m.direction='in') as last_in,
       (array_agg(m.body order by m.created_at desc))[1] as last_body, (array_agg(m.direction order by m.created_at desc) filter (where not m.is_note))[1] as last_dir,
       count(*) filter (where m.direction='in' and not m.read)::int as unread
     from messages m join households hh on hh.id=m.household_id join enquiries e on e.household_id=hh.id join students st on st.id=e.student_id join users u on u.id=e.owner_id
     left join lateral (select name, mobile from guardians g where g.household_id=hh.id order by is_primary desc limit 1) g on true
     where ${scope} and m.channel='whatsapp' group by hh.id, g.name, g.mobile order by last_at desc limit 200`,
    ps,
  );
  const list = convs.filter((c) => (f === "all" ? true : f === "unread" ? c.unread > 0 : f === "unanswered" ? c.last_dir === "in" : c.inbox_status === f));
  const cur = convs.find((c) => c.id === h) ?? list[0];
  const msgs = cur ? await q("select m.*, u.name as sender from messages m left join users u on u.id=m.sender_id where m.tenant_id=$1 and m.household_id=$2 and m.channel='whatsapp' order by m.created_at", [ctx.tenantId, cur.id]) : [];
  const enq = cur ? await q(`select e.id, st.name as student, e.grade, s.name as stage, s.color, e.score, e.temperature from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id where ${scope} and e.household_id=$${ps.length + 1}`, [...ps, cur.id]) : [];
  const templates = await q("select id, name, body from templates where tenant_id=$1 and channel='whatsapp' and status='approved' order by name", [ctx.tenantId]);
  const windowOpen = cur?.last_in && Date.now() - +new Date(cur.last_in) < 24 * 3600e3;
  const sla = Number(ctx.tenant.settings.first_response_mins ?? 30);
  const can = canMessage(ctx.perms);
  const tabs = [["open", "Open"], ["waiting", "Waiting on parent"], ["closed", "Closed"], ["unread", "Unread"], ["unanswered", "Read but not replied"], ["all", "All"]];
  return (
    <>
      <PageHeader title="Team inbox" sub={leadScope(ctx.perms) === "own" ? "WhatsApp conversations for your families" : "WhatsApp conversations across the team"} />
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map(([k, l]) => <Link key={k} href={`/inbox?f=${k}`} className={`tab ${f === k ? "tab-on" : ""}`}>{l}</Link>)}</div>
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr_16rem]">
        <section className="card max-h-[72vh] overflow-y-auto" aria-label="Conversations">
          {!list.length && <Empty title="No conversations here">New WhatsApp chats on the school number appear here and are matched to a household.</Empty>}
          {list.map((c) => {
            const waiting = c.last_dir === "in" ? Math.round((Date.now() - +new Date(c.last_in)) / 60000) : 0;
            return (
              <Link key={c.id} href={`/inbox?f=${f}&h=${c.id}`} className={`block border-b border-slate-100 px-3 py-2.5 ${cur?.id === c.id ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold text-slate-800">{c.guardian}</span>{c.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{c.unread} new</span>}</div>
                <div className="muted truncate text-xs">{c.student} · owner {c.owner}</div>
                <div className="truncate text-xs text-slate-600">{c.last_dir === "out" ? "You: " : ""}{c.last_body}</div>
                <div className="mt-0.5 flex items-center justify-between text-[11px]"><span className="muted">{rel(c.last_at)}</span>{waiting > 0 && <span className={waiting > sla ? "font-semibold text-rose-700" : "text-amber-700"}>⏱ waiting {waiting < 60 ? `${waiting} min` : rel(c.last_in).replace(" ago", "")}</span>}</div>
              </Link>
            );
          })}
        </section>
        <section className="card flex max-h-[72vh] flex-col" aria-label="Thread">
          {!cur ? <Empty title="Pick a conversation" /> : (
            <>
              <div className="card-h">
                <span>{cur.guardian} <span className="muted font-normal">+91 {cur.mobile}</span></span>
                <form action={inboxStatus} className="flex items-center gap-1.5">
                  <input type="hidden" name="householdId" value={cur.id} />
                  <Badge tone={windowOpen ? "green" : "amber"} title="WhatsApp only allows free-text replies within 24 hours of the parent's last message">{windowOpen ? "24-hour window open" : "Window closed: templates only"}</Badge>
                  {cur.inbox_status !== "closed" ? <button name="status" value="closed" className="btn btn-sm">Close</button> : <button name="status" value="open" className="btn btn-sm">Reopen</button>}
                </form>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 ${m.is_note ? "border border-amber-300 bg-amber-50" : m.direction === "in" ? "border border-slate-200 bg-white" : m.status === "failed" ? "border border-rose-300 bg-rose-50" : "bg-brand-100"}`}>
                      {m.is_note && <div className="text-[11px] font-semibold text-amber-800">Internal note (not sent to the parent)</div>}
                      <p className="whitespace-pre-wrap text-slate-800">{m.body}</p>
                      {m.status === "failed" && <p className="mt-1 text-xs font-medium text-rose-700">Not delivered: {m.fail_reason}</p>}
                      <div className="muted mt-0.5 text-[11px]">{m.direction === "in" ? cur.guardian : m.sender ?? "Automatic"} · {fmtDateTime(m.created_at)}{m.direction === "out" && !m.is_note && m.status !== "failed" ? " · delivered" : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
              {can && (
                <form action={sendMsg} className="space-y-2 border-t border-slate-200 p-3">
                  <input type="hidden" name="enquiryId" value={enq[0]?.id ?? ""} /><input type="hidden" name="channel" value="whatsapp" />
                  <div className="flex flex-wrap items-center gap-2">
                    <select name="templateId" required={!windowOpen} className="input w-56" aria-label="Template or quick reply"><option value="">{windowOpen ? "Free text (or pick a quick reply)" : "Choose a template"}</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="note" /> Internal note</label>
                  </div>
                  <div className="flex gap-2"><textarea name="body" rows={2} className="input" placeholder={windowOpen ? "Type a reply. If a template is chosen above, it is sent instead." : "Free text is only possible as an internal note right now."} /><button className="btn btn-primary self-end">Send</button></div>
                </form>
              )}
            </>
          )}
        </section>
        <aside className="space-y-3">
          {cur && (
            <>
              <section className="card p-3">
                <p className="text-xs font-semibold text-slate-600">Family</p>
                {enq.map((e) => <Link key={e.id} href={`/households/${cur.id}?e=${e.id}`} className="mt-1.5 block rounded-md border border-slate-200 p-2 hover:border-brand-500"><span className="link">{e.student}</span> <span className="muted text-xs">· {e.grade}</span><div className="mt-1 flex items-center gap-1.5"><Badge tone={e.color}>{e.stage}</Badge><span className="muted text-xs">Score {e.score}</span></div></Link>)}
                <p className="muted mt-2 text-xs">Owner: {cur.owner}</p>
              </section>
              <form action={simulateReply} className="card space-y-2 border-dashed p-3">
                <input type="hidden" name="householdId" value={cur.id} />
                <p className="text-xs font-semibold text-slate-600">Demo: simulate a parent reply</p>
                <p className="muted text-xs">No live WhatsApp number is connected, so this stands in for the provider webhook. Try “STOP” to see opt-out handling.</p>
                <input name="body" className="input" placeholder="Parent's message" />
                <button className="btn btn-sm w-full">Receive reply</button>
              </form>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
