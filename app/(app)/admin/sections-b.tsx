import Link from "next/link";
import type { Ctx } from "@/lib/auth";
import { q } from "@/lib/db";
import { DEFAULT_SCORING, SCORE_LABELS } from "@/lib/core";
import { fmtDateTime, inr } from "@/lib/fmt";
import { canPublishWorkflows } from "@/lib/perm";
import { RECIPES, TRIGGERS, type Step } from "@/lib/workflows";
import { Badge, Empty, Field } from "@/components/ui";
import { saveForm, saveRule, saveScoring, saveSource, saveTemplate } from "@/app/actions/admin";
import { createWorkflow, deleteWorkflow, editConditions, editSteps, installRecipe, testWorkflow, workflowStatus } from "@/app/actions/ops";

const condLabel = (field: string, fields: [string, string][]) => fields.find(([k]) => k === field)?.[1] ?? field.replace("custom.", "").replace(/_/g, " ");
import { Simulator } from "./Simulator";

export async function Sources({ ctx }: { ctx: Ctx }) {
  const rows = await q("select s.*, (select count(*)::int from source_touches t where t.source_id=s.id) as touches from sources s where s.tenant_id=$1 order by s.channel, s.name", [ctx.tenantId]);
  return (
    <section className="card">
      <div className="card-h"><span>Channel › source</span><span className="muted font-normal">Spend feeds cost per lead and per admission in Reports</span></div>
      <div className="divide-y divide-slate-100">
        {[null, ...rows].map((s) => (
          <form key={s?.id ?? "new"} action={saveSource} className={`flex flex-wrap items-end gap-3 px-4 py-2.5 ${s ? "" : "bg-slate-50"}`}>
            {s && <input type="hidden" name="id" value={s.id} />}
            <label><span className="label">{s ? "Channel" : "Add: channel"}</span><input name="channel" defaultValue={s?.channel} required className="input w-40" list="channels" /></label>
            <label><span className="label">Source</span><input name="name" defaultValue={s?.name} required className="input w-64" /></label>
            <label><span className="label">Spend this season (₹)</span><input name="cost" type="number" min={0} defaultValue={s?.cost ?? 0} className="input w-36" /></label>
            {s && <label><span className="label">Status</span><select name="active" defaultValue={s.active ? "on" : "off"} className="input w-28"><option value="on">Active</option><option value="off">Inactive</option></select></label>}
            <button className="btn">{s ? "Save" : "Add source"}</button>
            {s && <span className="muted pb-2 text-xs">{s.touches} touches{s.cost > 0 && s.touches ? ` · ${inr(s.cost / s.touches)} per lead` : ""}</span>}
          </form>
        ))}
        <datalist id="channels">{[...new Set(rows.map((r) => r.channel))].map((c) => <option key={c} value={c} />)}</datalist>
      </div>
    </section>
  );
}

