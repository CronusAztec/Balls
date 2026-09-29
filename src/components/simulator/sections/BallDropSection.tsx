"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface BallDropSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BALL_DROP_KEYS = ["dropBallCount", "dropSizeVariation", "dropGravityVariation", "dropRows", "dropSpawnInterval", "dropLoop"];

const pct = (v: number) => `${Math.round(100 * v)}%`;

/**
 * Ball Drop controls, shown in the Mode row while the mode is active (and in the Ball section while the
 * settings search is in use): ball count, size and gravity spread, peg rows, release interval and rain.
 * The values live in SimulatorSettings like everything else; Simulator.tsx forwards them to the engine
 * (see lib/physics/modes/drop.ts) and restarts the board when they change.
 */
export default function BallDropSection({ t, search, matches, settings: s, update }: BallDropSectionProps) {
  return (
    <div className="space-y-3 pt-2">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("dropDesc")}</p>}
      <Slider t={t} search={search} matches={matches} labelKey="dropBallCount" tipKey="dropBallCountTip" value={s.dropBallCount} range={RANGES.dropBallCount} onChange={(v) => update({ dropBallCount: v })} display={String(s.dropBallCount)} left="⚪" right="🎱" />
      <Slider t={t} search={search} matches={matches} labelKey="dropSizeVariation" tipKey="dropSizeVariationTip" value={s.dropSizeVariation} range={RANGES.dropSizeVariation} onChange={(v) => update({ dropSizeVariation: v })} display={pct(s.dropSizeVariation)} left="🔘" right="🎯" />
      <Slider t={t} search={search} matches={matches} labelKey="dropGravityVariation" tipKey="dropGravityVariationTip" value={s.dropGravityVariation} range={RANGES.dropGravityVariation} onChange={(v) => update({ dropGravityVariation: v })} display={pct(s.dropGravityVariation)} left="🪶" right="🪨" />
      <Slider t={t} search={search} matches={matches} labelKey="dropRows" tipKey="dropRowsTip" value={s.dropRows} range={RANGES.dropRows} onChange={(v) => update({ dropRows: v })} display={String(s.dropRows)} />
      <Slider t={t} search={search} matches={matches} labelKey="dropSpawnInterval" tipKey="dropSpawnIntervalTip" value={s.dropSpawnInterval} range={RANGES.dropSpawnInterval} onChange={(v) => update({ dropSpawnInterval: v })} display={`${s.dropSpawnInterval.toFixed(1)} s`} left="⚡" right="⏳" />
      <Searchable search={search} matches={matches} labelKey="dropLoop">
        <div className="space-y-1">
          <Toggle t={t} labelKey="dropLoop" tipKey="dropLoopTip" value={s.dropLoop} onChange={(v) => update({ dropLoop: v })} />
          <p className="text-xs text-zinc-500 leading-relaxed">{t("dropLoopDesc")}</p>
        </div>
      </Searchable>
    </div>
  );
}
