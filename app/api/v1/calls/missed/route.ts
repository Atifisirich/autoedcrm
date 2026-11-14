import { NextResponse } from "next/server";
import { apiAuth } from "@/lib/api";
import { addTask, captureEnquiry, emit, findHousehold, logActivity } from "@/lib/core";
import { one } from "@/lib/db";

/** Missed inbound call from a telephony provider: match or create the household and raise an urgent call-back (CAP-06). */
export async function POST(req: Request) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const t = auth.key.tenant_id as string;
  const b = await req.json().catch(() => null);
  if (!b?.mobile) return NextResponse.json({ error: "Send mobile." }, { status: 422 });
  const hit = await findHousehold(t, { mobile: b.mobile });
  let enquiryId: string, householdId: string;
  if (hit) {
    householdId = hit.household_id;
    const e = await one("select e.id from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and e.household_id=$2 order by s.is_closed, e.created_at desc limit 1", [t, householdId]);
    enquiryId = e!.id;
  } else {
    const branch = await one("select id from branches where tenant_id=$1 and active and ($2='' or phone=$2) order by name limit 1", [t, String(b.called_number ?? "")]) ?? (await one("select id from branches where tenant_id=$1 and active order by name limit 1", [t]));
    const res = await captureEnquiry(t, { studentName: "Name not given yet", guardianName: "Caller", mobile: b.mobile, branchId: branch!.id, channel: "Phone", source: "Inbound call", consent: { source: "Parent called the school" } });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 422 });
    enquiryId = res.enquiryId; householdId = res.householdId;
  }
  await logActivity(t, { householdId, enquiryId, type: "call", outcome: "missed_inbound", content: "Missed call from the parent." });
  await addTask(t, { enquiryId, title: "Urgent: return missed call", dueAt: new Date(Date.now() + 10 * 60000), priority: "high" });
  await emit(t, "missed_call", enquiryId);
  return NextResponse.json({ household_id: householdId, enquiry_id: enquiryId, new_household: !hit });
}
