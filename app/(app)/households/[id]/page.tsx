import { isUuid } from "@/lib/util";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx, scopeSql } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { scoreBreakdown, TASK_TYPES } from "@/lib/core";
import { fmtDate, fmtDateTime, inr, localInput, rel, age } from "@/lib/fmt";
import { pipeline } from "@/lib/leads";
import { canEditApplications, canEditLeads, canMessage, canTakePayment, canWorkTasks, has, lvl, mask, seesSensitive } from "@/lib/perm";
import { Badge, Empty, Temp } from "@/components/ui";
import { TaskDone } from "@/components/TaskDone";
import { addSibling, updateDetails, visitUpdate, addTaskAction } from "@/app/actions/record";
import { ActionBar } from "./ActionBar";

const ICON: Record<string, string> = { call: "📞", whatsapp: "💬", sms: "✉", email: "📧", note: "📝", visit: "🏫", stage_change: "➜", field_change: "✎", payment: "₹", document: "📎", system: "⚙", form: "📄", touch: "◎", task: "✓" };
const TYPE_LABEL: Record<string, string> = { call: "Call", whatsapp: "WhatsApp", sms: "SMS", email: "Email", note: "Note", visit: "Visit", stage_change: "Stage", field_change: "Edit", payment: "Payment", document: "Document", system: "System", form: "Application", touch: "Source", task: "Task" };

