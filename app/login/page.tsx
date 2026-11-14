import { q } from "@/lib/db";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Demo accounts are only offered when the demo group exists (embedded database or SEED_DEMO=1).
  const demo = await q(
    `select u.email, u.name, coalesce(r.name, 'AutoED platform team') as role from users u left join roles r on r.id=u.role_id
     where u.email like '%@greenfield.demo' or u.email like '%@autoed.demo' order by u.platform_role nulls first, u.created_at`,
  );
  return (
    <main className="flex min-h-full items-center justify-center bg-brand-900 p-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-xl md:grid-cols-2">
        <div className="p-8">
          <div className="flex items-center gap-2 text-lg font-semibold text-brand-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">A</span> AutoED CRM
          </div>
          <h1 className="mt-6 text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="muted mt-1">Admissions and parent relationships for K-12 schools.</p>
          <LoginForm demo={demo as any} />
        </div>
        <div className="hidden bg-brand-50 p-8 md:block">
          <h2 className="font-semibold text-brand-900">Built around the family, not the lead</h2>
          <ul className="mt-4 space-y-3 text-slate-700">
            <li><b>One household, every child.</b> Siblings, guardians and one timeline on a single page.</li>
            <li><b>One pipeline.</b> Prospect to enrolled, with the academic year as a filter rather than a separate list.</li>
            <li><b>Next action, always.</b> No enquiry is left without an owner and a follow-up.</li>
            <li><b>Yours to configure.</b> Fields, stages, roles, forms and workflows without raising a ticket.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
