"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { vortexNominalRunSec, vortexRunRangeSec, vortexSettingsOf } from "@/lib/physics/modes/vortex";

export interface VortexSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const VORTEX_KEYS = ["vxBalls", "vxStagger", "vxRings", "vxDuration", "vxGravity", "vxLoop", "vxDepthScale"];

/**
 * "Vortex" controls (feature gerald-vortex), shown in the Mode row while the Sound Vortex is the mode (and in the Ball
 * section while the settings search is in use): the balls and how far apart they enter, the sound rings, the seconds a
 * ball takes to the hole, the central pull (how fast they whirl), the loop and the depth cue, and a line that sums the
 * run up – its length for Find Simulation, or, with the loop on, why there is nothing to search for. The values live in
 * SimulatorSettings; Simulator.tsx forwards them to the engine (see lib/physics/modes/vortex.ts) and restarts the run
 * when the funnel or the flight changes (the depth cue and the Sound section's scale follow live).
 */
export default function VortexSection({ t, search, matches, settings: s, update }: VortexSectionProps) {
  const vx = vortexSettingsOf(s);
  const nominal = vortexNominalRunSec(vx);
  const range = vortexRunRangeSec(vx);
  return (
    <div className="space-y-3 pt-2" data-testid="sound-vortex">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t("vxTitle")}</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("vxDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="vxBalls" tipKey="vxBallsTip" value={s.vxBalls} range={RANGES.vxBalls} onChange={(v) => update({ vxBalls: v })} display={String(s.vxBalls)} left="⚪" right="🫧" />
      <Slider t={t} search={search} matches={matches} labelKey="vxStagger" tipKey="vxStaggerTip" value={s.vxStagger} range={RANGES.vxStagger} onChange={(v) => update({ vxStagger: v })} display={`${s.vxStagger.toFixed(2)}s`} left="⚡" right="⏳" />
      <Slider t={t} search={search} matches={matches} labelKey="vxRings" tipKey="vxRingsTip" value={s.vxRings} range={RANGES.vxRings} onChange={(v) => update({ vxRings: v })} display={String(s.vxRings)} left="◎" right="🎹" />
      <Slider t={t} search={search} matches={matches} labelKey="vxDuration" tipKey="vxDurationTip" value={s.vxDuration} range={RANGES.vxDuration} onChange={(v) => update({ vxDuration: v })} display={`${s.vxDuration.toFixed(1)}s`} left="🐇" right="🐢" />
      <Slider t={t} search={search} matches={matches} labelKey="vxGravity" tipKey="vxGravityTip" value={s.vxGravity} range={RANGES.vxGravity} onChange={(v) => update({ vxGravity: v })} display={`${s.vxGravity.toFixed(2)}×`} left="🌫️" right="🌀" />
      <Slider t={t} search={search} matches={matches} labelKey="vxDepthScale" tipKey="vxDepthScaleTip" value={s.vxDepthScale} range={RANGES.vxDepthScale} onChange={(v) => update({ vxDepthScale: v })} display={s.vxDepthScale.toFixed(2)} left="▭" right="🕳️" />
      <Searchable search={search} matches={matches} labelKey="vxLoop">
        <Toggle t={t} labelKey="vxLoop" tipKey="vxLoopTip" value={s.vxLoop} onChange={(v) => update({ vxLoop: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-zinc-400 leading-relaxed tabular-nums" data-testid="sound-vortex-run">
          {nominal !== null && range
            ? t("vxRunInfo", { notes: s.vxBalls * s.vxRings, seconds: nominal.toFixed(1), min: range.min.toFixed(1), max: range.max.toFixed(1) })
            : t("vxRunEndless")}
        </p>
      )}
    </div>
  );
}
