import { NextResponse } from "next/server";
import { apiAuth } from "@/lib/api";
import { captureEnquiry, findHousehold, receiveMessage } from "@/lib/core";
import { one } from "@/lib/db";

/** Inbound parent message from a messaging provider. An unknown number starts a new enquiry (CAP-05). */
export async function POST(req: Request) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const t = auth.key.tenant_id as string;
  const b = await req.json().catch(() => null);
  if (!b?.mobile || !b?.body) return NextResponse.json({ error: "Send mobile and body." }, { status: 422 });
  let hh = (await findHousehold(t, { mobile: b.mobile }))?.household_id as string | undefined;
  let created = false;
  if (!hh) {
    const branch = await one("select id from branches where tenant_id=$1 and active order by name limit 1", [t]);
    const res = await captureEnquiry(t, { studentName: b.student_name ?? "Name not given yet", guardianName: b.name ?? "Parent", mobile: b.mobile, branchId: branch!.id, channel: "WhatsApp", source: "School WhatsApp number", consent: { source: "Parent messaged the school first" } });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 422 });
    hh = res.householdId;
    created = true;
  }
  await receiveMessage(t, hh, b.channel === "sms" ? "sms" : "whatsapp", String(b.body));
  return NextResponse.json({ household_id: hh, new_household: created });
}
