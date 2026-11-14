import { NextResponse } from "next/server";
import { one, q, type Row } from "./db";
import { hashKey } from "./util";

const g = globalThis as unknown as { __aedRate?: Map<string, { n: number; t: number }> };

/** Authenticates a scoped API key and applies a simple per-key rate limit (API-01). */
export async function apiAuth(req: Request): Promise<{ key: Row } | { error: NextResponse }> {
  const raw = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return { error: NextResponse.json({ error: "Send your API key as: Authorization: Bearer <key>" }, { status: 401 }) };
  const key = await one("select k.*, t.status as tenant_status from api_keys k join tenants t on t.id=k.tenant_id where k.key_hash=$1", [hashKey(raw)]);
  if (!key) return { error: NextResponse.json({ error: "This API key is not valid or was revoked." }, { status: 401 }) };
  if (!["active", "trial"].includes(key.tenant_status)) return { error: NextResponse.json({ error: "This account is not active." }, { status: 403 }) };
  // In-memory window: adequate per instance; put a shared store in front for multi-instance production.
  const map = (g.__aedRate ??= new Map());
  const now = Date.now();
  const w = map.get(key.id);
  if (!w || now - w.t > 60000) map.set(key.id, { n: 1, t: now });
  else if (++w.n > 120) return { error: NextResponse.json({ error: "Rate limit reached: 120 requests per minute per key." }, { status: 429, headers: { "retry-after": "60" } }) };
  await q("update api_keys set last_used=now() where id=$1", [key.id]);
  return { key };
}
