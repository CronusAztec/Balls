"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface SpiralGlassSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const SPIRAL_GLASS_KEYS = ["sgTurns", "sgGlassHp", "sgSpeed", "sgMaxBalls", "sgChipEvery", "sgRainbow"];

/**
 * "Spiral Glass" controls (feature spiral-glass), shown in the Mode row while Spiral Glass is the mode (and in the Ball
 * section while the settings search is in use): the turns of the spiral, the glass's hit points, the balls' speed, the
 * ball cap, the chip time and the rainbow line. The values live in SimulatorSettings; Simulator.tsx forwards them to the
 * engine (see lib/physics/modes/spiralGlass.ts) and restarts the run when one changes (the rainbow follows live).
 */
export default function SpiralGlassSection({ t, search, matches, settings: s, update }: SpiralGlassSectionProps) {
  return (
    <div className="space-y-3 pt-2" data-testid="spiral-glass">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("sgTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("sgDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="sgTurns" tipKey="sgTurnsTip" value={s.sgTurns} range={RANGES.sgTurns} onChange={(v) => update({ sgTurns: v })} display={String(s.sgTurns)} />
      <Slider t={t} search={search} matches={matches} labelKey="sgGlassHp" tipKey="sgGlassHpTip" value={s.sgGlassHp} range={RANGES.sgGlassHp} onChange={(v) => update({ sgGlassHp: v })} display={String(s.sgGlassHp)} />
      <Slider t={t} search={search} matches={matches} labelKey="sgSpeed" tipKey="sgSpeedTip" value={s.sgSpeed} range={RANGES.sgSpeed} onChange={(v) => update({ sgSpeed: v })} display={`${s.sgSpeed.toFixed(1)}×`} />
      <Slider t={t} search={search} matches={matches} labelKey="sgMaxBalls" tipKey="sgMaxBallsTip" value={s.sgMaxBalls} range={RANGES.sgMaxBalls} onChange={(v) => update({ sgMaxBalls: v })} display={String(s.sgMaxBalls)} />
      <Slider t={t} search={search} matches={matches} labelKey="sgChipEvery" tipKey="sgChipEveryTip" value={s.sgChipEvery} range={RANGES.sgChipEvery} onChange={(v) => update({ sgChipEvery: v })} display={`${s.sgChipEvery.toFixed(2)}s`} />
      <Searchable search={search} matches={matches} labelKey="sgRainbow">
        <Toggle t={t} labelKey="sgRainbow" tipKey="sgRainbowTip" value={s.sgRainbow} onChange={(v) => update({ sgRainbow: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="spiral-glass-run">
          {t("sgRunInfo", { turns: s.sgTurns, tiles: s.sgTurns * 36 })}
        </p>
      )}
    </div>
  );
}
