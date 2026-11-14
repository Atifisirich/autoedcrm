"use client";
import { useActionState } from "react";

type Section = { title: string; fields: { key: string; label: string; required?: boolean; type?: string; options?: string[] }[] };
type Action = (prev: any, fd: FormData) => Promise<{ ok: boolean; error?: string }>;

/** The multi-section application. Used by staff in assisted mode and by parents on the public link (APP-01..03). */
export function ApplicationForm({ action, hidden, sections, answers, readOnly, staff, canOverrideAge }: { action: Action; hidden: Record<string, string>; sections: Section[]; answers: Record<string, string>; readOnly: boolean; staff: boolean; canOverrideAge?: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-5">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {sections.map((s) => (
        <fieldset key={s.title} className="space-y-3">
          <legend className="text-sm font-semibold text-slate-800">{s.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}{f.required && <span className="text-rose-600"> *</span>}</span>
                {f.options ? (
                  <select name={f.key} defaultValue={answers[f.key] ?? ""} disabled={readOnly} className="input"><option value="">Choose</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                ) : (
                  <input name={f.key} defaultValue={answers[f.key] ?? ""} readOnly={readOnly} className="input" />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {!readOnly && (
        <>
          <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-slate-700">
            <input type="checkbox" name="declaration" className="mt-0.5" />
            <span>{staff ? "The parent has confirmed that the information above is true and has signed the declaration." : "I confirm that the information above is true and I agree to the school's admission terms and privacy notice."}</span>
          </label>
          {canOverrideAge && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="overrideAge" /> Override the age-eligibility rule for this child (logged)</label>}
          {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">{state.error}</p>}
          {state?.ok && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-green-800">Saved.</p>}
          <div className="flex gap-2">
            <button name="submit" value="0" className="btn" disabled={pending}>Save and continue later</button>
            <button name="submit" value="1" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Submit application"}</button>
          </div>
        </>
      )}
    </form>
  );
}
