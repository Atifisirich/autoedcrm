"use server";
import { revalidatePath } from "next/cache";
import { insert, one, q, update } from "@/lib/db";
import { audit, getEnquiry, MESSAGE_COST, renderTemplate, sendMessage } from "@/lib/core";
import { actorOf, flash, guard, str } from "@/lib/guard";
import { leadIds, type SP } from "@/lib/leads";
import { canPublishWorkflows, canRunCampaigns, lvl } from "@/lib/perm";
import { mergeVars, RECIPES, testRun, TRIGGERS, type Step } from "@/lib/workflows";

// ----- campaigns (CMP-01, CMP-02) -----

export async function createCampaign(fd: FormData) {
  const ctx = await guard("campaigns");
  if (!canRunCampaigns(ctx.perms)) throw new Error("Your role cannot create campaigns.");
  const tpl = await one("select * from templates where tenant_id=$1 and id=$2 and status='approved'", [ctx.tenantId, str(fd, "templateId")]);
  if (!tpl) return flash("Choose an approved template.", "error");
  await insert("campaigns", { tenant_id: ctx.tenantId, name: str(fd, "name") || tpl.name, channel: tpl.channel, template_id: tpl.id, audience: { query: str(fd, "audience") }, created_by: ctx.user.id });
  await flash("Draft campaign created. Review the audience and cost, then send.");
  revalidatePath("/campaigns");
}

async function campaignAudience(ctx: Awaited<ReturnType<typeof guard>>, c: Record<string, any>): Promise<string[]> {
  const sp: SP = Object.fromEntries(new URLSearchParams(c.audience?.query ?? ""));
  return leadIds(ctx, sp);
}

export async function sendCampaign(fd: FormData) {
  const ctx = await guard("campaigns");
  if (!canRunCampaigns(ctx.perms)) throw new Error("Your role cannot send campaigns.");
  const c = await one("select c.*, t.body, t.category, t.name as template from campaigns c join templates t on t.id=c.template_id where c.tenant_id=$1 and c.id=$2 and c.status='draft'", [ctx.tenantId, str(fd, "id")]);
  if (!c) return;
  const ids = await campaignAudience(ctx, c);
  const tplRow = await one("select * from templates where id=$1", [c.template_id]);
  // One message per family, even when several children match (MSG-05 frequency rule).
  const seen = new Set<string>();
  let sent = 0, delivered = 0, skipped = 0;
  for (const id of ids) {
    const e = await getEnquiry(ctx.tenantId, id);
    if (!e || seen.has(e.household_id)) continue;
    seen.add(e.household_id);
    // CMPL-05: promotional messages never go to families who have already enrolled or closed.
    if (c.category === "marketing" && (e.is_won || e.is_closed)) { skipped++; continue; }
    const vars = await mergeVars(ctx.tenantId, e);
    const r = await sendMessage(ctx.tenantId, { householdId: e.household_id, enquiryId: id, channel: c.channel, body: renderTemplate(c.body, vars), actorId: ctx.user.id, campaignId: c.id, template: tplRow, vars });
    sent++;
    if (r.status !== "failed") delivered++;
  }
  await update("campaigns", ctx.tenantId, c.id, { status: "sent", sent_at: new Date(), cost: delivered * (MESSAGE_COST[c.channel] ?? 0), stats: { targeted: seen.size, sent, delivered, skipped } });
  await audit(ctx.tenantId, actorOf(ctx), "campaign", "campaign", c.id, `Sent campaign "${c.name}" to ${sent} families`);
  await flash(`Campaign sent to ${sent} famil${sent === 1 ? "y" : "ies"}: ${delivered} delivered, ${sent - delivered} not delivered${skipped ? `, ${skipped} excluded (enrolled or closed)` : ""}.`);
  revalidatePath("/campaigns");
}

export async function deleteCampaign(fd: FormData) {
  const ctx = await guard("campaigns");
  await q("delete from campaigns where tenant_id=$1 and id=$2 and status='draft'", [ctx.tenantId, str(fd, "id")]);
  revalidatePath("/campaigns");
}

// ----- workflows (AUT-01..05) -----

