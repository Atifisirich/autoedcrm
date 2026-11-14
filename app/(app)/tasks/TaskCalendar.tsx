"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rescheduleTask } from "@/app/actions/record";

type T = { id: string; title: string; student: string; day: string; time: string; iso: string; href: string; owner: string; overdue: boolean };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Month grid of open tasks. Drag a task onto another day to reschedule it; the time of day is kept. */
export function TaskCalendar({ tasks, today, showOwner }: { tasks: T[]; today: string; showOwner: boolean }) {
  const [offset, setOffset] = useState(0);
  const [over, setOver] = useState("");
  const [, start] = useTransition();
  const router = useRouter();
  const [ty, tm] = today.split("-").map(Number);
  const first = new Date(ty, tm - 1 + offset, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const move = (id: string, day: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.day === day) return;
    const shift = Math.round((+new Date(day) - +new Date(t.day)) / 86400e3);
    start(async () => { await rescheduleTask(id, new Date(+new Date(t.iso) + shift * 86400e3).toISOString()); router.refresh(); });
  };
  return (
    <div className="card overflow-hidden">
      <div className="card-h">
        <span>{first.toLocaleString("en-IN", { month: "long", year: "numeric" })}</span>
        <span className="flex gap-1"><button className="btn btn-sm" onClick={() => setOffset(offset - 1)}>← Previous</button><button className="btn btn-sm" onClick={() => setOffset(0)}>Today</button><button className="btn btn-sm" onClick={() => setOffset(offset + 1)}>Next →</button></span>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = key(d);
          const list = tasks.filter((t) => t.day === k);
          return (
            <div key={k} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver("")} onDrop={(e) => { e.preventDefault(); setOver(""); move(e.dataTransfer.getData("text/plain"), k); }}
              className={`min-h-24 border-b border-r border-slate-100 p-1 ${d.getMonth() !== first.getMonth() ? "bg-slate-50/70" : ""} ${over === k ? "bg-brand-50" : ""}`}>
              <div className={`mb-1 text-right text-xs ${k === today ? "font-bold text-brand-700" : "text-slate-500"}`}>{k === today ? "Today " : ""}{d.getDate()}</div>
              {list.slice(0, 4).map((t) => (
                <Link key={t.id} href={t.href} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)} title={`${t.title} · ${t.owner}`}
                  className={`mb-0.5 block truncate rounded px-1 py-0.5 text-[11px] ${t.overdue ? "bg-rose-100 text-rose-800" : "bg-brand-100 text-brand-900"}`}>{t.time} {t.student}{showOwner ? ` · ${t.owner.split(" ")[0]}` : ""}</Link>
              ))}
              {list.length > 4 && <div className="muted text-[11px]">+{list.length - 4} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
