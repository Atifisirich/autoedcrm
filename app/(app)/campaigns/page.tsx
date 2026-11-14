import { requireCtx } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { MESSAGE_COST } from "@/lib/core";
import { fmtDate, inr, num, pct } from "@/lib/fmt";
import { countLeads, type SP } from "@/lib/leads";
import { canRunCampaigns } from "@/lib/perm";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { createCampaign, deleteCampaign, sendCampaign } from "@/app/actions/ops";

const AUDIENCES: [string, string][] = [
  ["open=1&phase=enquiry", "Open enquiries (not yet visited)"], ["chip=hot", "Hot leads"], ["phase=visit&open=1", "In the visit phase"], ["phase=application&open=1", "Application in progress"],
  ["phase=prospect", "Prospect data pool"], ["closed=1&reason=Undecided", "Closed as undecided"], ["open=1", "Every open enquiry"],
];
const STEPS: [string, string][] = [["targeted", "Targeted"], ["sent", "Sent"], ["delivered", "Delivered"], ["read", "Read"], ["replied", "Replied"], ["visits", "Visits booked"], ["applications", "Applications"], ["admissions", "Admissions"]];

export default async function CampaignsPage() {
  const ctx = await requireCtx("campaigns");
  const t = ctx.tenantId;
  const can = canRunCampaigns(ctx.perms);
  const [rows, templates, views] = await Promise.all([
    q("select c.*, t.name as template, t.category, u.name as creator from campaigns c left join templates t on t.id=c.template_id left join users u on u.id=c.created_by where c.tenant_id=$1 order by c.created_at desc", [t]),
    q("select id, name, channel, category from templates where tenant_id=$1 and status='approved' order by channel, name", [t]),
    q("select name, query from saved_views where tenant_id=$1 and (shared or user_id=$2)", [t, ctx.user.id]),
  ]);
  // Live results for campaigns sent from this system: what the same families did after the send.
  for (const c of rows) {
    if (c.status === "draft") { c.count = await countLeads(ctx, Object.fromEntries(new URLSearchParams(c.audience?.query ?? "")) as SP); continue; }
    if (c.stats.read !== undefined) continue;
    const live = await one(
      `with hh as (select distinct household_id from messages where tenant_id=$1 and campaign_id=$2 and status='delivered')
       select (select count(distinct m.household_id)::int from messages m join hh on hh.household_id=m.household_id where m.direction='in' and m.created_at>$3) as replied,
              (select count(distinct v.household_id)::int from visits v join hh on hh.household_id=v.household_id where v.created_at>$3) as visits,
              (select count(distinct e.household_id)::int from applications a join enquiries e on e.id=a.enquiry_id join hh on hh.household_id=e.household_id where a.created_at>$3) as applications,
              (select count(distinct e.household_id)::int from enquiries e join stages s on s.id=e.stage_id join hh on hh.household_id=e.household_id where s.is_won and e.stage_entered_at>$3) as admissions`,
      [t, c.id, c.sent_at],
    );
    c.stats = { ...c.stats, ...live };
  }
  return (
    <>
      <PageHeader title="Campaigns" sub="Bulk WhatsApp, SMS and email to a saved audience, with results down to admissions" />
      {can && (
        <form action={createCampaign} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <label><span className="label">Campaign name</span><input name="name" required className="input w-56" placeholder="Open house reminder" /></label>
          <label><span className="label">Audience</span><select name="audience" className="input w-64">{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}{views.map((v) => <option key={v.name} value={v.query}>Saved view: {v.name}</option>)}</select></label>
          <label><span className="label">Template</span><select name="templateId" required className="input w-64">{templates.map((x) => <option key={x.id} value={x.id}>{x.channel}: {x.name} ({x.category})</option>)}</select></label>
          <button className="btn btn-primary">Create draft</button>
          <p className="muted w-full text-xs">Audiences use the academic year and branch selected in the header. Parents who opted out of a channel are skipped automatically; marketing templates never go to enrolled or closed families.</p>
        </form>
      )}
      {!rows.length && <div className="card"><Empty title="No campaigns yet">Create a draft above, check the audience size and cost estimate, then send.</Empty></div>}
      <div className="space-y-4">
        {rows.map((c) => (
          <section key={c.id} className="card">
            <div className="card-h">
              <span>{c.name} <span className="muted font-normal">· {c.channel} · template “{c.template}” · by {c.creator}</span></span>
              {c.status === "draft" ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Sent {fmtDate(c.sent_at)}</Badge>}
            </div>
            {c.status === "draft" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p>Audience right now: <b>{num(c.count)}</b> enquiries (one message per family). Estimated cost: up to <b>{inr(c.count * (MESSAGE_COST[c.channel] ?? 0))}</b> from the wallet (balance {inr(ctx.tenant.wallet_balance)}).</p>
                {can && <div className="flex gap-2"><form action={deleteCampaign}><input type="hidden" name="id" value={c.id} /><button className="btn">Discard</button></form><form action={sendCampaign}><input type="hidden" name="id" value={c.id} /><button className="btn btn-primary" disabled={!c.count}>Send now to {num(c.count)}</button></form></div>}
              </div>
            ) : (
              <div className="p-4">
                <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
                  {STEPS.filter(([k]) => c.stats[k] !== undefined).map(([k, l]) => (
                    <div key={k} className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold tabular-nums">{num(c.stats[k])}</div><div className="muted text-[11px]">{k === "targeted" ? " " : pct(c.stats[k], c.stats.targeted) + " of targeted"}</div></div>
                  ))}
                </div>
                <p className="muted mt-2 text-xs">Cost {inr(c.cost)}{c.stats.admissions ? ` · ${inr(c.cost / c.stats.admissions)} per admission` : ""}{c.stats.skipped ? ` · ${c.stats.skipped} excluded (enrolled or closed)` : ""}</p>
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
