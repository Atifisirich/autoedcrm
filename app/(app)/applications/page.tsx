import Link from "next/link";
import { requireCtx, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, inr } from "@/lib/fmt";
import { canVerifyPayment } from "@/lib/perm";
import { Badge, Empty, Meter, PageHeader, Stat } from "@/components/ui";
import { paymentAction } from "@/app/actions/record";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const ctx = await requireCtx("applications");
  const { f = "all" } = await searchParams;
  const ps: any[] = [];
  const scope = scopeSql(ctx, ps);
  ps.push(ctx.yearId);
  const rows = await q(
    `select a.*, e.id as enquiry_id, e.household_id, e.application_no, e.grade, st.name as student, s.name as stage, s.color, s.is_won, u.name as owner, b.name as branch,
       (select count(*)::int from documents d where d.enquiry_id=e.id) as docs,
       (select count(*)::int from documents d where d.enquiry_id=e.id and d.status='verified') as docs_ok,
       (select count(*)::int from documents d where d.enquiry_id=e.id and d.status='uploaded') as docs_review,
       (select coalesce(sum(p.amount),0) from payments p where p.enquiry_id=e.id and p.status='paid') as paid,
       (select count(*)::int from payments p where p.enquiry_id=e.id and p.status in ('pending','failed','awaiting_verification')) as pay_open
     from applications a join enquiries e on e.id=a.enquiry_id join students st on st.id=e.student_id join stages s on s.id=e.stage_id join users u on u.id=e.owner_id join branches b on b.id=e.branch_id
     where ${scope} and e.year_id=$${ps.length} order by a.updated_at desc limit 300`,
    ps,
  );
  const queue = canVerifyPayment(ctx.perms)
    ? await q(`select p.*, st.name as student, e.household_id from payments p join enquiries e on e.id=p.enquiry_id join students st on st.id=e.student_id where ${scope} and p.status='awaiting_verification' order by p.created_at`, ps.slice(0, -1))
    : [];
  const is = { started: (r: any) => r.status === "started", review: (r: any) => r.status === "submitted" && !r.is_won && (r.docs_review > 0 || r.docs_ok < r.docs), payment: (r: any) => r.pay_open > 0, ready: (r: any) => r.status === "submitted" && r.docs > 0 && r.docs_ok === r.docs && !r.is_won, all: () => true } as Record<string, (r: any) => boolean>;
  const shown = rows.filter(is[f] ?? is.all);
  const tabs = [["all", "All"], ["started", "In progress"], ["review", "Documents to review"], ["payment", "Payment pending"], ["ready", "Ready for decision"]];
  return (
    <>
      <PageHeader title="Applications" sub="The application phase of the same record: form, documents, fees and decision" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="In progress" value={rows.filter(is.started).length} href="/applications?f=started" />
        <Stat label="Documents to review" value={rows.filter(is.review).length} href="/applications?f=review" />
        <Stat label="Payment pending" value={rows.filter(is.payment).length} href="/applications?f=payment" />
        <Stat label="Ready for decision" value={rows.filter(is.ready).length} tone="good" href="/applications?f=ready" />
      </div>
      {queue.length > 0 && (
        <section className="card mb-4">
          <div className="card-h">Offline payments waiting for verification</div>
          <table className="tbl"><tbody>{queue.map((p) => (
            <tr key={p.id}><td><Link className="link" href={`/households/${p.household_id}?e=${p.enquiry_id}`}>{p.student}</Link></td><td>{p.purpose}</td><td>{inr(p.amount)}</td><td>{p.mode.replace("_", " ")}{p.reference ? ` · ${p.reference}` : ""}</td>
              <td className="text-right"><form action={paymentAction} className="flex justify-end gap-1.5"><input type="hidden" name="paymentId" value={p.id} /><button name="what" value="verify" className="btn btn-sm btn-primary">Verify and issue receipt</button><button name="what" value="fail" className="btn btn-sm">Not received</button></form></td></tr>
          ))}</tbody></table>
        </section>
      )}
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map(([k, l]) => <Link key={k} href={`/applications?f=${k}`} className={`tab ${f === k ? "tab-on" : ""}`}>{l}</Link>)}</div>
      <div className="card overflow-x-auto">
        {!shown.length ? <Empty title="No applications here">Start an application from a family's page, or send the parent the form link.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Application</th><th>Student</th><th>Grade</th><th>Form</th><th>Documents</th><th>Paid</th><th>Stage</th><th>Owner</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td><Link className="link" href={`/applications/${r.enquiry_id}`}>{r.application_no ?? "Open"}</Link></td>
                <td>{r.student}<span className="muted block text-xs">{r.branch}</span></td><td>{r.grade}</td>
                <td>{r.status === "submitted" ? <Badge tone="green">Submitted {fmtDate(r.submitted_at)}</Badge> : <Meter value={r.progress} max={100} />}</td>
                <td>{r.docs_ok} of {r.docs} verified{r.docs_review > 0 && <span className="ml-1.5"><Badge tone="amber">{r.docs_review} to review</Badge></span>}</td>
                <td>{inr(r.paid)}{r.pay_open > 0 && <span className="ml-1.5"><Badge tone="amber">Pending</Badge></span>}</td>
                <td><Badge tone={r.color}>{r.stage}</Badge></td><td>{r.owner}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
