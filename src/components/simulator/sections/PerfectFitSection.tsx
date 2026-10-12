"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { inputClass } from "@/components/ui/Field";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { PF_LIST_MAX, PF_PRESET_IDS, PF_PRESET_LABELS, PF_VARIANTS, parseBoxes, parseSections, perfectFitPresetPatch, perfectFitTetrisPieces, perfectFitVariantPatch, type PfPresetId, type PfVariant } from "@/lib/physics/perfectFit";
import { pentominoWays } from "@/lib/simulation/polyominoPlan";

/*
 * --- perfect-fit --- The Perfect Fit controls (lib/physics/perfectFit.ts), in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): the presets (Three rectangles, Every piece fits, Speed run, Big well), the
 * variant (pentomino rectangles or Tetris perfect clears), the seconds a piece takes, the fall's feel, landing on the beat and
 * the solution seed; the rectangles' boxes; the perfect clears' sections, well and held finale. The labels live in the
 * `PerfectFit` namespace (the search and the command palette read them there too: Controls.tsx). Simulator.tsx hands the
 * settings to the engine and re-plans the run when one of them changes.
 */

export interface PerfectFitSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const PERFECT_FIT_KEYS = ["pfPreset", "pfVariant", "pfPieceSec", "pfFall", "pfBeat", "pfSeed", "pfBoxes", "pfSections", "pfWellW", "pfWellH", "pfHold"];

