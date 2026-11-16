import { describe, expect, it } from "vitest";
import { codeAt, newSecret, readTicket, signTicket, verifyCode } from "@/lib/totp";

describe("two-factor codes", () => {
  it("matches the RFC 6238 test vector", () => {
    // Base32 of the ASCII secret "12345678901234567890"; at T=59s the 8-digit code is 94287082, so 6 digits give 287082.
    expect(codeAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });
  it("accepts the neighbouring step for clock drift, and nothing older", () => {
    const s = newSecret();
    const now = Date.now();
    expect(verifyCode(s, codeAt(s, now - 30_000), now)).toBe(true);
    expect(verifyCode(s, codeAt(s, now - 120_000), now)).toBe(false);
    expect(verifyCode(s, "12345", now)).toBe(false);
  });
  it("tickets carry the user id and cannot be forged", () => {
    const t = signTicket("user-1");
    expect(readTicket(t)).toBe("user-1");
    expect(readTicket(t.replace("user-1", "user-2"))).toBe(null);
  });
});
