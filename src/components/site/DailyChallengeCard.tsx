"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { assetPath } from "@/lib/site";
import { DAILY_PARAM, dailyStreak, formatRunSeconds, loadDailyHistory, msUntilNextChallenge, todaysChallenge, type DailyChallenge } from "@/lib/daily";

/*
 * --- daily-gallery --- "Today's challenge" on the landing page, below the hero: today's mode (its card picture), number,
 * date and seed, the visitor's streak and today's result once played, a countdown to the next one and the link that opens
 * it in the simulator (`/simulator?daily=1`). The date is the visitor's clock in UTC, read after mount – the page itself is
 * static – so the card shows a placeholder until then.
 */

interface CardState {
  challenge: DailyChallenge;
  streak: number;
  todayMs: number | null;
  nextMs: number;
}

function readState(): CardState {
  const now = new Date();
  const challenge = todaysChallenge(now);
  const history = loadDailyHistory();
  return { challenge, streak: dailyStreak(history, challenge.date), todayMs: history[challenge.date] ?? null, nextMs: msUntilNextChallenge(now) };
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DailyChallengeCard() {
  const t = useTranslations("Daily");
  const modes = useTranslations("Modes");
  const locale = useLocale();
  const [state, setState] = useState<CardState | null>(null);
  useEffect(() => {
    setState(readState());
    const id = setInterval(() => setState(readState()), 1000);
    return () => clearInterval(id);
  }, []);

  const c = state?.challenge;
  const date = c ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${c.date}T00:00:00Z`)) : "";
  return (
    <section className="w-full max-w-5xl mx-auto -mt-4 sm:-mt-8 mb-4 px-4" aria-labelledby="daily-heading">
      <div
        className="relative overflow-hidden rounded-3xl border border-[#93d119]/25 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-[#1e260a]/60 shadow-xl shadow-[#93d119]/5"
        data-testid="daily-card"
        data-daily-date={c?.date ?? ""}
        data-daily-mode={c?.mode ?? ""}
        data-daily-seed={c?.seed ?? ""}
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="relative aspect-video md:aspect-auto md:min-h-full bg-slate-800/50 overflow-hidden">
            {c ? (
              // A background picture, not an <img>: the mode cards below stay the page's only <img> of each mode preview.
              <div
                role="img"
                aria-label={t("cardImageAlt", { mode: modes(`${c.mode}.name`) })}
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url("${assetPath(`/modes/${c.mode}.webp`)}")` }}
                data-testid="daily-image"
              />
            ) : (
              <div className="absolute inset-0 animate-pulse bg-slate-800/60" aria-hidden="true" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-slate-950/40" aria-hidden="true" />
            {c && <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-950/80 border border-[#93d119]/40 text-[11px] font-black font-mono text-[#b0f02a]">#{c.number}</span>}
          </div>
          <div className="p-6 sm:p-8 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-2 font-bold uppercase tracking-[0.2em] text-[#93d119]">
                <span aria-hidden="true">📅</span>
                {t("cardBadge")}
              </span>
              {date && <span className="font-medium text-slate-400">· {date}</span>}
            </div>
            <h2 id="daily-heading" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-50">
              {c ? t("cardTitle", { mode: modes(`${c.mode}.name`) }) : t("cardLoading")}
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">{t("cardText")}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {c && <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">{t("cardSeed", { seed: c.seed })}</span>}
              {state && state.streak > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold">🔥 {t("streak", { days: state.streak })}</span>}
              {state && state.todayMs !== null && (
                <span className="px-2.5 py-1 rounded-lg bg-[#93d119]/10 border border-[#93d119]/30 text-[#b0f02a] font-semibold" data-testid="daily-played">
                  ✅ {t("cardPlayed", { seconds: formatRunSeconds(state.todayMs) })}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
              <Link
                href={`/simulator?${DAILY_PARAM}=1`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/20 hover:scale-105 active:scale-95 transition-all"
                data-testid="daily-play"
              >
                ▶ {t("play")}
              </Link>
              {state && <span className="text-xs text-slate-500 font-mono tabular-nums">{t("nextIn", { time: countdown(state.nextMs) })}</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
