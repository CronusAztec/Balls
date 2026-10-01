"use client";

import type { ReactNode } from "react";

/* --- desktop-exe --- Small building blocks of the Desktop group (dark theme, lime accent like the rest of the panel). */

export const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
export const primaryBtn = `${btn} bg-accent text-accent-ink hover:bg-accent-strong`;
export const ghostBtn = `${btn} bg-surface-2 text-ink hover:bg-surface-3 border border-line-strong`;
export const dangerBtn = `${btn} bg-danger/80 text-ink hover:bg-danger`;
export const inputClass = "px-2.5 py-1.5 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim text-xs";

export function Card({ title, children, actions, testId }: { title: string; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className="bg-surface-1/60 border border-line rounded-xl p-4 space-y-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Bar({ value, tone = "lime" }: { value: number; tone?: "lime" | "cyan" | "red" }) {
  const color = tone === "red" ? "bg-danger" : tone === "cyan" ? "bg-accent" : "bg-accent";
  return (
    <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-[width] duration-200`} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${on ? "bg-accent/20 border-accent text-accent" : "bg-surface-2 border-line-strong text-ink-2 hover:text-ink"}`}>
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
