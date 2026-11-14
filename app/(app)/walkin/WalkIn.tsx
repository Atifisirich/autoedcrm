"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { walkIn } from "@/app/actions/leads";
import { DuplicateNotice, useDuplicate } from "@/components/Shell";

export function WalkIn({ branches, branchId, grades, sourceId }: { branches: { id: string; name: string }[]; branchId: string; grades: string[]; sourceId: string }) {
  const [state, action, pending] = useActionState(walkIn, null);
  const [mobile, setMobile] = useState("");
  const [n, setN] = useState(0);
  const dup = useDuplicate(mobile);
  if (state?.ok) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-green-300 bg-green-50 p-8 text-center">
        <p className="text-sm font-semibold text-green-800">Visitor token</p>
        <p className="my-2 text-6xl font-bold text-green-900">{state.token}</p>
        <p className="text-lg text-slate-800">{state.message}</p>
        <p className="mt-1 text-slate-600">Counsellor: <b>{state.ownerName}</b> has been notified with a task.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn btn-primary btn-lg" onClick={() => { setMobile(""); setN(n + 1); window.location.reload(); }}>Next visitor</button>
          <Link className="btn btn-lg" href={`/households/${state.householdId}?e=${state.enquiryId}`}>Open record</Link>
        </div>
      </div>
    );
  }
  return (
    <form key={n} action={action} className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Walk-in desk</h1>
      <input type="hidden" name="sourceId" value={sourceId} />
      <label className="block"><span className="mb-1 block text-base font-medium">Parent's mobile number</span>
        <input name="mobile" required autoFocus inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value)} className="input !py-3 !text-2xl tracking-wider" placeholder="98765 43210" /></label>
      <DuplicateNotice dup={dup} />
      <label className="block"><span className="mb-1 block text-base font-medium">Child's name</span><input name="studentName" required className="input !py-3 !text-lg" /></label>
      {!dup && <label className="block"><span className="mb-1 block text-base font-medium">Parent's name</span><input name="guardianName" required className="input !py-3 !text-lg" /></label>}
      <div className="grid grid-cols-2 gap-4">
        <label className="block"><span className="mb-1 block text-base font-medium">Grade</span><select name="grade" required className="input !py-3 !text-lg">{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-base font-medium">Branch</span><select name="branchId" defaultValue={branchId} className="input !py-3 !text-lg">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>
      <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" name="consent" defaultChecked className="h-5 w-5" /> Parent agrees to be contacted about admissions</label>
      {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">{state.error}</p>}
      <button className="btn btn-primary btn-lg w-full" disabled={pending}>{pending ? "Saving…" : dup ? "Check in this family" : "Save walk-in"}</button>
    </form>
  );
}
