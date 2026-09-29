import { MAX_RACERS, type RaceFeature } from "@/lib/physics/raceTrack";
import { TEAM_PRESETS, sanitizeTeamEmoji, sanitizeTeamName, type TeamEntry } from "@/lib/teams";
import { normalizeHexColor } from "@/lib/themes";

/**
 * Who races in the Square Racing Grand Prix: racer i takes the name, colour and emoji of team i of the Teams roster
 * (the "Teams & Scoreboard" tab – up to six teams), and every racer beyond the roster a colour of its own from
 * `RACE_COLORS` (the first six are the Teams presets, so a roster and the defaults look alike) with its colour's name.
 * Nothing here reaches the physics: the roster only decides what the canvas draws and what the panel lists.
 */

/** Sixteen racer colours that stay distinct on the dark background (the first six are the Teams presets). */
export const RACE_COLORS: readonly string[] = [
  ...TEAM_PRESETS.map((t) => t.color),
  "#ec4899",
  "#06b6d4",
  "#a3e635",
  "#f8fafc",
  "#b45309",
  "#14b8a6",
  "#6366f1",
  "#94a3b8",
  "#9f1239",
  "#6ee7b7",
];

export interface RaceRoster {
  names: string[];
  colors: string[];
  emoji: string[];
}

/**
 * The 16 racer slots: the roster's teams first (a team without a name takes the default name of its slot), then the
 * default colours and names (`defaultNames[i]`, translated colour names; "#n" without one). Emoji only come from teams.
 */
export function raceRoster(teams: readonly TeamEntry[], defaultNames: readonly string[] = []): RaceRoster {
  const names: string[] = [];
  const colors: string[] = [];
  const emoji: string[] = [];
  for (let i = 0; i < MAX_RACERS; i++) {
    const team = teams[i];
    const fallback = defaultNames[i] || `#${i + 1}`;
    names.push((team && sanitizeTeamName(team.name)) || fallback);
    colors.push((team && normalizeHexColor(team.color)) || RACE_COLORS[i % RACE_COLORS.length]);
    emoji.push(team ? sanitizeTeamEmoji(team.emoji) : "");
  }
  return { names, colors, emoji };
}

/** Translation key (Controls namespace) of the automatic cup title for a track mix: "Turbo Dash Cup", "Swap Zone Cup"… */
export const CUP_TITLE_KEYS: Record<RaceFeature, string> = {
  mixed: "rcCupAutoMixed",
  pegs: "rcCupAutoPegs",
  funnels: "rcCupAutoFunnels",
  spinners: "rcCupAutoSpinners",
  swaps: "rcCupAutoSwaps",
  turbo: "rcCupAutoTurbo",
  bumpers: "rcCupAutoBumpers",
  gates: "rcCupAutoGates",
};

/** Translation keys (Controls namespace) of the default racer names: the colour names of RACE_COLORS. */
export const RACER_NAME_KEYS: readonly string[] = Array.from({ length: MAX_RACERS }, (_, i) => `rcName${i + 1}`);
