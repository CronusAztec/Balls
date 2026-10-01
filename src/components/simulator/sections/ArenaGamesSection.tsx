"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BATTLE_ARENAS, ctfTimeLimitSec, type BattleArena } from "@/lib/physics/modes/arenaGames";

export interface ArenaGamesSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const ARENA_GAME_KEYS = ["arenaTitle", "btCount", "btHp", "btDamage", "btArena", "btShrink", "btPowerUps", "ctfPerTeam", "ctfScoreToWin", "arenaNudge"];

const ARENA_OPTIONS: Record<BattleArena, { labelKey: string }> = {
  box: { labelKey: "btArenaBox" },
  circle: { labelKey: "btArenaCircle" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Arena games" controls (feature jdm-arena-games), shown in the Mode row while Battle Royale or Capture the Flag is the
 * mode (and in the Ball section while the settings search is in use): the battle's squares, hit points, damage, arena,
 * shrinking zone and power-ups, capture the flag's team size and score to win, and the director's nudge both games share.
 * The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/modes/battle.ts, ctf.ts)
 * and restarts the game when one changes.
 */
export default function ArenaGamesSection({ t, search, matches, settings: s, update }: ArenaGamesSectionProps) {
  const all = !!search;
  const battle = s.mode === "battle";
  const ctf = s.mode === "ctf";
  return (
    <div className="space-y-3 pt-2" data-testid="arena-games-section">
      {!search && (
        <>
          <p className="text-sm font-semibold text-ink">{t("arenaTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t(ctf ? "ctfDesc" : "btDesc")}</p>
        </>
      )}
      {(battle || all) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="btCount" tipKey="btCountTip" value={s.btCount} range={RANGES.btCount} onChange={(v) => update({ btCount: v })} display={String(s.btCount)} />
          <Slider t={t} search={search} matches={matches} labelKey="btHp" tipKey="btHpTip" value={s.btHp} range={RANGES.btHp} onChange={(v) => update({ btHp: v })} display={String(s.btHp)} />
          <Slider t={t} search={search} matches={matches} labelKey="btDamage" tipKey="btDamageTip" value={s.btDamage} range={RANGES.btDamage} onChange={(v) => update({ btDamage: v })} display={`${s.btDamage.toFixed(2)}×`} />
          <Searchable search={search} matches={matches} labelKey="btArena">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2">
                {t("btArena")}
                <Tooltip text={t("btArenaTip")} />
              </label>
              <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("btArena")}>
                {BATTLE_ARENAS.map((id) => (
                  <button type="button" key={id} onClick={() => update({ btArena: id })} aria-pressed={s.btArena === id} className={pick(s.btArena === id)}>
                    {t(ARENA_OPTIONS[id].labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="btShrink">
            <Toggle t={t} labelKey="btShrink" tipKey="btShrinkTip" value={s.btShrink} onChange={(v) => update({ btShrink: v })} />
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="btPowerUps">
            <Toggle t={t} labelKey="btPowerUps" tipKey="btPowerUpsTip" value={s.btPowerUps} onChange={(v) => update({ btPowerUps: v })} />
          </Searchable>
        </>
      )}
      {(ctf || all) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="ctfPerTeam" tipKey="ctfPerTeamTip" value={s.ctfPerTeam} range={RANGES.ctfPerTeam} onChange={(v) => update({ ctfPerTeam: v })} display={`${s.ctfPerTeam} – ${s.ctfPerTeam}`} />
          <Slider t={t} search={search} matches={matches} labelKey="ctfScoreToWin" tipKey="ctfScoreToWinTip" value={s.ctfScoreToWin} range={RANGES.ctfScoreToWin} onChange={(v) => update({ ctfScoreToWin: v })} display={String(s.ctfScoreToWin)} />
          {!search && (
            <p className="text-xs text-ink-2 tabular-nums" data-testid="ctf-time-limit">
              {t("ctfTimeInfo", { seconds: Math.round(ctfTimeLimitSec(s.recordingDuration)) })}
            </p>
          )}
        </>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="arenaNudge" tipKey="arenaNudgeTip" value={s.arenaNudge} range={RANGES.arenaNudge} onChange={(v) => update({ arenaNudge: v })} display={`${Math.round(100 * s.arenaNudge)}%`} />
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("arenaTeamsHint")}</p>}
    </div>
  );
}