export default async function HouseholdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx("leads");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const t = ctx.tenantId;
  const ps: any[] = [];
  const where = scopeSql(ctx, ps, "e", false);
  ps.push(id);
  const enquiries = await q(
    `select e.*, st.name as student, st.dob::text as dob, st.gender, st.current_school, st.current_grade, st.special_needs, s.name as stage, s.color, s.is_closed, s.is_won, s.exempt_next_action,
            p.key as phase_key, u.name as owner, b.name as branch, y.name as year
     from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id
     join users u on u.id=e.owner_id join branches b on b.id=e.branch_id join academic_years y on y.id=e.year_id
     where ${where} and e.household_id=$${ps.length} order by y.position desc, e.created_at`,
    ps,
  );
  if (!enquiries.length) notFound();
  const e = enquiries.find((x) => x.id === sp.e) ?? enquiries[0];
  const typeFilter = sp.t;
  const [hh, guardians, acts, tasks, visits, touches, app, docs, payments, fields, { stages }, templates, users, score] = await Promise.all([
    one("select * from households where tenant_id=$1 and id=$2", [t, id]),
    q("select * from guardians where tenant_id=$1 and household_id=$2 order by is_primary desc", [t, id]),
    q(`select a.*, u.name as actor from activities a left join users u on u.id=a.actor_id where a.tenant_id=$1 and a.household_id=$2 ${typeFilter ? "and a.type=$3" : ""} order by a.created_at desc limit 150`, typeFilter ? [t, id, typeFilter] : [t, id]),
    q("select k.*, u.name as owner from tasks k join users u on u.id=k.owner_id where k.tenant_id=$1 and k.enquiry_id=$2 order by (k.status='open') desc, k.due_at desc limit 20", [t, e.id]),
    q("select v.*, u.name as host from visits v left join users u on u.id=v.host_id where v.tenant_id=$1 and v.enquiry_id=$2 order by v.slot_at desc", [t, e.id]),
    q("select * from source_touches where tenant_id=$1 and enquiry_id=$2 order by created_at", [t, e.id]),
    one("select * from applications where tenant_id=$1 and enquiry_id=$2", [t, e.id]),
    q("select * from documents where tenant_id=$1 and enquiry_id=$2 order by type", [t, e.id]),
    q("select * from payments where tenant_id=$1 and enquiry_id=$2 order by created_at desc", [t, e.id]),
    q("select * from custom_fields where tenant_id=$1 and entity='enquiry' and active order by position", [t]),
    pipeline(t),
    q("select id, name, channel, body from templates where tenant_id=$1 and status='approved' order by name", [t]),
    q("select u.id, u.name from users u join roles r on r.id=u.role_id where u.tenant_id=$1 and u.status='active' and r.permissions->>'leads' in ('F','T','O') order by u.name", [t]),
    scoreBreakdown(t, e.id),
  ]);
  const g = guardians[0];
  const openTasks = tasks.filter((k) => k.status === "open");
  const next = [...openTasks].sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at))[0];
  const needsNext = !e.is_closed && !e.is_won && !e.exempt_next_action && !openTasks.length;
  const sens = seesSensitive(ctx.perms);
  const edit = canEditLeads(ctx.perms);
  const s = ctx.tenant.settings;
  const reasons: string[] = s.closure_reasons ?? [];
  const defaultDue = localInput(new Date(Date.now() + 24 * 3600e3));
  const stageOpts = stages.map((x) => ({ id: x.id, name: x.name, phase_name: x.phase_name, is_closed: x.is_closed, exempt_next_action: x.exempt_next_action }));
  const base = `/households/${id}?e=${e.id}`;
  const lastCall = acts.find((a) => a.type === "call" && a.outcome === "connected");
  const lastNote = acts.find((a) => a.type === "note");
  const docsOk = docs.filter((d) => d.status === "verified").length;
  const F = ({ label, name, value, type = "text", options }: { label: string; name: string; value: any; type?: string; options?: string[] }) => (
    <label className="block"><span className="label">{label}</span>
      {options ? <select name={name} defaultValue={value ?? ""} disabled={!edit} className="input"><option value=""></option>{options.map((o) => <option key={o}>{o}</option>)}</select> : <input name={name} type={type} defaultValue={value ?? ""} readOnly={!edit} className="input" />}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/leads" className="muted text-xs hover:underline">← Leads</Link>
          <h1 className="text-xl font-semibold text-slate-900">{g?.name ?? "Household"} <span className="muted text-base font-normal">family</span></h1>
          <p className="muted">{g?.relation} · +91 {g?.mobile}{g?.email ? ` · ${g.email}` : ""}{hh?.locality ? ` · ${hh.locality}` : ""}{hh?.sibling_in_school && <span className="ml-2"><Badge tone="teal">Sibling in school</Badge></span>}</p>
        </div>
        {edit && (
          <details className="relative">
            <summary className="btn list-none">+ Add sibling</summary>
            <form action={addSibling} className="card absolute right-0 z-10 mt-1 w-80 space-y-2 p-3 shadow-lg">
              <input type="hidden" name="householdId" value={id} />
              <p className="muted text-xs">Parent and address details are reused from this household.</p>
              <label className="block"><span className="label">Child's name</span><input name="studentName" required className="input" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Grade</span><select name="grade" required className="input">{(s.grades ?? []).map((x: string) => <option key={x}>{x}</option>)}</select></label>
                <label><span className="label">Date of birth</span><input type="date" name="dob" className="input" /></label>
              </div>
              <label className="block"><span className="label">Branch</span><select name="branchId" defaultValue={e.branch_id} className="input">{ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <button className="btn btn-primary w-full">Add sibling</button>
            </form>
          </details>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Children in this household">
        {enquiries.map((x) => (
          <Link key={x.id} href={`/households/${id}?e=${x.id}`} role="tab" aria-selected={x.id === e.id} className={`tab ${x.id === e.id ? "tab-on" : ""}`}>
            {x.student} <span className="muted font-normal">· {x.grade} · {x.year}</span> <Badge tone={x.color}>{x.stage}</Badge>
          </Link>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div><div className="label !mb-0">Stage</div><Badge tone={e.color}>{e.stage}</Badge>{e.closure_reason && <span className="muted ml-1 text-xs">({e.closure_reason})</span>}</div>
        <div><div className="label !mb-0">Owner</div>{e.owner}</div>
        <div><div className="label !mb-0">Score</div>
          <details className="relative inline-block"><summary className="cursor-pointer list-none"><b>{e.score}</b> <Temp t={e.temperature} /> <span className="link text-xs">why?</span></summary>
            <div className="card absolute z-10 mt-1 w-64 p-3 shadow-lg"><p className="mb-1 text-xs font-semibold">What moved this score</p>
              {score.parts.length ? score.parts.map((p) => <div key={p.key} className="flex justify-between text-xs"><span>{p.label} × {p.count}</span><span className="font-semibold">+{p.points}</span></div>) : <p className="muted text-xs">No scoring activity yet.</p>}
            </div></details></div>
        <div><div className="label !mb-0">Next action</div>{next ? <span className={new Date(next.due_at) < new Date() ? "font-medium text-rose-700" : ""}>{next.title} · {rel(next.due_at)}</span> : <span className={needsNext ? "font-semibold text-rose-700" : "muted"}>{needsNext ? "None planned" : "Not needed in this stage"}</span>}</div>
        <div><div className="label !mb-0">Age of enquiry</div>{age(e.created_at)}</div>
        <div><div className="label !mb-0">Branch · year</div>{e.branch} · {e.year}</div>
        {e.application_no && <div><div className="label !mb-0">Application</div><Link className="link" href={`/applications/${e.id}`}>{e.application_no}</Link></div>}
        <div className="flex flex-wrap gap-1">{e.reenquired && <Badge tone="amber">Re-enquired</Badge>}{(e.tags as string[]).map((x) => <Badge key={x}>{x}</Badge>)}</div>
      </div>

      {needsNext && has(ctx.perms, "tasks") && (
        <form action={addTaskAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3">
          <input type="hidden" name="enquiryId" value={e.id} />
          <p className="w-full font-semibold text-rose-800">This enquiry has no next action. Plan one now so it is not forgotten.</p>
          <label><span className="label">Task</span><input name="title" defaultValue="Follow-up call" required className="input w-56" /></label>
          <label><span className="label">Due</span><input type="datetime-local" name="dueAt" defaultValue={defaultDue} required className="input" /></label>
          <button className="btn btn-primary">Plan next action</button>
        </form>
      )}

      <div className="card border-brand-200 bg-brand-50/50 px-4 py-3">
        <p className="text-xs font-semibold text-brand-900">At a glance <span className="font-normal text-slate-500">(built from this record's data, not AI)</span></p>
        <ul className="mt-1 space-y-0.5 text-slate-700">
          <li><b>Who:</b> {g?.name}{g?.occupation ? `, ${g.occupation.toLowerCase()}` : ""}{hh?.locality ? `, from ${hh.locality}` : ""}; {enquiries.length > 1 ? `${enquiries.length} enquiries in this family` : "one child enquiring"}. Looking at {e.grade ?? "a grade not yet set"} ({e.board ?? "board not set"}) at {e.branch}.</li>
          <li><b>What they care about:</b> {lastNote?.content ?? lastCall?.content ?? "Nothing recorded yet. Ask about transport, fees and timings on the first call."}</li>
          <li><b>What to do next:</b> {next ? `${next.title}, ${rel(next.due_at)}.` : e.is_won ? "Admission is confirmed. Send onboarding details." : e.is_closed ? "Closed. A new enquiry from this family will reopen it." : "Plan the next follow-up."}</li>
        </ul>
      </div>

      <ActionBar enquiryId={e.id} mobile={g?.mobile ?? ""} stageId={e.stage_id} stages={stageOpts} reasons={reasons} templates={templates as any} users={users as any} defaultDue={defaultDue} initial={sp.panel} hasApplication={!!app}
        fees={s.fees ?? { registration: 1500, admission: 25000 }}
        can={{ edit, message: canMessage(ctx.perms), tasks: canWorkTasks(ctx.perms), reassign: ["F", "T"].includes(lvl(ctx.perms, "reassign")), application: canEditApplications(ctx.perms), pay: canTakePayment(ctx.perms) }} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="card" aria-label="Timeline">
          <div className="card-h"><span>Timeline <span className="muted font-normal">all children, all channels</span></span></div>
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
            <Link href={base} className={`chip ${!typeFilter ? "chip-on" : ""}`}>Everything</Link>
            {["call", "whatsapp", "sms", "email", "note", "visit", "stage_change", "payment", "document"].map((k) => <Link key={k} href={`${base}&t=${k}`} className={`chip ${typeFilter === k ? "chip-on" : ""}`}>{TYPE_LABEL[k]}</Link>)}
          </div>
          {!acts.length && <Empty title="Nothing here yet">Calls, messages, visits, stage moves and edits appear here as they happen.</Empty>}
          <ol className="divide-y divide-slate-100">
            {acts.map((a) => {
              const failed = a.meta?.status === "failed";
              const child = enquiries.length > 1 ? enquiries.find((x) => x.id === a.enquiry_id)?.student : null;
              return (
                <li key={a.id} className="flex gap-3 px-4 py-2.5">
                  <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm">{ICON[a.type] ?? "•"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="font-semibold text-slate-700">{TYPE_LABEL[a.type] ?? a.type}{a.meta?.direction === "in" ? " from parent" : a.meta?.direction === "out" ? " to parent" : ""}</span>
                      {child && <span className="muted">{child}</span>}
                      <span className="muted">{a.actor ?? (a.meta?.direction === "in" ? g?.name : "Automatic")} · {fmtDateTime(a.created_at)}</span>
                    </div>
                    <p className={`mt-0.5 whitespace-pre-wrap ${failed ? "font-medium text-rose-700" : "text-slate-800"}`}>{a.content}</p>
                    {failed && a.meta?.body && <p className="muted mt-0.5 text-xs">Message was: {a.meta.body}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="space-y-4">
          <section className="card">
            <div className="card-h">Tasks</div>
            {!tasks.length && <Empty title="No tasks yet" />}
            <ul className="divide-y divide-slate-100">
              {tasks.slice(0, 8).map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0"><div className={k.status !== "open" ? "muted line-through" : "font-medium"}>{k.title}</div>
                    <div className={`text-xs ${k.status === "open" && new Date(k.due_at) < new Date() ? "text-rose-700" : "muted"}`}>{TASK_TYPES[k.type] ?? k.type} · {k.owner} · {k.status === "open" ? rel(k.due_at) : k.status === "done" ? `done: ${k.outcome ?? ""}` : "cancelled"}</div></div>
                  {k.status === "open" && canWorkTasks(ctx.perms) && <TaskDone taskId={k.id} title={k.title} lastOpen={openTasks.length === 1 && !e.exempt_next_action} stages={stageOpts} reasons={reasons} defaultDue={defaultDue} />}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="card-h">Details</div>
            <form action={updateDetails} className="space-y-2 p-4">
              <input type="hidden" name="enquiryId" value={e.id} />
              <p className="text-xs font-semibold text-slate-500">Student</p>
              <F label="Name" name="s_name" value={e.student} />
              <div className="grid grid-cols-2 gap-2">
                <F label="Grade applying for" name="e_grade" value={e.grade} options={s.grades} />
                <F label="Board" name="e_board" value={e.board} options={s.boards} />
                {sens ? <F label="Date of birth" name="s_dob" value={e.dob} type="date" /> : <label className="block"><span className="label">Date of birth</span><input disabled value={mask(e.dob)} className="input" title="Hidden for your role" /></label>}
                <F label="Gender" name="s_gender" value={e.gender} options={["Girl", "Boy", "Other"]} />
              </div>
              <F label="Current school" name="s_current_school" value={e.current_school} />
              {sens ? <F label="Special needs note (restricted)" name="s_special_needs" value={e.special_needs} /> : null}
              <F label="Expected decision date" name="e_expected_decision" value={e.expected_decision} type="date" />
              {fields.map((f) => f.sensitive && !sens ? <label key={f.id} className="block"><span className="label">{f.label}</span><input disabled value={mask(e.custom?.[f.key])} className="input" title="Hidden for your role" /></label> : <F key={f.id} label={f.label} name={"cf_" + f.key} value={e.custom?.[f.key]} options={f.type === "select" ? f.options : undefined} />)}
              <p className="pt-2 text-xs font-semibold text-slate-500">Parent and home</p>
              <F label="Parent name" name="g_name" value={g?.name} />
              <div className="grid grid-cols-2 gap-2">
                <F label="Relation" name="g_relation" value={g?.relation} options={["Father", "Mother", "Guardian", "Parent"]} />
                <F label="Alternate mobile" name="g_alt_mobile" value={g?.alt_mobile} />
              </div>
              <F label="Email" name="g_email" value={g?.email} type="email" />
              <F label="Occupation" name="g_occupation" value={g?.occupation} />
              <F label="Address" name="h_address" value={hh?.address} />
              <div className="grid grid-cols-2 gap-2"><F label="Locality" name="h_locality" value={hh?.locality} /><F label="PIN code" name="h_pincode" value={hh?.pincode} /></div>
              <F label="How they heard about us" name="h_heard_about" value={hh?.heard_about} />
              <F label="Sibling already in school" name="h_sibling_in_school" value={hh?.sibling_in_school ? "yes" : "no"} options={["yes", "no"]} />
              {edit && <button className="btn btn-primary w-full">Save details</button>}
            </form>
          </section>

          <section className="card">
            <div className="card-h">Visits</div>
            {!visits.length && <Empty title="No visits booked">Use Book visit in the action bar.</Empty>}
            <ul className="divide-y divide-slate-100">
              {visits.map((v) => (
                <li key={v.id} className="px-4 py-2">
                  <div className="flex items-center justify-between"><span className="font-medium">{fmtDateTime(v.slot_at)}</span><Badge tone={v.status === "done" ? "green" : v.status === "scheduled" ? "violet" : "rose"}>{v.status === "no_show" ? "No-show" : v.status[0].toUpperCase() + v.status.slice(1)}</Badge></div>
                  <div className="muted text-xs">{v.type.replace("_", " ")} · host {v.host ?? "not set"}{v.outcome ? ` · ${v.outcome}` : ""}</div>
                  {v.status === "scheduled" && canWorkTasks(ctx.perms) && (
                    <form action={visitUpdate} className="mt-1.5 flex flex-wrap gap-1.5">
                      <input type="hidden" name="visitId" value={v.id} />
                      <input name="outcome" placeholder="Outcome (needed for Done)" className="input !w-full !py-1 text-xs" />
                      {!v.checked_in_at && <button name="what" value="check_in" className="btn btn-sm">Check in</button>}
                      <button name="what" value="done" className="btn btn-sm">Done</button><button name="what" value="no_show" className="btn btn-sm">No-show</button><button name="what" value="cancel" className="btn btn-sm">Cancel</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="card-h"><span>Application</span>{app && <Link href={`/applications/${e.id}`} className="link text-xs">Open</Link>}</div>
            <div className="space-y-1 px-4 py-3">
              {!app ? <p className="muted">Not started. Use Form / payment in the action bar.</p> : (
                <>
                  <p>{app.status === "submitted" ? `Submitted ${fmtDate(app.submitted_at)}` : `In progress: ${app.progress}% of required answers`}</p>
                  <p className="muted text-xs">Documents verified: {docsOk} of {docs.length}</p>
                </>
              )}
              {payments.map((p) => <p key={p.id} className="text-xs">{p.purpose}: {inr(p.amount)} · <span className={p.status === "paid" ? "text-green-700" : p.status === "failed" ? "text-rose-700" : "text-amber-700"}>{p.status.replace("_", " ")}</span>{p.receipt_no ? ` · ${p.receipt_no}` : ""}</p>)}
            </div>
          </section>

          <section className="card">
            <div className="card-h">Source touches</div>
            <ul className="divide-y divide-slate-100">
              {touches.map((x, i) => <li key={x.id} className="px-4 py-2"><span className="font-medium">{x.source}</span> <span className="muted">({x.channel})</span>{i === 0 && <span className="ml-1"><Badge>First touch</Badge></span>}{i > 0 && i === touches.length - 1 && <span className="ml-1"><Badge>Latest</Badge></span>}<div className="muted text-xs">{x.campaign ? `Campaign: ${x.campaign} · ` : ""}{fmtDateTime(x.created_at)}</div></li>)}
            </ul>
          </section>

          <section className="card px-4 py-3 text-xs">
            <p className="font-semibold text-slate-700">Consent</p>
            <p className="muted mt-1">{["whatsapp", "sms", "email", "call"].map((c) => `${c}: ${g?.consent?.[c] === false ? "opted out" : "yes"}`).join(" · ")}</p>
            <p className="muted">Source: {g?.consent?.source ?? "not recorded"}{g?.consent?.at ? ` · ${fmtDate(g.consent.at)}` : ""}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
