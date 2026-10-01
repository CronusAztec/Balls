"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CONVEYOR_ARENAS, conveyorBallCount, conveyorNominalRunSec, conveyorSettingsOf, type ConveyorArena } from "@/lib/physics/modes/conveyor";
import { RESPAWN_MODES } from "@/lib/physics/respawn";
import type { ModeId } from "@/lib/physics/types";

export interface ConveyorSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the Conveyor block (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const CONVEYOR_KEYS = ["cvInterval", "cvMaxBalls", "cvArena", "cvFreeze", "cvVariety"];
/** Search key of the respawn timer of Classic and Multiply (in the Ball section). */
export const RESPAWN_KEYS = ["respawnEvery"];

/** Whether the Ball section shows the respawn timer in `mode`. */
export function showsRespawn(mode: ModeId): boolean {
  return RESPAWN_MODES.includes(mode);
}

const ARENA_OPTIONS: Record<ConveyorArena, { icon: string; labelKey: string; hintKey: string }> = {
  rings: { icon: "◎", labelKey: "cvArenaRings", hintKey: "cvHintRings" },
  bowl: { icon: "◡", labelKey: "cvArenaBowl", hintKey: "cvHintBowl" },
  pegs: { icon: "⁘", labelKey: "cvArenaPegs", hintKey: "cvHintPegs" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Conveyor Belt" controls (feature gerald-conveyor), shown in the Mode row while the Conveyor Belt is the mode (and in the
 * Ball section while the settings search is in use): what the balls drop into (rings, bowl, peg field), how often the belt
 * drops one and how many it loads, the freeze (a ball that lands becomes an obstacle) and how much the balls' sizes and
 * colours vary, with a line that sums the run up for Find Simulation. The values live in SimulatorSettings; Simulator.tsx
 * forwards them to the engine (lib/physics/modes/conveyor.ts) and restarts the run when one changes (the Sound section's
 * scale and root follow live). The rings take the Wall section's Wall Count, Gap Size and Rotation.
 */
export default function ConveyorSection({ t, search, matches, settings: s, update }: ConveyorSectionProps) {
  const cv = conveyorSettingsOf(s);
  return (
    <div className="space-y-3 pt-2" data-testid="conveyor">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("cvTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("cvDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="cvArena">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("cvArena")}
            <Tooltip text={t("cvArenaTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("cvArena")}>
            {CONVEYOR_ARENAS.map((id) => (
              <button type="button" key={id} onClick={() => update({ cvArena: id })} aria-pressed={s.cvArena === id} className={pick(s.cvArena === id)} data-testid={`conveyor-arena-${id}`}>
                <span aria-hidden="true">{ARENA_OPTIONS[id].icon}</span> {t(ARENA_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && <p className="text-xs text-ink-3 leading-relaxed">{t(ARENA_OPTIONS[s.cvArena].hintKey)}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="cvInterval" tipKey="cvIntervalTip" value={s.cvInterval} range={RANGES.cvInterval} onChange={(v) => update({ cvInterval: v })} display={`${s.cvInterval.toFixed(1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="cvMaxBalls" tipKey="cvMaxBallsTip" value={s.cvMaxBalls} range={RANGES.cvMaxBalls} onChange={(v) => update({ cvMaxBalls: v })} display={String(s.cvMaxBalls)} />
      <Searchable search={search} matches={matches} labelKey="cvFreeze">
        <Toggle t={t} labelKey="cvFreeze" tipKey="cvFreezeTip" value={s.cvFreeze} onChange={(v) => update({ cvFreeze: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="cvVariety" tipKey="cvVarietyTip" value={s.cvVariety} range={RANGES.cvVariety} onChange={(v) => update({ cvVariety: v })} display={`${Math.round(100 * s.cvVariety)}%`} />
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="conveyor-run">
          {t("cvRunInfo", { balls: conveyorBallCount(cv), seconds: conveyorNominalRunSec(cv).toFixed(1) })}
        </p>
      )}
    </div>
  );
}

/**
 * The respawn timer of Classic and Multiply (feature gerald-conveyor), in the Ball section: a new ball drops in from the top
 * every N seconds (0 = off). It travels in the physics config (lib/physics/respawn.ts), so a found seed, the fast export and
 * the batch render all respawn the same.
 */
export function RespawnControl({ t, search, matches, settings: s, update }: ConveyorSectionProps) {
  if (!showsRespawn(s.mode)) return null;
  return (
    <div data-testid="respawn-every">
      <Slider t={t} search={search} matches={matches} labelKey="respawnEvery" tipKey="respawnEveryTip" value={s.respawnEvery} range={RANGES.respawnEvery} onChange={(v) => update({ respawnEvery: v })} display={s.respawnEvery > 0 ? t("respawnEveryValue", { seconds: s.respawnEvery.toFixed(1) }) : t("respawnEveryOff")} />
    </div>
  );
}
