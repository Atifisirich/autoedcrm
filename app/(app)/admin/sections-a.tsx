import type { Ctx } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, rel } from "@/lib/fmt";
import { CAPS, LEVELS, LEVEL_HELP, isFullAdmin } from "@/lib/perm";
import { Badge, DOTS, Field } from "@/components/ui";
import { cloneRole, moveStageOrder, retireStage, rollover, saveBranch, saveField, saveOrg, saveProgramme, saveRoles, saveStage, saveUser, userAction, yearAction } from "@/app/actions/admin";

export async function Org({ ctx }: { ctx: Ctx }) {
  const s = ctx.tenant.settings;
  const programmes = await q("select p.*, b.name as branch from programmes p join branches b on b.id=p.branch_id where p.tenant_id=$1 and p.year_id=$2 order by b.name, p.grade_order", [ctx.tenantId, ctx.yearId]);
  const current = ctx.years.find((y) => y.id === ctx.yearId)!;
  const nextName = (() => { const a = Number(ctx.years[ctx.years.length - 1].name.slice(0, 4)) + 1; return `${a}-${String(a + 1).slice(2)}`; })();
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-h">Organisation profile and defaults</div>
        <form action={saveOrg} className="grid gap-3 p-4 md:grid-cols-3">
          <Field label="School / group name"><input name="name" defaultValue={ctx.tenant.name} className="input" /></Field>
          <Field label="Legal name"><input name="legal_name" defaultValue={s.legal_name} className="input" /></Field>
          <Field label="GSTIN"><input name="gstin" defaultValue={s.gstin} className="input" /></Field>
          <Field label="Brand colour"><input name="color" type="color" defaultValue={ctx.tenant.branding?.color ?? "#0f6e6e"} className="input h-9 p-1" /></Field>
          <Field label="First response target (minutes)" hint="Used for SLA timers and escalation"><input name="first_response_mins" type="number" min={1} defaultValue={s.first_response_mins ?? 30} className="input" /></Field>
          <Field label="Registration fee (₹)"><input name="fee_registration" type="number" defaultValue={s.fees?.registration} className="input" /></Field>
          <Field label="Admission fee (₹)"><input name="fee_admission" type="number" defaultValue={s.fees?.admission} className="input" /></Field>
          <Field label="Application number prefix"><input name="app_no_prefix" defaultValue={s.app_no_prefix} className="input" /></Field>
          <Field label="Receipt number prefix"><input name="receipt_prefix" defaultValue={s.receipt_prefix} className="input" /></Field>
          <Field label="Closure reasons (one per line)"><textarea name="closure_reasons" rows={6} defaultValue={(s.closure_reasons ?? []).join("\n")} className="input" /></Field>
          <Field label="Document checklist (one per line)"><textarea name="doc_types" rows={6} defaultValue={(s.doc_types ?? []).join("\n")} className="input" /></Field>
          <Field label="Privacy notice shown on forms"><textarea name="privacy_notice" rows={6} defaultValue={s.privacy_notice ?? "We use these details only to respond to your admission enquiry. You can ask us to correct or delete them at any time."} className="input" /></Field>
          <Field label="Quiet hours: no automated messages from (hour, 0-23)"><input name="quiet_from" type="number" min={0} max={23} defaultValue={s.quiet_hours?.from ?? 21} className="input" /></Field>
          <Field label="… until (hour, 0-23)" hint="Automated messages due in this window wait until it ends. India time."><input name="quiet_to" type="number" min={0} max={23} defaultValue={s.quiet_hours?.to ?? 8} className="input" /></Field>
          <Field label="Most automated messages per family per day" hint="Messages sent by staff and campaigns do not count."><input name="max_auto_per_day" type="number" min={1} defaultValue={s.max_auto_per_day ?? 4} className="input" /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" name="require_2fa_admins" defaultChecked={!!s.require_2fa_admins} /> Require two-factor sign-in for everyone who can change settings</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="reopen" defaultChecked={s.reopen_on_reenquiry !== false} /> Re-open a closed enquiry when the family enquires again</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="call_recording" defaultChecked={!!s.call_recording} /> Record calls (with announcement) once telephony is connected</label>
          <div className="md:col-span-3"><button className="btn btn-primary">Save organisation settings</button></div>
        </form>
      </section>

      <section className="card">
        <div className="card-h">Branches</div>
        <div className="divide-y divide-slate-100">
          {[...ctx.branches, null].map((b) => (
            <form key={b?.id ?? "new"} action={saveBranch} className="grid items-end gap-2 px-4 py-3 md:grid-cols-8">
              {b && <input type="hidden" name="id" value={b.id} />}
              <label className="md:col-span-2"><span className="label">{b ? "Name" : "Add a branch"}</span><input name="name" defaultValue={b?.name} placeholder="Branch name" className="input" /></label>
              <label><span className="label">City</span><input name="city" defaultValue={b?.city} className="input" /></label>
              <label className="md:col-span-2"><span className="label">Address</span><input name="address" defaultValue={b?.address} className="input" /></label>
              <label><span className="label">Hours (open to close)</span><span className="flex gap-1"><input name="open_hour" type="number" min={0} max={23} defaultValue={b?.open_hour ?? 9} className="input" aria-label="Opening hour" /><input name="close_hour" type="number" min={1} max={24} defaultValue={b?.close_hour ?? 18} className="input" aria-label="Closing hour" /></span></label>
              <label><span className="label">Visits per hour</span><input name="visit_capacity" type="number" min={1} defaultValue={b?.visit_capacity ?? 3} className="input" /></label>
              <button className="btn">{b ? "Save" : "Add branch"}</button>
            </form>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-h">Academic years</div>
        <table className="tbl"><tbody>
          {ctx.years.map((y) => (
            <tr key={y.id}><td className="font-medium">{y.name}</td><td>{y.status === "open" ? <Badge tone="green">Open for admissions</Badge> : <Badge>Closed</Badge>} {y.is_default && <Badge tone="teal">Default</Badge>}</td>
              <td className="text-right"><form action={yearAction} className="flex justify-end gap-1.5"><input type="hidden" name="id" value={y.id} />{!y.is_default && <button name="what" value="default" className="btn btn-sm">Make default</button>}{y.status === "open" ? !y.is_default && <button name="what" value="close" className="btn btn-sm">Close admissions</button> : <button name="what" value="open" className="btn btn-sm">Reopen</button>}</form></td></tr>
          ))}
        </tbody></table>
        <form action={rollover} className="flex flex-wrap items-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
          <p className="w-full font-semibold">Rollover wizard</p>
          <label><span className="label">Copy from</span><select name="from" defaultValue={ctx.years[ctx.years.length - 1].id} className="input w-32">{ctx.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
          <label><span className="label">New academic year</span><input name="name" defaultValue={nextName} className="input w-32" /></label>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="carry" defaultChecked /> Carry forward open and "not now" families as prospects</label>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="makeDefault" /> Make it the default year</label>
          <button className="btn btn-primary">Create year</button>
          <p className="muted w-full text-xs">Copies programmes, seats and age rules. Stages, forms, fields and workflows are shared across years, so nothing is duplicated and history is never split.</p>
        </form>
      </section>

      <section className="card overflow-x-auto">
        <div className="card-h">Programmes and seats · {current.name}</div>
        <table className="tbl"><thead><tr><th>Branch</th><th>Board</th><th>Grade</th><th>Seats</th><th>Minimum age on cut-off</th><th>Cut-off date</th><th></th></tr></thead>
          <tbody>{programmes.map((p) => (
            <tr key={p.id}><td>{p.branch}</td><td>{p.board}</td><td className="font-medium">{p.grade}</td>
              <td colSpan={2}><form action={saveProgramme} className="flex items-center gap-2"><input type="hidden" name="id" value={p.id} /><input name="capacity" type="number" min={0} defaultValue={p.capacity} className="input !w-20 !py-1" aria-label={`Seats for ${p.grade}`} /><input name="min_age_years" type="number" step="0.5" defaultValue={p.min_age_years} className="input !w-20 !py-1" aria-label={`Minimum age for ${p.grade}`} /><button className="btn btn-sm">Save</button></form></td>
              <td>{fmtDate(p.age_cutoff)}</td><td></td></tr>
          ))}</tbody></table>
      </section>
    </div>
  );
}

export async function Users({ ctx }: { ctx: Ctx }) {
  const users = await q("select u.*, r.name as role from users u left join roles r on r.id=u.role_id where u.tenant_id=$1 order by u.status, u.name", [ctx.tenantId]);
  const roles = await q("select id, name, permissions->>'admin' as admin from roles where tenant_id=$1 order by name", [ctx.tenantId]);
  const full = isFullAdmin(ctx.perms);
  const visible = full ? users : users.filter((u) => (u.branch_ids as string[]).some((b) => ctx.branchIds.includes(b)));
  const Form = ({ u }: { u?: any }) => (
    <form action={saveUser} className="grid items-end gap-2 md:grid-cols-6">
      {u && <input type="hidden" name="id" value={u.id} />}
      <label><span className="label">Name</span><input name="name" required defaultValue={u?.name} className="input" /></label>
      {!u && <label><span className="label">Work email</span><input name="email" type="email" required className="input" /></label>}
      <label><span className="label">Role</span><select name="roleId" defaultValue={u?.role_id} className="input">{roles.filter((r) => full || r.admin !== "F").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label><span className="label">Branches (none = all)</span><select name="branchIds" multiple defaultValue={u?.branch_ids ?? []} className="input h-16">{ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span className="label">Reports to</span><select name="reports_to" defaultValue={u?.reports_to ?? ""} className="input"><option value="">Nobody</option>{users.filter((x) => x.id !== u?.id && x.status === "active").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="label">Leads per day</span><input name="daily_capacity" type="number" min={0} defaultValue={u?.daily_capacity ?? 25} className="input" /></label>
      <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="on_leave" defaultChecked={u?.on_leave} /> On leave (skip in routing)</label>
      <button className="btn btn-primary">{u ? "Save" : "Add user"}</button>
    </form>
  );
  return (
    <div className="space-y-4">
      <section className="card"><div className="card-h"><span>Add a user</span><span className="muted font-normal">{users.filter((u) => u.status === "active").length} active licences in use</span></div><div className="p-4"><Form /></div></section>
      <section className="card">
        <div className="card-h">Team</div>
        <div className="divide-y divide-slate-100">
          {visible.map((u) => (
            <details key={u.id} className="px-4 py-2.5">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span><b>{u.name}</b> <span className="muted">· {u.email} · {u.role}</span> {u.status !== "active" && <Badge tone="rose">Paused</Badge>} {u.totp_enabled && <Badge tone="green">2FA</Badge>} {u.on_leave && <Badge tone="amber">On leave</Badge>}</span>
                <span className="muted text-xs">{(u.branch_ids as string[]).length ? ctx.branches.filter((b) => u.branch_ids.includes(b.id)).map((b) => b.name).join(", ") : "All branches"} · last sign-in {u.last_login ? rel(u.last_login) : "never"} · edit ▾</span>
              </summary>
              <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-3">
                <Form u={u} />
                {u.id !== ctx.user.id && <form action={userAction} className="flex gap-2"><input type="hidden" name="id" value={u.id} />{u.status === "active" ? <button name="what" value="pause" className="btn btn-sm btn-danger">Pause and sign out</button> : <button name="what" value="activate" className="btn btn-sm">Reactivate</button>}<button name="what" value="reset" className="btn btn-sm">Reset password</button>{u.totp_enabled && <button name="what" value="reset2fa" className="btn btn-sm">Reset two-factor</button>}</form>}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

export async function Roles({ ctx }: { ctx: Ctx }) {
  const roles = await q("select r.*, (select count(*)::int from users u where u.role_id=r.id and u.status='active') as users from roles r where r.tenant_id=$1 order by r.is_system desc, r.name", [ctx.tenantId]);
  const order = ["Group Admin", "Branch Admin", "Admission Head", "Counsellor", "Front Office", "Principal", "Marketing", "Accounts", "Read-only Management"];
  roles.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  return (
    <div className="space-y-4">
      <form action={saveRoles} className="card overflow-x-auto">
        <div className="card-h"><span>Permission matrix</span><button className="btn btn-primary btn-sm">Save permissions</button></div>
        <p className="muted px-4 pt-3 text-xs">{LEVEL_HELP}. Other values limit the role to its own area (for example Front Office: Check-in, Accounts: Collect). Sensitive fields: anything other than F, T or V shows masked values.</p>
        <table className="tbl mt-2">
          <thead><tr><th className="sticky left-0 bg-slate-50">Capability</th>{roles.map((r) => <th key={r.id}>{r.name}<span className="muted block font-normal">{r.users} user{r.users === 1 ? "" : "s"}</span></th>)}</tr></thead>
          <tbody>{CAPS.map(([k, label]) => (
            <tr key={k}><td className="sticky left-0 bg-white font-medium">{label}</td>
              {roles.map((r) => <td key={r.id}><select name={`${r.id}:${k}`} defaultValue={r.permissions[k] ?? "-"} disabled={r.name === "Group Admin"} aria-label={`${r.name}: ${label}`} className="input !w-28 !px-1.5 !py-1 text-xs">{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></td>)}</tr>
          ))}</tbody>
        </table>
      </form>
      <form action={cloneRole} className="card flex flex-wrap items-end gap-3 p-4">
        <label><span className="label">Create a role from</span><select name="id" className="input w-56">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label><span className="label">New role name</span><input name="name" required className="input w-56" placeholder="Seasonal counsellor" /></label>
        <button className="btn">Clone role</button>
      </form>
    </div>
  );
}

export async function Fields({ ctx }: { ctx: Ctx }) {
  const fields = await q("select f.*, (select count(*)::int from enquiries e where e.tenant_id=f.tenant_id and coalesce(e.custom->>f.key,'')<>'') as used from custom_fields f where f.tenant_id=$1 order by f.position", [ctx.tenantId]);
  const standard = ["Student name", "Date of birth (sensitive)", "Gender", "Grade", "Board", "Parent name", "Mobile (unique per organisation)", "Email", "Address", "Locality", "Source", "Stage", "Owner", "Expected decision date", "Special needs note (sensitive)"];
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-h">Add a field to Enquiry</div>
        <form action={saveField} className="flex flex-wrap items-end gap-3 p-4">
          <label><span className="label">Label</span><input name="label" required className="input w-56" placeholder="Transport required" /></label>
          <label><span className="label">Type</span><select name="type" className="input w-36"><option value="text">Text</option><option value="select">Dropdown</option></select></label>
          <label><span className="label">Dropdown values (comma separated)</span><input name="options" className="input w-72" placeholder="Yes, No, Not sure" /></label>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="sensitive" /> Sensitive (masked for most roles)</label>
          <button className="btn btn-primary">Add field</button>
        </form>
      </section>
      <section className="card">
        <div className="card-h">Custom fields</div>
        <div className="divide-y divide-slate-100">
          {fields.map((f) => (
            <form key={f.id} action={saveField} className="flex flex-wrap items-end gap-3 px-4 py-3">
              <input type="hidden" name="id" value={f.id} /><input type="hidden" name="type" value={f.type} />
              <label><span className="label">Label</span><input name="label" defaultValue={f.label} className="input w-56" /></label>
              {f.type === "select" && <label><span className="label">Values</span><input name="options" defaultValue={(f.options as string[]).join(", ")} className="input w-72" /></label>}
              <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="sensitive" defaultChecked={f.sensitive} /> Sensitive</label>
              <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="active" defaultChecked={f.active} /> Active</label>
              <span className="muted pb-2 text-xs">{f.type === "select" ? "Dropdown" : "Text"} · filled on {f.used} record{f.used === 1 ? "" : "s"}</span>
              <button className="btn">Save</button>
            </form>
          ))}
          {!fields.length && <p className="muted px-4 py-3">No custom fields yet.</p>}
        </div>
      </section>
      <section className="card p-4">
        <p className="font-semibold">Standard fields</p>
        <p className="muted mt-1 text-xs">These drive duplicate checks, routing and reports, so they cannot be deleted.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{standard.map((s) => <Badge key={s}>{s}</Badge>)}</div>
      </section>
    </div>
  );
}

const COLORS = ["slate", "sky", "violet", "amber", "orange", "teal", "green", "rose"];

export async function Pipeline({ ctx }: { ctx: Ctx }) {
  const phases = await q("select * from phases where tenant_id=$1 order by position", [ctx.tenantId]);
  const stages = await q("select s.*, (select count(*)::int from enquiries e where e.stage_id=s.id) as records from stages s where s.tenant_id=$1 and s.active order by s.position", [ctx.tenantId]);
  return (
    <div className="space-y-4">
      <p className="muted">One pipeline for every academic year. Order is set with the arrows, never with numbers in names. Probability feeds the admissions forecast.</p>
      {phases.map((ph) => (
        <section key={ph.id} className="card">
          <div className="card-h">{ph.name}</div>
          <div className="divide-y divide-slate-100">
            {stages.filter((s) => s.phase_id === ph.id).map((s) => (
              <div key={s.id} className="flex flex-wrap items-end gap-2 px-4 py-2.5">
                <form action={moveStageOrder} className="flex gap-0.5 pb-0.5"><input type="hidden" name="id" value={s.id} /><button name="dir" value="up" className="btn btn-sm" aria-label={`Move ${s.name} up`}>↑</button><button name="dir" value="down" className="btn btn-sm" aria-label={`Move ${s.name} down`}>↓</button></form>
                <form action={saveStage} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <label><span className="label">Stage</span><span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${DOTS[s.color]}`} /><input name="name" defaultValue={s.name} className="input w-48" /></span></label>
                  <label><span className="label">Colour</span><select name="color" defaultValue={s.color} className="input w-24">{COLORS.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <label><span className="label">Probability %</span><input name="probability" type="number" min={0} max={100} defaultValue={s.probability} className="input w-20" /></label>
                  <label><span className="label">SLA hours</span><input name="sla_hours" type="number" min={0} defaultValue={s.sla_hours} className="input w-20" /></label>
                  <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="exempt" defaultChecked={s.exempt_next_action} /> No next action needed</label>
                  <button className="btn">Save</button>
                </form>
                <form action={retireStage} className="ml-auto flex items-end gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <span className="muted pb-2 text-xs">{s.records} record{s.records === 1 ? "" : "s"}</span>
                  {s.records > 0 && <select name="targetId" className="input w-44" aria-label={`Move records from ${s.name} to`}><option value="">Move records to…</option>{stages.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                  <button className="btn btn-danger">Retire</button>
                </form>
              </div>
            ))}
            <form action={saveStage} className="flex flex-wrap items-end gap-2 bg-slate-50 px-4 py-2.5">
              <input type="hidden" name="phaseId" value={ph.id} />
              <label><span className="label">Add a stage to {ph.name}</span><input name="name" className="input w-48" placeholder="Stage name" /></label>
              <label><span className="label">Probability %</span><input name="probability" type="number" defaultValue={0} className="input w-20" /></label>
              <button className="btn">Add stage</button>
            </form>
          </div>
        </section>
      ))}
    </div>
  );
}
