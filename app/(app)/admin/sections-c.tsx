import Link from "next/link";
import type { Ctx } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime, inr, rel } from "@/lib/fmt";
import { isFullAdmin } from "@/lib/perm";
import { Badge, Bars, Empty, Field, Stat } from "@/components/ui";
import { createApiKey, eraseHousehold, importCsv, integrationAction, metaAction, reviewRows, saveMeta, supportAccess, undoImport } from "@/app/actions/admin";
import { getSecret, secretHint } from "@/lib/secrets";
import { raiseTicket } from "@/app/actions/session";

const CONNECTORS: [string, string, string][] = [
  ["WhatsApp Business API (Meta Cloud API)", "Messaging", "meta"], ["SMS (DLT registered)", "Messaging", "simulated"], ["Email sending domain", "Messaging", "simulated"],
  ["Cloud telephony", "Telephony", "not_connected"], ["Meta lead ads", "Lead ads", "not_connected"], ["Google Ads lead forms", "Lead ads", "not_connected"],
  ["Payment gateway (Razorpay / PayU / Cashfree)", "Payments", "simulated"], ["School ERP", "ERP", "not_connected"], ["Website forms and REST API", "Website", "live"], ["Outbound webhooks", "Automation", "live"],
];

async function MetaSetup({ ctx }: { ctx: Ctx }) {
  const t = ctx.tenantId;
  const wa = ctx.tenant.settings.integrations?.whatsapp ?? {};
  const ml = ctx.tenant.settings.integrations?.meta_leads ?? {};
  const [tokenHint, secretH, pageHint, verify, key, leads, tpl] = await Promise.all([
    secretHint(t, "wa_token"), secretHint(t, "meta_app_secret"), secretHint(t, "meta_page_token"), getSecret(t, "meta_verify_token"),
    q("select webhook_key from tenants where id=$1", [t]),
    q("select status, count(*)::int n from meta_leads where tenant_id=$1 group by status", [t]),
    q("select coalesce(meta_status,'not sent') as s, count(*)::int n from templates where tenant_id=$1 and channel='whatsapp' group by 1", [t]),
  ]);
  const hook = `${process.env.APP_URL ?? "https://YOUR-DOMAIN"}/api/webhooks/meta/${key[0]?.webhook_key}`;
  const live = wa.enabled && wa.phone_number_id && tokenHint;
  return (
    <section className="card">
      <div className="card-h"><span>Meta: WhatsApp and lead ads</span>{live ? <Badge tone="green">WhatsApp live</Badge> : <Badge tone="amber">WhatsApp simulated</Badge>}</div>
      <div className="space-y-5 p-4">
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>In Meta Business Suite create (or open) your app with the <b>WhatsApp</b> product and add your school number.</li>
          <li>Create a <b>System User</b> with a permanent token that has <code>whatsapp_business_messaging</code>, <code>whatsapp_business_management</code> and, for lead ads, <code>leads_retrieval</code> and <code>pages_manage_metadata</code>.</li>
          <li>In the app's <b>Webhooks</b> settings paste the callback URL and verify token below, then subscribe to <code>messages</code>, <code>message_template_status_update</code> and, on the Page object, <code>leadgen</code>.</li>
          <li>Fill in the IDs and tokens here, tick Use for sending, Save, then Test. Then Sync templates and wait for Meta's approval.</li>
        </ol>
        <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-xs md:grid-cols-[9rem_1fr]">
          <span className="font-semibold">Callback URL</span><code className="select-all break-all">{hook}</code>
          <span className="font-semibold">Verify token</span><span className="flex flex-wrap items-center gap-2"><code className="select-all break-all">{verify ?? "Created when you first save"}</code>{verify && <form action={metaAction}><input type="hidden" name="what" value="rotate_verify" /><button className="link">New token</button></form>}</span>
        </div>
        <form action={saveMeta} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="section" value="whatsapp" />
          <p className="font-semibold md:col-span-2">WhatsApp Cloud API</p>
          <Field label="Phone number ID"><input name="phone_number_id" defaultValue={wa.phone_number_id} className="input" placeholder="From WhatsApp > API setup" /></Field>
          <Field label="WhatsApp Business Account ID"><input name="waba_id" defaultValue={wa.waba_id} className="input" /></Field>
          <Field label={`Permanent access token ${tokenHint ? `(saved ${tokenHint})` : ""}`} hint="Leave blank to keep the saved one."><input name="wa_token" type="password" autoComplete="off" className="input" /></Field>
          <Field label={`App secret ${secretH ? `(saved ${secretH})` : ""}`} hint="Used to check that webhook calls really come from Meta."><input name="app_secret" type="password" autoComplete="off" className="input" /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={!!wa.enabled} /> Use for sending (when off, WhatsApp stays simulated)</label>
          <div className="flex flex-wrap gap-2 md:col-span-2"><button className="btn btn-primary">Save</button></div>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <form action={metaAction}><input type="hidden" name="what" value="test_wa" /><button className="btn">Test connection</button></form>
          <form action={metaAction}><input type="hidden" name="what" value="sync_templates" /><button className="btn">Sync templates with Meta</button></form>
          <span className="muted text-xs">Templates: {tpl.map((x) => `${x.n} ${String(x.s).toLowerCase()}`).join(", ") || "none"}</span>
        </div>
        <form action={saveMeta} className="grid gap-3 border-t border-slate-200 pt-4 md:grid-cols-2">
          <input type="hidden" name="section" value="leads" />
          <p className="font-semibold md:col-span-2">Facebook and Instagram lead ads</p>
          <Field label="Facebook Page ID"><input name="page_id" defaultValue={ml.page_id} className="input" /></Field>
          <Field label={`Page access token ${pageHint ? `(saved ${pageHint})` : ""}`} hint="Leave blank to keep the saved one."><input name="page_token" type="password" autoComplete="off" className="input" /></Field>
          <div className="flex flex-wrap items-center gap-2 md:col-span-2"><button className="btn btn-primary">Save</button><span className="muted text-xs">Leads received: {leads.map((x) => `${x.n} ${x.status.replace("_", " ")}`).join(", ") || "none yet"}</span></div>
        </form>
        <form action={metaAction}><input type="hidden" name="what" value="test_leads" /><button className="btn">Test and subscribe the Page</button></form>
        <p className="muted text-xs">Form questions are matched by name: child or student name, phone, email, grade or class, campus or branch, city or area. Anything else is saved as a note on the enquiry.</p>
      </div>
    </section>
  );
}

