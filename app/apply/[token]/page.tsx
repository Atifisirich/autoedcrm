import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { APPLICATION_SECTIONS } from "@/lib/admissions";
import { inr } from "@/lib/fmt";
import { ApplicationForm } from "@/components/ApplicationForm";
import { parentApplication, parentUpload } from "@/app/actions/public";

export const dynamic = "force-dynamic";

/** Parent's application link: prefilled, save and resume, progress, documents and fee status (APP-01, APP-02). */
export default async function ApplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const e = await one(
    `select e.id, e.tenant_id, e.grade, e.application_no, e.custom, st.name as student, st.current_school, t.name as school, t.branding, h.address, h.pincode, b.name as branch, s.name as stage
     from enquiries e join students st on st.id=e.student_id join tenants t on t.id=e.tenant_id join households h on h.id=e.household_id join branches b on b.id=e.branch_id join stages s on s.id=e.stage_id
     where e.public_token=$1 and t.status in ('active','trial')`, [token]);
  if (!e) notFound();
  const app = await one("select * from applications where enquiry_id=$1", [e.id]);
  const docs = app ? await q("select * from documents where enquiry_id=$1 order by type", [e.id]) : [];
  const pays = await q("select * from payments where enquiry_id=$1 and mode='link' order by created_at", [e.id]);
  const answers = app?.answers ?? { address: e.address ?? "", pincode: e.pincode ?? "", previous_school: e.current_school ?? "", transport: e.custom?.transport_required ?? "" };
  const submitted = app?.status === "submitted";
  const color = e.branding?.color ?? "#0f6e6e";
  return (
    <main className="min-h-full bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="overflow-hidden rounded-xl bg-white shadow">
          <div className="px-6 py-5 text-white" style={{ background: color }}>
            <p className="text-sm opacity-90">{e.school} · {e.branch}</p>
            <h1 className="text-xl font-semibold">Application for {e.student}, {e.grade}</h1>
            {e.application_no && <p className="text-sm opacity-90">Application number {e.application_no}</p>}
          </div>
          <div className="p-6">
            {submitted ? <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-green-800">Your application is submitted. Current status: <b>{e.stage}</b>. The school will contact you about the next step.</p>
              : <p className="muted mb-4">We have filled in what we already know. {app ? `You are ${app.progress}% done; ` : ""}you can save and come back to this link at any time.</p>}
            <ApplicationForm action={parentApplication} hidden={{ token }} sections={APPLICATION_SECTIONS} answers={answers} readOnly={submitted} staff={false} />
          </div>
        </div>
        {docs.length > 0 && (
          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="font-semibold text-slate-900">Documents</h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {docs.map((d) => (
                <li key={d.id} className="py-2.5">
                  <div className="flex items-center justify-between"><span>{d.type}</span><span className={d.status === "verified" ? "text-green-700" : d.status === "rejected" ? "text-rose-700" : "text-slate-500"}>{d.status === "verified" ? "✓ Verified" : d.status === "uploaded" ? "Received, being checked" : d.status === "rejected" ? "Please send again" : "Not yet received"}</span></div>
                  {d.reject_reason && <p className="text-sm text-rose-700">{d.reject_reason}</p>}
                  {["pending", "rejected"].includes(d.status) && <form action={parentUpload} className="mt-1 flex gap-2"><input type="hidden" name="token" value={token} /><input type="hidden" name="docId" value={d.id} /><input type="file" name="file" required accept="image/*,.pdf" capture="environment" className="w-full text-sm" /><button className="btn btn-sm">Send</button></form>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pays.length > 0 && (
          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="font-semibold text-slate-900">Fees</h2>
            <ul className="mt-2 space-y-2">{pays.map((p) => <li key={p.id} className="flex items-center justify-between"><span>{p.purpose} · {inr(p.amount)}</span>{p.status === "paid" ? <span className="text-green-700">✓ Paid · receipt {p.receipt_no}</span> : <a className="btn btn-primary btn-sm" href={`/pay/${p.token}`}>Pay now</a>}</li>)}</ul>
          </div>
        )}
      </div>
    </main>
  );
}
