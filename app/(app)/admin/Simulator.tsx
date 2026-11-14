"use client";
import { useActionState } from "react";
import { simulateRule } from "@/app/actions/admin";

export function Simulator({ branches, grades, channels }: { branches: { id: string; name: string }[]; grades: string[]; channels: string[] }) {
  const [state, action, pending] = useActionState(simulateRule, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 p-4">
      <label><span className="label">Branch</span><select name="branch_id" className="input w-48">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span className="label">Grade</span><select name="grade" className="input w-32"><option value="">Any</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
      <label><span className="label">Channel</span><select name="channel" className="input w-36"><option value="">Any</option>{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button className="btn" disabled={pending}>Test: who would get this lead?</button>
      {state && <p role="status" className="w-full rounded-md bg-brand-50 px-3 py-2 text-brand-900">{state.text} Nothing was assigned.</p>}
    </form>
  );
}
