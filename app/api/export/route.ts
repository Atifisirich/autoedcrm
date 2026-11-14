import { getCtx } from "@/lib/auth";
import { audit } from "@/lib/core";
import { fmtDate } from "@/lib/fmt";
import { listLeads, type SP } from "@/lib/leads";
import { lvl } from "@/lib/perm";

const cell = (v: any) => {
  let s = String(v ?? "");
  // Neutralise spreadsheet formulas in exported text.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** CSV export of the filtered lead set. Permission-checked, logged, and watermarked with who exported it (CMPL-11). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!["F", "T", "Part"].includes(lvl(ctx.perms, "bulk"))) return new Response("Your role cannot export records.", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams) as SP;
  const rows = await listLeads(ctx, sp, 5000);
  const head = ["Student", "Parent", "Mobile", "Grade", "Branch", "Stage", "Owner", "Score", "Temperature", "First source", "Created", "Application no."];
  const lines = [head.join(","), ...rows.map((r) => [r.student, r.guardian, r.mobile, r.grade, r.branch, r.stage, r.owner, r.score, r.temperature, r.source, fmtDate(r.created_at), r.application_no].map(cell).join(","))];
  lines.push("", cell(`Exported by ${ctx.user.name} (${ctx.user.email}) on ${new Date().toISOString()} from AutoED CRM. Contains personal data: handle under your school's privacy policy.`));
  await audit(ctx.tenantId, { id: ctx.user.id, name: ctx.user.name }, "export", "enquiry", null, `Exported ${rows.length} enquiries to CSV`, null, sp);
  return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="autoed-leads-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
