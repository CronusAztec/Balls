"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  SC_ENVELOPES,
  SC_PALETTES,
  SC_PRESET_IDS,
  SC_PRESET_LABELS,
  SC_VOICES,
  ballColorOf,
  cleanStars,
  parseStars,
  periodOf,
  randomStarSet,
  seededRandom,
  serializeStars,
  starChordsPresetPatch,
  starsForBalls,
  type ScEnvelope,
  type ScPalette,
  type ScPresetId,
  type ScVoice,
} from "@/lib/physics/starChords";
import { memoryCeiling } from "@/lib/uncap";

/*
 * --- chord-stars --- The Chord Stars controls (lib/physics/starChords.ts), in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): the presets, the balls, the stars (typed "n/k" pairs, a random coprime
 * set, the run's stars as coloured chips), the drawing time, the hold, the fade and the start points' spread, the line width,
 * the inner circles, the colours, the bounces' voice and the completion chord. Simulator.tsx hands the run to the engine
 * (restarting a Chord Stars run) and the look to the canvas; Find Simulation searches star sets and fits the loop to the clip.
 */

export interface StarChordsSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const STAR_CHORDS_KEYS = ["scStarPresets", "scBalls", "scStars", "scCycle", "scHold", "scFade", "scSpread", "scLineWidth", "scEnvelope", "scPalette", "scVoice", "scChord"];

const ENVELOPE_LABELS: Record<ScEnvelope, string> = { closed: "scEnvelopeClosed", on: "scEnvelopeOn", off: "scEnvelopeOff" };
const PALETTE_LABELS: Record<ScPalette, string> = { pastel: "scPalettePastel", rainbow: "scPaletteRainbow", ball: "scPaletteBall" };
const VOICE_LABELS: Record<ScVoice, string> = { pluck: "scVoicePluck", chime: "scVoiceChime", bar: "scVoiceBar", silent: "scVoiceSilent" };
/** The run's stars shown as chips at most (a bigger run says how many more). */
const CHIPS_MAX = 12;

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A seed for the random coprime set (the button is the page's, not the simulation's: any seed will do). */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) | 0;
}

export default function StarChordsSection({ t, search, matches, settings: s, update }: StarChordsSectionProps) {
  // the stars field while it is being typed in (null: it shows the settings' stars)
  const [draft, setDraft] = useState<string | null>(null);
  const balls = Math.max(1, memoryCeiling("scBalls", s.scBalls));
  const typed = parseStars(s.scStars);
  const shownCount = Math.min(balls, CHIPS_MAX);
  const run = starsForBalls(typed, shownCount);
  let chordsPerLoop = 0;
  // Σn of the whole run (the stars past the chips counted without building them all again when the run is huge)
  for (const star of balls <= CHIPS_MAX ? run : starsForBalls(typed, balls)) chordsPerLoop += star.n;
  const loopSec = periodOf(s.scCycle, s.scHold, s.scFade);
  const commitStars = () => {
    if (draft === null) return;
    update({ scStars: cleanStars(draft) });
    setDraft(null);
  };
  const applyPreset = (id: ScPresetId) => {
    setDraft(null);
    update(starChordsPresetPatch(id));
  };
  const randomize = () => {
    setDraft(null);
    update({ scStars: serializeStars(randomStarSet(balls, seededRandom(randomSeed()))) });
  };
  return (
    <div className="space-y-3 pt-2" data-testid="star-chords-section" data-sc-envelope={s.scEnvelope} data-sc-voice={s.scVoice}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("scStarDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="scStarPresets">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("scStarPresets")}
            <Tooltip text={t("scStarPresetsTip")} />
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {SC_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-sc-preset={id}>
                {t(SC_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="scBalls" tipKey="scBallsTip" value={s.scBalls} range={RANGES.scBalls} onChange={(v) => update({ scBalls: v })} display={String(s.scBalls)} />
      <Searchable search={search} matches={matches} labelKey="scStars">
        <div className="space-y-1.5">
          <label htmlFor="sc-stars" className="text-sm font-medium text-ink-2 flex items-center">
            {t("scStars")}
            <Tooltip text={t("scStarsTip")} />
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="sc-stars"
              type="text"
              value={draft ?? s.scStars.split(",").join(", ")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitStars}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitStars();
                else if (e.key === "Escape") setDraft(null);
              }}
              placeholder="5/2, 7/3, 8/3, 9/4, 12/5"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm font-mono"
              data-testid="sc-stars"
            />
            <button type="button" onClick={randomize} className={`${pick(false)} shrink-0 px-2.5`} title={t("scStarsRandomTip")} data-testid="sc-stars-random">
              {t("scStarsRandom")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1" aria-label={t("scStarsRun")} data-testid="sc-stars-run">
            {run.map((star, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-mono text-ink-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: ballColorOf(i, balls, s.scPalette, s.ballColor) }} aria-hidden="true" />
                {star.n}/{star.k}
              </span>
            ))}
            {balls > shownCount && <span className="px-1 text-[11px] text-ink-3">{t("scStarsMore", { count: balls - shownCount })}</span>}
          </div>
          {balls > typed.length && <p className="text-xs text-ink-3 leading-relaxed">{t("scStarsExtended", { typed: typed.length })}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="scCycle" tipKey="scCycleTip" value={s.scCycle} range={RANGES.scCycle} onChange={(v) => update({ scCycle: v })} display={`${s.scCycle}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="scHold" tipKey="scHoldTip" value={s.scHold} range={RANGES.scHold} onChange={(v) => update({ scHold: v })} display={`${s.scHold}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="scFade" tipKey="scFadeTip" value={s.scFade} range={RANGES.scFade} onChange={(v) => update({ scFade: v })} display={`${s.scFade}s`} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="sc-loop-note">
          {t("scLoopNote", { loop: loopSec.toFixed(1), chords: chordsPerLoop })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="scSpread" tipKey="scSpreadTip" value={s.scSpread} range={RANGES.scSpread} onChange={(v) => update({ scSpread: v })} display={`${Math.round(100 * s.scSpread)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="scLineWidth" tipKey="scLineWidthTip" value={s.scLineWidth} range={RANGES.scLineWidth} onChange={(v) => update({ scLineWidth: v })} display={`${s.scLineWidth}px`} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="scEnvelope" tipKey="scEnvelopeTip" values={SC_ENVELOPES} labels={ENVELOPE_LABELS} value={s.scEnvelope} onChange={(scEnvelope) => update({ scEnvelope })} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="scPalette" tipKey="scPaletteTip" values={SC_PALETTES} labels={PALETTE_LABELS} value={s.scPalette} onChange={(scPalette) => update({ scPalette })} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="scVoice" tipKey="scVoiceTip" values={SC_VOICES} labels={VOICE_LABELS} value={s.scVoice} onChange={(scVoice) => update({ scVoice })} />
      <Searchable search={search} matches={matches} labelKey="scChord">
        <Toggle t={t} labelKey="scChord" tipKey="scChordTip" value={s.scChord} onChange={(v) => update({ scChord: v })} />
      </Searchable>
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed). */
function ButtonRow<V extends string>({ t, search, matches, labelKey, tipKey, values, labels, value, onChange }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className={`grid gap-1 ${values.length > 3 ? "grid-cols-4" : "grid-cols-3"}`} role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-sc-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
      </div>
    </Searchable>
  );
}
