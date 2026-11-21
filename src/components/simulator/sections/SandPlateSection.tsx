"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { sandPlateCycleSec } from "@/lib/physics/modes/sandPlate";

export interface SandPlateSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const SAND_PLATE_KEYS = ["spNotes", "spNoteSec", "spGrains", "spShake", "spLoop"];

/**
 * "Sand Plate" controls (feature sand-plate), shown in the Mode row while Sand Plate is the mode (and in the Ball section
 * while the settings search is in use): the notes (one figure each), the seconds a note rings, the grains of sand, how hard
 * the plate shakes and the loop. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/sandPlate.ts) and restarts the run when one changes. The line under them says how long a run lasts.
 */
export default function SandPlateSection({ t, search, matches, settings: s, update }: SandPlateSectionProps) {
  const runSec = Math.round(10 * sandPlateCycleSec({ notes: s.spNotes, noteSec: s.spNoteSec })) / 10;
  return (
    <div className="space-y-3 pt-2" data-testid="sand-plate">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("spTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("spDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="spNotes" tipKey="spNotesTip" value={s.spNotes} range={RANGES.spNotes} onChange={(v) => update({ spNotes: v })} display={String(s.spNotes)} />
      <Slider t={t} search={search} matches={matches} labelKey="spNoteSec" tipKey="spNoteSecTip" value={s.spNoteSec} range={RANGES.spNoteSec} onChange={(v) => update({ spNoteSec: v })} display={`${s.spNoteSec.toFixed(1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="spGrains" tipKey="spGrainsTip" value={s.spGrains} range={RANGES.spGrains} onChange={(v) => update({ spGrains: v })} display={String(s.spGrains)} />
      <Slider t={t} search={search} matches={matches} labelKey="spShake" tipKey="spShakeTip" value={s.spShake} range={RANGES.spShake} onChange={(v) => update({ spShake: v })} display={`${s.spShake.toFixed(1)}×`} />
      <Searchable search={search} matches={matches} labelKey="spLoop">
        <Toggle t={t} labelKey="spLoop" tipKey="spLoopTip" value={s.spLoop} onChange={(v) => update({ spLoop: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="sand-plate-run">
          {t(s.spLoop ? "spRunLoop" : "spRunInfo", { seconds: runSec })}
        </p>
      )}
    </div>
  );
}
