import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { EnquiryForm } from "./EnquiryForm";

export const dynamic = "force-dynamic";

/** Hosted enquiry form (CAP-03, FB-02): school branded, UTM and click ids captured, consent and privacy notice shown. */
export default async function PublicForm({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const form = await one("select f.*, t.name as school, t.branding, t.settings from forms f join tenants t on t.id=f.tenant_id where f.slug=$1 and f.active and t.status in ('active','trial')", [slug]);
  if (!form) notFound();
  const branches = form.branch_id ? [] : await q("select id, name from branches where tenant_id=$1 and active order by name", [form.tenant_id]);
  const utm = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && (k.startsWith("utm_") || ["gclid", "fbclid"].includes(k))));
  const color = form.branding?.color ?? "#0f6e6e";
  return (
    <main className="min-h-full bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-lg overflow-hidden rounded-xl bg-white shadow">
        <div className="px-6 py-5 text-white" style={{ background: color }}>
          <p className="text-sm opacity-90">{form.school}</p>
          <h1 className="text-xl font-semibold">Admission enquiry</h1>
        </div>
        <EnquiryForm slug={slug} fields={form.fields} grades={form.settings.grades ?? []} branches={branches as any} utm={JSON.stringify(utm)} notice={form.settings.privacy_notice ?? "We use these details only to respond to your admission enquiry. You can ask us to correct or delete them at any time."} color={color} />
      </div>
    </main>
  );
}
