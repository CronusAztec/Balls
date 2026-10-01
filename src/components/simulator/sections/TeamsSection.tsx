"use client";

import Tooltip from "../Tooltip";
import { ColorPicker, Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import type { ControlSection } from "../Controls";
import { MAX_TEAMS, MULTI_BALL_MODES, modeBallCap } from "@/lib/physics/ballStats";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
import {
  MAX_TEAM_NAME_LENGTH,
  SCOREBOARD_POSITIONS,
  TEAM_EMOJI_SUGGESTIONS,
  ballCountPatch,
  effectiveBallCount,
  maxTeamsIn,
  pickEmoji,
  resizeRoster,
  rosterPatch,
  type ScoreboardPosition,
  type TeamEntry,
} from "@/lib/teams";

export interface TeamsSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onReset: (section: ControlSection) => void;
}

/** Search keys of the Teams section (SECTION_KEYS.teams in Controls.tsx). */
export const TEAM_KEYS = ["teams", "teamAdd", "showBallNames", "showScoreboard", "scoreboardPosition"];

const POSITION_LABELS: Record<ScoreboardPosition, { icon: string; labelKey: string }> = {
  "top-left": { icon: "↖", labelKey: "scoreboardTopLeft" },
  "top-right": { icon: "↗", labelKey: "scoreboardTopRight" },
};

const EMOJI_LIST_ID = "team-emoji-options";

/** The translated default names of the six teams (Red, Blue, Green, Gold, Purple, Orange). */
export function defaultTeamNames(t: Translate): string[] {
  return Array.from({ length: MAX_TEAMS }, (_, i) => t(`teamDefault${i + 1}`));
}

/**
 * The ball count slider of the Ball & Physics section (it replaced the "Two balls" switch): 1–6 balls in the
 * multi-ball modes (1–2 in Grow, see `modeBallCap()`), with the second ball's colour while there is no team roster.
 * With a roster the count is the number of teams, so moving the slider adds or removes teams.
 */
export function BallCountControl({ t, search, matches, settings: s, update }: Omit<TeamsSectionProps, "onReset">) {
  if (search && !matches("ballCount") && !matches("twoBalls")) return null;
  const count = effectiveBallCount(s);
  const range = { ...RANGES.ballCount, max: Math.min(RANGES.ballCount.max, modeBallCap(s.mode)) };
  // --- unlimited --- the count goes past the team balls (the rest are crowd balls): the plain ball-count range, unclamped
  // --- uncap-all --- whatever the Wide sliders switch: the slider keeps the mode's team range (two in Grow) unless Wide
  // sliders is on, and a count past the six team balls – typed into the number field or from a link – is a crowd
  const crowd = s.unlimited;
  const pastTeams = s.ballCount > RANGES.ballCount.max;
  const shown = crowd || pastTeams ? Math.max(count, Math.floor(s.ballCount)) : count;
  const body = (
    <div className="space-y-3">
      <Slider t={t} search="" matches={matches} labelKey="ballCount" tipKey="ballCountTip" value={shown} range={crowd ? RANGES.ballCount : range} onChange={(v) => update((crowd && v > range.max) || v > RANGES.ballCount.max ? { ballCount: v, twoBalls: true } : ballCountPatch(s, v, defaultTeamNames(t)))} display={String(shown)} />
      {count >= 2 && !s.rainbowBall && s.teams.length === 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">{t("ballColor2")}</label>
          <ColorPicker value={s.ballColor2} onChange={(v) => update({ ballColor2: v })} label={t("ballColor2")} />
        </div>
      )}
    </div>
  );
  return search ? <div className="p-3 bg-surface-2/40 rounded-xl border border-line-strong/50 shadow-sm">{body}</div> : body;
}

/** One roster row: colour, emoji (a text field with suggestions) and name, plus a remove button. */
function TeamRow({ t, team, index, onChange, onRemove }: { t: Translate; team: TeamEntry; index: number; onChange: (patch: Partial<TeamEntry>) => void; onRemove: () => void }) {
  const n = index + 1;
  return (
    <div className="flex items-center gap-2" data-testid="team-row">
      <input
        type="color"
        value={team.color}
        onChange={(e) => onChange({ color: e.target.value })}
        aria-label={t("teamColor", { n })}
        className="w-9 h-9 shrink-0 bg-surface-2 rounded-lg cursor-pointer border border-line-strong"
      />
      <input
        type="text"
        value={team.emoji}
        onChange={(e) => onChange({ emoji: pickEmoji(e.target.value, team.emoji) })}
        list={EMOJI_LIST_ID}
        aria-label={t("teamEmoji", { n })}
        placeholder="🙂"
        className="w-12 shrink-0 px-1 py-1.5 text-center text-lg bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3"
      />
      <input
        type="text"
        value={team.name}
        onChange={(e) => onChange({ name: Array.from(e.target.value).slice(0, MAX_TEAM_NAME_LENGTH).join("") })}
        maxLength={2 * MAX_TEAM_NAME_LENGTH}
        placeholder={t("teamNamePlaceholder", { n })}
        aria-label={t("teamName", { n })}
        className="flex-1 min-w-0 px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
        style={{ boxShadow: `inset 3px 0 0 ${team.color}` }}
      />
      <button type="button" onClick={onRemove} aria-label={t("teamRemove", { n })} className="shrink-0 px-2 py-1 text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer">
        <IconClose size={14} />
      </button>
    </div>
  );
}

