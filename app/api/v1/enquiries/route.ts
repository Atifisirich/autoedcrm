import { NextResponse } from "next/server";
import { apiAuth } from "@/lib/api";
import { captureEnquiry } from "@/lib/core";
import { one, q } from "@/lib/db";

const g = globalThis as unknown as { __aedIdem?: Map<string, any> };

/** Create an enquiry. Existing families are matched, never duplicated; the response says which happened. */
export async function POST(req: Request) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const t = auth.key.tenant_id as string;
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const idem = req.headers.get("idempotency-key");
  const cache = (g.__aedIdem ??= new Map());
  if (idem && cache.has(auth.key.id + idem)) return NextResponse.json(cache.get(auth.key.id + idem));
  const branch = await one("select id from branches where tenant_id=$1 and active and (id::text=$2 or lower(name)=lower($2) or $2='') order by name limit 1", [t, String(b.branch_id ?? b.branch ?? "")]);
  if (!branch) return NextResponse.json({ error: "Unknown branch. Send branch (name) or branch_id." }, { status: 422 });
  const res = await captureEnquiry(t, {
    studentName: String(b.student_name ?? ""), guardianName: String(b.guardian_name ?? ""), mobile: String(b.mobile ?? ""), email: b.email, altMobile: b.alt_mobile, grade: b.grade, board: b.board, dob: b.dob, locality: b.locality,
    branchId: branch.id, sourceId: auth.key.source_id ?? undefined, channel: b.channel ?? "API", source: b.source ?? auth.key.name, campaign: b.campaign ?? b.utm?.campaign, utm: b.utm ?? {}, heardAbout: b.heard_about, custom: b.custom,
    consent: { source: b.consent_source ?? `API key: ${auth.key.name}` }, note: b.note,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 422 });
  const out = { status: res.status, enquiry_id: res.enquiryId, household_id: res.householdId, owner: res.ownerName };
  if (idem) cache.set(auth.key.id + idem, out);
  return NextResponse.json(out, { status: res.status === "created" ? 201 : 200 });
}

/** List enquiries, newest first, with cursor pagination. Sensitive fields are not included. */
export async function GET(req: Request) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const u = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit")) || 50));
  const cursor = u.searchParams.get("cursor");
  const rows = await q(
    `select e.id, e.household_id, st.name as student_name, e.grade, e.board, s.name as stage, p.name as phase, u.name as owner, b.name as branch, y.name as academic_year, e.score, e.temperature, e.custom, e.tags, e.application_no, e.created_at, e.updated_at
     from enquiries e join students st on st.id=e.student_id join stages s on s.id=e.stage_id join phases p on p.id=s.phase_id join users u on u.id=e.owner_id join branches b on b.id=e.branch_id join academic_years y on y.id=e.year_id
     where e.tenant_id=$1 and ($2::timestamptz is null or e.created_at < $2) order by e.created_at desc limit $3`,
    [auth.key.tenant_id, cursor, limit + 1],
  );
  const page = rows.slice(0, limit);
  return NextResponse.json({ data: page, next_cursor: rows.length > limit ? new Date(page[page.length - 1].created_at).toISOString() : null });
}
