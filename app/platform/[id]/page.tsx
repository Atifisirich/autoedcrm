import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatform } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { fmtDateTime, inr, rel } from "@/lib/fmt";
import { PACKS } from "@/lib/seed";
import { Badge, PageHeader, Stat } from "@/components/ui";
import { impersonate, requestAccess, tenantAction } from "@/app/actions/platform";

const ONBOARDING: [string, string][] = [["branches", "Branches set up"], ["users", "Users invited"], ["whatsapp", "WhatsApp number approved"], ["dlt", "SMS DLT registration"], ["telephony", "Telephony connected"], ["forms", "Forms live"], ["migration", "Data migrated"], ["training", "Training done"]];
const FLAGS: [string, string][] = [["ai_summary", "AI summary on the 360 page"], ["parent_portal", "Parent portal"], ["voice_agent", "AI voice agent"]];

/** Tenant page (key screen): plan, usage, wallet, health, onboarding checklist, tickets, feature flags. */
export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePlatform();
  const { id } = await params;
  const t = await one("select * from tenants where id=$1", [id]);
  if (!t) notFound();
  const [c, users, ledger, tickets, grants] = await Promise.all([
    one(`select (select count(*)::int from users where tenant_id=$1 and status='active') as users, (select count(*)::int from users where tenant_id=$1 and last_login>now()-interval '7 days') as active,
         (select count(*)::int from branches where tenant_id=$1) as branches, (select count(*)::int from households where tenant_id=$1) as households, (select count(*)::int from enquiries where tenant_id=$1) as enquiries,
         (select count(*)::int from messages where tenant_id=$1 and direction='out' and created_at>now()-interval '30 days') as messages, (select count(*)::int from workflow_runs where tenant_id=$1 and created_at>now()-interval '30 days' and not test) as runs,
         (select count(*)::int from workflow_runs where tenant_id=$1 and status='error') as errors`, [id]),
    q("select u.id, u.name, u.email, r.name as role, u.last_login from users u left join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active' order by u.name", [id]),
    q("select * from wallet_ledger where tenant_id=$1 order by created_at desc limit 8", [id]),
    q("select * from tickets where tenant_id=$1 order by created_at desc limit 8", [id]),
    q("select s.*, u.name as agent from support_access s left join users u on u.id=s.requested_by where s.tenant_id=$1 order by s.created_at desc limit 5", [id]),
  ]);
  const mine = grants.find((g) => g.requested_by === me.id && g.status === "approved" && new Date(g.expires_at) > new Date());
  const hidden = <input type="hidden" name="id" value={id} />;
  return (
    <>
      <PageHeader title={t.name} sub={<>{t.subdomain} · {PACKS[t.pack]?.label} · region {t.region} · created {rel(t.created_at)}</>}>
        <Link href="/platform" className="btn">← All tenants</Link>
      </PageHeader>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Status" value={<Badge tone={t.status === "active" ? "green" : t.status === "trial" ? "sky" : "amber"}>{t.status}</Badge>} sub={`Plan: ${t.plan}`} />
        <Stat label="Users (active 7 days)" value={`${c!.users} (${c!.active})`} />
        <Stat label="Branches" value={c!.branches} /><Stat label="Households / enquiries" value={`${c!.households} / ${c!.enquiries}`} />
        <Stat label="Messages, 30 days" value={c!.messages} sub={`${c!.runs} automation runs`} /><Stat label="Automation errors" value={c!.errors} tone={c!.errors ? "bad" : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="card-h">Lifecycle and plan</div>
          <div className="space-y-3 p-4">
            <form action={tenantAction} className="flex items-end gap-2">{hidden}<input type="hidden" name="what" value="status" /><label><span className="label">Status</span><select name="status" defaultValue={t.status} className="input w-44">{["trial", "active", "suspended", "cancelled", "archived"].map((s) => <option key={s}>{s}</option>)}</select></label><button className="btn">Change status</button></form>
            <form action={tenantAction} className="flex items-end gap-2">{hidden}<input type="hidden" name="what" value="plan" /><label><span className="label">Plan</span><select name="plan" defaultValue={t.plan} className="input w-44">{["starter", "growth", "group"].map((s) => <option key={s}>{s}</option>)}</select></label><button className="btn">Change plan</button></form>
            <p className="muted text-xs">Suspended tenants are read-only. Cancelled and archived tenants cannot sign in. Plan limits the number of branches.</p>
          </div>
        </section>
        <section className="card">
          <div className="card-h"><span>Credit wallet</span><span className="font-semibold">{inr(t.wallet_balance)}</span></div>
          <form action={tenantAction} className="flex flex-wrap items-end gap-2 p-4">{hidden}<input type="hidden" name="what" value="credits" /><label><span className="label">Add credits (₹)</span><input name="amount" type="number" min={1} required className="input w-32" /></label><label><span className="label">Note / invoice no.</span><input name="note" className="input w-56" /></label><button className="btn btn-primary">Record recharge</button></form>
          <table className="tbl"><tbody>{ledger.map((l) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{l.category}</td><td className="muted">{l.note}</td><td className="text-right tabular-nums">{l.type === "credit" ? "+" : "−"}₹{Number(l.amount).toFixed(2)}</td></tr>)}</tbody></table>
        </section>
        <section className="card">
          <div className="card-h">Onboarding tracker</div>
          <ul className="divide-y divide-slate-100">{ONBOARDING.map(([k, label]) => <li key={k} className="flex items-center justify-between px-4 py-2"><span className={t.onboarding?.[k] ? "text-slate-500" : "font-medium"}>{t.onboarding?.[k] ? "✓" : "○"} {label}</span><form action={tenantAction}>{hidden}<input type="hidden" name="what" value="onboarding" /><input type="hidden" name="item" value={k} /><button name="on" value={t.onboarding?.[k] ? "0" : "1"} className="btn btn-sm">{t.onboarding?.[k] ? "Reopen" : "Mark done"}</button></form></li>)}</ul>
        </section>
        <section className="card">
          <div className="card-h">Feature flags</div>
          <ul className="divide-y divide-slate-100">{FLAGS.map(([k, label]) => <li key={k} className="flex items-center justify-between px-4 py-2"><span>{label} {t.flags?.[k] ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</span><form action={tenantAction}>{hidden}<input type="hidden" name="what" value="flag" /><input type="hidden" name="flag" value={k} /><button name="on" value={t.flags?.[k] ? "0" : "1"} className="btn btn-sm">{t.flags?.[k] ? "Turn off" : "Turn on"}</button></form></li>)}</ul>
          <p className="muted px-4 py-2 text-xs">These flags are stored and audited. The features behind them are on the roadmap and not built yet.</p>
        </section>
        <section className="card">
          <div className="card-h">Support access (needs the school's approval)</div>
          <div className="space-y-3 p-4">
            {mine ? (
              <form action={impersonate} className="flex flex-wrap items-end gap-2">{hidden}<p className="w-full text-green-800">Approved until {fmtDateTime(mine.expires_at)}.</p><label><span className="label">View as</span><select name="userId" className="input w-64">{users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></label><button className="btn btn-primary">Start session</button></form>
            ) : (
              <form action={requestAccess} className="flex flex-wrap items-end gap-2">{hidden}<label><span className="label">Reason (shown to the school admin)</span><input name="reason" required className="input w-80" placeholder="Investigating ticket: template stuck in review" /></label><button className="btn">Request access</button></form>
            )}
            <ul className="space-y-1 text-xs">{grants.map((g) => <li key={g.id} className="muted">{g.agent}: {g.reason} · <b>{g.status}</b>{g.expires_at ? ` · until ${fmtDateTime(g.expires_at)}` : ""}</li>)}</ul>
          </div>
        </section>
        <section className="card">
          <div className="card-h"><span>Tickets</span><Link className="link text-xs" href="/platform?tab=tickets">Support desk</Link></div>
          <ul className="divide-y divide-slate-100">{tickets.map((k) => <li key={k.id} className="px-4 py-2"><b>{k.subject}</b> <Badge tone={k.status === "open" ? "amber" : "green"}>{k.status}</Badge><span className="muted block text-xs">{k.body}</span></li>)}{!tickets.length && <li className="muted px-4 py-3">No tickets.</li>}</ul>
        </section>
      </div>
    </>
  );
}
