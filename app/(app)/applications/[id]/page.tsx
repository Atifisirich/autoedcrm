import { isUuid } from "@/lib/util";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx, scopeSql } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { APPLICATION_SECTIONS, ageIssue, checklist, seatUse } from "@/lib/admissions";
import { fmtDate, inr } from "@/lib/fmt";
import { canEditApplications, canTakePayment, canVerifyDocs, canVerifyPayment, lvl } from "@/lib/perm";
import { Badge, PageHeader } from "@/components/ui";
import { ApplicationForm } from "@/components/ApplicationForm";
import { confirmAdmissionAction, docAction, paymentAction, saveApplicationAction, startApplicationAction } from "@/app/actions/record";

const DOC_TONE: Record<string, string> = { pending: "slate", uploaded: "amber", verified: "green", rejected: "rose" };
const DOC_TEXT: Record<string, string> = { pending: "Not received", uploaded: "Received, to review", verified: "Verified", rejected: "Rejected" };

/** Application review (key screen): answers, documents with verify / reject, payment status, decision. */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("applications");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps, "e", false);
  ps.push(id);
  const e = await one(`select e.*, st.name as student, s.name as stage, s.color, s.is_won, s.is_closed, b.name as branch, y.name as year from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join branches b on b.id=e.branch_id join academic_years y on y.id=e.year_id where ${scope} and e.id=$${ps.length}`, ps);
  if (!e) notFound();
  const t = ctx.tenantId;
  const [app, docs, payments, list, issue, seats] = await Promise.all([
    one("select * from applications where tenant_id=$1 and enquiry_id=$2", [t, id]),
    q("select * from documents where tenant_id=$1 and enquiry_id=$2 order by type", [t, id]),
    q("select * from payments where tenant_id=$1 and enquiry_id=$2 order by created_at", [t, id]),
    checklist(t, id), ageIssue(t, e), seatUse(t, e.branch_id, e.year_id, e.grade),
  ]);
  const edit = canEditApplications(ctx.perms), verify = canVerifyDocs(ctx.perms), decide = ["F", "T", "Decide"].includes(lvl(ctx.perms, "applications"));
  const fees = ctx.tenant.settings.fees ?? { registration: 1500, admission: 25000 };
  return (
    <>
      <PageHeader title={`${e.student} · ${e.application_no ?? "Application"}`} sub={<>{e.grade} · {e.branch} · {e.year} · <Badge tone={e.color}>{e.stage}</Badge></>}>
        <Link className="btn" href={`/households/${e.household_id}?e=${e.id}`}>Open family page</Link>
      </PageHeader>
      {!app ? (
        <div className="card p-6 text-center">
          <p className="font-medium">No application yet for this child.</p>
          {edit && <form action={startApplicationAction} className="mt-3"><input type="hidden" name="enquiryId" value={e.id} /><button className="btn btn-primary">Start application</button></form>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <section className="card">
            <div className="card-h"><span>Form answers</span><span className="muted font-normal">{app.status === "submitted" ? `Submitted ${fmtDate(app.submitted_at)}` : `${app.progress}% complete · saved automatically on each save`}</span></div>
            <div className="p-4">
              {issue && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-amber-900">Age check: {issue}</p>}
              <ApplicationForm action={saveApplicationAction} hidden={{ enquiryId: e.id }} sections={APPLICATION_SECTIONS} answers={app.answers} readOnly={app.status === "submitted" || !edit} staff canOverrideAge={!!issue && decide} />
              {app.status !== "submitted" && <p className="muted mt-3 text-xs">Parent link: /apply/{e.public_token}</p>}
            </div>
          </section>
          <aside className="space-y-4">
            <section className="card">
              <div className="card-h">Decision</div>
              <div className="space-y-2 p-4">
                {list.map((c) => <p key={c.label} className={c.done ? "text-green-800" : "text-slate-600"}>{c.done ? "✓" : "○"} {c.label}</p>)}
                {seats && <p className="muted text-xs">Seats in {e.grade}: {seats.confirmed} confirmed of {seats.capacity}</p>}
                {e.is_won ? <Badge tone="green">Admission confirmed</Badge> : decide && !e.is_closed && <form action={confirmAdmissionAction}><input type="hidden" name="enquiryId" value={e.id} /><button className="btn btn-primary w-full" disabled={list.some((c) => !c.done)}>Confirm admission</button></form>}
                {!e.is_won && list.some((c) => !c.done) && <p className="muted text-xs">The button unlocks when every item above is done.</p>}
              </div>
            </section>
            <section className="card">
              <div className="card-h">Documents</div>
              <ul className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <li key={d.id} className="space-y-1.5 px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{d.type}</span><Badge tone={DOC_TONE[d.status]}>{DOC_TEXT[d.status]}</Badge></div>
                    {d.file_name && <p className="muted text-xs">{d.file_name}</p>}
                    {d.reject_reason && <p className="text-xs text-rose-700">Reason: {d.reject_reason}</p>}
                    {edit && ["pending", "rejected"].includes(d.status) && <form action={docAction} className="flex gap-1.5"><input type="hidden" name="docId" value={d.id} /><input type="hidden" name="what" value="upload" /><input type="file" name="file" required accept="image/*,.pdf" className="w-full text-xs" /><button className="btn btn-sm">Add</button></form>}
                    {verify && d.status === "uploaded" && <form action={docAction} className="flex gap-1.5"><input type="hidden" name="docId" value={d.id} /><input name="reason" placeholder="Reason if rejecting" className="input !py-1 text-xs" /><button name="what" value="verify" className="btn btn-sm btn-primary">Verify</button><button name="what" value="reject" className="btn btn-sm btn-danger">Reject</button></form>}
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <div className="card-h">Payments</div>
              <ul className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between"><span className="font-medium">{p.purpose} · {inr(p.amount)}</span><Badge tone={p.status === "paid" ? "green" : p.status === "failed" ? "rose" : "amber"}>{p.status === "awaiting_verification" ? "To verify" : p.status[0].toUpperCase() + p.status.slice(1)}</Badge></div>
                    <p className="muted text-xs">{p.mode.replace("_", " ")}{p.receipt_no ? ` · receipt ${p.receipt_no}` : ""}{p.status !== "paid" && p.mode === "link" ? ` · link /pay/${p.token}` : ""}</p>
                    {canVerifyPayment(ctx.perms) && p.status !== "paid" && <form action={paymentAction} className="mt-1.5 flex gap-1.5"><input type="hidden" name="paymentId" value={p.id} /><input name="reference" placeholder="Reference" className="input !py-1 text-xs" /><button name="what" value="verify" className="btn btn-sm">Mark received</button></form>}
                  </li>
                ))}
                {!payments.length && <li className="muted px-4 py-3">No payments requested yet.</li>}
              </ul>
              {canTakePayment(ctx.perms) && (
                <form action={paymentAction} className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3">
                  <input type="hidden" name="enquiryId" value={e.id} /><input type="hidden" name="what" value="create" />
                  <select name="purpose" className="input" aria-label="Purpose"><option>Admission fee</option><option>Registration fee</option></select>
                  <input name="amount" type="number" min={1} defaultValue={fees.admission} required className="input" aria-label="Amount" />
                  <select name="mode" className="input" aria-label="Mode"><option value="link">Send payment link</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option></select>
                  <button className="btn">Request / record</button>
                </form>
              )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
