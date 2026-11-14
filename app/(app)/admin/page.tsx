import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { rel } from "@/lib/fmt";
import { ADMIN_SECTIONS, adminSections } from "@/lib/perm";
import { PageHeader } from "@/components/ui";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  const allowed = adminSections(ctx.perms);
  if (!allowed.length) redirect("/?denied=admin");
  const { q: term = "" } = await searchParams;
  const sections = ADMIN_SECTIONS.filter(([k, l, d]) => allowed.includes(k) && (l + d).toLowerCase().includes(term.toLowerCase()));
  const t = ctx.tenantId;
  const [users, rules, wa, forms, last] = await Promise.all([
    one("select count(*)::int n from users where tenant_id=$1 and status='active'", [t]),
    one("select count(*)::int n from assignment_rules where tenant_id=$1 and active and jsonb_array_length(user_ids)>0", [t]),
    one("select count(*)::int n from templates where tenant_id=$1 and status='approved'", [t]),
    one("select count(*)::int n from forms where tenant_id=$1 and active", [t]),
    q("select user_name, summary, created_at from audit_events where tenant_id=$1 and action in ('config','permission') order by created_at desc limit 5", [t]),
  ]);
  const setup: [string, boolean, string][] = [
    ["Add your branches and seats", ctx.branches.length > 0, "/admin/org"], ["Invite your team", users!.n > 1, "/admin/users"], ["Set who receives new leads", rules!.n > 0, "/admin/routing"],
    ["Review message templates", wa!.n > 0, "/admin/templates"], ["Publish your website enquiry form", forms!.n > 0, "/admin/forms"], ["Connect WhatsApp, telephony and the payment gateway", false, "/admin/integrations"],
  ];
  return (
    <>
      <PageHeader title="Admin console" sub="Everything you can configure yourself, in one place">
        <form><input name="q" defaultValue={term} placeholder="Search settings" className="input w-56" aria-label="Search settings" /></form>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map(([k, label, desc]) => <Link key={k} href={`/admin/${k}`} className="card block p-4 hover:border-brand-500"><div className="font-semibold text-slate-900">{label}</div><div className="muted mt-0.5 text-xs">{desc}</div></Link>)}
          {!sections.length && <p className="muted">No setting matches “{term}”.</p>}
        </div>
        <aside className="space-y-4">
          {allowed.includes("org") && (
            <section className="card">
              <div className="card-h">Setup checklist</div>
              <ul className="divide-y divide-slate-100">{setup.map(([label, ok, href]) => <li key={label} className="flex items-center justify-between gap-2 px-4 py-2"><span className={ok ? "text-slate-500" : "font-medium"}>{ok ? "✓" : "○"} {label}</span>{!ok && <Link className="link text-xs" href={href}>Open</Link>}</li>)}</ul>
            </section>
          )}
          <section className="card">
            <div className="card-h">Recent configuration changes</div>
            <ul className="divide-y divide-slate-100">{last.map((a, i) => <li key={i} className="px-4 py-2 text-xs"><span className="text-slate-800">{a.summary}</span><span className="muted block">{a.user_name} · {rel(a.created_at)}</span></li>)}{!last.length && <li className="muted px-4 py-3 text-xs">No changes yet.</li>}</ul>
          </section>
        </aside>
      </div>
    </>
  );
}
