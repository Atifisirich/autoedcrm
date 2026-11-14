import { getCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { adminSections } from "@/lib/perm";

/** Failed rows of an import as CSV, with the reason, ready to fix and re-upload (HUB-04). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || !adminSections(ctx.perms).includes("data")) return new Response("Not allowed.", { status: 403 });
  const rows = await q("select data, error from import_rows where tenant_id=$1 and batch_id=$2 and status='failed'", [ctx.tenantId, new URL(req.url).searchParams.get("batch")]);
  const esc = (v: any) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = ["Student name,Parent name,Mobile,Email,Grade,Source,Problem", ...rows.map((r) => [r.data.studentName, r.data.guardianName, r.data.mobile, r.data.email, r.data.grade, r.data.source, r.error].map(esc).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="import-problems.csv"' } });
}