export async function Routing({ ctx }: { ctx: Ctx }) {
  const rules = await q("select * from assignment_rules where tenant_id=$1 order by position", [ctx.tenantId]);
  const users = await q("select u.id, u.name, u.on_leave, u.daily_capacity from users u join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active' and r.permissions->>'leads' in ('O','T') order by u.name", [ctx.tenantId]);
  const channels = (await q("select distinct channel from sources where tenant_id=$1 order by 1", [ctx.tenantId])).map((c) => c.channel as string);
  const s = ctx.tenant.settings;
  const scoring = { ...DEFAULT_SCORING, ...(s.scoring ?? {}) };
  const RuleForm = ({ r }: { r?: any }) => (
    <form action={saveRule} className="grid items-end gap-2 md:grid-cols-7">
      {r && <input type="hidden" name="id" value={r.id} />}
      <label><span className="label">Order</span><input name="position" type="number" defaultValue={r?.position ?? rules.length + 1} className="input" /></label>
      <label><span className="label">Rule name</span><input name="name" required defaultValue={r?.name} className="input" /></label>
      <label><span className="label">If branch is</span><select name="branch_id" defaultValue={r?.conditions.branch_id ?? ""} className="input"><option value="">Any branch</option>{ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span className="label">and channel is</span><select name="channel" defaultValue={r?.conditions.channel ?? ""} className="input"><option value="">Any channel</option>{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label><span className="label">Distribute by</span><select name="method" defaultValue={r?.method ?? "round_robin"} className="input"><option value="round_robin">Round robin</option><option value="least_load">Least open load</option></select></label>
      <label><span className="label">To (hold Ctrl to pick several)</span><select name="userIds" multiple defaultValue={r?.user_ids ?? []} className="input h-20">{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.on_leave ? " (on leave)" : ""}</option>)}</select></label>
      <div className="flex gap-1.5"><button name="what" value="save" className="btn btn-primary">{r ? "Save" : "Add rule"}</button>{r && <button name="what" value="delete" className="btn btn-danger">Delete</button>}</div>
    </form>
  );
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-h">Assignment rules, checked top to bottom</div>
        <p className="muted px-4 pt-3 text-xs">Before any rule: a family that already has a counsellor stays with them (sticky owner). People on leave or at their daily capacity are skipped. If no rule fits, the least-loaded available person in the branch gets the lead.</p>
        <div className="space-y-3 p-4">{rules.map((r) => <div key={r.id} className="rounded-md border border-slate-200 p-3"><RuleForm r={r} /></div>)}<div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3"><RuleForm /></div></div>
      </section>
      <section className="card"><div className="card-h">Rule simulator</div><Simulator branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))} grades={s.grades ?? []} channels={channels} /></section>
      <section className="card">
        <div className="card-h">Lead scoring</div>
        <form action={saveScoring} className="grid gap-3 p-4 md:grid-cols-4">
          {Object.entries(SCORE_LABELS).map(([k, label]) => <Field key={k} label={label}><input name={`s_${k}`} type="number" min={0} max={100} defaultValue={scoring[k]} className="input" /></Field>)}
          <Field label="Hot at score"><input name="hot_at" type="number" defaultValue={s.hot_at ?? 60} className="input" /></Field>
          <Field label="Warm at score"><input name="warm_at" type="number" defaultValue={s.warm_at ?? 30} className="input" /></Field>
          <div className="md:col-span-4"><button className="btn btn-primary">Save scoring</button><span className="muted ml-3 text-xs">Each kind of activity counts at most three times. Score is capped at 100. Users see the breakdown on every record.</span></div>
        </form>
      </section>
    </div>
  );
}

