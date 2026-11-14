"use client";
import { useState, useTransition } from "react";
import { addNote, addTaskAction, bookVisit, logCall, paymentAction, reassignOne, sendMsg, startApplicationAction } from "@/app/actions/record";
import { moveStage } from "@/app/actions/leads";
import type { StageOpt } from "@/components/TaskDone";

type Opt = { id: string; name: string };
type Props = {
  enquiryId: string; mobile: string; stageId: string; stages: StageOpt[]; reasons: string[]; templates: (Opt & { channel: string; body: string })[]; users: Opt[]; defaultDue: string; initial?: string; hasApplication: boolean;
  fees: { registration: number; admission: number }; can: { edit: boolean; message: boolean; tasks: boolean; reassign: boolean; application: boolean; pay: boolean };
};

/** One action bar on every record. Panels open inline so the user never loses the page (UX 15.2). */
export function ActionBar(p: Props) {
  const [panel, setPanel] = useState(p.initial ?? "");
  const [stageId, setStageId] = useState("");
  const [err, setErr] = useState("");
  const [tpl, setTpl] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [pending, start] = useTransition();
  const target = p.stages.find((s) => s.id === stageId);
  const close = () => setPanel("");
  const Btn = ({ id, children, show = true }: { id: string; children: React.ReactNode; show?: boolean }) => (show ? <button type="button" onClick={() => setPanel(panel === id ? "" : id)} aria-expanded={panel === id} className={`btn ${panel === id ? "btn-primary" : ""}`}>{children}</button> : null);
  const hidden = <input type="hidden" name="enquiryId" value={p.enquiryId} />;
  const shown = p.templates.filter((t) => t.channel === channel);
  return (
    <div className="card">
      <div className="flex flex-wrap gap-2 p-3">
        <Btn id="call" show={p.can.edit}>📞 Call</Btn>
        <Btn id="message" show={p.can.message}>💬 Message</Btn>
        <Btn id="note">📝 Note</Btn>
        <Btn id="task" show={p.can.tasks}>⏰ Task</Btn>
        <Btn id="visit" show={p.can.tasks}>🏫 Book visit</Btn>
        <Btn id="stage" show={p.can.edit}>➜ Change stage</Btn>
        <Btn id="apply" show={p.can.application || p.can.pay}>📄 Form / payment</Btn>
        <Btn id="reassign" show={p.can.reassign}>👤 Reassign</Btn>
      </div>
      {panel && (
        <div className="border-t border-slate-200 bg-slate-50 p-3">
          {panel === "call" && (
            <form action={async (fd) => { await logCall(fd); close(); }} className="grid gap-3 md:grid-cols-4">
              {hidden}
              <div className="md:col-span-4"><a href={`tel:+91${p.mobile}`} className="btn btn-primary">Call +91 {p.mobile}</a> <span className="muted ml-2">Then log what happened. A disposition is required after every call.</span></div>
              <label><span className="label">Outcome</span><select name="outcome" required className="input"><option value="connected">Connected</option><option value="not_answered">Not answered</option><option value="busy">Busy</option><option value="switched_off">Switched off</option><option value="wrong_number">Wrong number</option></select></label>
              <label className="md:col-span-3"><span className="label">Notes</span><input name="notes" className="input" placeholder="What did the parent say?" /></label>
              <label className="md:col-span-2"><span className="label">Next follow-up (optional)</span><input name="nextTitle" className="input" placeholder="Follow-up call" /></label>
              <label><span className="label">Due</span><input type="datetime-local" name="nextDue" className="input" /></label>
              <div className="flex items-end"><button className="btn btn-primary">Log call</button></div>
            </form>
          )}
          {panel === "message" && (
            <form action={async (fd) => { await sendMsg(fd); close(); }} className="space-y-3">
              {hidden}
              <div className="flex flex-wrap items-end gap-3">
                <label><span className="label">Channel</span><select name="channel" value={channel} onChange={(e) => { setChannel(e.target.value); setTpl(""); }} className="input w-36"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></label>
                <label><span className="label">Template</span><select name="templateId" value={tpl} onChange={(e) => setTpl(e.target.value)} className="input w-64"><option value="">Free text</option>{shown.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <span className="muted pb-2 text-xs">Cost estimate: {channel === "whatsapp" ? "₹0.80" : channel === "sms" ? "₹0.25" : "₹0.02"} from the wallet</span>
              </div>
              {tpl ? <p className="rounded-md border border-slate-200 bg-white p-3 text-slate-600">{p.templates.find((t) => t.id === tpl)?.body}<span className="muted mt-1 block text-xs">Names and links are filled in for this family when sent.</span></p> : <textarea name="body" rows={3} required className="input" placeholder="Type your message" />}
              <button className="btn btn-primary">Send</button>
            </form>
          )}
          {panel === "note" && (
            <form action={async (fd) => { await addNote(fd); close(); }} className="space-y-3">
              {hidden}
              <textarea name="note" rows={3} required autoFocus className="input" placeholder="Internal note. Type @firstname to notify a colleague, for example @meera please approve." />
              <button className="btn btn-primary">Save note</button>
            </form>
          )}
          {panel === "task" && (
            <form action={async (fd) => { await addTaskAction(fd); close(); }} className="grid gap-3 md:grid-cols-5">
              {hidden}
              <label><span className="label">Type</span><select name="type" className="input"><option value="call_back">Call back</option><option value="whatsapp_follow_up">WhatsApp follow-up</option><option value="document_chase">Document chase</option><option value="payment_chase">Payment chase</option><option value="interaction">Interaction</option><option value="custom">Other</option></select></label>
              <label className="md:col-span-2"><span className="label">Task</span><input name="title" required defaultValue="Follow-up call" className="input" /></label>
              <label><span className="label">Due</span><input type="datetime-local" name="dueAt" required defaultValue={p.defaultDue} className="input" /></label>
              <label><span className="label">Priority</span><select name="priority" className="input"><option value="normal">Normal</option><option value="high">High</option></select></label>
              <div><button className="btn btn-primary">Add task</button></div>
            </form>
          )}
          {panel === "visit" && (
            <form action={async (fd) => { await bookVisit(fd); close(); }} className="grid gap-3 md:grid-cols-4">
              {hidden}
              <label><span className="label">Type</span><select name="type" className="input"><option value="campus_tour">Campus tour</option><option value="counselling">Counselling</option><option value="interaction">Interaction</option><option value="assessment">Assessment</option></select></label>
              <label><span className="label">Date and time</span><input type="datetime-local" name="slotAt" required defaultValue={p.defaultDue} className="input" /></label>
              <label><span className="label">Host</span><select name="hostId" className="input"><option value="">Record owner</option>{p.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <div className="flex items-end"><button className="btn btn-primary">Book visit</button></div>
            </form>
          )}
          {panel === "stage" && (
            <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => { const r = await moveStage(p.enquiryId, stageId, { closure_reason: String(fd.get("closure_reason") ?? "") || undefined }); if (r.ok) { setErr(""); close(); } else setErr(r.missing?.includes("visit") ? "This stage needs a booked visit. Use Book visit and the stage moves by itself." : r.missing ? "Choose a closure reason." : r.error ?? "Could not move."); }); }} className="flex flex-wrap items-end gap-3">
              <label><span className="label">Move to</span><select required value={stageId} onChange={(e) => setStageId(e.target.value)} className="input w-64"><option value="">Choose a stage</option>{p.stages.filter((s) => s.id !== p.stageId).map((s) => <option key={s.id} value={s.id}>{s.phase_name}: {s.name}</option>)}</select></label>
              {target?.is_closed && <label><span className="label">Closure reason</span><select name="closure_reason" required className="input w-56"><option value="">Choose a reason</option>{p.reasons.map((r) => <option key={r}>{r}</option>)}</select></label>}
              <button className="btn btn-primary" disabled={pending}>Move</button>
              {err && <p role="alert" className="w-full text-rose-700">{err}</p>}
            </form>
          )}
          {panel === "apply" && (
            <div className="grid gap-4 md:grid-cols-2">
              {p.can.application && (
                <div>
                  <p className="mb-2 font-medium">Application form</p>
                  {p.hasApplication ? <a className="btn" href={`/applications/${p.enquiryId}`}>Open the application</a> : <form action={async (fd) => { await startApplicationAction(fd); close(); }}>{hidden}<button className="btn btn-primary">Start application</button></form>}
                  {p.can.message && <form action={async (fd) => { await sendMsg(fd); close(); }} className="mt-2">{hidden}<input type="hidden" name="templateId" value={p.templates.find((t) => t.name === "Application link" && t.channel === "whatsapp")?.id ?? ""} /><button className="btn">Send the form link on WhatsApp</button></form>}
                </div>
              )}
              {p.can.pay && (
                <form action={async (fd) => { await paymentAction(fd); close(); }} className="grid grid-cols-2 gap-2">
                  {hidden}<input type="hidden" name="what" value="create" />
                  <p className="col-span-2 font-medium">Payment</p>
                  <label><span className="label">For</span><select name="purpose" className="input"><option>Registration fee</option><option>Admission fee</option></select></label>
                  <label><span className="label">Amount (₹)</span><input name="amount" type="number" min={1} required defaultValue={p.fees.registration} className="input" /></label>
                  <label><span className="label">How</span><select name="mode" className="input"><option value="link">Send payment link</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="upi">UPI at desk</option></select></label>
                  <label><span className="label">Reference (optional)</span><input name="reference" className="input" placeholder="Cheque / UTR no." /></label>
                  <div className="col-span-2"><button className="btn btn-primary">Continue</button></div>
                </form>
              )}
            </div>
          )}
          {panel === "reassign" && (
            <form action={async (fd) => { await reassignOne(fd); close(); }} className="flex flex-wrap items-end gap-3">
              {hidden}
              <label><span className="label">New owner</span><select name="ownerId" required className="input w-56"><option value="">Choose</option>{p.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label><span className="label">Reason</span><input name="reason" required className="input w-64" placeholder="Why is this moving?" /></label>
              <button className="btn btn-primary">Reassign</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
