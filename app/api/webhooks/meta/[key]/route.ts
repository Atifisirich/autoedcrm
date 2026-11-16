// Webhook for the school's Meta app: WhatsApp messages and delivery statuses, template reviews, and lead ads.
// Each school has its own URL (/api/webhooks/meta/<key>) and verify token, shown in Admin > Channels.
import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { handleMetaWebhook, verifySignature } from "@/lib/meta";
import { getSecret } from "@/lib/secrets";

async function tenantFor(key: string) {
  if (!/^[a-f0-9]{32}$/.test(key)) return null;
  return one("select id, settings from tenants where webhook_key=$1 and status in ('active','trial')", [key]);
}

/** Meta's one-time subscription check. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const t = await tenantFor((await params).key);
  const u = new URL(req.url);
  const expected = t ? await getSecret(t.id, "meta_verify_token") : null;
  if (t && expected && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === expected) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Verification failed", { status: 403 });
}

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const t = await tenantFor((await params).key);
  if (!t) return new Response("Unknown endpoint", { status: 404 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), await getSecret(t.id, "meta_app_secret"))) {
    return new Response("Bad signature", { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  try {
    const log = await handleMetaWebhook(t.id, payload);
    return NextResponse.json({ ok: true, handled: log.length });
  } catch (e: any) {
    console.error("meta webhook failed", e);
    // A 500 makes Meta retry later, which is what we want for a transient database problem.
    return new Response("Temporary error", { status: 500 });
  }
}
