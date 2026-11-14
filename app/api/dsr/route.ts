import { getCtx } from "@/lib/auth";
import { audit, normMobile } from "@/lib/core";
import { one, q } from "@/lib/db";
import { isFullAdmin } from "@/lib/perm";

/** Data-subject access request: everything held about one family, as a JSON download (CMPL-03). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || !isFullAdmin(ctx.perms)) return new Response("Only a group admin can export a family's data.", { status: 403 });
  const mobile = normMobile(new URL(req.url).searchParams.get("mobile"));
  const g = await one("select household_id from guardians where tenant_id=$1 and mobile=$2", [ctx.tenantId, mobile]);
  if (!g) return new Response("No household has that mobile number.", { status: 404 });
  const h = g.household_id, t = ctx.tenantId;
  const data = {
    exported_at: new Date().toISOString(), school: ctx.tenant.name,
    household: await one("select * from households where id=$1", [h]),
    guardians: await q("select name, relation, mobile, alt_mobile, email, occupation, consent, language from guardians where tenant_id=$1 and household_id=$2", [t, h]),
    students: await q("select name, dob::text, gender, current_school, current_grade, special_needs from students where tenant_id=$1 and household_id=$2", [t, h]),
    enquiries: await q("select e.id, e.grade, e.board, s.name as stage, e.closure_reason, e.custom, e.tags, e.application_no, e.created_at from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.household_id=$2", [t, h]),
    timeline: await q("select type, outcome, content, created_at from activities where tenant_id=$1 and household_id=$2 order by created_at", [t, h]),
    messages: await q("select channel, direction, body, status, created_at from messages where tenant_id=$1 and household_id=$2 order by created_at", [t, h]),
    visits: await q("select type, slot_at, status, outcome from visits where tenant_id=$1 and household_id=$2", [t, h]),
    applications: await q("select a.answers, a.status, a.submitted_at from applications a join enquiries e on e.id=a.enquiry_id where e.tenant_id=$1 and e.household_id=$2", [t, h]),
    payments: await q("select p.purpose, p.amount, p.status, p.receipt_no, p.paid_at from payments p join enquiries e on e.id=p.enquiry_id where e.tenant_id=$1 and e.household_id=$2", [t, h]),
  };
  await audit(t, { id: ctx.user.id, name: ctx.user.name }, "export", "household", h, "Exported one family's data for an access request");
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="family-data-${mobile}.json"` } });
}
