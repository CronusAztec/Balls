"use client";

import Tooltip from "../Tooltip";
import { ColorPicker, Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { mazeRowsFor } from "@/lib/physics/mazeGrid";
import { DEFAULT_MAZE_SETTINGS, MZ_BRAINS, MZ_HANDS, MZ_PALETTE, type MazeBrain, type MazeHand } from "@/lib/physics/modes/maze";

export interface MazeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const MAZE_KEYS = ["mzBrain", "mzHand", "mzBalls", "mzCols", "mzSpeed", "mzGravity", "mzTrail", "mzTrailColor", "mzTrailOwn", "mzFog", "mzWallColor", "mzDuration", "mzBadge", "mzHud"];

const BRAIN_OPTIONS: Record<MazeBrain, { icon: string; labelKey: string; hintKey: string }> = {
  bounce: { icon: "🎱", labelKey: "mzBrainBounce", hintKey: "mzHintBounce" },
  wallFollow: { icon: "✋", labelKey: "mzBrainWallFollow", hintKey: "mzHintWallFollow" },
  explorer: { icon: "🧭", labelKey: "mzBrainExplorer", hintKey: "mzHintExplorer" },
};

const HAND_OPTIONS: Record<MazeHand, string> = { left: "mzHandLeft", right: "mzHandRight", alternate: "mzHandAlternate" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

/**
 * "Maze" controls (feature odd-maze), shown in the Mode row while the Maze is the mode (and in the Ball section while the
 * settings search is in use): the brain (bounce / wall follower / explorer) and the wall follower's hand, the balls, the
 * maze's size, speed and pull, the painted trail (opacity, colour or each ball's own), the fog, the wall colour, the clip
 * limit, the warning badge and the HUD. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine
 * (lib/physics/modes/maze.ts) and restarts the run with a new maze when its layout or its race changes (the pull and the
 * speed follow live and drop a found seed; the drawing follows live). A team roster (Teams & Scoreboard) gives the first
 * balls its colours and names.
 */
export default function MazeSection({ t, search, matches, settings: s, update }: MazeSectionProps) {
  const all = !!search;
  const rows = mazeRowsFor(s.mzCols);
  const rosterBalls = Math.min(s.teams.length, s.mzBalls, 6);
  return (
    <div className="space-y-3 pt-2" data-testid="maze-section">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("mzDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="mzBrain">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("mzBrain")}
            <Tooltip text={t("mzBrainTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("mzBrain")}>
            {MZ_BRAINS.map((id) => (
              <button type="button" key={id} onClick={() => update({ mzBrain: id })} aria-pressed={s.mzBrain === id} className={pick(s.mzBrain === id)}>
                <span aria-hidden="true">{BRAIN_OPTIONS[id].icon}</span> {t(BRAIN_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && (
            <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="maze-brain-hint">
              {t(BRAIN_OPTIONS[s.mzBrain].hintKey)}
            </p>
          )}
        </div>
      </Searchable>
      {(s.mzBrain === "wallFollow" || all) && (
        <Searchable search={search} matches={matches} labelKey="mzHand">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              {t("mzHand")}
              <Tooltip text={t("mzHandTip")} />
            </label>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("mzHand")}>
              {MZ_HANDS.map((id) => (
                <button type="button" key={id} onClick={() => update({ mzHand: id })} aria-pressed={s.mzHand === id} className={pick(s.mzHand === id)}>
                  {t(HAND_OPTIONS[id])}
                </button>
              ))}
            </div>
          </div>
        </Searchable>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="mzBalls" tipKey="mzBallsTip" value={s.mzBalls} range={RANGES.mzBalls} onChange={(v) => update({ mzBalls: v })} display={String(s.mzBalls)} left="🟢" right="🏁" />
      {!search && (
        <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="maze-palette">
          {rosterBalls > 0 ? t("mzRosterNote", { count: rosterBalls, balls: s.mzBalls }) : t("mzPaletteNote", { names: MZ_PALETTE.slice(0, s.mzBalls).map((p) => p.name).join(" · ") })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="mzCols" tipKey="mzColsTip" value={s.mzCols} range={RANGES.mzCols} onChange={(v) => update({ mzCols: v })} display={`${s.mzCols} × ${rows}`} left="▦" right="▩" />
      <Slider t={t} search={search} matches={matches} labelKey="mzSpeed" tipKey="mzSpeedTip" value={s.mzSpeed} range={RANGES.mzSpeed} onChange={(v) => update({ mzSpeed: v })} display={`${s.mzSpeed.toFixed(2)}×`} left="🐢" right="🚀" />
      <Slider t={t} search={search} matches={matches} labelKey="mzGravity" tipKey="mzGravityTip" value={s.mzGravity} range={RANGES.mzGravity} onChange={(v) => update({ mzGravity: v })} display={s.mzGravity === 0 ? t("mzGravityOff") : `${Math.round(100 * s.mzGravity)}%`} left="🎈" right="🪨" />
      <Slider t={t} search={search} matches={matches} labelKey="mzTrail" tipKey="mzTrailTip" value={s.mzTrail} range={RANGES.mzTrail} onChange={(v) => update({ mzTrail: v })} display={s.mzTrail === 0 ? t("mzTrailOff") : `${Math.round(100 * s.mzTrail)}%`} left="◻️" right="🩸" />
      {(s.mzTrail > 0 || all) && (
        <>
          <Searchable search={search} matches={matches} labelKey="mzTrailOwn">
            <Toggle t={t} labelKey="mzTrailOwn" tipKey="mzTrailOwnTip" value={s.mzTrailOwn} onChange={(v) => update({ mzTrailOwn: v })} />
          </Searchable>
          {(!s.mzTrailOwn || all) && (
            <Searchable search={search} matches={matches} labelKey="mzTrailColor">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  {t("mzTrailColor")}
                  <Tooltip text={t("mzTrailColorTip")} />
                </label>
                <ColorPicker value={s.mzTrailColor} onChange={(v) => update({ mzTrailColor: v })} label={t("mzTrailColor")} />
              </div>
            </Searchable>
          )}
        </>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="mzFog" tipKey="mzFogTip" value={s.mzFog} range={RANGES.mzFog} onChange={(v) => update({ mzFog: v })} display={s.mzFog === 0 ? t("mzFogOff") : `${Math.round(100 * s.mzFog)}%`} left="☀️" right="🌫️" />
      <Searchable search={search} matches={matches} labelKey="mzWallColor">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300">
              {t("mzWallColor")}
              <Tooltip text={t("mzWallColorTip")} />
            </label>
            {s.mzWallColor !== DEFAULT_MAZE_SETTINGS.wallColor && (
              <button type="button" onClick={() => update({ mzWallColor: DEFAULT_MAZE_SETTINGS.wallColor })} className="text-xs text-zinc-500 hover:text-[#93d119] transition-colors cursor-pointer">
                {t("mzWallColorReset")}
              </button>
            )}
          </div>
          <ColorPicker value={s.mzWallColor} onChange={(v) => update({ mzWallColor: v })} label={t("mzWallColor")} />
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="mzDuration" tipKey="mzDurationTip" value={s.mzDuration} range={RANGES.mzDuration} onChange={(v) => update({ mzDuration: v })} display={`${s.mzDuration}s`} left="⏱️" right="⌛" />
      <Searchable search={search} matches={matches} labelKey="mzBadge">
        <Toggle t={t} labelKey="mzBadge" tipKey="mzBadgeTip" value={s.mzBadge} onChange={(v) => update({ mzBadge: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="mzHud">
        <Toggle t={t} labelKey="mzHud" tipKey="mzHudTip" value={s.mzHud} onChange={(v) => update({ mzHud: v })} />
      </Searchable>
      {!search && (
        <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="maze-run">
          {t("mzRunInfo", { cols: s.mzCols, rows, cells: s.mzCols * rows, seconds: s.mzDuration })}
        </p>
      )}
    </div>
  );
}
