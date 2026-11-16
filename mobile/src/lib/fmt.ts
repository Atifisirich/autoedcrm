const TZ = "Asia/Kolkata";
const d = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

export function rel(v?: string | null): string {
  if (!v) return "";
  const diff = d(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const [n, u] = abs < 3600e3 ? [Math.max(1, Math.round(abs / 60e3)), "min"] : abs < 86400e3 ? [Math.round(abs / 3600e3), "hr"] : [Math.round(abs / 86400e3), "day"];
  const label = `${n} ${u}${n !== 1 && u !== "min" ? "s" : ""}`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

export const time = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).format(d(v)) : "");
export const dateTime = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).format(d(v)) : "");
export const isPast = (v?: string | null) => !!v && d(v).getTime() < Date.now();

/** Quick due-time choices; easier on a phone than a date picker. Times are India time. */
export function dueChoices(): { label: string; iso: string }[] {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const offset = now.getTime() - istNow.getTime();
  const at = (days: number, hour: number) => { const x = new Date(istNow); x.setDate(x.getDate() + days); x.setHours(hour, 0, 0, 0); return new Date(x.getTime() + offset).toISOString(); };
  return [
    { label: "In 2 hours", iso: new Date(now.getTime() + 2 * 3600e3).toISOString() },
    { label: "This evening", iso: istNow.getHours() < 17 ? at(0, 18) : at(1, 18) },
    { label: "Tomorrow 10 am", iso: at(1, 10) },
    { label: "In 2 days", iso: at(2, 11) },
    { label: "Next week", iso: at(7, 11) },
  ];
}
