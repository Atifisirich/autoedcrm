import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { duplicatePreview } from "@/lib/core";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const u = new URL(req.url);
  const match = await duplicatePreview(ctx.tenantId, { mobile: u.searchParams.get("mobile") ?? "", email: u.searchParams.get("email") ?? "" });
  return NextResponse.json({ match });
}
