"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { dailyLink, formatRunSeconds, type DailyChallenge } from "@/lib/daily";
import type { DailyResult } from "./useDailyChallenge";

/*
 * --- daily-gallery --- The simulator's daily-challenge UI: the bar under the canvas (the challenge on the page and the
 * "Play today's seed" button) and the end-of-run panel on the canvas that invites to share the run (it copies the
 * challenge's link). Nothing here is drawn on the canvas itself, so a recording never shows it.
 */

/** The bar under the canvas: which challenge is on the page, and the button that loads today's. */
export function DailyBar({ active, busy, disabled, onPlay }: { active: DailyChallenge | null; busy: boolean; disabled: boolean; onPlay: () => void }) {
  const t = useTranslations("Daily");
  const modes = useTranslations("Modes");
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]" data-testid="daily-bar" data-daily-active={active ? active.date : ""}>
      <span className={active ? "text-[#93d119]/90 font-medium" : "text-zinc-500"}>
        {active ? `📅 ${t("barActive", { number: active.number, mode: modes(`${active.mode}.name`), seed: active.seed })}` : t("barIdle")}
      </span>
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled || busy}
        className="shrink-0 px-2.5 py-1 rounded-md bg-[#93d119]/10 border border-[#93d119]/25 text-[#b0f02a] hover:bg-[#93d119]/20 hover:border-[#93d119]/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        📅 {t("play")}
      </button>
    </div>
  );
}

/** The end-of-run panel of a finished daily run: its number, mode and run length, the streak, and the share button. */
export function DailyResultPanel({ result }: { result: DailyResult }) {
  const t = useTranslations("Daily");
  const modes = useTranslations("Modes");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const { challenge, ms, streak } = result;
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(dailyLink(`${window.location.origin}${window.location.pathname}`, challenge));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable */
    }
  }, [challenge]);
  return (
    <div className="absolute inset-x-0 top-3 sm:top-5 z-10 flex justify-center px-3 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[#93d119]/30 bg-slate-950/85 backdrop-blur-md shadow-2xl shadow-[#93d119]/10 px-4 py-3 text-center animate-fade-in"
        data-testid="daily-result"
        data-daily-date={challenge.date}
        data-daily-ms={Math.round(ms)}
        role="status"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#93d119]">📅 {t("resultTitle", { number: challenge.number })}</p>
        <p className="mt-1 text-sm text-slate-200">
          <span className="font-semibold">{modes(`${challenge.mode}.name`)}</span> · <span className="font-mono tabular-nums">{t("resultTime", { seconds: formatRunSeconds(ms) })}</span>
          {streak > 0 && <span className="text-amber-400"> · 🔥 {t("streak", { days: streak })}</span>}
        </p>
        <p className="mt-1 text-[11px] text-slate-400 leading-snug">{t("resultInvite")}</p>
        <button
          type="button"
          onClick={copy}
          className="mt-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-slate-950 text-xs font-bold transition-all cursor-pointer"
        >
          {copied ? `✅ ${t("copied")}` : `📋 ${t("copyResult")}`}
        </button>
      </div>
    </div>
  );
}
