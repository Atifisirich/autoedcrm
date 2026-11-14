import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { sweep } from "@/lib/workflows";

/**
 * Runs waiting workflow steps, SLA checks and no-show detection for every active tenant.
 * Point a scheduler at this every minute with: Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const tenants = await q("select id from tenants where status in ('active','trial')");
  for (const t of tenants) await sweep(t.id);
  return NextResponse.json({ ok: true, tenants: tenants.length });
}
