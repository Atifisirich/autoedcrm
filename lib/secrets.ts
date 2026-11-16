// Provider credentials per tenant, encrypted at rest with AES-256-GCM.
// The key comes from APP_SECRET, so the database alone is not enough to read them.
import crypto from "node:crypto";
import { one, q } from "./db";

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret && process.env.DATABASE_URL && process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be set to store provider credentials.");
  return crypto.createHash("sha256").update(secret ?? "autoed-dev-secret").digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(enc: string): string {
  const [iv, tag, data] = enc.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export async function setSecret(tenantId: string, name: string, value: string) {
  await q(
    "insert into tenant_secrets (tenant_id, key, value_enc) values ($1,$2,$3) on conflict (tenant_id, key) do update set value_enc=excluded.value_enc, updated_at=now()",
    [tenantId, name, encrypt(value)],
  );
}

export async function getSecret(tenantId: string, name: string): Promise<string | null> {
  const r = await one("select value_enc from tenant_secrets where tenant_id=$1 and key=$2", [tenantId, name]);
  if (!r) return null;
  try { return decrypt(r.value_enc); } catch { return null; }
}

export async function deleteSecret(tenantId: string, name: string) {
  await q("delete from tenant_secrets where tenant_id=$1 and key=$2", [tenantId, name]);
}

/** Last four characters only, for showing that a secret is set. */
export async function secretHint(tenantId: string, name: string): Promise<string | null> {
  const v = await getSecret(tenantId, name);
  return v ? "••••" + v.slice(-4) : null;
}
