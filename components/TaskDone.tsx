"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { completeTaskAction } from "@/app/actions/record";

export type StageOpt = { id: string; name: string; phase_name: string; is_closed: boolean; exempt_next_action: boolean };

/**
 * One-tap complete with outcome. When this is the enquiry's last open task the dialog also
 * asks for the next action and will not save without one (TSK-02, TSK-03).
 */
export function TaskDone({ taskId, title, lastOpen, stages, reasons, defaultDue }: { taskId: string; title: string; lastOpen: boolean; stages: StageOpt[]; reasons: string[]; defaultDue: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(lastOpen ? "task" : "none");
  const [stageId, setStageId] = useState("");
  const [state, action, pending] = useActionState(completeTaskAction, null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const closing = stages.find((s) => s.id === stageId)?.is_closed;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-sm">✓ Done</button>
      <dialog ref={ref} onClose={() => setOpen(false)} className="m-auto w-full max-w-md rounded-lg bg-white p-0 text-left shadow-xl">
        <form action={action}>
          <input type="hidden" name="taskId" value={taskId} />
          <div className="card-h">Complete: {title}</div>
          <div className="space-y-3 p-4">
            <label className="block"><span className="label">Outcome</span><input name="outcome" required autoFocus className="input" placeholder="What happened?" list="outcomes" />
              <datalist id="outcomes">{["Spoke to parent, interested", "Not answered", "Asked to call later", "Visit planned", "Shared fee details", "Not interested"].map((o) => <option key={o} value={o} />)}</datalist></label>
            <fieldset>
              <legend className="label">{lastOpen ? "Next action (required: this is the last open task)" : "Next action"}</legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5"><input type="radio" name="next" value="task" checked={next === "task"} onChange={() => setNext("task")} /> Schedule a task</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="next" value="stage" checked={next === "stage"} onChange={() => setNext("stage")} /> Move stage / close</label>
                {!lastOpen && <label className="flex items-center gap-1.5"><input type="radio" name="next" value="none" checked={next === "none"} onChange={() => setNext("none")} /> Nothing more</label>}
              </div>
            </fieldset>
            {next === "task" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 block"><span className="label">Task</span><input name="nextTitle" defaultValue="Follow-up call" required className="input" /></label>
                <label className="block"><span className="label">Type</span><select name="nextType" className="input"><option value="call_back">Call back</option><option value="whatsapp_follow_up">WhatsApp follow-up</option><option value="document_chase">Document chase</option><option value="payment_chase">Payment chase</option><option value="custom">Other</option></select></label>
                <label className="block"><span className="label">Due</span><input type="datetime-local" name="nextDue" required defaultValue={defaultDue} className="input" /></label>
              </div>
            )}
            {next === "stage" && (
              <>
                <label className="block"><span className="label">Move to</span>
                  <select name="stageId" required value={stageId} onChange={(e) => setStageId(e.target.value)} className="input"><option value="">Choose a stage</option>
                    {stages.filter((s) => !lastOpen || s.exempt_next_action).map((s) => <option key={s.id} value={s.id}>{s.phase_name}: {s.name}</option>)}</select></label>
                {closing && <label className="block"><span className="label">Closure reason</span><select name="closure_reason" required className="input"><option value="">Choose a reason</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label>}
              </>
            )}
            {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">{state.error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 p-3">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Complete task"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
