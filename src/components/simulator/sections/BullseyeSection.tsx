"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { bullseyeNominalRunSec, bullseyeSettingsOf, perfectShotIndex } from "@/lib/physics/modes/bullseye";

export interface BullseyeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BULLSEYE_KEYS = ["byShots", "byInterval", "byChaos", "byRings", "byTargetMoving", "byPerfect"];

/**
 * "Bullseye" controls (feature boris-bullseye), shown in the Mode row while Bullseye is the mode (and in the Ball section
 * while the settings search is in use): the shots and how far apart they leave, the chaos of the peg field, the target's
 * rings, the moving target, the rigged perfect shot and a line that sums the run up for Find Simulation. The values live
 * in SimulatorSettings; Simulator.tsx forwards them to the engine (see lib/physics/modes/bullseye.ts) and restarts the run
 * when one changes (the Sound section's scale and root follow live).
 */
export default function BullseyeSection({ t, search, matches, settings: s, update }: BullseyeSectionProps) {
  const by = bullseyeSettingsOf(s);
  const perfect = perfectShotIndex(by);
  return (
    <div className="space-y-3 pt-2" data-testid="bullseye">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t("byTitle")}</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("byDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="byShots" tipKey="byShotsTip" value={s.byShots} range={RANGES.byShots} onChange={(v) => update({ byShots: v })} display={String(s.byShots)} left="⚪" right="🎯" />
      <Slider t={t} search={search} matches={matches} labelKey="byInterval" tipKey="byIntervalTip" value={s.byInterval} range={RANGES.byInterval} onChange={(v) => update({ byInterval: v })} display={`${s.byInterval.toFixed(1)}s`} left="⚡" right="⏳" />
      <Slider t={t} search={search} matches={matches} labelKey="byChaos" tipKey="byChaosTip" value={s.byChaos} range={RANGES.byChaos} onChange={(v) => update({ byChaos: v })} display={`${Math.round(100 * s.byChaos)}%`} left="🎯" right="🌪️" />
      <Slider t={t} search={search} matches={matches} labelKey="byRings" tipKey="byRingsTip" value={s.byRings} range={RANGES.byRings} onChange={(v) => update({ byRings: v })} display={String(s.byRings)} left="◉" right="◎" />
      <Searchable search={search} matches={matches} labelKey="byTargetMoving">
        <Toggle t={t} labelKey="byTargetMoving" tipKey="byTargetMovingTip" value={s.byTargetMoving} onChange={(v) => update({ byTargetMoving: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="byPerfect" tipKey="byPerfectTip" value={s.byPerfect} range={RANGES.byPerfect} onChange={(v) => update({ byPerfect: v })} display={s.byPerfect > 0 ? `#${s.byPerfect}` : t("byPerfectOff")} left="🎲" right="🎯" />
      {!search && (
        <p className="text-xs text-zinc-400 leading-relaxed tabular-nums" data-testid="bullseye-run">
          {t("byRunInfo", { shots: s.byShots, seconds: bullseyeNominalRunSec(by).toFixed(1) })}
          {s.byPerfect > 0 && " " + (perfect >= 0 ? t("byPerfectInfo", { shot: perfect + 1 }) : t("byPerfectBeyond", { shots: s.byShots }))}
        </p>
      )}
    </div>
  );
}
