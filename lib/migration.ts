// Stage mapping for data moved from another CRM (PRD Appendix B). Matching ignores case, punctuation,
// numeric prefixes such as "03 -" and a "(2026)" or "(Raw)" suffix.

const RULES: [RegExp, string][] = [
  [/^(cold|warm|untouched raw|raw|mobile verified|email verified|both verified)$/, "New data"],
  [/^untouched$/, "New"],
  [/^(inaccessible|not reachable|not answered|no response|contact attempted)$/, "Contact attempted"],
  [/^follow ?up( follow ?up planned)?$/, "Connected"],
  [/^follow ?up campus visit planned$/, "Visit scheduled"],
  [/^(direct walk ?in|follow ?up campus visit done|visit done|walk ?in)$/, "Visit done"],
  [/^interested( hot| warm| cold)?$/, "Interested"],
  [/^(application started|step [123] filled|form started)$/, "Form started"],
  [/^(registration payment failed|form submitted)$/, "Form submitted"],
  [/^(registration payment done|fee paid)$/, "Fee paid"],
  [/^(enrolled|admission done|admission confirmed)$/, "Admission confirmed"],
  [/^(closed.*|not interested.*|lost)$/, "Not interested"],
  [/^(junk|duplicate|junk duplicate)$/, "Junk / duplicate"],
  [/^(cancelled|canceled|refunded)$/, "Cancelled / refunded"],
];

export function normaliseStage(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\((?:\d{4}|raw)\)/g, " ")
    .replace(/^\s*\d+\s*[-.)]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Returns our stage name for a stage (and optional sub-stage) from the old system, or null if unknown. */
export function mapStage(stage: string, subStage = ""): { stage: string; temperature?: string } | null {
  const s = normaliseStage(stage);
  const sub = normaliseStage(subStage);
  if (!s) return null;
  const key = sub && /^follow ?up$/.test(s) ? `${s} ${sub}` : s;
  const temp = /^interested (hot|warm|cold)$/.exec(s)?.[1] ?? (/^interested$/.test(s) && /^(hot|warm|cold)$/.test(sub) ? sub : undefined);
  const t = temp ? temp[0].toUpperCase() + temp.slice(1) : undefined;
  // The stage with its sub-stage is more specific, so it is tried against every rule first.
  for (const candidate of [key, s]) for (const [re, ours] of RULES) if (re.test(candidate)) return { stage: ours, temperature: t };
  return null;
}

/** "Lead 2026-27" style year labels or a "(2026)" suffix tell which academic year a record belongs to. */
export function yearHint(stage: string): number | null {
  const m = /\((\d{4})\)/.exec(stage);
  return m ? Number(m[1]) : null;
}