/**
 * The Teams section: switch the roster on (a default team per ball, at least two), edit each team's colour, emoji
 * and name, add or remove teams (the ball count follows), and the ball names / scoreboard switches with the
 * scoreboard corner. Only the canvas reads the roster; the engine only learns the ball count, like "two balls"
 * before it, so a roster change restarts nothing but the balls it adds or removes.
 */
export default function TeamsSection({ t, search, matches, settings: s, update }: TeamsSectionProps) {
  const names = defaultTeamNames(t);
  const on = s.teams.length > 0;
  const plays = MULTI_BALL_MODES.includes(s.mode) || s.mode === "stringBattle" || s.mode === "territory" || s.mode === "maze"; // --- odd-string-battle --- (its balls wear the roster) --- odd-territory --- (its teams do) --- odd-maze --- (so do the maze's)
  // Grow takes two balls at most: a bigger roster (kept for the other modes) plays with its first teams there.
  const maxTeams = maxTeamsIn(s.mode);
  const setRoster = (roster: TeamEntry[]) => update(rosterPatch(roster));
  // Edits keep the text as typed (a name may end in a space while typing); the canvas and links tidy it up.
  const editTeam = (index: number, patch: Partial<TeamEntry>) => update({ teams: s.teams.map((team, i) => (i === index ? { ...team, ...patch } : team)) });
  return (
    <div className="space-y-4">
      <Searchable search={search} matches={matches} labelKey="teams">
        <div className="space-y-2">
          <Toggle t={t} labelKey="teams" tipKey="teamsTip" value={on} onChange={(v) => setRoster(v ? resizeRoster([], Math.max(2, effectiveBallCount(s)), names) : [])} caseStyle="title" />
          {!plays && s.mode !== "race" && <p className="text-xs text-warn/90 leading-relaxed">{t("teamsModeNote")}</p>}
          {/* --- jdm-race --- the Square Racing Grand Prix names, colours and emoji its first racers from the roster */}
          {s.mode === "race" && <p className="text-xs text-accent/80 leading-relaxed" data-testid="teams-race-note">{t("rcTeamsNote")}</p>}
          {plays && maxTeams < MAX_TEAMS && (on || !!search) && (
            <p className="text-xs text-warn/90 leading-relaxed" data-testid="teams-cap-note">
              {t("teamsModeCapNote", { max: maxTeams })}
            </p>
          )}
        </div>
      </Searchable>
      {on && (
        <Searchable search={search} matches={matches} labelKey="teamAdd">
          <div className="space-y-2" data-testid="team-roster">
            {s.teams.map((team, i) => (
              <TeamRow key={i} t={t} team={team} index={i} onChange={(patch) => editTeam(i, patch)} onRemove={() => setRoster(s.teams.filter((_, j) => j !== i))} />
            ))}
            <datalist id={EMOJI_LIST_ID}>
              {TEAM_EMOJI_SUGGESTIONS.map((emoji) => (
                <option key={emoji} value={emoji} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => update(ballCountPatch(s, s.teams.length + 1, names))}
              disabled={s.teams.length >= maxTeams}
              className="w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-dashed border-accent/40 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ＋ {t("teamAdd")}
            </button>
          </div>
        </Searchable>
      )}
      {(on || !!search) && (
        <>
          <Searchable search={search} matches={matches} labelKey="showBallNames">
            <Toggle t={t} labelKey="showBallNames" tipKey="showBallNamesTip" value={s.showBallNames} onChange={(v) => update({ showBallNames: v })} caseStyle="title" />
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="showScoreboard">
            <Toggle t={t} labelKey="showScoreboard" tipKey="showScoreboardTip" value={s.showScoreboard} onChange={(v) => update({ showScoreboard: v })} caseStyle="title" />
          </Searchable>
          {(s.showScoreboard || !!search) && (
            <Searchable search={search} matches={matches} labelKey="scoreboardPosition">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink-2">
                  {t("scoreboardPosition")}
                  <Tooltip text={t("scoreboardPositionTip")} />
                </label>
                <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("scoreboardPosition")}>
                  {SCOREBOARD_POSITIONS.map((position) => (
                    <button
                      type="button"
                      key={position}
                      onClick={() => update({ scoreboardPosition: position })}
                      aria-pressed={s.scoreboardPosition === position}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.scoreboardPosition === position ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                    >
                      <span aria-hidden="true">{POSITION_LABELS[position].icon}</span> {t(POSITION_LABELS[position].labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </Searchable>
          )}
        </>
      )}
    </div>
  );
}
