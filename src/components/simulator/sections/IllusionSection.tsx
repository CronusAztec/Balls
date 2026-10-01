"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { ILLUSION_PATTERN_CHOICES, ILLUSION_TYPES, illusionCycleSeconds, illusionSettingsOf, type IllusionPatternChoice, type IllusionType } from "@/lib/physics/modes/illusion";

export interface IllusionSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const ILLUSION_KEYS = ["ilType", "ilBalls", "ilRings", "ilDepth", "ilPainters", "ilPattern", "ilSpeed", "ilTracks", "ilReveal", "ilCycles"];

const TYPE_OPTIONS: Record<IllusionType, { labelKey: string; hintKey: string }> = {
  lines: { labelKey: "ilTypeLines", hintKey: "ilHintLines" },
  rings: { labelKey: "ilTypeRings", hintKey: "ilHintRings" },
  nested: { labelKey: "ilTypeNested", hintKey: "ilHintNested" },
  whitespace: { labelKey: "ilTypeWhitespace", hintKey: "ilHintWhitespace" },
};

const PATTERN_LABELS: Record<IllusionPatternChoice, string> = {
  auto: "ilPatternAuto",
  heart: "ilPatternHeart",
  star: "ilPatternStar",
  smile: "ilPatternSmile",
  moon: "ilPatternMoon",
  note: "ilPatternNote",
  diamond: "ilPatternDiamond",
  flower: "ilPatternFlower",
  cross: "ilPatternCross",
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** Seconds for the readout: whole seconds as they are, otherwise one decimal. */
function formatSeconds(sec: number) {
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

/**
 * "Circle Illusion" controls (feature jdm-illusions), shown in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): the type – lines (the rolling-circle illusion), rings, nested circles or
 * the white-spaces picture – with its own count, the picture of the whitespace type, the speed, the tracks and the
 * reveal, and the cycles after which lines and rings finish. The values live in SimulatorSettings; Simulator.tsx
 * forwards them to the engine (see lib/physics/modes/illusion.ts) and restarts the run when one changes (the tracks and
 * the reveal follow live).
 */
export default function IllusionSection({ t, search, matches, settings: s, update }: IllusionSectionProps) {
  const all = !!search;
  const type = s.ilType;
  const cycleSec = illusionCycleSeconds(illusionSettingsOf(s));
  const hasCycles = type === "lines" || type === "rings";
  return (
    <div className="space-y-3 pt-2" data-testid="illusion-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("ilDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="ilType">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("ilType")}
            <Tooltip text={t("ilTypeTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("ilType")}>
            {ILLUSION_TYPES.map((id) => (
              <button type="button" key={id} onClick={() => update({ ilType: id })} aria-pressed={type === id} className={pick(type === id)}>
                {t(TYPE_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && <p className="text-xs text-ink-3 leading-relaxed" data-testid="illusion-hint">{t(TYPE_OPTIONS[type].hintKey)}</p>}
        </div>
      </Searchable>
      {(type === "lines" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="ilBalls" tipKey="ilBallsTip" value={s.ilBalls} range={RANGES.ilBalls} onChange={(v) => update({ ilBalls: v })} display={String(s.ilBalls)} />
      )}
      {(type === "rings" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="ilRings" tipKey="ilRingsTip" value={s.ilRings} range={RANGES.ilRings} onChange={(v) => update({ ilRings: v })} display={String(s.ilRings)} />
      )}
      {(type === "nested" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="ilDepth" tipKey="ilDepthTip" value={s.ilDepth} range={RANGES.ilDepth} onChange={(v) => update({ ilDepth: v })} display={String(s.ilDepth)} />
      )}
      {(type === "whitespace" || all) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="ilPainters" tipKey="ilPaintersTip" value={s.ilPainters} range={RANGES.ilPainters} onChange={(v) => update({ ilPainters: v })} display={String(s.ilPainters)} />
          <Searchable search={search} matches={matches} labelKey="ilPattern">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2" htmlFor="illusion-pattern-select">
                {t("ilPattern")}
                <Tooltip text={t("ilPatternTip")} />
              </label>
              <select id="illusion-pattern-select" value={s.ilPattern} onChange={(e) => update({ ilPattern: e.target.value as IllusionPatternChoice })} className={selectClass}>
                {ILLUSION_PATTERN_CHOICES.map((id) => (
                  <option key={id} value={id}>
                    {t(PATTERN_LABELS[id])}
                  </option>
                ))}
              </select>
            </div>
          </Searchable>
        </>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="ilSpeed" tipKey="ilSpeedTip" value={s.ilSpeed} range={RANGES.ilSpeed} onChange={(v) => update({ ilSpeed: v })} display={`${s.ilSpeed.toFixed(2)}×`} />
      {(type === "lines" || type === "rings" || all) && (
        <>
          <Searchable search={search} matches={matches} labelKey="ilTracks">
            <Toggle t={t} labelKey="ilTracks" tipKey="ilTracksTip" value={s.ilTracks} onChange={(v) => update({ ilTracks: v })} />
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="ilReveal">
            <Toggle t={t} labelKey="ilReveal" tipKey="ilRevealTip" value={s.ilReveal} onChange={(v) => update({ ilReveal: v })} />
          </Searchable>
        </>
      )}
      {(hasCycles || all) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="ilCycles" tipKey="ilCyclesTip" value={s.ilCycles} range={RANGES.ilCycles} onChange={(v) => update({ ilCycles: v })} display={s.ilCycles === 0 ? t("ilCyclesNever") : String(s.ilCycles)} />
          {!search && hasCycles && (
            <p className="text-xs text-ink-2 tabular-nums" data-testid="illusion-cycle">
              {t("ilCycleInfo", { seconds: formatSeconds(Math.round(10 * cycleSec) / 10) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
