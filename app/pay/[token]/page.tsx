import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { fmtDateTime, inr } from "@/lib/fmt";
import { demoPay } from "@/app/actions/public";

export const dynamic = "force-dynamic";

/**
 * Payment link page. No gateway account is connected in this build, so the checkout is a clearly
 * labelled simulator; a real gateway replaces the two buttons and confirms through its webhook.
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await one("select p.*, st.name as student, t.name as school, t.branding from payments p join enquiries e on e.id=p.enquiry_id join students st on st.id=e.student_id join tenants t on t.id=p.tenant_id where p.token=$1", [token]);
  if (!p) notFound();
  const demo = !process.env.DATABASE_URL || process.env.DEMO_PAYMENTS === "1";
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow">
        <div className="px-6 py-5 text-white" style={{ background: p.branding?.color ?? "#0f6e6e" }}><p className="text-sm opacity-90">{p.school}</p><h1 className="text-xl font-semibold">{p.purpose}</h1></div>
        <div className="space-y-4 p-6 text-center">
          <p className="muted">For {p.student}</p>
          <p className="text-4xl font-semibold text-slate-900">{inr(p.amount)}</p>
          {p.status === "paid" ? (
            <div className="rounded-md bg-green-50 p-4 text-green-800"><p className="font-semibold">Payment received</p><p className="text-sm">Receipt {p.receipt_no} · {fmtDateTime(p.paid_at)}</p></div>
          ) : (
            <>
              {p.status === "failed" && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">The last attempt did not go through. No money was taken. Please try again.</p>}
              {!demo && <p className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-700">Online payment is not switched on for this school yet. Please pay at the school office and quote this page.</p>}
              {demo && <form action={demoPay} className="space-y-2">
                <input type="hidden" name="token" value={token} />
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Demo checkout: no payment gateway is connected, so no real money moves.</p>
                <button name="result" value="success" className="btn btn-primary btn-lg w-full">Simulate a successful payment</button>
                <button name="result" value="failure" className="btn w-full">Simulate a failed payment</button>
              </form>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
