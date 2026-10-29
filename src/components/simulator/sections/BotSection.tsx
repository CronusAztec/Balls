"use client";

import { useId, useState } from "react";
import { useMessages, useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, SliderTrack, offBtn, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives"; // --- unlimited-sizes --- (SliderTrack)
import { CLIP_CEILING } from "@/lib/uncap"; // --- unlimited-sizes --- (the wide track of a clip count ends at its ceiling)
import { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, recipeById, type BotFamily, type EndingChoice, type LengthBucket } from "@/lib/bot/playbook";
import type { ClipPlan } from "@/lib/bot/planner";
import { BOT_COUNT_RANGE, chosenTemplate, templateChoices } from "@/lib/bot/store";
import { reasonValues, type BotCopy } from "@/lib/bot/copy"; // --- insights --- (a countdown by its name, not its code)
import { TEMPLATE_FORMAT_IDS, TEMPLATE_FORMATS, clarityJudges, templateById, templateNameOf } from "@/lib/bot/templates"; // --- bot-templates ---
import type { ModeId } from "@/lib/physics/types";
import type { BotClarity, BotPanelProps } from "../useViralBot";
import { IconRestart, IconVideo } from "@/components/ui/icons"; // --- site-redesign ---
import NumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control
import WatermarkBadge from "@/components/billing/WatermarkBadge"; // --- free-watermark --- (was the paywall's lock: everyone renders, watermarked without Pro)

export type { BotPanelProps } from "../useViralBot";

/*
 * --- viral-bot --- The "Viral video bot" block at the end of the Recording section: platform, clip count, series, length
 * and ending; "Plan clips" (a fresh set with these filters) and "Today's plan" (the day's own plan of every series, the same
 * all day – --- bot-templates --- in the look the Simple switch picks: the CLI and the scheduled job plan the day's rotation in the
 * bot look, studio round 1, 5); the planned clips with their recipe, hook, mode, seed, length, ending and score, "why this
 * clip", Open in simulator, Re-roll and Copy caption; "Render all" through the batch renderer into a ZIP. The page side
 * is components/simulator/useViralBot.ts, the planner lib/bot/planner.ts.
 *
 * --- bot-templates --- Two more controls: the Template choice ("Plan clips" plans one ready template, lib/bot/templates.ts,
 * listed as "{Mode name} · {Format name}" and grouped by format, the series' own – the battle family's only under All series
 * and Battle, where the bot offers it; Auto keeps the daily rotation exactly) and the Simple switch (off by default here: the
 * Simple look for the clips of both buttons). "Why this clip" adds the clip's Simple score and the crew's clarity lines
 * (lib/bot/clarityLines.ts), checked when it is opened and kept in memory only – for a clip in the Simple look, whose rules they
 * are; a clip in the bot's own look gets one line that says so (studio round 1, 3: every one of them read Busy beside its ticks).
 */

/** Search keys of the block (added to SECTION_KEYS.recording in Controls.tsx; the label is in the Controls namespace). */
export const BOT_KEYS = ["viralBot"];

function modeLabel(t: Translate, mode: ModeId): string {
  const key = `mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return t.has(key) ? t(key) : mode;
}

const scoreTone = (score: number) => (score >= 90 ? "bg-accent text-accent-ink" : score >= 75 ? "bg-warn text-accent-ink" : "bg-danger text-ink");

// --- bot-templates --- the clarity lines of "Why this clip": the Simple score, then each gate (a failed one says why)
function ClarityLines({ lines, b }: { lines: BotClarity | null; b: Translate }) {
  const state = lines === null || lines === "checking" ? "checking" : lines === "failed" ? "failed" : "done";
  return (
    <div className="mt-1.5 border-t border-line-strong/30 pt-1.5" data-bot-clarity={state} data-bot-simple={typeof lines === "object" && lines ? lines.simple : undefined}>
      {/* (one status line: "Checking…", then the Simple score – what a screen reader hears when the check ends) */}
      <p role="status" className={`text-xs tabular-nums ${state === "done" ? "font-medium text-ink-2" : state === "failed" ? "text-warn" : "text-ink-3"}`}>
        {typeof lines === "object" && lines ? b("crew.simple", { score: lines.simple, band: b(`crew.bands.${lines.band}`) }) : b(state === "failed" ? "crew.failed" : "crew.checking")}
      </p>
      {typeof lines === "object" && lines && (
        <>
          <ul className="mt-1 space-y-0.5">
            {lines.gates.map((g) => {
              const why = !g.ok && b.has(`crew.problems.${g.key}`) ? b(`crew.problems.${g.key}`, g.values) : "";
              return (
                <li key={g.id} className="flex gap-1.5 text-xs leading-snug" data-bot-gate={g.id} data-bot-gate-ok={g.ok ? "1" : "0"}>
                  <span aria-hidden="true" className={g.ok ? "text-accent" : "text-danger"}>
                    {g.ok ? "✓" : "✕"}
                  </span>
                  <span className="sr-only">{b(g.ok ? "crew.ok" : "crew.notOk")}:</span>
                  <span className="flex-1 text-ink-2">
                    {why ? <span className="text-ink-3">{b(`crew.gates.${g.name}`)}:</span> : b(`crew.gates.${g.name}`)} {why && <span data-bot-gate-why="">{why}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
// --- end bot-templates ---

function ClipRow({ clip, t, b, bot, botCopy }: { clip: ClipPlan; t: Translate; b: Translate; bot: BotPanelProps; botCopy: BotCopy }) {
  const [copied, setCopied] = useState(false);
  const recipe = recipeById(clip.recipe);
  const template = templateById(clip.template); // --- bot-templates --- ("{Mode name} · {Format name}": its mode named already)
  const name = template ? templateNameOf(template, botCopy, modeLabel(t, template.mode)) : recipe ? b(`recipes.${recipe.copyKey}.name`) : clip.recipe;
  const busy = !!bot.planning || !!bot.rerolling || bot.render.status === "running";
  const judged = clarityJudges(clip); // --- bot-templates --- (studio round 1, 3: the clarity lines are the Simple look's)
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
    <li className="rounded-lg bg-surface-2/50 border border-line-strong/40 px-2.5 py-2 text-xs space-y-1.5" data-bot-clip={clip.id} data-bot-recipe={clip.recipe} data-bot-score={clip.score} data-bot-ending={clip.ending} data-bot-seed={clip.seed} data-bot-template={clip.template} data-bot-look={clip.look ?? "bot"}>
      <div className="flex items-start gap-2">
        <span className="text-ink-3 tabular-nums w-5 shrink-0">{clip.index}.</span>
        <div className="flex-1 min-w-0">
          {/* --- bot-templates --- (studio round 1, 6) a template's name wraps to a second line, never cut: at phone width a Mode Lab
              game's name ("Laboratorium trybów · Gra z laboratorium · Wyścig przez kołki") lost the game, the one part that differs */}
          <div className={`text-ink font-medium ${template ? "line-clamp-2 break-words" : "truncate"}`} title={name} data-bot-name="">
            {name} {!template && <span className="text-ink-3 font-normal">· {modeLabel(t, clip.mode)}</span>}
          </div>
          <div className="text-ink-2 italic truncate" title={clip.hook}>
            “{clip.hook}”
          </div>
        </div>
        <span className={`shrink-0 px-1.5 py-0.5 rounded-md font-bold tabular-nums ${scoreTone(clip.score)}`} title={b("score")} aria-label={`${b("score")} ${clip.score}`}>
          {clip.score}
        </span>
      </div>
      <div className="pl-7 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-2 tabular-nums">
        <span>{b("seed", { seed: clip.seed })}</span>
        <span>· {b("length", { sec: clip.timing.clipSec.toFixed(1) })}</span>
        <span>· {b(`endings.${clip.ending}`)}</span>
        <span>· {b(`payoffTypes.${clip.payoff.type}`)}</span>
        {clip.post.time && <span>· {clip.post.time}</span>}
      </div>
      {!clip.timing.found && <p className="pl-7 text-xs text-warn">{b("closest")}</p>}
      <details className="pl-7" onToggle={(e) => e.currentTarget.open && judged && bot.onClarity(clip.id) /* --- bot-templates --- */}>
        <summary className="cursor-pointer text-xs text-accent select-none">{b("why")}</summary>
        <ul className="mt-1 space-y-0.5">
          {clip.reasons.map((r) => (
            <li key={r.id} className="flex gap-1.5 text-xs leading-snug" data-bot-reason={r.id}>
              <span aria-hidden="true" className={r.points === r.max ? "text-accent" : r.points > 0 ? "text-warn" : "text-danger"}>
                {r.points === r.max ? "✓" : r.points > 0 ? "◐" : "✕"}
              </span>
              <span className="flex-1 text-ink-2">
                <span className="text-ink-3">{b(`checklist.${r.id}`)}:</span> {b(`reasons.${r.key}`, reasonValues(r.values, (path) => (b.has(path) ? b(path) : "")))}
              </span>
              <span className="text-ink-3 tabular-nums">
                {r.points}/{r.max}
              </span>
            </li>
          ))}
        </ul>
        {judged ? (
          <ClarityLines lines={bot.clarity(clip)} b={b} /* --- bot-templates --- */ />
        ) : (
          // --- bot-templates --- (studio round 1, 3) the bot's own look: one neutral line, no verdict of the Simple look's rules
          <p className="mt-1.5 border-t border-line-strong/30 pt-1.5 text-xs text-ink-3" data-bot-clarity="botLook">
            {b("crew.botLook")}
          </p>
        )}
      </details>
      <div className="pl-7 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => bot.onOpen(clip.id)} disabled={busy} className="px-2 py-1 rounded-md bg-surface-3 text-ink hover:bg-surface-3 disabled:opacity-40 cursor-pointer">
          ▶ {b("open")}
        </button>
        <button type="button" onClick={() => bot.onReroll(clip.id)} disabled={busy} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40 cursor-pointer">
          {bot.rerolling === clip.id ? "…" : <IconRestart size={14} />} {b("reroll")}
        </button>
        <button type="button" onClick={() => void copy()} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer">
          {copied ? b("copied") : `${b("copyCaption")}`}
        </button>
      </div>
    </li>
  );
}

export default function BotSection({ t, search, matches, bot }: { t: Translate; search: string; matches: Matcher; bot: BotPanelProps }) {
  const b = useTranslations("ViralBot");
  const botCopy = (useMessages() as Record<string, unknown>).ViralBot as BotCopy; // --- bot-templates --- (the templates' names, as the studio writes them)
  const simpleIds = { label: useId(), line: useId() }; // --- bot-templates ---
  const o = bot.options;
  const simple = o.look === "simple"; // --- bot-templates ---
  const plan = bot.plan;
  const rendering = bot.render.status === "running";
  const busy = !!bot.planning || !!bot.rerolling || rendering;
  const status = bot.planning ? "planning" : rendering ? "rendering" : bot.render.status === "done" ? "done" : plan ? "planned" : "idle";
  const canRender = !!plan && plan.clips.length > 0 && !busy && !bot.disabled && bot.supported !== false;

  return (
    <Searchable search={search} matches={matches} labelKey="viralBot">
      <div className="space-y-3 border-t border-line pt-3" data-bot={status} data-bot-clips={plan?.clips.length ?? 0} data-bot-rendered={bot.render.done} data-bot-watermarked={bot.render.watermarked /* --- bot-templates --- the last render's watermarked clips */}>
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t("viralBot")}
          <Tooltip text={t("viralBotTip")} />
        </span>
        <p className="text-xs text-ink-3 leading-snug">{b("intro")}</p>

        <div className="grid grid-cols-3 gap-2" role="group" aria-label={b("platform")}>
          {BOT_PLATFORMS.map((p) => (
            <button key={p} type="button" aria-pressed={o.platform === p} disabled={busy} onClick={() => bot.setOptions({ platform: p })} className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${o.platform === p ? onBtn : offBtn}`}>
              {b(`platforms.${p}`)}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-ink-2 flex items-center justify-between" htmlFor="bot-count">
            <span>{b("count")}</span>
            <span className="text-ink-3 tabular-nums">{o.count}</span>
          </label>
          <SliderTrack id="bot-count" settingKey="botCount" label={b("count")} value={o.count} range={BOT_COUNT_RANGE} onChange={(v) => bot.setOptions({ count: v })} disabled={busy} top={CLIP_CEILING} /* --- unlimited-sizes --- (a plan renders at most its clips' ceiling: the wide track ends there) */ />
          <NumberField value={o.count} onCommit={(v) => bot.setOptions({ count: v })} label={b("count")} range={BOT_COUNT_RANGE} rules={{ min: BOT_COUNT_RANGE.min, integer: true }} disabled={busy} settingKey="botCount" /* --- uncap-all --- */ />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor="bot-family">
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
          <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor="bot-bucket">
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
          <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor="bot-ending">
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

        {/* --- bot-templates --- the Template choice (its series' ready templates, by format) and the Simple switch */}
        <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor="bot-template">
          {b("template")}
          <select id="bot-template" value={chosenTemplate(o) ?? "auto"} disabled={busy} onChange={(e) => bot.setOptions({ template: e.target.value === "auto" ? undefined : e.target.value })} className={`${selectClass} text-xs px-2 w-full min-w-0`}>
            <option value="auto">{b("templateAuto")}</option>
            {TEMPLATE_FORMAT_IDS.map((f) => {
              const list = templateChoices(o.family).filter((x) => x.format.id === f);
              return list.length === 0 ? null : (
                <optgroup key={f} label={b(`formats.${TEMPLATE_FORMATS[f].copyKey}.name`)}>
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {templateNameOf(x, botCopy, modeLabel(t, x.mode))}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-xs leading-snug">
            <span id={simpleIds.label} className="block text-ink-2">
              {b("simpleLook")}
            </span>
            <span id={simpleIds.line} className="block text-ink-3">
              {b("looks.simple.line")}
            </span>
          </span>
          {/* the panel's switch (ControlPrimitives' Toggle): a track and a knob in a button the panel's hit targets size, ON / OFF beside */}
          <button
            type="button"
            role="switch"
            aria-checked={simple}
            aria-labelledby={simpleIds.label}
            aria-describedby={simpleIds.line}
            disabled={busy}
            onClick={() => bot.setOptions({ look: simple ? undefined : "simple" })}
            // Space toggles a focused switch (the page's own Space, pause and resume, waits on the window for any other key)
            onKeyDown={(e) => {
              if (e.key === " ") e.stopPropagation();
            }}
            data-bot-simple-switch=""
            className="group/sw inline-flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
          >
            <span aria-hidden="true" className={`num text-xs tracking-[0.08em] ${simple ? "text-ink" : "text-ink-3"}`}>
              {t(simple ? "onText" : "offText")}
            </span>
            <span aria-hidden="true" className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150 ${simple ? onBtn : "bg-surface-3 group-hover/sw:bg-[rgb(242_242_237/0.16)]"}`}>
              <span className={`absolute left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform duration-150 ${simple ? "translate-x-4 bg-accent-ink" : "bg-ink-2"}`} />
            </span>
          </button>
        </div>
        {/* --- end bot-templates --- */}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={bot.onPlan} disabled={busy} className="px-3 py-2.5 rounded-xl font-bold text-sm cursor-pointer bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed">
            {b("planClips")}
          </button>
          <button type="button" onClick={bot.onToday} disabled={busy} className="px-3 py-2.5 rounded-xl font-bold text-sm cursor-pointer border border-accent/60 text-accent bg-surface-1/40 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed">
            {b("today")}
          </button>
        </div>

        {bot.planning && (
          <div className="flex items-center justify-between gap-2 text-xs text-ink-2" role="status">
            <span className="tabular-nums">{b("planning", { current: bot.planning.current, total: bot.planning.total, seeds: bot.planning.seeds })}</span>
            <button type="button" onClick={bot.onCancel} className="px-2.5 py-1 rounded-md bg-surface-3 text-ink hover:bg-surface-3 cursor-pointer">
              {b("cancel")}
            </button>
          </div>
        )}

        {!plan && !bot.planning && <p className="text-xs text-ink-3 leading-snug">{b("empty")}</p>}

        {plan && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
              <span>{b("planFor", { count: plan.clips.length, date: plan.date, platform: b(`platforms.${plan.platform}`) })}</span>
              <button type="button" onClick={bot.onClear} disabled={busy} className="px-2 py-0.5 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40 cursor-pointer">
                {b("clear")}
              </button>
            </div>
            {bot.worldChanged && <p className="text-xs text-warn leading-snug">{b("worldChanged")}</p>}
            <ol className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1 custom-scrollbar" aria-label={b("title")}>
              {plan.clips.map((clip) => (
                <ClipRow key={clip.id} clip={clip} t={t} b={b} bot={bot} botCopy={botCopy} />
              ))}
            </ol>
            <p className="text-xs text-ink-3 leading-snug">{b("notes")}</p>
            <button type="button" onClick={bot.onRenderAll} disabled={!canRender} className="w-full px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-accent/60 text-accent bg-surface-1/40 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed">
              <IconVideo size={16} /> {b("renderAll")}
              <WatermarkBadge /* --- free-watermark --- */ />
            </button>
            {rendering && (
              <div className="space-y-1.5" role="status">
                <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
                  <span className="tabular-nums">{b("rendering", { current: bot.renderCurrent, total: bot.render.total })}</span>
                  <button type="button" onClick={bot.onStop} className="px-2.5 py-1 rounded-md bg-surface-3 text-ink hover:bg-surface-3 text-xs cursor-pointer">
                    {b("stop")}
                  </button>
                </div>
                {bot.renderProgress !== null && (
                  <div className="h-1.5 rounded-full bg-surface-1 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * bot.renderProgress)}>
                    <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(100 * bot.renderProgress)}%` }} />
                  </div>
                )}
              </div>
            )}
            {bot.render.status === "done" && <p className="text-xs text-accent leading-snug">{b("renderDone", { done: bot.render.done, total: bot.render.total })}</p>}
            {bot.render.status === "failed" && <p className="text-xs text-danger leading-snug">{b("renderFailed")}</p>}
            {bot.supported === false && <p className="text-xs text-warn leading-snug">{b("unsupported")}</p>}
            {bot.disabled && !busy && <p className="text-xs text-ink-3 leading-snug" data-testid={bot.splitRace ? "bot-split-race" : undefined}>{b(bot.splitRace ? "splitRace" : "busy")}</p>}{/* --- split-screen --- */}
          </div>
        )}
      </div>
    </Searchable>
  );
}
