"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { assetPath } from "@/lib/site";
import { buttonClass } from "@/components/ui/Button";
import { IconCalendar, IconCheck, IconFlame, IconPlay } from "@/components/ui/icons";
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
  // --- site-redesign --- one horizontal band on the desk: the mode's picture, the challenge, its seed and streak, the play button
  return (
    <section className="border-b border-line bg-surface-1" aria-labelledby="daily-heading">
      <div
        className="site-container flex flex-col gap-5 py-6 md:flex-row md:items-center md:gap-8"
        data-testid="daily-card"
        data-daily-date={c?.date ?? ""}
        data-daily-mode={c?.mode ?? ""}
        data-daily-seed={c?.seed ?? ""}
      >
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-black">
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
            <div className="absolute inset-0 bg-surface-2" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow flex flex-wrap items-center gap-x-2 text-ink-3">
            <IconCalendar size={14} className="text-accent" />
            <span>{t("cardBadge")}</span>
            {c && <span className="num">#{c.number}</span>}
            {date && <span className="normal-case tracking-normal">· {date}</span>}
          </p>
          <h2 id="daily-heading" className="mt-1 text-xl font-bold text-ink">
            {c ? t("cardTitle", { mode: modes(`${c.mode}.name`) }) : t("cardLoading")}
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-ink-2">{t("cardText")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {c && <span className="num rounded-md border border-line bg-surface-2 px-2 py-1 text-ink-2">{t("cardSeed", { seed: c.seed })}</span>}
            {state && state.streak > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-warn/30 px-2 py-1 font-medium text-warn">
                <IconFlame size={14} />
                {t("streak", { days: state.streak })}
              </span>
            )}
            {state && state.todayMs !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 px-2 py-1 font-medium text-accent" data-testid="daily-played">
                <IconCheck size={14} />
                {t("cardPlayed", { seconds: formatRunSeconds(state.todayMs) })}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <Link href={`/simulator?${DAILY_PARAM}=1`} className={buttonClass({ variant: "secondary", size: "md" })} data-testid="daily-play">
            <IconPlay size={16} />
            {t("play")}
          </Link>
          {state && <span className="num text-xs text-ink-3">{t("nextIn", { time: countdown(state.nextMs) })}</span>}
        </div>
      </div>
    </section>
  );
}
