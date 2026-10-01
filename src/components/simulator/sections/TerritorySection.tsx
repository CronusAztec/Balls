"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { TY_PALETTE, TY_POWERS, parseTyPowers, serializeTyPowers, territoryClipSec, territoryRows, type TyPower } from "@/lib/physics/modes/territory";

export interface TerritorySectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const TERRITORY_KEYS = ["tyTeams", "tyBallsPerTeam", "tyPowers", "tyPowerEvery", "tyRadius", "tyCols", "tyDuration", "tyPegs", "tyBadge", "tyHud"];

const POWER_OPTIONS: Record<TyPower, { icon: string; labelKey: string; hintKey: string }> = {
  none: { icon: "⚪", labelKey: "tyPowerNone", hintKey: "tyHintNone" },
  vortex: { icon: "🌀", labelKey: "tyPowerVortex", hintKey: "tyHintVortex" },
  bomber: { icon: "💣", labelKey: "tyPowerBomber", hintKey: "tyHintBomber" },
  painter: { icon: "🖌️", labelKey: "tyPowerPainter", hintKey: "tyHintPainter" },
  ghost: { icon: "👻", labelKey: "tyPowerGhost", hintKey: "tyHintGhost" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Territory" controls (feature odd-territory), shown in the Mode row while the mode is active (and in the Ball section
 * while the settings search is in use): 2 or 4 teams, the balls per team, a power per team (none / vortex / bomber /
 * painter / ghost) with how often the timed ones fire and how far they reach, the board's columns, the countdown, the
 * dotted grid of pegs, the warning badge and the HUD. The values live in SimulatorSettings; Simulator.tsx forwards them
 * to the engine (see lib/physics/modes/territory.ts) and restarts the battle when a rule of the fight changes (the badge
 * and the HUD follow live). A team roster (Teams & Scoreboard) gives the teams its colours and names.
 */
export default function TerritorySection({ t, search, matches, settings: s, update }: TerritorySectionProps) {
  const teams = s.tyTeams >= 3 ? 4 : 2;
  const powers = parseTyPowers(s.tyPowers);
  const setPower = (team: number, power: TyPower) => {
    const next = [...powers];
    next[team] = power;
    update({ tyPowers: serializeTyPowers(next) });
  };
  const teamName = (team: number) => (team < s.teams.length ? s.teams[team].name || t("tyTeamN", { n: team + 1 }) : TY_PALETTE[team].name);
  const teamColor = (team: number) => (team < s.teams.length ? s.teams[team].color : TY_PALETTE[team].color);
  const used = new Set(powers.slice(0, teams));
  return (
    <div className="space-y-3 pt-2" data-testid="territory-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("tyDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="tyTeams">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("tyTeams")}
            <Tooltip text={t("tyTeamsTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("tyTeams")}>
            {[2, 4].map((n) => (
              <button type="button" key={n} onClick={() => update({ tyTeams: n })} aria-pressed={teams === n} className={pick(teams === n)}>
                {t(n === 2 ? "tyTeams2" : "tyTeams4")}
              </button>
            ))}
          </div>
          {!search && (
            <p className="text-xs text-ink-3 leading-relaxed" data-testid="territory-teams-note">
              {s.teams.length > 0 ? t("tyRosterNote", { count: Math.min(s.teams.length, teams), teams }) : t("tyPaletteNote", { names: TY_PALETTE.slice(0, teams).map((p) => p.name).join(" · ") })}
            </p>
          )}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="tyBallsPerTeam" tipKey="tyBallsPerTeamTip" value={s.tyBallsPerTeam} range={RANGES.tyBallsPerTeam} onChange={(v) => update({ tyBallsPerTeam: v })} display={String(s.tyBallsPerTeam)} />
      <Searchable search={search} matches={matches} labelKey="tyPowers">
        <div className="space-y-2" data-testid="territory-powers">
          <label className="text-sm font-medium text-ink-2">
            {t("tyPowers")}
            <Tooltip text={t("tyPowersTip")} />
          </label>
          {Array.from({ length: teams }, (_, team) => (
            <div key={team} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: teamColor(team), boxShadow: `0 0 8px ${teamColor(team)}` }} aria-hidden="true" />
              <span className="w-20 shrink-0 truncate text-xs font-bold text-ink-2">{teamName(team)}</span>
              <select value={powers[team]} onChange={(e) => setPower(team, e.target.value as TyPower)} aria-label={t("tyPowerOf", { team: teamName(team) })} className={`${selectClass} text-sm py-1.5`}>
                {TY_POWERS.map((id) => (
                  <option key={id} value={id}>
                    {POWER_OPTIONS[id].icon} {t(POWER_OPTIONS[id].labelKey)}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {!search && (
            <ul className="text-xs text-ink-3 leading-relaxed space-y-0.5" data-testid="territory-power-hints">
              {TY_POWERS.filter((id) => used.has(id)).map((id) => (
                <li key={id}>
                  <span aria-hidden="true">{POWER_OPTIONS[id].icon}</span> {t(POWER_OPTIONS[id].hintKey)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="tyPowerEvery" tipKey="tyPowerEveryTip" value={s.tyPowerEvery} range={RANGES.tyPowerEvery} onChange={(v) => update({ tyPowerEvery: v })} display={`${s.tyPowerEvery.toFixed(1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="tyRadius" tipKey="tyRadiusTip" value={s.tyRadius} range={RANGES.tyRadius} onChange={(v) => update({ tyRadius: v })} display={t("tyTiles", { count: s.tyRadius })} />
      <Slider t={t} search={search} matches={matches} labelKey="tyCols" tipKey="tyColsTip" value={s.tyCols} range={RANGES.tyCols} onChange={(v) => update({ tyCols: v })} display={`${s.tyCols} × ${territoryRows(s.tyCols)}`} />
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="tyDuration"
        tipKey="tyDurationTip"
        value={s.tyDuration}
        range={RANGES.tyDuration}
        // The clip follows the countdown, so a recording covers the verdict and its banner.
        onChange={(v) => update({ tyDuration: v, recordingDuration: territoryClipSec(v) })}
        display={`${s.tyDuration}s`}
      />
      <Searchable search={search} matches={matches} labelKey="tyPegs">
        <Toggle t={t} labelKey="tyPegs" tipKey="tyPegsTip" value={s.tyPegs} onChange={(v) => update({ tyPegs: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="tyBadge">
        <Toggle t={t} labelKey="tyBadge" tipKey="tyBadgeTip" value={s.tyBadge} onChange={(v) => update({ tyBadge: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="tyHud">
        <Toggle t={t} labelKey="tyHud" tipKey="tyHudTip" value={s.tyHud} onChange={(v) => update({ tyHud: v })} />
      </Searchable>
    </div>
  );
}