export async function workflowStatus(fd: FormData) {
  const ctx = await guard("workflows");
  if (!canPublishWorkflows(ctx.perms)) throw new Error("Your role can draft workflows but not publish or pause them.");
  const status = str(fd, "status");
  const wf = await update("workflows", ctx.tenantId, str(fd, "id"), { status, updated_at: new Date() });
  if (wf) await audit(ctx.tenantId, actorOf(ctx), "config", "workflow", wf.id, `Workflow "${wf.name}" set to ${status}`);
  await flash(status === "published" ? "Workflow is live." : "Workflow paused. Waiting steps will be cancelled when they come due.");
  revalidatePath("/admin/workflows");
}

export async function installRecipe(fd: FormData) {
  const ctx = await guard("workflows");
  const r = RECIPES.find((x) => x.key === str(fd, "key"));
  if (!r) return;
  await insert("workflows", { tenant_id: ctx.tenantId, recipe_key: r.key, name: r.name, description: r.description, trigger: r.trigger, conditions: r.conditions ?? [], steps: r.steps, status: "draft" });
  await flash(`"${r.name}" installed as a draft. Test it, then publish.`);
  revalidatePath("/admin/workflows");
}

export async function createWorkflow(fd: FormData) {
  const ctx = await guard("workflows");
  const trigger = str(fd, "trigger");
  if (!TRIGGERS[trigger]) return flash("Choose a trigger.", "error");
  const wf = await insert("workflows", { tenant_id: ctx.tenantId, name: str(fd, "name") || "New workflow", description: "Custom workflow", trigger, steps: [], status: "draft" });
  revalidatePath("/admin/workflows");
  const { redirect } = await import("next/navigation");
  redirect("/admin/workflows?id=" + wf.id);
}

export async function editSteps(fd: FormData) {
  const ctx = await guard("workflows");
  const wf = await one("select * from workflows where tenant_id=$1 and id=$2", [ctx.tenantId, str(fd, "id")]);
  if (!wf) return;
  if (wf.status === "published" && !canPublishWorkflows(ctx.perms)) throw new Error("Pause the workflow before editing it, or ask someone who can publish.");
  let steps = [...(wf.steps as Step[])];
  const what = str(fd, "what");
  if (what === "remove") steps.splice(Number(str(fd, "index")), 1);
  else if (what === "up") { const i = Number(str(fd, "index")); if (i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; }
  else if (what === "add") {
    const type = str(fd, "type");
    const step: Step | null =
      type === "send" ? { type: "send", channel: (str(fd, "channel") || "whatsapp") as any, template: str(fd, "template") }
      : type === "task" ? { type: "task", title: str(fd, "title") || "Follow-up", dueMins: Number(str(fd, "mins")) || 60 }
      : type === "wait" ? { type: "wait", mins: Number(str(fd, "mins")) || 1440 }
      : type === "notify" ? { type: "notify", who: (str(fd, "who") || "owner") as any, title: str(fd, "title") || "Please check this record" }
      : type === "stage" ? { type: "stage", stage: str(fd, "stage") }
      : type === "tag" ? { type: "tag", tag: str(fd, "title") }
      : type === "reassign" ? { type: "reassign" } : null;
    if (!step) return flash("Choose a step type.", "error");
    steps = [...steps, step];
  }
  await update("workflows", ctx.tenantId, wf.id, { steps, version: wf.version + 1, updated_at: new Date() });
  await audit(ctx.tenantId, actorOf(ctx), "config", "workflow", wf.id, `Edited steps of workflow "${wf.name}" (version ${wf.version + 1})`, wf.steps, steps);
  revalidatePath("/admin/workflows");
}

export async function testWorkflow(fd: FormData) {
  const ctx = await guard("workflows");
  const sample = await one("select e.id from enquiries e join stages s on s.id=e.stage_id where e.tenant_id=$1 and not s.is_closed order by e.created_at desc limit 1", [ctx.tenantId]);
  if (!sample) return flash("Add at least one enquiry to test with.", "error");
  await testRun(ctx.tenantId, str(fd, "id"), sample.id);
  await flash("Test run finished. Nothing was sent. See the run log below.");
  revalidatePath("/admin/workflows");
}

export async function deleteWorkflow(fd: FormData) {
  const ctx = await guard("workflows");
  if (lvl(ctx.perms, "workflows") !== "F") throw new Error("Only a group admin can delete workflows.");
  await q("delete from workflows where tenant_id=$1 and id=$2 and status<>'published'", [ctx.tenantId, str(fd, "id")]);
  revalidatePath("/admin/workflows");
}
