import { requireCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { canCreateLeads } from "@/lib/perm";
import { redirect } from "next/navigation";
import { WalkIn } from "./WalkIn";

/** Front-office walk-in mode: big targets, mobile number first, duplicate shown before saving (CAP-02). */
export default async function WalkInPage() {
  const ctx = await requireCtx("leads");
  if (!canCreateLeads(ctx.perms)) redirect("/?denied=leads");
  const src = await q("select id from sources where tenant_id=$1 and channel='Walk-in' and active limit 1", [ctx.tenantId]);
  return <WalkIn branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))} branchId={ctx.branchId ?? ctx.branches[0]?.id} grades={ctx.tenant.settings.grades ?? []} sourceId={src[0]?.id ?? ""} />;
}
