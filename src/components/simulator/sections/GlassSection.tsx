"use client";

import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { glassSettingsOf, resolveGlassSettings, stageHp, stageRows } from "@/lib/physics/modes/glass";

export interface GlassSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const GLASS_KEYS = ["glassRows", "glassHp", "glassStages", "glassMoving", "glassHoles", "glassGates"];

/** Panes and hits of the whole run with these settings (every pane shattered), for the summary line. */
export function glassRunSize(s: SimulatorSettings): { panes: number; hits: number } {
  const g = resolveGlassSettings(glassSettingsOf(s)); // --- unlimited --- (the run the engine plays: its memory-safety ceilings applied)
  let panes = 0;
  let hits = 0;
  for (let stage = 0; stage < g.stages; stage++) {
    const rows = stageRows(g.rows, stage);
    panes += rows;
    hits += rows * stageHp(g.hp, stage);
  }
  return { panes, hits };
}

/**
 * "Glass" controls of the Glass Smash mode, shown in the Mode row while the mode is active (and in the Ball section
 * while the settings search is in use): panes per stage, hits per pane, stages, sliding panes, holes and the multiplier
 * gates, with a line that sums the run up. The values live in SimulatorSettings like everything else; Simulator.tsx forwards them to the
 * engine (see lib/physics/modes/glass.ts) and restarts the shaft when they change.
 */
export default function GlassSection({ t, search, matches, settings: s, update }: GlassSectionProps) {
  const size = glassRunSize(s);
  return (
    <div className="space-y-3 pt-2" data-testid="glass-smash">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("glassTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("glassDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="glassRows" tipKey="glassRowsTip" value={s.glassRows} range={RANGES.glassRows} onChange={(v) => update({ glassRows: v })} display={String(s.glassRows)} />
      <Slider t={t} search={search} matches={matches} labelKey="glassHp" tipKey="glassHpTip" value={s.glassHp} range={RANGES.glassHp} onChange={(v) => update({ glassHp: v })} display={String(s.glassHp)} />
      <Slider t={t} search={search} matches={matches} labelKey="glassStages" tipKey="glassStagesTip" value={s.glassStages} range={RANGES.glassStages} onChange={(v) => update({ glassStages: v })} display={String(s.glassStages)} />
      <Searchable search={search} matches={matches} labelKey="glassMoving">
        <Toggle t={t} labelKey="glassMoving" tipKey="glassMovingTip" value={s.glassMoving} onChange={(v) => update({ glassMoving: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="glassHoles">
        <Toggle t={t} labelKey="glassHoles" tipKey="glassHolesTip" value={s.glassHoles} onChange={(v) => update({ glassHoles: v })} />
      </Searchable>
      {/* --- gerald-multipliers --- a row of multiplier gates above every stage's glass (the cap is in the Ball section's Multipliers group) */}
      <Searchable search={search} matches={matches} labelKey="glassGates">
        <Toggle t={t} labelKey="glassGates" tipKey="glassGatesTip" value={s.glassGates} onChange={(v) => update({ glassGates: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="glass-run-size">
          {t("glassRunSize", { panes: size.panes, hits: size.hits, stages: s.glassStages })}
        </p>
      )}
    </div>
  );
}
