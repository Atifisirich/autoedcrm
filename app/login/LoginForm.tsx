"use client";
import { useActionState, useRef } from "react";
import { loginAction } from "@/app/actions/session";

export function LoginForm({ demo }: { demo: { email: string; name: string; role: string }[] }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const form = useRef<HTMLFormElement>(null);
  const fill = (email: string) => {
    const f = form.current!;
    (f.elements.namedItem("email") as HTMLInputElement).value = email;
    (f.elements.namedItem("password") as HTMLInputElement).value = "demo1234";
    f.requestSubmit();
  };
  return (
    <>
      <form ref={form} action={action} className="mt-6 space-y-3">
        <label className="block">
          <span className="label">Work email</span>
          <input name="email" type="email" required autoComplete="username" className="input" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input" />
        </label>
        {state?.error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">{state.error}</p>}
        <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      {demo.length > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold text-slate-600">Demo workspace: sign in as</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {demo.map((d) => (
              <button key={d.email} type="button" onClick={() => fill(d.email)} className="chip" title={d.email}>
                {d.name.split(" ")[0]} · {d.role}
              </button>
            ))}
          </div>
          <p className="muted mt-2 text-xs">Sample data only. Password for every demo account: demo1234</p>
        </div>
      )}
    </>
  );
}