export async function Integrations({ ctx }: { ctx: Ctx }) {
  const keys = await q("select k.*, s.name as source from api_keys k left join sources s on s.id=k.source_id where k.tenant_id=$1 order by k.created_at desc", [ctx.tenantId]);
  const hooks = await q("select * from webhooks where tenant_id=$1 order by created_at desc", [ctx.tenantId]);
  const sources = await q("select id, name, channel from sources where tenant_id=$1 and active order by channel, name", [ctx.tenantId]);
  return (
    <div className="space-y-4">
      <MetaSetup ctx={ctx} />
      <section className="card">
        <div className="card-h">Channels and connectors</div>
        <table className="tbl"><tbody>{CONNECTORS.map(([name, cat, status]) => (
          <tr key={name}><td className="font-medium">{name}</td><td className="muted">{cat}</td><td>{status === "live" || (status === "meta" && ctx.tenant.settings.integrations?.whatsapp?.enabled) ? <Badge tone="green">Live</Badge> : status === "simulated" || status === "meta" ? <Badge tone="amber">Simulated provider</Badge> : <Badge>Not connected</Badge>}</td>
            <td className="muted text-xs">{status === "meta" ? "Connect your own Meta Business account above." : status === "live" ? "Working now." : status === "simulated" ? "Messages and payments are recorded and charged to the wallet but do not leave the system until a provider account is connected." : "Needs a provider account. Leads from this source can arrive today through the REST API below."}</td></tr>
        ))}</tbody></table>
      </section>
      <section className="card">
        <div className="card-h">API keys</div>
        <form action={createApiKey} className="flex flex-wrap items-end gap-3 p-4">
          <label><span className="label">Key name</span><input name="name" required className="input w-56" placeholder="Website, listing portal…" /></label>
          <label><span className="label">Tag leads with source</span><select name="source_id" className="input w-64"><option value="">Decided by each request</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.channel}: {s.name}</option>)}</select></label>
          <button className="btn btn-primary">Create key</button>
        </form>
        <table className="tbl"><tbody>{keys.map((k) => <tr key={k.id}><td className="font-medium">{k.name}</td><td><code>{k.key_prefix}…</code></td><td className="muted">{k.source ?? "Any source"}</td><td className="muted">{k.last_used ? `last used ${rel(k.last_used)}` : "never used"}</td><td className="text-right"><form action={integrationAction}><input type="hidden" name="id" value={k.id} /><button name="what" value="revoke_key" className="btn btn-sm btn-danger">Revoke</button></form></td></tr>)}</tbody></table>
        <pre className="m-4 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST https://YOUR-DOMAIN/api/v1/enquiries \\
  -H "Authorization: Bearer aed_..." -H "Content-Type: application/json" \\
  -H "Idempotency-Key: form-submission-123" \\
  -d '{"student_name":"Aarav Rao","guardian_name":"Suresh Rao","mobile":"9876543210","grade":"Grade 1","branch":"${ctx.branches[0]?.name}","utm":{"source":"google"}}'

