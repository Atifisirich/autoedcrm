// Permission model from PRD section 12. Each role stores one value per capability;
// schools can change any cell in Admin > Roles.

export const CAPS = [
  ["leads", "Leads and 360"],
  ["reassign", "Reassign / transfer"],
  ["bulk", "Bulk actions / export"],
  ["delete", "Delete / merge"],
  ["tasks", "Tasks and visits"],
  ["applications", "Applications and documents"],
  ["concession", "Concession approval"],
  ["payments", "Payments and refunds"],
  ["campaigns", "Campaigns"],
  ["workflows", "Workflows"],
  ["templates", "Templates"],
  ["reports", "Reports and dashboards"],
  ["sensitive", "Sensitive fields"],
  ["admin", "Admin console"],
  ["audit", "Audit log"],
] as const;

export type Cap = (typeof CAPS)[number][0];
export type Perms = Partial<Record<Cap, string>>;

export const LEVELS = ["F", "T", "O", "V", "-", "Create, V", "Check-in", "Own", "Assist", "Decide", "Within limit", "Request", "Send link", "Collect", "Use", "Draft", "Part", "Branch", "Branch scope", "Merge only", "Masked", "Mktg", "Fin."];

export const LEVEL_HELP = "F = full, T = team or branch, O = own records, V = view only, - = no access";

const row = (v: string[]): Perms => Object.fromEntries(CAPS.map(([k], i) => [k, v[i]])) as Perms;

export const DEFAULT_ROLES: [string, Perms][] = [
  ["Group Admin", row(["F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"])],
  ["Branch Admin", row(["T", "T", "T", "T", "T", "T", "Within limit", "T", "T", "T", "T", "T", "T", "Branch scope", "Branch"])],
  ["Admission Head", row(["T", "T", "T", "Merge only", "T", "T", "Within limit", "V", "T", "V", "T", "T", "T", "-", "-"])],
  ["Counsellor", row(["O", "-", "-", "-", "O", "O", "Request", "Send link", "-", "-", "Use", "O", "Masked", "-", "-"])],
  ["Front Office", row(["Create, V", "-", "-", "-", "Check-in", "Assist", "-", "Collect", "-", "-", "Use", "-", "Masked", "-", "-"])],
  ["Principal", row(["V", "-", "-", "-", "Own", "Decide", "Within limit", "-", "-", "-", "Use", "Branch", "V", "-", "-"])],
  ["Marketing", row(["V", "-", "T", "-", "-", "-", "-", "-", "F", "Draft", "F", "Mktg", "Masked", "Part", "-"])],
  ["Accounts", row(["V", "-", "Part", "-", "-", "V", "-", "F", "-", "-", "Use", "Fin.", "Masked", "Part", "-"])],
  ["Read-only Management", row(["V", "-", "-", "-", "V", "V", "-", "V", "V", "-", "-", "V", "Masked", "-", "-"])],
];

export const lvl = (p: Perms, cap: Cap) => p[cap] ?? "-";
export const has = (p: Perms, cap: Cap) => lvl(p, cap) !== "-";

/** all = whole organisation, branch = the user's branches, own = records they own. */
export function leadScope(p: Perms): "all" | "branch" | "own" | "none" {
  const v = lvl(p, "leads");
  if (v === "-") return "none";
  if (v === "F") return "all";
  if (v === "O") return "own";
  return "branch";
}
export const canEditLeads = (p: Perms) => ["F", "T", "O"].includes(lvl(p, "leads"));
export const canCreateLeads = (p: Perms) => canEditLeads(p) || lvl(p, "leads") === "Create, V";
export const canWorkTasks = (p: Perms) => ["F", "T", "O", "Own", "Check-in"].includes(lvl(p, "tasks"));
export const seesSensitive = (p: Perms) => ["F", "T", "V"].includes(lvl(p, "sensitive"));
export const canMessage = (p: Perms) => has(p, "templates") && canCreateLeads(p);
export const canEditApplications = (p: Perms) => ["F", "T", "O", "Assist", "Decide"].includes(lvl(p, "applications"));
export const canVerifyDocs = (p: Perms) => ["F", "T", "Decide"].includes(lvl(p, "applications"));
export const canTakePayment = (p: Perms) => ["F", "T", "Collect", "Send link"].includes(lvl(p, "payments"));
export const canVerifyPayment = (p: Perms) => ["F", "T"].includes(lvl(p, "payments"));
export const canRunCampaigns = (p: Perms) => ["F", "T"].includes(lvl(p, "campaigns"));
export const canPublishWorkflows = (p: Perms) => ["F", "T"].includes(lvl(p, "workflows"));
export const canEditTemplates = (p: Perms) => ["F", "T"].includes(lvl(p, "templates"));
export const isFullAdmin = (p: Perms) => lvl(p, "admin") === "F";
export const mask = (v: string | null | undefined) => (v ? "••••••" : "");

export const ADMIN_SECTIONS: [string, string, string][] = [
  ["org", "Organisation and years", "Profile, branches, academic years, rollover, seats"],
  ["users", "Users", "Invite, pause, roles, branches, capacity, leave"],
  ["roles", "Roles and permissions", "The permission matrix; clone and edit roles"],
  ["fields", "Fields", "Custom fields and dropdown values"],
  ["pipeline", "Pipeline", "Phases, stages, order, SLA, probability"],
  ["sources", "Sources", "Channels, sources and spend"],
  ["routing", "Assignment and scoring", "Routing rules, simulator, score rules"],
  ["templates", "Templates", "WhatsApp, SMS and email templates"],
  ["forms", "Forms", "Hosted enquiry forms and embed code"],
  ["workflows", "Workflows", "Automation recipes, test runs, run log"],
  ["integrations", "Channels and integrations", "Connectors, API keys, webhooks"],
  ["wallet", "Wallet and plan", "Credits, usage and subscription"],
  ["data", "Data management", "Import, review queue, erasure requests"],
  ["audit", "Audit log", "Who changed, exported or deleted what"],
  ["help", "Help and support", "Tickets, feature requests, support access"],
];

/** Which admin-console sections a role may open (PRD section 12: F, Branch scope, Part). */
export function adminSections(p: Perms): string[] {
  const a = lvl(p, "admin");
  const out = new Set<string>();
  if (a === "F") ADMIN_SECTIONS.forEach(([k]) => out.add(k));
  if (a === "Branch scope") ["users", "routing", "templates", "sources", "forms", "data", "help"].forEach((k) => out.add(k));
  if (a === "Part" && lvl(p, "campaigns") === "F") ["sources", "templates", "forms"].forEach((k) => out.add(k));
  if (a === "Part" && lvl(p, "payments") === "F") out.add("wallet");
  if (has(p, "workflows")) out.add("workflows");
  if (has(p, "audit")) out.add("audit");
  if (out.size) out.add("help");
  return [...out];
}
