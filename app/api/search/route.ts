import { NextResponse } from "next/server";
import { getCtx, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";

/** Global search across guardian, student, mobile, email, application number, receipt number and notes (WS-08). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ hits: [] }, { status: 401 });
  const term = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (term.length < 2) return NextResponse.json({ hits: [] });
  const params: any[] = [];
  const where = scopeSql(ctx, params, "e", false);
  params.push("%" + term + "%");
  const n = "$" + params.length;
  const rows = await q(
    `select e.id, e.household_id, st.name as student, e.grade, s.name as stage, y.name as year, g.name as guardian, g.mobile,
       case when e.application_no ilike ${n} then 'Application ' || e.application_no
            when exists (select 1 from payments p where p.enquiry_id=e.id and p.receipt_no ilike ${n}) then 'Receipt match'
            when lower(st.name) like ${n} or lower(g.name) like ${n} or g.mobile like ${n} or lower(coalesce(g.email,'')) like ${n} then null
            else 'Mentioned in a note' end as why
     from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join academic_years y on y.id=e.year_id
     left join lateral (select name, mobile, email from guardians g where g.household_id=e.household_id order by is_primary desc limit 1) g on true
     where ${where} and (lower(st.name) like ${n} or lower(g.name) like ${n} or g.mobile like ${n} or lower(coalesce(g.email,'')) like ${n} or e.application_no ilike ${n}
        or exists (select 1 from payments p where p.enquiry_id=e.id and p.receipt_no ilike ${n})
        or exists (select 1 from activities a where a.enquiry_id=e.id and a.type='note' and lower(a.content) like ${n}))
     order by e.updated_at desc limit 12`,
    params,
  );
  return NextResponse.json({
    hits: rows.map((r) => ({ href: `/households/${r.household_id}?e=${r.id}`, title: `${r.student} · ${r.guardian ?? ""}`, sub: [r.why, r.grade, r.stage, r.year, r.mobile].filter(Boolean).join(" · ") })),
  });
}