GET  /api/v1/enquiries?limit=50&cursor=...     list enquiries
POST /api/v1/messages/inbound                   {"mobile":"...","body":"..."}  parent message from your provider
POST /api/v1/calls/missed                       {"mobile":"..."}  missed call from your telephony provider`}</pre>
      </section>
      <section className="card">
        <div className="card-h">Outbound webhooks</div>
        <form action={integrationAction} className="flex flex-wrap items-end gap-3 p-4"><input type="hidden" name="what" value="add_hook" /><label><span className="label">Endpoint URL (https)</span><input name="url" type="url" required className="input w-96" placeholder="https://example.com/hooks/autoed" /></label><button className="btn">Add webhook</button></form>
        <table className="tbl"><tbody>{hooks.map((h) => <tr key={h.id}><td className="font-medium">{h.url}</td><td className="muted text-xs">{h.last_status ?? "No deliveries yet"}</td><td className="text-right"><form action={integrationAction}><input type="hidden" name="id" value={h.id} /><button name="what" value="delete_hook" className="btn btn-sm btn-danger">Remove</button></form></td></tr>)}</tbody></table>
        <p className="muted px-4 pb-4 text-xs">Sends <code>enquiry.created</code> with an <code>x-autoed-signature</code> header (HMAC-SHA256 of the body with your signing secret).</p>
      </section>
    </div>
  );
}

export async function Wallet({ ctx }: { ctx: Ctx }) {
  const ledger = await q("select * from wallet_ledger where tenant_id=$1 order by created_at desc limit 40", [ctx.tenantId]);
  const usage = await q("select category, sum(amount)::float as amount, count(*)::int n from wallet_ledger where tenant_id=$1 and type='debit' and created_at > now() - interval '30 days' group by category order by amount desc", [ctx.tenantId]);
  const users = await q("select count(*)::int n from users where tenant_id=$1 and status='active'", [ctx.tenantId]);
  const bal = Number(ctx.tenant.wallet_balance);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Wallet balance" value={inr(bal)} tone={bal < 200 ? "bad" : undefined} sub={bal < 200 ? "Low: messages stop at zero" : "WhatsApp, SMS and email credits"} />
        <Stat label="Plan" value={ctx.tenant.plan[0].toUpperCase() + ctx.tenant.plan.slice(1)} sub={`Status: ${ctx.tenant.status}`} />
        <Stat label="Active users" value={users[0].n} />
        <Stat label="Branches" value={ctx.branches.length} />
      </div>
      <section className="card"><div className="card-h">Spend in the last 30 days, by channel (₹)</div><div className="p-4">{usage.length ? <Bars rows={usage.map((u) => ({ label: u.category, value: Math.round(u.amount * 100) / 100, note: `· ${u.n} msgs` }))} /> : <p className="muted">No usage yet.</p>}</div></section>
      <section className="card">
        <div className="card-h"><span>Ledger</span><form action={raiseTicket}><input type="hidden" name="subject" value="Wallet recharge request" /><input type="hidden" name="body" value="Please send a recharge link / invoice for message credits." /><button className="btn btn-sm">Request a recharge</button></form></div>
        <table className="tbl"><thead><tr><th>When</th><th>Type</th><th>Category</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{ledger.map((l) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{l.type === "credit" ? <Badge tone="green">Credit</Badge> : <Badge>Debit</Badge>}</td><td>{l.category}</td><td className="muted">{l.note}</td><td className="text-right tabular-nums">{l.type === "credit" ? "+" : "−"}{inr(l.amount)}{Number(l.amount) < 1 ? ` (${Number(l.amount).toFixed(2)})` : ""}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

export async function Data({ ctx }: { ctx: Ctx }) {
  const batches = await q("select b.*, u.name as by from import_batches b left join users u on u.id=b.created_by where b.tenant_id=$1 order by b.created_at desc limit 15", [ctx.tenantId]);
  const review = await q(
    `select r.*, b.file_name, g.name as guardian, (select string_agg(st.name, ', ') from students st where st.household_id=r.match_household_id) as children
     from import_rows r join import_batches b on b.id=r.batch_id left join lateral (select name from guardians g where g.household_id=r.match_household_id order by is_primary desc limit 1) g on true
     where r.tenant_id=$1 and r.status='review' order by b.created_at desc limit 100`, [ctx.tenantId]);
  const failed = await q("select r.*, b.file_name from import_rows r join import_batches b on b.id=r.batch_id where r.tenant_id=$1 and r.status='failed' order by b.created_at desc limit 30", [ctx.tenantId]);
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-h">Import a spreadsheet (CSV)</div>
        <form action={importCsv} className="grid items-end gap-3 p-4 md:grid-cols-4">
          <label className="md:col-span-2"><span className="label">File: needs "Student name" and "Mobile"; also reads Parent name, Email, Grade, Source</span><input type="file" name="file" accept=".csv,text/csv" required className="input" /></label>
          <label><span className="label">Branch</span><select name="branch_id" className="input">{ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label><span className="label">Bring in as</span><select name="as" className="input"><option value="prospect">Prospect data (no messages sent)</option><option value="enquiry">Live enquiries (workflows run)</option></select></label>
          <label><span className="label">If the family already exists</span><select name="strategy" className="input"><option value="review">Send to the review queue</option><option value="skip">Skip the row</option><option value="touch">Add as re-enquiry / sibling</option></select></label>
          <label><span className="label">Tag (optional)</span><input name="tag" className="input" placeholder="pre-school tie-up" /></label>
          <label><span className="label">Consent basis for this list</span><input name="consent_basis" required className="input" placeholder="Open house sign-up sheet, Nov" /></label>
          <button className="btn btn-primary">Import</button>
        </form>
      </section>
      {review.length > 0 && (
        <section className="card">
          <div className="card-h"><span>Duplicate review queue · {review.length}</span><form action={reviewRows} className="flex gap-1.5"><button name="what" value="merge" className="btn btn-sm btn-primary">Merge all</button><button name="what" value="discard" className="btn btn-sm">Discard all</button></form></div>
          <table className="tbl"><thead><tr><th>Imported row</th><th>Matches household</th><th>File</th><th></th></tr></thead>
            <tbody>{review.map((r) => <tr key={r.id}><td>{r.data.studentName} · {r.data.guardianName} · {r.data.mobile}</td><td><Link className="link" href={`/households/${r.match_household_id}`}>{r.guardian}</Link> <span className="muted text-xs">children: {r.children}</span></td><td className="muted">{r.file_name}</td>
              <td className="text-right"><form action={reviewRows} className="flex justify-end gap-1.5"><input type="hidden" name="rowId" value={r.id} /><button name="what" value="merge" className="btn btn-sm">Merge (re-enquiry or sibling)</button><button name="what" value="discard" className="btn btn-sm">Discard</button></form></td></tr>)}</tbody></table>
        </section>
      )}
      <section className="card">
        <div className="card-h">Import history</div>
        {!batches.length ? <Empty title="No imports yet">Bring last year's sheet in as prospect data. Duplicates go to a review queue instead of an error list, and any import can be undone.</Empty> : (
          <table className="tbl"><thead><tr><th>File</th><th>When</th><th>By</th><th>Rows</th><th>Created</th><th>Duplicates</th><th>Problems</th><th></th></tr></thead>
            <tbody>{batches.map((b) => <tr key={b.id}><td className="font-medium">{b.file_name}</td><td>{fmtDateTime(b.created_at)}</td><td>{b.by}</td><td>{b.total}</td><td>{b.created}</td><td>{b.duplicates}</td><td className={b.failed ? "text-rose-700" : ""}>{b.failed}{b.failed > 0 && <a className="link ml-2 text-xs" href={`/api/import-failed?batch=${b.id}`}>Download rows</a>}</td>
              <td className="text-right">{b.status === "undone" ? <Badge>Undone</Badge> : b.created > 0 && <form action={undoImport}><input type="hidden" name="id" value={b.id} /><button className="btn btn-sm btn-danger">Undo import</button></form>}</td></tr>)}</tbody></table>
        )}
        {failed.length > 0 && <div className="border-t border-slate-200 p-4"><p className="mb-1 text-xs font-semibold text-slate-600">Rows with problems</p><ul className="space-y-0.5 text-xs">{failed.map((f) => <li key={f.id}><span className="muted">{f.file_name}:</span> {f.data.studentName || "(no name)"} · {f.data.mobile || "(no mobile)"} <span className="text-rose-700">{f.error}</span></li>)}</ul></div>}
      </section>
      {isFullAdmin(ctx.perms) && (
        <section className="card">
          <div className="card-h">Data-subject requests</div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <form action="/api/dsr" method="get" className="space-y-2"><p className="font-medium">Access request</p><p className="muted text-xs">Download everything held about a family as a JSON file to share with the parent.</p><input name="mobile" required placeholder="Parent mobile" className="input" /><button className="btn">Download their data</button></form>
            <form action={eraseHousehold} className="space-y-2"><p className="font-medium">Erasure request</p><p className="muted text-xs">Anonymises names, contacts, messages and notes. Cannot be undone. Logged in the audit trail.</p><div className="flex gap-2"><input name="mobile" required placeholder="Parent mobile" className="input" /><input name="confirm" required placeholder="Type ERASE" className="input" /></div><button className="btn btn-danger">Erase personal data</button></form>
          </div>
        </section>
      )}
    </div>
  );
}

export async function Audit({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const ps: any[] = [ctx.tenantId];
  let where = "a.tenant_id=$1";
  if (sp.action) { ps.push(sp.action); where += ` and a.action=$${ps.length}`; }
  if (sp.q) { ps.push("%" + sp.q.toLowerCase() + "%"); where += ` and (lower(a.summary) like $${ps.length} or lower(a.user_name) like $${ps.length})`; }
  const rows = await q(`select a.* from audit_events a where ${where} order by a.created_at desc limit 200`, ps);
  return (
    <section className="card">
      <div className="card-h">
        <span>Audit log <span className="muted font-normal">append-only</span></span>
        <form className="flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Search who or what" className="input w-56" /><select name="action" defaultValue={sp.action ?? ""} className="input w-40"><option value="">All actions</option>{["config", "permission", "edit", "export", "import", "delete", "bulk", "campaign", "support"].map((a) => <option key={a}>{a}</option>)}</select><button className="btn">Filter</button></form>
      </div>
      {!rows.length ? <Empty title="Nothing matches" /> : (
        <table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Change</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.created_at)}</td><td>{a.user_name}</td><td><Badge tone={a.action === "delete" ? "rose" : a.action === "export" || a.action === "support" ? "amber" : "slate"}>{a.action}</Badge></td><td>{a.summary}</td>
            <td className="max-w-xs text-xs text-slate-500">{a.before || a.after ? <details><summary className="cursor-pointer">Before / after</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details> : ""}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

export async function Help({ ctx }: { ctx: Ctx }) {
  const tickets = await q("select t.*, u.name as by from tickets t left join users u on u.id=t.user_id where t.tenant_id=$1 order by t.created_at desc limit 30", [ctx.tenantId]);
  const access = await q("select s.*, u.name as agent from support_access s left join users u on u.id=s.requested_by where s.tenant_id=$1 order by s.created_at desc limit 10", [ctx.tenantId]);
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-h">Raise a ticket or request a feature</div>
        <form action={raiseTicket} className="grid gap-3 p-4 md:grid-cols-4">
          <label><span className="label">Type</span><select name="kind" className="input"><option value="ticket">Something is not working</option><option value="feature">Feature request</option></select></label>
          <label className="md:col-span-3"><span className="label">Subject</span><input name="subject" required className="input" /></label>
          <label className="md:col-span-4"><span className="label">Details</span><textarea name="body" rows={3} className="input" /></label>
          <div><button className="btn btn-primary">Send to AutoED</button></div>
        </form>
        <table className="tbl"><tbody>{tickets.map((t) => <tr key={t.id}><td><Badge tone={t.kind === "feature" ? "violet" : "sky"}>{t.kind === "feature" ? "Feature request" : "Ticket"}</Badge></td><td><b>{t.subject}</b><span className="muted block text-xs">{t.body}</span>{t.reply && <span className="mt-1 block rounded bg-brand-50 px-2 py-1 text-xs text-brand-900">AutoED: {t.reply}</span>}</td><td className="muted">{t.by} · {rel(t.created_at)}</td><td><Badge tone={t.status === "open" ? "amber" : "green"}>{t.status}</Badge></td></tr>)}</tbody></table>
      </section>
      <section className="card">
        <div className="card-h">AutoED support access</div>
        <p className="muted px-4 pt-3 text-xs">Our support team can only view your workspace after you approve a time-boxed request here. Everything they do is written to your audit log, and you can revoke access at any time.</p>
        {!access.length ? <Empty title="No access requests" /> : (
          <table className="tbl mt-2"><tbody>{access.map((a) => {
            const live = a.status === "approved" && new Date(a.expires_at) > new Date();
            return <tr key={a.id}><td><b>{a.agent}</b><span className="muted block text-xs">{a.reason}</span></td><td>{a.status === "requested" ? <Badge tone="amber">Waiting for you</Badge> : live ? <Badge tone="green">Active, ends {rel(a.expires_at)}</Badge> : <Badge>{a.status === "approved" ? "Expired" : a.status}</Badge>}</td>
              <td className="text-right"><form action={supportAccess} className="flex justify-end gap-1.5"><input type="hidden" name="id" value={a.id} />{a.status === "requested" && <><select name="hours" className="input !w-28 !py-1 text-xs"><option value="2">2 hours</option><option value="8">8 hours</option><option value="24">24 hours</option></select><button name="what" value="approve" className="btn btn-sm btn-primary">Approve</button><button name="what" value="deny" className="btn btn-sm">Deny</button></>}{live && <button name="what" value="revoke" className="btn btn-sm btn-danger">Revoke now</button>}</form></td></tr>;
          })}</tbody></table>
        )}
      </section>
    </div>
  );
}
