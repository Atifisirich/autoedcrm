import QRCode from "qrcode";
import { needs2faSetup, requireCtx } from "@/lib/auth";
import { q } from "@/lib/db";
import { rel } from "@/lib/fmt";
import { decrypt } from "@/lib/secrets";
import { otpauthUri } from "@/lib/totp";
import { Badge, PageHeader } from "@/components/ui";
import { confirm2fa, disable2fa, start2fa } from "@/app/actions/account";

export default async function AccountPage() {
  const ctx = await requireCtx();
  const u = ctx.user;
  const pending = u.totp_pending_enc ? decrypt(u.totp_pending_enc) : null;
  const qr = pending ? await QRCode.toDataURL(otpauthUri(pending, u.email), { margin: 1, width: 200 }) : null;
  const sessions = await q("select device, expires_at from sessions where user_id=$1 and expires_at>now() order by expires_at desc limit 10", [u.id]);
  const required = needs2faSetup(ctx);
  return (
    <>
      <PageHeader title="My account" sub={`${u.name} · ${u.email} · ${ctx.roleName}`} />
      {required && <p role="alert" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-amber-900">Your school requires two-factor sign-in for anyone who can change settings. Turn it on below to open the admin console.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="card-h"><span>Two-factor sign-in</span>{u.totp_enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</div>
          <div className="space-y-3 p-4">
            <p className="muted">After your password, you also enter a 6-digit code from an authenticator app such as Google Authenticator or Microsoft Authenticator. It protects children's data if your password leaks.</p>
            {u.totp_enabled ? (
              <form action={disable2fa} className="flex flex-wrap items-end gap-2">
                <label><span className="label">Current code</span><input name="code" required inputMode="numeric" className="input w-36" /></label>
                <button className="btn btn-danger">Turn off</button>
              </form>
            ) : pending ? (
              <form action={confirm2fa} className="space-y-3">
                <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                  <li>Open your authenticator app and add an account by scanning this code.</li>
                  <li>Type the 6-digit code it shows.</li>
                </ol>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qr && <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded border border-slate-200" />}
                <p className="muted text-xs">Cannot scan? Enter this key by hand: <code className="select-all break-all">{pending}</code></p>
                <div className="flex items-end gap-2">
                  <label><span className="label">6-digit code</span><input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" className="input w-36" /></label>
                  <button className="btn btn-primary">Turn on</button>
                </div>
              </form>
            ) : (
              <form action={start2fa}><button className="btn btn-primary">Set up two-factor sign-in</button></form>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-h">Signed-in devices</div>
          <ul className="divide-y divide-slate-100">
            {sessions.map((s, i) => <li key={i} className="px-4 py-2"><span className="font-medium">{s.device ?? "Web browser"}</span><span className="muted block text-xs">Session ends {rel(s.expires_at)}</span></li>)}
          </ul>
          <p className="muted px-4 py-2 text-xs">Lost a phone? Ask your admin to pause and reactivate your user; that signs out every device.</p>
        </section>
      </div>
    </>
  );
}
