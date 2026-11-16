// Time-based one-time passwords (RFC 6238) for two-factor sign-in with any authenticator app.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(secret: string): Buffer {
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function codeAt(secret: string, time = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac("sha1", decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side, to allow for phone clock drift. */
export function verifyCode(secret: string, code: string, time = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, time + w * 30000)), Buffer.from(c)));
}

export const otpauthUri = (secret: string, account: string, issuer = "AutoED CRM") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Short-lived proof that the password step passed, carried to the code step. */
export function signTicket(userId: string, minutes = 5): string {
  const exp = Date.now() + minutes * 60000;
  const body = `${userId}.${exp}`;
  const mac = crypto.createHmac("sha256", process.env.APP_SECRET ?? "autoed-dev-secret").update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readTicket(ticket: string): string | null {
  const [userId, exp, mac] = ticket.split(".");
  if (!userId || !exp || !mac || Number(exp) < Date.now()) return null;
  const expected = crypto.createHmac("sha256", process.env.APP_SECRET ?? "autoed-dev-secret").update(`${userId}.${exp}`).digest("base64url");
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? userId : null;
}
