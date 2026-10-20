"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface MergeRingSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const MERGE_RING_KEYS = ["mrTiers", "mrInterval", "mrSpawnTiers", "mrGravity", "mrRainbow"];

/**
 * "Merge Ring" controls (feature merge-ring), shown in the Mode row while Merge Ring is the mode (and in the Ball section
 * while the settings search is in use): the tiers of the ladder, how often a ball leaves the chute, which tiers the chute
 * spawns, the gravity of the drop and the rainbow rim. The values live in SimulatorSettings; Simulator.tsx forwards them
 * to the engine (see lib/physics/modes/mergeRing.ts) and restarts the run when one changes (the rainbow follows live).
 */
export default function MergeRingSection({ t, search, matches, settings: s, update }: MergeRingSectionProps) {
  return (
    <div className="space-y-3 pt-2" data-testid="merge-ring">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("mrTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("mrDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="mrTiers" tipKey="mrTiersTip" value={s.mrTiers} range={RANGES.mrTiers} onChange={(v) => update({ mrTiers: v })} display={String(s.mrTiers)} />
      <Slider t={t} search={search} matches={matches} labelKey="mrInterval" tipKey="mrIntervalTip" value={s.mrInterval} range={RANGES.mrInterval} onChange={(v) => update({ mrInterval: v })} display={`${s.mrInterval.toFixed(1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="mrSpawnTiers" tipKey="mrSpawnTiersTip" value={s.mrSpawnTiers} range={RANGES.mrSpawnTiers} onChange={(v) => update({ mrSpawnTiers: v })} display={String(s.mrSpawnTiers)} />
      <Slider t={t} search={search} matches={matches} labelKey="mrGravity" tipKey="mrGravityTip" value={s.mrGravity} range={RANGES.mrGravity} onChange={(v) => update({ mrGravity: v })} display={`${s.mrGravity.toFixed(1)}×`} />
      <Searchable search={search} matches={matches} labelKey="mrRainbow">
        <Toggle t={t} labelKey="mrRainbow" tipKey="mrRainbowTip" value={s.mrRainbow} onChange={(v) => update({ mrRainbow: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="merge-ring-run">
          {t("mrRunInfo", { tiers: s.mrTiers })}
        </p>
      )}
    </div>
  );
}
