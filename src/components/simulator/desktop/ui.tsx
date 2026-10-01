"use client";

import type { ReactNode } from "react";

/* --- desktop-exe --- Small building blocks of the Desktop group (dark theme, lime accent like the rest of the panel). */

export const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
export const primaryBtn = `${btn} bg-[#93d119] text-slate-950 hover:bg-[#7fb315]`;
export const ghostBtn = `${btn} bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700`;
export const dangerBtn = `${btn} bg-red-600/80 text-white hover:bg-red-600`;
export const inputClass = "px-2.5 py-1.5 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none text-xs";

export function Card({ title, children, actions, testId }: { title: string; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Bar({ value, tone = "lime" }: { value: number; tone?: "lime" | "cyan" | "red" }) {
  const color = tone === "red" ? "bg-red-500" : tone === "cyan" ? "bg-cyan-500" : "bg-[#93d119]";
  return (
    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-[width] duration-200`} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${on ? "bg-[#93d119]/20 border-[#93d119] text-[#b0f02a]" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"}`}>
      {children}
    </button>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

export function formatSeconds(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "–";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(0).padStart(2, "0")}` : `${s.toFixed(1)} s`;
}

/** An IPC error without Electron's "Error invoking remote method" prefix. */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
