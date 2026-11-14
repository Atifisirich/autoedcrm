import Link from "next/link";
import { requirePlatform } from "@/lib/auth";
import { Toast } from "@/components/Shell";
import { logoutAction } from "@/app/actions/session";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePlatform();
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between bg-slate-900 px-5 py-3 text-white">
        <Link href="/platform" className="font-semibold">AutoED platform console <span className="ml-2 rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-slate-900">Internal</span></Link>
        <div className="flex items-center gap-4 text-sm"><Link href="/platform" className="hover:underline">Tenants</Link><Link href="/platform?tab=tickets" className="hover:underline">Tickets</Link><Link href="/platform?tab=ops" className="hover:underline">Operations</Link>
          <span className="text-slate-300">{u.name} · {u.platform_role.replace("_", " ")}</span><form action={logoutAction}><button className="underline">Sign out</button></form></div>
      </header>
      <main className="p-5">{children}</main>
      <Toast />
    </div>
  );
}
