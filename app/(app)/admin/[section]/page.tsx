import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { needs2faSetup, requireCtx } from "@/lib/auth";
import { ADMIN_SECTIONS, adminSections } from "@/lib/perm";
import { Fields, Org, Pipeline, Roles, Users } from "../sections-a";
import { Forms, Routing, Sources, Templates, Workflows } from "../sections-b";
import { Audit, Data, Help, Integrations, Wallet } from "../sections-c";

export default async function AdminSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (needs2faSetup(ctx)) redirect("/account?setup=1");
  const { section } = await params;
  const sp = await searchParams;
  const meta = ADMIN_SECTIONS.find(([k]) => k === section);
  if (!meta) notFound();
  const allowed = adminSections(ctx.perms);
  if (!allowed.includes(section)) redirect("/?denied=admin");
  const body = {
    org: <Org ctx={ctx} />, users: <Users ctx={ctx} />, roles: <Roles ctx={ctx} />, fields: <Fields ctx={ctx} />, pipeline: <Pipeline ctx={ctx} />,
    sources: <Sources ctx={ctx} />, routing: <Routing ctx={ctx} />, templates: <Templates ctx={ctx} />, forms: <Forms ctx={ctx} />, workflows: <Workflows ctx={ctx} sp={sp} />,
    integrations: <Integrations ctx={ctx} />, wallet: <Wallet ctx={ctx} />, data: <Data ctx={ctx} />, audit: <Audit ctx={ctx} sp={sp} />, help: <Help ctx={ctx} />,
  }[section];
  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Admin sections" className="space-y-0.5">
        <Link href="/admin" className="muted mb-2 block text-xs hover:underline">← Admin console</Link>
        {ADMIN_SECTIONS.filter(([k]) => allowed.includes(k)).map(([k, label]) => <Link key={k} href={`/admin/${k}`} aria-current={k === section ? "page" : undefined} className={`block rounded-md px-2.5 py-1.5 ${k === section ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>)}
      </nav>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900">{meta[1]}</h1>
        <p className="muted mb-4">{meta[2]}</p>
        {body}
      </div>
    </div>
  );
}
