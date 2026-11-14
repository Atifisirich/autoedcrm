"use client";
import { useActionState, useState } from "react";
import { submitForm } from "@/app/actions/public";

export function EnquiryForm({ slug, fields, grades, branches, utm, notice, color }: { slug: string; fields: string[]; grades: string[]; branches: { id: string; name: string }[]; utm: string; notice: string; color: string }) {
  const [state, action, pending] = useActionState(submitForm, null);
  const [loaded] = useState(() => Date.now());
  const has = (k: string) => fields.includes(k);
  if (state?.ok) return <div className="px-6 py-12 text-center"><p className="text-3xl">✓</p><p className="mt-2 text-lg font-medium text-slate-900">{state.message}</p></div>;
  return (
    <form action={action} className="space-y-4 px-6 py-6 text-base">
      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="utm" value={utm} /><input type="hidden" name="loaded" value={loaded} />
      <div className="hidden" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="block"><span className="label">Child's name</span><input name="student_name" required className="input !py-2.5" /></label>
      <label className="block"><span className="label">Your name</span><input name="guardian_name" required autoComplete="name" className="input !py-2.5" /></label>
      <label className="block"><span className="label">Mobile number</span><input name="mobile" required inputMode="numeric" autoComplete="tel" pattern="[0-9+ ]{10,14}" className="input !py-2.5" placeholder="10-digit mobile" /></label>
      {has("email") && <label className="block"><span className="label">Email (optional)</span><input name="email" type="email" autoComplete="email" className="input !py-2.5" /></label>}
      {has("grade") && <label className="block"><span className="label">Grade you are looking for</span><select name="grade" required className="input !py-2.5" defaultValue=""><option value="" disabled>Choose a grade</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>}
      {has("branch") && branches.length > 1 && <label className="block"><span className="label">Campus</span><select name="branch" required className="input !py-2.5">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      {has("dob") && <label className="block"><span className="label">Child's date of birth</span><input name="dob" type="date" className="input !py-2.5" /></label>}
      {has("locality") && <label className="block"><span className="label">Area you live in</span><input name="locality" className="input !py-2.5" /></label>}
      {has("heard_about") && <label className="block"><span className="label">How did you hear about us? (optional)</span><input name="heard_about" className="input !py-2.5" /></label>}
      <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" name="consent" required className="mt-1" /><span>I am the parent or guardian and I agree to be contacted about admission by call, WhatsApp, SMS or email. {notice}</span></label>
      {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>}
      <button className="w-full rounded-md px-4 py-3 font-semibold text-white disabled:opacity-60" style={{ background: color }} disabled={pending}>{pending ? "Sending…" : "Send enquiry"}</button>
    </form>
  );
}