export async function Templates({ ctx }: { ctx: Ctx }) {
  const rows = await q("select t.* from templates t where t.tenant_id=$1 order by t.channel, t.name", [ctx.tenantId]);
  const vars = "{{guardian_name}} {{student_name}} {{grade}} {{branch}} {{counsellor}} {{school}} {{apply_link}}";
  const TForm = ({ t }: { t?: any }) => (
    <form action={saveTemplate} className="grid gap-2 md:grid-cols-6">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className="md:col-span-2"><span className="label">Name</span><input name="name" required defaultValue={t?.name} className="input" /></label>
      <label><span className="label">Channel</span><select name="channel" defaultValue={t?.channel ?? "whatsapp"} className="input"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></label>
      <label><span className="label">Category</span><select name="category" defaultValue={t?.category ?? "utility"} className="input"><option value="utility">Utility</option><option value="marketing">Marketing</option></select></label>
      <label><span className="label">Language</span><input name="language" defaultValue={t?.language ?? "English"} className="input" /></label>
      {t ? <label><span className="label">Status</span><select name="status" defaultValue={t.status} className="input"><option value="approved">Approved</option><option value="pending">Pending approval</option><option value="draft">Draft</option></select></label> : <span />}
      <label className="md:col-span-5"><span className="label">Body</span><textarea name="body" rows={2} required defaultValue={t?.body} className="input" /></label>
      <div className="flex items-end"><button className="btn">{t ? "Save" : "Add template"}</button></div>
    </form>
  );
  return (
    <div className="space-y-4">
      <section className="card p-4"><p className="mb-2 font-semibold">New template</p><TForm /><p className="muted mt-2 text-xs">Merge variables: {vars}</p></section>
      <section className="card">
        <div className="card-h">Template library</div>
        <div className="divide-y divide-slate-100">
          {rows.map((t) => (
            <details key={t.id} className="px-4 py-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2"><span><b>{t.name}</b> <span className="muted">· {t.channel} · {t.category} · {t.language}</span></span><span className="flex gap-1">{t.channel === "whatsapp" && t.meta_status && <Badge tone={t.meta_status === "APPROVED" ? "green" : t.meta_status === "REJECTED" ? "rose" : "amber"} title={t.meta_reason ?? undefined}>Meta: {String(t.meta_status).toLowerCase()}</Badge>}<Badge tone={t.status === "approved" ? "green" : "amber"}>{t.status}</Badge></span></summary>
              <div className="mt-3 rounded-md bg-slate-50 p-3"><TForm t={t} /></div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

const OPTIONAL = [["email", "Email"], ["grade", "Grade"], ["branch", "Branch"], ["dob", "Date of birth"], ["locality", "Locality"], ["heard_about", "How did you hear about us"]];

export async function Forms({ ctx }: { ctx: Ctx }) {
  const forms = await q("select * from forms where tenant_id=$1 order by name", [ctx.tenantId]);
  const sources = await q("select id, name, channel from sources where tenant_id=$1 and active order by channel, name", [ctx.tenantId]);
  const FForm = ({ f }: { f?: any }) => (
    <form action={saveForm} className="grid gap-2 md:grid-cols-4">
      {f && <input type="hidden" name="id" value={f.id} />}
      <label><span className="label">Form name</span><input name="name" required defaultValue={f?.name} className="input" /></label>
      <label><span className="label">Fixed branch</span><select name="branch_id" defaultValue={f?.branch_id ?? ""} className="input"><option value="">Parent chooses</option>{ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span className="label">Tag leads with source</span><select name="source_id" defaultValue={f?.source_id ?? ""} className="input">{sources.map((s) => <option key={s.id} value={s.id}>{s.channel}: {s.name}</option>)}</select></label>
      <label><span className="label">Thank-you message</span><input name="thank_you" defaultValue={f?.thank_you} className="input" /></label>
      <fieldset className="md:col-span-3"><legend className="label">Fields (student name, parent name and mobile are always asked)</legend><div className="flex flex-wrap gap-3">{OPTIONAL.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="fields" value={k} defaultChecked={f ? f.fields.includes(k) : ["email", "grade", "branch"].includes(k)} /> {l}</label>)}</div></fieldset>
      <div className="flex items-end gap-3">{f && <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={f.active} /> Live</label>}<button className="btn">{f ? "Save" : "Create form"}</button></div>
    </form>
  );
  return (
    <div className="space-y-4">
      <section className="card p-4"><p className="mb-2 font-semibold">New enquiry form</p><FForm /></section>
      {forms.map((f) => (
        <section key={f.id} className="card">
          <div className="card-h"><span>{f.name} <span className="muted font-normal">· {f.submissions} submissions</span></span>{f.active ? <Badge tone="green">Live</Badge> : <Badge>Off</Badge>}</div>
          <div className="space-y-3 p-4">
            <FForm f={f} />
            <div className="rounded-md bg-slate-50 p-3 text-xs">
              <p>Hosted link: <Link className="link" href={`/f/${f.slug}`} target="_blank">/f/{f.slug}</Link> <span className="muted">(add ?utm_source=…&utm_campaign=… and they are captured on the lead)</span></p>
              <p className="mt-1">Embed on your website: <code className="rounded bg-white px-1 py-0.5">{`<iframe src="https://YOUR-DOMAIN/f/${f.slug}" width="100%" height="640" style="border:0"></iframe>`}</code></p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function describe(s: Step): string {
  const t = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)} day(s)` : m >= 60 ? `${Math.round(m / 60)} hour(s)` : `${m} min`);
  switch (s.type) {
    case "send": return `Send “${s.template}” on ${s.channel}${s.fallback?.length ? `, falling back to ${s.fallback.join(" then ")}` : ""}`;
    case "task": return `Create task “${s.title}” for the owner, due in ${t(s.dueMins)}`;
    case "wait": return `Wait ${t(s.mins)} (stops if the parent replies or the stage changes)`;
    case "notify": return `Notify the ${s.who === "head" ? "admission head" : "owner"}: “${s.title}”`;
    case "stage": return `Move to stage “${s.stage}” if still in New`;
    case "tag": return `Add tag “${s.tag}”`;
    case "reassign": return "Reassign to the next available counsellor if still untouched";
  }
}

export async function Workflows({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const wfs = await q(
    `select w.*, (select count(*)::int from workflow_runs r where r.workflow_id=w.id and not r.test) as runs,
       (select count(*)::int from workflow_runs r where r.workflow_id=w.id and r.status='running') as waiting,
       (select count(*)::int from workflow_runs r where r.workflow_id=w.id and r.status='error') as errors
     from workflows w where w.tenant_id=$1 order by w.name`, [ctx.tenantId]);
  const cur = wfs.find((w) => w.id === sp.id);
  const publish = canPublishWorkflows(ctx.perms);
  const installed = new Set(wfs.map((w) => w.recipe_key));
  if (cur) {
    const runs = await q("select r.*, st.name as student from workflow_runs r left join enquiries e on e.id=r.enquiry_id left join students st on st.id=e.student_id where r.workflow_id=$1 order by r.created_at desc limit 15", [cur.id]);
    const templates = await q("select distinct name from templates where tenant_id=$1 and status='approved' order by 1", [ctx.tenantId]);
    const stages = await q("select name from stages where tenant_id=$1 and active order by position", [ctx.tenantId]);
    const steps = cur.steps as Step[];
    const custom = await q("select key, label from custom_fields where tenant_id=$1 and entity='enquiry' and active", [ctx.tenantId]);
    const condFields: [string, string][] = [["grade", "Grade"], ["board", "Board"], ["branch_name", "Branch"], ["stage_name", "Stage"], ["temperature", "Temperature"], ["closure_reason", "Closure reason"], ...custom.map((f) => ["custom." + f.key, f.label] as [string, string])];
    return (
      <div className="space-y-4">
        <Link href="/admin/workflows" className="muted text-xs hover:underline">← All workflows</Link>
        <section className="card">
          <div className="card-h"><span>{cur.name} <span className="muted font-normal">· version {cur.version}</span></span><Badge tone={cur.status === "published" ? "green" : "amber"}>{cur.status}</Badge></div>
          <div className="p-4">
            <p className="muted">{cur.description}</p>
            <ol className="mt-4 space-y-0">
              <li className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
                <span className="text-xs font-semibold text-brand-900">WHEN</span> {TRIGGERS[cur.trigger] ?? cur.trigger}
                {(cur.conditions as any[]).map((c, i) => (
                  <form key={i} action={editConditions} className="mt-1 flex items-center gap-2 text-xs">
                    <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="index" value={i} />
                    <span className="muted">AND {condLabel(c.field, condFields)} {c.op === "ne" ? "is not" : "is"} {Array.isArray(c.value) ? c.value.join(" or ") : c.value}</span>
                    <button name="what" value="remove" className="link">remove</button>
                  </form>
                ))}
                <form action={editConditions} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                  <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="what" value="add" />
                  <span className="font-semibold text-brand-900">Only if</span>
                  <select name="field" className="input !w-auto !py-1 text-xs">{condFields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <select name="op" className="input !w-auto !py-1 text-xs"><option value="in">is one of</option><option value="ne">is not</option></select>
                  <input name="value" required placeholder="Value (commas for several)" className="input !w-56 !py-1 text-xs" />
                  <button className="btn btn-sm">Add condition</button>
                </form>
              </li>
              {steps.map((s, i) => (
                <li key={i}>
                  <div className="ml-6 h-4 w-px bg-slate-300" />
                  <div className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${s.type === "wait" ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-200 bg-white"}`}>
                    <span><span className="mr-2 text-xs font-semibold text-slate-500">{i + 1}</span>{describe(s)}</span>
                    <form action={editSteps} className="flex gap-1"><input type="hidden" name="id" value={cur.id} /><input type="hidden" name="index" value={i} /><button name="what" value="up" className="btn btn-sm" aria-label="Move step up">↑</button><button name="what" value="remove" className="btn btn-sm" aria-label="Remove step">×</button></form>
                  </div>
                </li>
              ))}
            </ol>
            <form action={editSteps} className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
              <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="what" value="add" />
              <label><span className="label">Add step</span><select name="type" className="input w-40"><option value="send">Send message</option><option value="task">Create task</option><option value="wait">Wait</option><option value="notify">Notify</option><option value="stage">Change stage</option><option value="tag">Add tag</option><option value="reassign">Reassign</option></select></label>
              <label><span className="label">Channel</span><select name="channel" className="input w-28"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></label>
              <label><span className="label">Template</span><select name="template" className="input w-44">{templates.map((t) => <option key={t.name}>{t.name}</option>)}</select></label>
              <label><span className="label">Title / tag text</span><input name="title" className="input w-44" /></label>
              <label><span className="label">Minutes (wait / due)</span><input name="mins" type="number" min={1} defaultValue={60} className="input w-28" /></label>
              <label><span className="label">Notify</span><select name="who" className="input w-28"><option value="owner">Owner</option><option value="head">Head</option></select></label>
              <label><span className="label">Stage</span><select name="stage" className="input w-40">{stages.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
              <button className="btn">Add step</button>
              <p className="muted w-full text-xs">Only the boxes that apply to the chosen step type are used.</p>
            </form>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={testWorkflow}><input type="hidden" name="id" value={cur.id} /><button className="btn">Test run on a sample record</button></form>
              {publish && <form action={workflowStatus}><input type="hidden" name="id" value={cur.id} />{cur.status === "published" ? <button name="status" value="paused" className="btn btn-danger">Pause</button> : <button name="status" value="published" className="btn btn-primary">Publish</button>}</form>}
              {cur.status !== "published" && <form action={deleteWorkflow}><input type="hidden" name="id" value={cur.id} /><button className="btn">Delete</button></form>}
            </div>
            <p className="muted mt-2 text-xs">Safeguards on every workflow: one run per record at a time, waiting steps cancel when the parent replies or the record leaves its stage, opted-out parents are never messaged.</p>
          </div>
        </section>
        <section className="card">
          <div className="card-h">Run log</div>
          {!runs.length && <Empty title="No runs yet">Use Test run to see exactly what this workflow would do, without sending anything.</Empty>}
          <div className="divide-y divide-slate-100">
            {runs.map((r) => (
              <details key={r.id} className="px-4 py-2.5" open={r.test && r === runs[0]}>
                <summary className="flex cursor-pointer list-none items-center justify-between"><span>{r.student ?? "Record"} <span className="muted text-xs">· {fmtDateTime(r.created_at)}</span></span><Badge tone={r.status === "error" ? "rose" : r.status === "running" ? "amber" : r.status === "cancelled" ? "slate" : "green"}>{r.test ? "Test run" : r.status === "running" ? "Waiting" : r.status}</Badge></summary>
                <ul className="mt-2 space-y-1 text-xs">{(r.log as any[]).map((l, i) => <li key={i} className={l.ok === false ? "text-rose-700" : "text-slate-700"}>{l.step ? `Step ${l.step}: ` : ""}{l.text}</li>)}</ul>
              </details>
            ))}
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className="card overflow-x-auto">
        <div className="card-h">Workflows</div>
        <table className="tbl">
          <thead><tr><th>Workflow</th><th>Runs when</th><th>Steps</th><th>Runs</th><th>Waiting</th><th>Errors</th><th>Status</th></tr></thead>
          <tbody>{wfs.map((w) => (
            <tr key={w.id}><td><Link className="link" href={`/admin/workflows?id=${w.id}`}>{w.name}</Link><span className="muted block max-w-md text-xs">{w.description}</span></td><td>{TRIGGERS[w.trigger] ?? w.trigger}</td><td>{(w.steps as any[]).length}</td><td>{w.runs}</td><td>{w.waiting}</td><td className={w.errors ? "font-semibold text-rose-700" : ""}>{w.errors}</td><td><Badge tone={w.status === "published" ? "green" : "amber"}>{w.status}</Badge></td></tr>
          ))}</tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-h">Build your own</div>
        <form action={createWorkflow} className="flex flex-wrap items-end gap-3 p-4">
          <label><span className="label">Name</span><input name="name" required className="input w-56" /></label>
          <label><span className="label">Trigger</span><select name="trigger" className="input w-72">{Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="btn btn-primary">Create draft</button>
        </form>
      </section>
      {RECIPES.some((r) => !installed.has(r.key)) && (
        <section className="card">
          <div className="card-h">Recipe library</div>
          <div className="divide-y divide-slate-100">{RECIPES.filter((r) => !installed.has(r.key)).map((r) => <form key={r.key} action={installRecipe} className="flex items-center justify-between gap-3 px-4 py-2.5"><input type="hidden" name="key" value={r.key} /><span><b>{r.name}</b><span className="muted block text-xs">{r.description}</span></span><button className="btn btn-sm">Install</button></form>)}</div>
        </section>
      )}
    </div>
  );
}