const VARIANT_LABELS: Record<PfVariant, string> = { pento: "variantPento", tetris: "variantTetris" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

/** The section's translator: a key of the `PerfectFit` namespace, else the Controls namespace's (the primitives' shared words). */
function usePerfectFitTranslator(t: Translate): Translate {
  const pf = useTranslations("PerfectFit");
  return useMemo(() => {
    const own = (key: string) => pf.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? pf(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? pf.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? pf.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? pf.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [pf, t]);
}

export default function PerfectFitSection({ t: controls, search, matches, settings: s, update }: PerfectFitSectionProps) {
  const t = usePerfectFitTranslator(controls);
  const tetris = s.pfVariant === "tetris";
  const boxes = parseBoxes(s.pfBoxes);
  const fits = boxes.filter((b) => b.w * b.h === 60).length;
  const sections = parseSections(s.pfSections);
  const lines = sections.reduce((n, l) => n + l, 0);
  const pieces = perfectFitTetrisPieces(s);
  const applyPreset = (id: PfPresetId) => update(perfectFitPresetPatch(id));
  return (
    <div className="space-y-3 pt-2" data-testid="perfect-fit-section" data-pf-variant={s.pfVariant} data-pf-boxes={String(boxes.length)} data-pf-fits={String(fits)} data-pf-lines={String(lines)} data-pf-pieces={String(tetris ? pieces : 12 * fits)}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("desc")}</p>}
      <Searchable search={search} matches={matches} labelKey="pfPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("pfPreset")}
            <Tooltip text={t("pfPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="pf-presets">
            {PF_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-pf-preset={id}>
                {t(PF_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="pfVariant">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("pfVariant")}
            <Tooltip text={t("pfVariantTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("pfVariant")}>
            {PF_VARIANTS.map((v) => (
              <button type="button" key={v} onClick={() => update(perfectFitVariantPatch(s, v))} aria-pressed={s.pfVariant === v} className={pick(s.pfVariant === v)} data-pf-option={`pfVariant:${v}`}>
                {t(VARIANT_LABELS[v])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="pfPieceSec" tipKey="pfPieceSecTip" value={s.pfPieceSec} range={RANGES.pfPieceSec} onChange={(v) => update({ pfPieceSec: v })} display={`${short(s.pfPieceSec, 2)} s`} />
      {(!tetris || !!search) && <Slider t={t} search={search} matches={matches} labelKey="pfFall" tipKey="pfFallTip" value={s.pfFall} range={RANGES.pfFall} onChange={(v) => update({ pfFall: v })} display={short(s.pfFall, 1)} />}
      <Searchable search={search} matches={matches} labelKey="pfBeat">
        <Toggle t={t} labelKey="pfBeat" tipKey="pfBeatTip" value={s.pfBeat} onChange={(v) => update({ pfBeat: v })} />
        {s.pfBeat && !search && (
          <p className="text-xs text-ink-3 leading-relaxed" data-testid="pf-beat-note">
            {t("beatNote", { bpm: short(s.bpm, 1) })}
          </p>
        )}
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="pfSeed" tipKey="pfSeedTip" value={s.pfSeed} range={RANGES.pfSeed} onChange={(v) => update({ pfSeed: v })} display={s.pfSeed > 0 ? String(s.pfSeed) : t("seedAuto")} />
      {(!tetris || !!search) && (
        <Searchable search={search} matches={matches} labelKey="pfBoxes">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink-2 flex items-center">
              {t("pfBoxes")}
              <Tooltip text={t("pfBoxesTip")} />
            </span>
            <input type="text" value={s.pfBoxes} maxLength={PF_LIST_MAX} onChange={(e) => update({ pfBoxes: e.target.value })} placeholder="10×6, 12×5, 15×4" className={`${inputClass} text-sm`} aria-label={t("pfBoxes")} data-testid="pf-boxes" spellCheck={false} />
          </label>
          {!search && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-3" data-testid="pf-box-notes">
              {boxes.map((b, i) => {
                const ways = pentominoWays(b.w, b.h);
                // the 12 pieces fill 60 cells: 6 × 10, 5 × 12 and 4 × 15 can be built by dropping, 3 × 20's two tilings cannot, 2 × 30 and 1 × 60 have none
                const key = b.w * b.h !== 60 ? "boxNoteSize" : Math.min(b.w, b.h) <= 2 ? "boxNoteNone" : Math.min(b.w, b.h) === 3 ? "boxNoteNoDrop" : ways !== null ? "boxNoteWays" : "boxNoteOther";
                return (
                  <li key={`${b.w}x${b.h}:${i}`} data-pf-box-note={key}>
                    {t(key, { w: b.w, h: b.h, area: b.w * b.h, ways: ways ?? 0 })}
                  </li>
                );
              })}
            </ul>
          )}
        </Searchable>
      )}
      {(tetris || !!search) && (
        <>
          <Searchable search={search} matches={matches} labelKey="pfSections">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink-2 flex items-center">
                {t("pfSections")}
                <Tooltip text={t("pfSectionsTip")} />
              </span>
              <input type="text" value={s.pfSections} maxLength={PF_LIST_MAX} onChange={(e) => update({ pfSections: e.target.value })} placeholder="4,4,4,4,12" className={`${inputClass} text-sm`} aria-label={t("pfSections")} data-testid="pf-sections" spellCheck={false} />
            </label>
            {!search && (
              <p className="mt-1.5 text-xs text-ink-3 leading-relaxed" data-testid="pf-sections-note">
                {t("sectionsNote", { lines, pieces })}
              </p>
            )}
          </Searchable>
          <Slider t={t} search={search} matches={matches} labelKey="pfWellW" tipKey="pfWellWTip" value={s.pfWellW} range={RANGES.pfWellW} onChange={(v) => update({ pfWellW: v })} display={String(s.pfWellW)} />
          <Slider t={t} search={search} matches={matches} labelKey="pfWellH" tipKey="pfWellHTip" value={s.pfWellH} range={RANGES.pfWellH} onChange={(v) => update({ pfWellH: v })} display={String(s.pfWellH)} />
          <Searchable search={search} matches={matches} labelKey="pfHold">
            <Toggle t={t} labelKey="pfHold" tipKey="pfHoldTip" value={s.pfHold} onChange={(v) => update({ pfHold: v })} />
          </Searchable>
        </>
      )}
    </div>
  );
}
