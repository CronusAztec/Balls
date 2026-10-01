"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, offBtn, onBtn, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, recipeById, type BotFamily, type EndingChoice, type LengthBucket } from "@/lib/bot/playbook";
import type { ClipPlan } from "@/lib/bot/planner";
import { BOT_COUNT_RANGE } from "@/lib/bot/store";
import type { ModeId } from "@/lib/physics/types";
import type { BotPanelProps } from "../useViralBot";
import NumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control

export type { BotPanelProps } from "../useViralBot";

/*
 * --- viral-bot --- The "Viral video bot" block at the end of the Recording section: platform, clip count, series, length
 * and ending; "Plan clips" (a fresh set with these filters) and "Today's plan" (the day's own plan – the one the CLI and
 * the scheduled job make); the planned clips with their recipe, hook, mode, seed, length, ending and score, "why this
 * clip", Open in simulator, Re-roll and Copy caption; "Render all" through the batch renderer into a ZIP. The page side
 * is components/simulator/useViralBot.ts, the planner lib/bot/planner.ts.
 */

/** Search keys of the block (added to SECTION_KEYS.recording in Controls.tsx; the label is in the Controls namespace). */
export const BOT_KEYS = ["viralBot"];

function modeLabel(t: Translate, mode: ModeId): string {
  const key = `mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return t.has(key) ? t(key) : mode;
}

const scoreTone = (score: number) => (score >= 90 ? "bg-[#93d119] text-slate-950" : score >= 75 ? "bg-amber-400 text-slate-950" : "bg-red-500 text-white");

function ClipRow({ clip, t, b, bot }: { clip: ClipPlan; t: Translate; b: Translate; bot: BotPanelProps }) {
  const [copied, setCopied] = useState(false);
  const recipe = recipeById(clip.recipe);
  const name = recipe ? b(`recipes.${recipe.copyKey}.name`) : clip.recipe;
  const busy = !!bot.planning || !!bot.rerolling || bot.render.status === "running";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(clip.post.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <li className="rounded-lg bg-zinc-800/50 border border-zinc-700/40 px-2.5 py-2 text-xs space-y-1.5" data-bot-clip={clip.id} data-bot-recipe={clip.recipe} data-bot-score={clip.score} data-bot-ending={clip.ending} data-bot-seed={clip.seed}>
      <div className="flex items-start gap-2">
        <span className="text-zinc-500 tabular-nums w-5 shrink-0">{clip.index}.</span>
        <div className="flex-1 min-w-0">
          <div className="text-zinc-100 font-medium truncate">
            {name} <span className="text-zinc-500 font-normal">· {modeLabel(t, clip.mode)}</span>
          </div>
          <div className="text-zinc-300 italic truncate" title={clip.hook}>
            “{clip.hook}”
          </div>
        </div>
        <span className={`shrink-0 px-1.5 py-0.5 rounded-md font-bold tabular-nums ${scoreTone(clip.score)}`} title={b("score")} aria-label={`${b("score")} ${clip.score}`}>
          {clip.score}
        </span>
      </div>
      <div className="pl-7 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
        <span>{b("seed", { seed: clip.seed })}</span>
        <span>· {b("length", { sec: clip.timing.clipSec.toFixed(1) })}</span>
        <span>· {b(`endings.${clip.ending}`)}</span>
        <span>· {b(`payoffTypes.${clip.payoff.type}`)}</span>
        {clip.post.time && <span>· {clip.post.time}</span>}
      </div>
      {!clip.timing.found && <p className="pl-7 text-[11px] text-amber-300">{b("closest")}</p>}
      <details className="pl-7">
        <summary className="cursor-pointer text-[11px] text-[#93d119] select-none">{b("why")}</summary>
        <ul className="mt-1 space-y-0.5">
          {clip.reasons.map((r) => (
            <li key={r.id} className="flex gap-1.5 text-[11px] leading-snug">
              <span aria-hidden="true" className={r.points === r.max ? "text-[#93d119]" : r.points > 0 ? "text-amber-300" : "text-red-400"}>
                {r.points === r.max ? "✓" : r.points > 0 ? "◐" : "✕"}
              </span>
              <span className="flex-1 text-zinc-300">
                <span className="text-zinc-500">{b(`checklist.${r.id}`)}:</span> {b(`reasons.${r.key}`, r.values)}
              </span>
              <span className="text-zinc-500 tabular-nums">
                {r.points}/{r.max}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <div className="pl-7 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => bot.onOpen(clip.id)} disabled={busy} className="px-2 py-1 rounded-md bg-zinc-700 text-zinc-100 hover:bg-zinc-600 disabled:opacity-40 cursor-pointer">
          ▶ {b("open")}
        </button>
        <button type="button" onClick={() => bot.onReroll(clip.id)} disabled={busy} className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 cursor-pointer">
          {bot.rerolling === clip.id ? "…" : "🎲"} {b("reroll")}
        </button>
        <button type="button" onClick={() => void copy()} className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer">
          {copied ? b("copied") : `📋 ${b("copyCaption")}`}
        </button>
      </div>
    </li>
  );
}

export default function BotSection({ t, search, matches, bot }: { t: Translate; search: string; matches: Matcher; bot: BotPanelProps }) {
  const b = useTranslations("ViralBot");
  const o = bot.options;
  const plan = bot.plan;
  const rendering = bot.render.status === "running";
  const busy = !!bot.planning || !!bot.rerolling || rendering;
  const status = bot.planning ? "planning" : rendering ? "rendering" : bot.render.status === "done" ? "done" : plan ? "planned" : "idle";
  const canRender = !!plan && plan.clips.length > 0 && !busy && !bot.disabled && bot.supported !== false;

  return (
    <Searchable search={search} matches={matches} labelKey="viralBot">
      <div className="space-y-3 border-t border-zinc-800 pt-3" data-bot={status} data-bot-clips={plan?.clips.length ?? 0} data-bot-rendered={bot.render.done}>
        <span className="text-sm font-medium text-zinc-300 flex items-center">
          <span aria-hidden="true" className="mr-1.5">
            🤖
          </span>
          {t("viralBot")}
          <Tooltip text={t("viralBotTip")} />
        </span>
        <p className="text-[11px] text-zinc-500 leading-snug">{b("intro")}</p>

        <div className="grid grid-cols-3 gap-2" role="group" aria-label={b("platform")}>
          {BOT_PLATFORMS.map((p) => (
            <button key={p} type="button" aria-pressed={o.platform === p} disabled={busy} onClick={() => bot.setOptions({ platform: p })} className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${o.platform === p ? onBtn : offBtn}`}>
              {b(`platforms.${p}`)}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400 flex items-center justify-between" htmlFor="bot-count">
            <span>{b("count")}</span>
            <span className="text-zinc-500 tabular-nums">{o.count}</span>
          </label>
          <input
            id="bot-count"
            type="range"
            min={BOT_COUNT_RANGE.min}
            max={BOT_COUNT_RANGE.max}
            step={BOT_COUNT_RANGE.step}
            value={o.count}
            disabled={busy}
            onChange={(e) => bot.setOptions({ count: Number(e.target.value) })}
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
            style={sliderStyle(o.count, BOT_COUNT_RANGE.min, BOT_COUNT_RANGE.max)}
            aria-label={b("count")}
          />
          <NumberField value={o.count} onCommit={(v) => bot.setOptions({ count: v })} label={b("count")} range={BOT_COUNT_RANGE} rules={{ min: BOT_COUNT_RANGE.min, integer: true }} disabled={busy} settingKey="botCount" /* --- uncap-all --- */ />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-zinc-400" htmlFor="bot-family">
            {b("family")}
            <select id="bot-family" value={o.family} disabled={busy} onChange={(e) => bot.setOptions({ family: e.target.value as BotFamily | "all" })} className={`${selectClass} text-xs px-2`}>
              <option value="all">{b("familyAll")}</option>
              {BOT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {b(`families.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-zinc-400" htmlFor="bot-bucket">
            {b("bucket")}
            <select id="bot-bucket" value={o.bucket} disabled={busy} onChange={(e) => bot.setOptions({ bucket: e.target.value as LengthBucket | "auto" })} className={`${selectClass} text-xs px-2`}>
              <option value="auto">{b("buckets.auto")}</option>
              {LENGTH_BUCKETS.map((k) => (
                <option key={k} value={k}>
                  {b(`buckets.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-zinc-400" htmlFor="bot-ending">
            {b("ending")}
            <select id="bot-ending" value={o.ending} disabled={busy} onChange={(e) => bot.setOptions({ ending: e.target.value as EndingChoice })} className={`${selectClass} text-xs px-2`}>
              {ENDING_CHOICES.map((k) => (
                <option key={k} value={k}>
                  {b(`endings.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={bot.onPlan} disabled={busy} className="px-3 py-2.5 rounded-xl font-bold text-sm cursor-pointer bg-[#93d119] text-slate-950 hover:bg-[#a4e02a] disabled:opacity-40 disabled:cursor-not-allowed">
            🧠 {b("planClips")}
          </button>
          <button type="button" onClick={bot.onToday} disabled={busy} className="px-3 py-2.5 rounded-xl font-bold text-sm cursor-pointer border border-[#93d119]/60 text-[#93d119] bg-zinc-900/40 hover:bg-[#93d119]/10 disabled:opacity-40 disabled:cursor-not-allowed">
            📅 {b("today")}
          </button>
        </div>

        {bot.planning && (
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-300" role="status">
            <span className="tabular-nums">{b("planning", { current: bot.planning.current, total: bot.planning.total, seeds: bot.planning.seeds })}</span>
            <button type="button" onClick={bot.onCancel} className="px-2.5 py-1 rounded-md bg-zinc-700 text-zinc-200 hover:bg-zinc-600 cursor-pointer">
              {b("cancel")}
            </button>
          </div>
        )}

        {!plan && !bot.planning && <p className="text-[11px] text-zinc-500 leading-snug">{b("empty")}</p>}

        {plan && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
              <span>{b("planFor", { count: plan.clips.length, date: plan.date, platform: b(`platforms.${plan.platform}`) })}</span>
              <button type="button" onClick={bot.onClear} disabled={busy} className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 cursor-pointer">
                {b("clear")}
              </button>
            </div>
            {bot.worldChanged && <p className="text-[11px] text-amber-300 leading-snug">{b("worldChanged")}</p>}
            <ol className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1 custom-scrollbar" aria-label={b("title")}>
              {plan.clips.map((clip) => (
                <ClipRow key={clip.id} clip={clip} t={t} b={b} bot={bot} />
              ))}
            </ol>
            <p className="text-[11px] text-zinc-500 leading-snug">{b("notes")}</p>
            <button type="button" onClick={bot.onRenderAll} disabled={!canRender} className="w-full px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-[#93d119]/60 text-[#93d119] bg-zinc-900/40 hover:bg-[#93d119]/10 disabled:opacity-40 disabled:cursor-not-allowed">
              <span aria-hidden="true">🎬</span> {b("renderAll")}
            </button>
            {rendering && (
              <div className="space-y-1.5" role="status">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                  <span className="tabular-nums">{b("rendering", { current: bot.renderCurrent, total: bot.render.total })}</span>
                  <button type="button" onClick={bot.onStop} className="px-2.5 py-1 rounded-md bg-zinc-700 text-zinc-200 hover:bg-zinc-600 text-xs cursor-pointer">
                    {b("stop")}
                  </button>
                </div>
                {bot.renderProgress !== null && (
                  <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * bot.renderProgress)}>
                    <div className="h-full rounded-full bg-[#93d119] transition-[width] duration-150" style={{ width: `${Math.round(100 * bot.renderProgress)}%` }} />
                  </div>
                )}
              </div>
            )}
            {bot.render.status === "done" && <p className="text-[11px] text-[#93d119] leading-snug">{b("renderDone", { done: bot.render.done, total: bot.render.total })}</p>}
            {bot.render.status === "failed" && <p className="text-[11px] text-red-400 leading-snug">{b("renderFailed")}</p>}
            {bot.supported === false && <p className="text-[11px] text-amber-300 leading-snug">{b("unsupported")}</p>}
            {bot.disabled && !busy && <p className="text-[11px] text-zinc-500 leading-snug" data-testid={bot.splitRace ? "bot-split-race" : undefined}>{b(bot.splitRace ? "splitRace" : "busy")}</p>}{/* --- split-screen --- */}
          </div>
        )}
      </div>
    </Searchable>
  );
}
