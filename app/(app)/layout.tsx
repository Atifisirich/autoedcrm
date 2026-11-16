import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { rel } from "@/lib/fmt";
import { canCreateLeads, has, leadScope } from "@/lib/perm";
import { tick } from "@/lib/workflows";
import { AutoSelect, MenuButton, NavLink, Toast, TopBar } from "@/components/Shell";
import { logoutAction, setBranch, setYear } from "@/app/actions/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  await tick(ctx.tenantId);
  const p = ctx.perms;
  const own = leadScope(p) === "own";
  const [notes, unread, sources, fields, overdue, inbox] = await Promise.all([
    q("select * from notifications where tenant_id=$1 and user_id=$2 order by created_at desc limit 20", [ctx.tenantId, ctx.user.id]),
    one("select count(*)::int n from notifications where tenant_id=$1 and user_id=$2 and not read", [ctx.tenantId, ctx.user.id]),
    q("select id, name, channel from sources where tenant_id=$1 and active order by channel, name", [ctx.tenantId]),
    q("select key, label, options, required from custom_fields where tenant_id=$1 and entity='enquiry' and active and type='select' and not sensitive order by position", [ctx.tenantId]),
    one("select count(*)::int n from tasks where tenant_id=$1 and owner_id=$2 and status='open' and due_at<now()", [ctx.tenantId, ctx.user.id]),
    one(
      `select count(distinct m.household_id)::int n from messages m join enquiries e on e.household_id=m.household_id
       where m.tenant_id=$1 and m.direction='in' and not m.read and ($2::uuid is null or e.owner_id=$2)`,
      [ctx.tenantId, own ? ctx.user.id : null],
    ),
  ]);
  const s = ctx.tenant.settings;
  // At most eight top-level items for a counsellor; admin sits behind one entry (UX 15.2).
  const nav = [
    ["/", "Home", true, 0], ["/leads", "Leads", has(p, "leads"), 0], ["/inbox", "Inbox", has(p, "leads") && has(p, "templates"), inbox!.n], ["/tasks", "Tasks", has(p, "tasks"), overdue!.n],
    ["/visits", "Visits", has(p, "tasks") && s.modules?.visits !== false, 0], ["/applications", "Applications", has(p, "applications") && s.modules?.applications !== false, 0],
    ["/campaigns", "Campaigns", has(p, "campaigns") && s.modules?.campaigns !== false, 0], ["/reports", "Reports", has(p, "reports"), 0],
  ] as const;
  return (
    <div className="flex min-h-full">
      <div id="nav-scrim" className="fixed inset-0 z-30 hidden bg-slate-900/40 md:hidden" aria-hidden />
      <aside id="sidebar" className="fixed inset-y-0 left-0 z-40 flex h-screen w-60 shrink-0 -translate-x-full flex-col overflow-y-auto bg-brand-900 p-3 transition-transform md:sticky md:top-0 md:w-52 md:translate-x-0">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2 text-base font-semibold text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-brand-700">A</span> AutoED CRM
        </Link>
        <nav className="space-y-0.5" aria-label="Main">
          {nav.filter((n) => n[2]).map(([href, label, , badge]) => <NavLink key={href} href={href} badge={badge}>{label}</NavLink>)}
          {canCreateLeads(p) && <NavLink href="/walkin">Walk-in desk</NavLink>}
        </nav>
        <div className="mt-4 space-y-2 border-t border-white/15 px-1 pt-3 md:hidden">
          <form action={setYear}><AutoSelect name="year" label="Academic year" value={ctx.yearId} options={ctx.years.map((y) => ({ value: y.id, label: `${y.name}${y.status === "closed" ? " (closed)" : ""}` }))} /></form>
          {ctx.branches.length > 1 && <form action={setBranch}><AutoSelect name="branch" label="Branch" value={ctx.branchId ?? ""} options={[{ value: "", label: "All branches" }, ...ctx.branches.map((b) => ({ value: b.id, label: b.name }))]} /></form>}
        </div>
        <div className="mt-auto space-y-0.5 border-t border-white/15 pt-2">
          {(has(p, "admin") || has(p, "workflows")) && <NavLink href="/admin">⚙ Admin console</NavLink>}
          <div className="px-3 pt-2 text-xs text-brand-100">
            <div className="truncate font-medium text-white">{ctx.user.name}</div>
            <div className="truncate">{ctx.roleName} · {ctx.tenant.name}</div>
            <form action={logoutAction}><button className="mt-1 underline hover:text-white">{ctx.impersonatorId ? "End support session" : "Sign out"}</button></form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {ctx.impersonatorId && <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-slate-900">AutoED support session: you are viewing as {ctx.user.name}. Every action is logged and visible to the school.</div>}
        {ctx.tenant.status === "suspended" && <div className="bg-rose-600 px-4 py-1.5 text-center text-xs font-semibold text-white">This account is suspended. You can view and export data but cannot make changes.</div>}
        <TopBar
          data={{ branches: ctx.branches.map((b) => ({ id: b.id, name: b.name })), grades: s.grades ?? [], boards: s.boards ?? [], sources: sources as any, branchId: ctx.branchId, canCreate: canCreateLeads(p), fields: fields as any }}
          notes={notes.map((n) => ({ id: n.id, title: n.title, link: n.link, category: n.category, read: n.read, when: rel(n.created_at) }))}
          unread={unread!.n}
          menu={<MenuButton />}
        >
          <form action={setYear}><AutoSelect name="year" label="Academic year" value={ctx.yearId} options={ctx.years.map((y) => ({ value: y.id, label: `${y.name}${y.status === "closed" ? " (closed)" : ""}` }))} /></form>
          {ctx.branches.length > 1 && (
            <form action={setBranch}><AutoSelect name="branch" label="Branch" value={ctx.branchId ?? ""} options={[{ value: "", label: "All branches" }, ...ctx.branches.map((b) => ({ value: b.id, label: b.name }))]} /></form>
          )}
        </TopBar>
        <main className="p-3 sm:p-5">{children}</main>
      </div>
      <Toast />
    </div>
  );
}
