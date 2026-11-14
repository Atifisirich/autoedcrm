const TZ = "Asia/Kolkata";
const d = (v: any) => (v instanceof Date ? v : new Date(v));
export const fmtDate = (v: any) => (v ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(d(v)) : "");
export const fmtDay = (v: any) => (v ? new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(d(v)) : "");
export const fmtTime = (v: any) => (v ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).format(d(v)) : "");
export const fmtDateTime = (v: any) => (v ? `${fmtDay(v)}, ${fmtTime(v)}` : "");
export const dayKey = (v: any) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d(v));
export const inr = (n: any) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n ?? 0));
export const num = (n: any) => new Intl.NumberFormat("en-IN").format(Number(n ?? 0));
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

/** "5 min ago", "in 2 hours", "3 days ago". */
export function rel(v: any): string {
  if (!v) return "";
  const diff = d(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const unit = abs < 3600e3 ? [Math.max(1, Math.round(abs / 60e3)), "min"] : abs < 86400e3 ? [Math.round(abs / 3600e3), "hr"] : [Math.round(abs / 86400e3), "day"];
  const label = `${unit[0]} ${unit[1]}${unit[0] !== 1 && unit[1] !== "min" ? "s" : ""}`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}
export const age = (v: any) => rel(v).replace(" ago", "").replace("in ", "");
/** datetime-local value in India time. */
export function localInput(v: Date): string {
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(v);
  return p.replace(" ", "T");
}
/** Parses a datetime-local value entered in India time. */
export const parseLocal = (s: string) => new Date(s.length === 16 ? s + ":00+05:30" : s);
