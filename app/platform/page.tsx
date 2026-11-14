import Link from "next/link";
import { requirePlatform } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtDateTime, inr, rel } from "@/lib/fmt";
import { PACKS } from "@/lib/seed";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { createTenantAction, replyTicket } from "@/app/actions/platform";

const TONE: Record<string, string> = { active: "green", trial: "sky", suspended: "amber", cancelled: "rose", archived: "slate" };

/** Health score (PS-03): recent logins, response time, automation errors and credit balance, 0 to 100. */
function health(t: any): number {
  let s = 100;
  if (t.active_7d === 0) s -= 40; else if (t.active_7d < t.users / 2) s -= 15;
  if (t.untouched > 5) s -= 20;
  if (t.wf_errors > 0) s -= 10;
  if (Number(t.wallet_balance) < 200) s -= 15;
  if (t.open_tickets > 2) s -= 10;
  return Math.max(0, s);
}

export default async function PlatformHome({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePlatform();
  const { tab = "tenants" } = await searchParams;
  const tenants = await q(
    `select t.*, (select count(*)::int from users u where u.tenant_id=t.id and u.status='active') as users,
       (select count(*)::int from users u where u.tenant_id=t.id and u.last_login > now() - interval '7 days') as active_7d,
       (select count(*)::int from branches b where b.tenant_id=t.id) as branches,
       (select count(*)::int from enquiries e where e.tenant_id=t.id) as enquiries,
       (select count(*)::int from enquiries e join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id where e.tenant_id=t.id and p.key='enquiry' and e.first_response_at is null) as untouched,
       (select count(*)::int from workflow_runs r where r.tenant_id=t.id and r.status='error') as wf_errors,
       (select count(*)::int from tickets k where k.tenant_id=t.id and k.status='open') as open_tickets
     from tenants t order by t.created_at`);
  const tickets = await q("select k.*, t.name as tenant, u.name as by from tickets k join tenants t on t.id=k.tenant_id left join users u on u.id=k.user_id order by (k.status='open') desc, k.created_at desc limit 50");
  return (
    <>
      <PageHeader title={tab === "tickets" ? "Support desk" : tab === "ops" ? "Product operations" : "Tenants"} sub="Not visible to schools" />
      {tab === "tenants" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Tenants" value={tenants.length} /><Stat label="Active" value={tenants.filter((t) => t.status === "active").length} tone="good" /><Stat label="On trial" value={tenants.filter((t) => t.status === "trial").length} /><Stat label="Open tickets" value={tickets.filter((k) => k.status === "open").length} href="/platform?tab=tickets" />
          </div>
          <section className="card mb-4 overflow-x-auto">
            <table className="tbl"><thead><tr><th>Organisation</th><th>Plan</th><th>Status</th><th>Branches</th><th>Users (active 7d)</th><th>Enquiries</th><th>Wallet</th><th>Health</th><th>Go-live</th></tr></thead>
              <tbody>{tenants.map((t) => { const h = health(t); return (
                <tr key={t.id}><td><Link className="link" href={`/platform/${t.id}`}>{t.name}</Link><span className="muted block text-xs">{t.subdomain} · {PACKS[t.pack]?.label}</span></td><td>{t.plan}</td><td><Badge tone={TONE[t.status]}>{t.status}</Badge></td><td>{t.branches}</td><td>{t.users} ({t.active_7d})</td><td>{t.enquiries}</td>
                  <td className={Number(t.wallet_balance) < 200 ? "font-semibold text-rose-700" : ""}>{inr(t.wallet_balance)}</td><td><Badge tone={h >= 80 ? "green" : h >= 55 ? "amber" : "rose"}>{h >= 80 ? "Healthy" : h >= 55 ? "Watch" : "At risk"} · {h}</Badge></td><td>{t.go_live_date ? fmtDate(t.go_live_date) : "Not set"}</td></tr>); })}</tbody></table>
          </section>
          <section className="card">
            <div className="card-h">Create a tenant</div>
            <form action={createTenantAction} className="grid gap-3 p-4 md:grid-cols-4">
              <label><span className="label">Organisation name</span><input name="name" required className="input" /></label>
              <label><span className="label">Sub-domain</span><input name="subdomain" required pattern="[a-z0-9-]{3,}" className="input" placeholder="sunrise" /></label>
              <label><span className="label">Plan</span><select name="plan" className="input"><option value="starter">Starter (1 branch)</option><option value="growth">Growth (5 branches)</option><option value="group">Group (50 branches)</option></select></label>
              <label><span className="label">Starter configuration pack</span><select name="pack" className="input">{Object.entries(PACKS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
              <label><span className="label">First branch</span><input name="branchName" className="input" placeholder="Main campus" /></label>
              <label><span className="label">City</span><input name="city" className="input" /></label>
              <label><span className="label">First admin name</span><input name="adminName" required className="input" /></label>
              <label><span className="label">First admin email</span><input name="adminEmail" type="email" required className="input" /></label>
              <label><span className="label">Region</span><select name="region" className="input"><option value="in-south">India (south)</option><option value="in-west">India (west)</option></select></label>
              <div className="flex items-end"><button className="btn btn-primary">Create tenant</button></div>
              <p className="muted text-xs md:col-span-4">Installs default roles, the pipeline, sources, message templates, the 16 automation recipes, an enquiry form, the first branch with programmes, and the current academic year.</p>
            </form>
          </section>
        </>
      )}
      {tab === "tickets" && (
        <section className="card">
          {!tickets.length && <Empty title="No tickets" />}
          <div className="divide-y divide-slate-100">
            {tickets.map((k) => (
              <div key={k.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_24rem]">
                <div><Badge tone={k.kind === "feature" ? "violet" : "sky"}>{k.kind === "feature" ? "Feature request" : "Ticket"}</Badge> {k.priority === "high" && <Badge tone="red">High</Badge>} <Badge tone={k.status === "open" ? "amber" : "green"}>{k.status}</Badge>
                  <p className="mt-1 font-semibold">{k.subject}</p><p className="muted text-sm">{k.body}</p><p className="muted mt-1 text-xs"><Link className="link" href={`/platform/${k.tenant_id}`}>{k.tenant}</Link> · {k.by} · {rel(k.created_at)}</p></div>
                <form action={replyTicket} className="space-y-1.5"><input type="hidden" name="id" value={k.id} /><textarea name="reply" rows={2} defaultValue={k.reply ?? ""} placeholder="Reply shown to the school" className="input" /><div className="flex gap-1.5"><button name="close" value="0" className="btn btn-sm">Reply</button><button name="close" value="1" className="btn btn-sm btn-primary">Reply and close</button></div></form>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "ops" && <Ops />}
    </>
  );
}

async function Ops() {
  const jobs = await q("select j.kind, j.status, j.run_at, j.result, t.name as tenant from jobs j join tenants t on t.id=j.tenant_id order by j.run_at desc limit 30");
  const stats = await q("select status, count(*)::int n from messages where direction='out' and created_at > now() - interval '7 days' group by status");
  const imports = await q("select b.file_name, b.total, b.created, b.failed, b.status, b.created_at, t.name as tenant from import_batches b join tenants t on t.id=b.tenant_id order by b.created_at desc limit 10");
  const log = await q("select * from audit_events where action in ('platform','support') order by created_at desc limit 25");
  const total = stats.reduce((a, s) => a + s.n, 0), ok = stats.find((s) => s.status === "delivered")?.n ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Messages, 7 days" value={total} /><Stat label="Delivery rate" value={total ? Math.round((ok / total) * 100) + "%" : "–"} /><Stat label="Queued jobs" value={jobs.filter((j) => j.status === "queued").length} /><Stat label="Failed jobs" value={jobs.filter((j) => j.status === "failed").length} tone={jobs.some((j) => j.status === "failed") ? "bad" : undefined} /></div>
      <section className="card overflow-x-auto"><div className="card-h">Background jobs</div>{!jobs.length ? <Empty title="No jobs yet">Workflow waits, and their results, appear here.</Empty> : <table className="tbl"><thead><tr><th>Tenant</th><th>Job</th><th>Runs at</th><th>Status</th><th>Result</th></tr></thead><tbody>{jobs.map((j, i) => <tr key={i}><td>{j.tenant}</td><td>{j.kind.replace("_", " ")}</td><td>{fmtDateTime(j.run_at)}</td><td><Badge tone={j.status === "failed" ? "rose" : j.status === "queued" ? "amber" : "green"}>{j.status}</Badge></td><td className="muted">{j.result}</td></tr>)}</tbody></table>}</section>
      <section className="card overflow-x-auto"><div className="card-h">Recent imports</div><table className="tbl"><tbody>{imports.map((b, i) => <tr key={i}><td>{b.tenant}</td><td>{b.file_name}</td><td>{b.total} rows · {b.created} created · {b.failed} problems</td><td>{b.status}</td><td>{rel(b.created_at)}</td></tr>)}{!imports.length && <tr><td className="muted">None yet.</td></tr>}</tbody></table></section>
      <section className="card overflow-x-auto"><div className="card-h">Audit of our own staff</div><table className="tbl"><tbody>{log.map((a) => <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.created_at)}</td><td>{a.user_name}</td><td>{a.summary}</td></tr>)}{!log.length && <tr><td className="muted">No staff actions yet.</td></tr>}</tbody></table></section>
    </div>
  );
}
