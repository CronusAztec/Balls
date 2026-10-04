import { MAX_TEAMS, MULTI_BALL_MODES, modeBallCap, type BallStats } from "@/lib/physics/ballStats";
import type { ModeId } from "@/lib/physics/types";
import { normalizeHexColor } from "@/lib/themes";
import { isFlMatch, matchTeams } from "@/lib/physics/modes/fightLeague"; // --- fight-league ---

/**
 * Team balls with a scoreboard – the "which one wins" format. Pure data and maths, no DOM:
 *
 * - the roster (`teams`: name, colour, emoji per team; team i is the ball that starts in slot i, see
 *   physics/ballStats.ts) with its validation and its compact URL form (`teams=Red*ef4444*🔥,Blue*3b82f6*💧`),
 * - the other team settings (`ballCount`, `showBallNames`, `showScoreboard`, `scoreboardPosition`) and their
 *   short URL keys (`nb`, `tn`, `tsb`, `tsp`; the old `two=1` still means two balls),
 * - the ranking: most escapes, then most walls broken, then most bounces (then the earlier first escape).
 *
 * Nothing here reaches the physics except the ball count, which the engine already knew as "two balls".
 */

export interface TeamEntry {
  name: string;
  /** "#rrggbb". */
  color: string;
  /** One emoji (or any short symbol) drawn on the ball; "" = none. */
  emoji: string;
}

export const SCOREBOARD_POSITIONS = ["top-left", "top-right"] as const;
export type ScoreboardPosition = (typeof SCOREBOARD_POSITIONS)[number];

export function isScoreboardPosition(value: unknown): value is ScoreboardPosition {
  return typeof value === "string" && (SCOREBOARD_POSITIONS as readonly string[]).includes(value);
}

/** Longest team name (in characters). */
export const MAX_TEAM_NAME_LENGTH = 16;
/** Longest emoji field (in code points; a family emoji with joiners takes 7). */
export const MAX_TEAM_EMOJI_LENGTH = 8;

/** The default look of team i (colour, emoji, English name); the panel translates the names. */
export const TEAM_PRESETS: readonly TeamEntry[] = [
  { name: "Red", color: "#ef4444", emoji: "🔥" },
  { name: "Blue", color: "#3b82f6", emoji: "💧" },
  { name: "Green", color: "#22c55e", emoji: "🍀" },
  { name: "Gold", color: "#eab308", emoji: "⚡" },
  { name: "Purple", color: "#a855f7", emoji: "🔮" },
  { name: "Orange", color: "#f97316", emoji: "🍊" },
];

/** Emoji offered next to the emoji field. */
export const TEAM_EMOJI_SUGGESTIONS: readonly string[] = ["🔥", "💧", "🍀", "⚡", "🔮", "🍊", "⭐", "💀", "👑", "🚀", "🐱", "🐶", "🦊", "🐸", "🍩", "⚽", "🏀", "🎱", "❤️", "😎"];

export interface TeamSettings {
  /** Balls the multi-ball modes start with, 1–6 (URL `nb` above two, `two=1` for two); a roster sets it to its size. */
  ballCount: number;
  /** The roster; empty = no teams (URL `teams`). */
  teams: TeamEntry[];
  /** Team name next to each team's ball (URL `tn`). */
  showBallNames: boolean;
  /** Per-team bounces / walls / escapes in a corner of the canvas (URL `tsb`). */
  showScoreboard: boolean;
  /** top-left | top-right (URL `tsp`). */
  scoreboardPosition: ScoreboardPosition;
}

export function defaultTeamSettings(): TeamSettings {
  return { ballCount: 1, teams: [], showBallNames: true, showScoreboard: true, scoreboardPosition: "top-left" };
}

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const TEAM_RANGES = {
  ballCount: { min: 1, max: MAX_TEAMS, step: 1 },
} as const;

export function clampBallCount(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(TEAM_RANGES.ballCount.min, Math.min(TEAM_RANGES.ballCount.max, Math.round(n)));
}

/* ------------------------------------------------------------------ roster entries */

// Control characters and the Unicode line / paragraph separators (the zero-width joiner and variation selectors emoji need stay).
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function codePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

/** A team name as stored: no control characters, whitespace collapsed, trimmed, at most MAX_TEAM_NAME_LENGTH characters. */
export function sanitizeTeamName(value: unknown): string {
  if (typeof value !== "string") return "";
  return codePoints(value.replace(/\s+/g, " ").replace(CONTROL, "").trim(), MAX_TEAM_NAME_LENGTH).trim();
}

/** An emoji field as stored: no control characters or spaces, at most MAX_TEAM_EMOJI_LENGTH code points. */
export function sanitizeTeamEmoji(value: unknown): string {
  if (typeof value !== "string") return "";
  return codePoints(value.replace(CONTROL, "").replace(/\s+/g, ""), MAX_TEAM_EMOJI_LENGTH);
}

/** The user-perceived characters (grapheme clusters) of a string – a flag or a family emoji is one. */
export function graphemes(value: string): string[] {
  if (!value) return [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const out: string[] = [];
    for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) out.push(part.segment);
    return out;
  }
  return Array.from(value);
}

/**
 * What the emoji field keeps after an edit: one symbol. Typing or pasting next to the current one replaces it
 * (the new symbol is the one that differs from `previous`); a single symbol is kept as it is.
 */
export function pickEmoji(next: string, previous: string): string {
  const parts = graphemes(sanitizeTeamEmoji(next));
  if (parts.length <= 1) return parts[0] ?? "";
  const fresh = parts.find((g) => g !== previous);
  return sanitizeTeamEmoji(fresh ?? parts[parts.length - 1]);
}

/** The default entry for team `index` (0-based), optionally with a translated name. */
export function defaultTeam(index: number, name?: string): TeamEntry {
  const preset = TEAM_PRESETS[((index % TEAM_PRESETS.length) + TEAM_PRESETS.length) % TEAM_PRESETS.length];
  return { name: sanitizeTeamName(name ?? preset.name), color: preset.color, emoji: preset.emoji };
}

/** A valid entry from anything (a preset, a parsed URL): the name and emoji sanitised, a bad colour replaced by the default of `index`. */
export function sanitizeTeam(value: unknown, index: number): TeamEntry {
  const source = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof TeamEntry, unknown>>;
  return {
    name: sanitizeTeamName(source.name),
    color: normalizeHexColor(source.color) ?? defaultTeam(index).color,
    emoji: sanitizeTeamEmoji(source.emoji),
  };
}

/** A valid roster: an array of at most MAX_TEAMS entries (anything else is an empty roster). */
export function resolveRoster(value: unknown): TeamEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TEAMS).map((entry, i) => sanitizeTeam(entry, i));
}

/**
 * The roster with `count` teams: cut, or extended with default teams. A new team takes the first preset look
 * (colour and emoji) the roster does not use yet, and its name from `names` (translated defaults) when given.
 */
export function resizeRoster(roster: readonly TeamEntry[], count: number, names?: readonly string[]): TeamEntry[] {
  const n = clampBallCount(count);
  const out = roster.slice(0, n).map((t) => ({ ...t }));
  while (out.length < n) {
    let preset = TEAM_PRESETS.findIndex((p) => !out.some((t) => t.color === p.color));
    if (preset < 0) preset = out.length % TEAM_PRESETS.length;
    out.push(defaultTeam(preset, names?.[preset]));
  }
  return out;
}

/* ------------------------------------------------------------------ URL form */

/** `%`, `*` and `,` inside a field are percent-escaped, so the separators always split correctly. */
function escapeField(value: string): string {
  return value.replace(/[%*,]/g, (c) => (c === "%" ? "%25" : c === "*" ? "%2A" : "%2C"));
}

function unescapeField(value: string): string {
  return value.replace(/%(25|2A|2C)/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** `name*rrggbb*emoji` per team, teams joined by commas (URLSearchParams percent-encodes the emoji). */
export function serializeTeams(roster: readonly TeamEntry[]): string {
  return roster
    .slice(0, MAX_TEAMS)
    .map((t) => `${escapeField(t.name)}*${(normalizeHexColor(t.color) ?? "#ffffff").slice(1)}*${escapeField(t.emoji)}`)
    .join(",");
}

/** Reads the URL form back (at most MAX_TEAMS teams; bad colours fall back to the team's default, names and emoji are sanitised). */
export function parseTeams(text: string | null | undefined): TeamEntry[] {
  if (!text) return [];
  const out: TeamEntry[] = [];
  for (const part of text.split(",")) {
    if (out.length >= MAX_TEAMS) break;
    if (!part) continue;
    const [name = "", color = "", emoji = ""] = part.split("*");
    out.push(sanitizeTeam({ name: unescapeField(name), color, emoji: unescapeField(emoji) }, out.length));
  }
  return out;
}

/* ------------------------------------------------------------------ settings */

interface BallCountFields {
  mode: ModeId;
  ballCount: number;
  twoBalls: boolean;
  teams: readonly TeamEntry[];
  /** --- odd-string-battle --- The String Battle's own ball count (2–6): one team per ball, whatever the roster's size. */
  sbBalls?: number;
  /** --- odd-territory --- Territory's own team count (2 or 4), whatever the roster's size. */
  tyTeams?: number;
  /** --- odd-maze --- The Maze's own ball count (1–8): its first six balls are teams, whatever the roster's size. */
  mzBalls?: number;
  /** --- fight-league --- Fight League's match type: its sides (a fighter each, two teams in 2v2), whatever the roster's size. */
  flMatch?: string;
}

/**
 * How many balls a multi-ball mode starts with: the roster's size when there is one, else the ball count (two with
 * the old switch) – at most the mode's cap (Grow: two; a bigger roster keeps its teams, and the first ones play).
 */
export function effectiveBallCount(settings: BallCountFields): number {
  // --- odd-string-battle --- the String Battle plays its own number of balls (the roster colours and names the first ones)
  if (settings.mode === "stringBattle" && settings.sbBalls !== undefined && Number.isFinite(settings.sbBalls)) return Math.max(2, Math.min(MAX_TEAMS, Math.round(settings.sbBalls)));
  // --- odd-territory --- Territory plays its own number of teams (the roster colours and names the first ones)
  if (settings.mode === "territory" && settings.tyTeams !== undefined && Number.isFinite(settings.tyTeams)) return settings.tyTeams >= 3 ? 4 : 2;
  // --- odd-maze --- the Maze plays its own number of balls too (the roster colours and names the first ones; six at most are teams)
  if (settings.mode === "maze" && settings.mzBalls !== undefined && Number.isFinite(settings.mzBalls)) return Math.max(1, Math.min(MAX_TEAMS, Math.round(settings.mzBalls)));
  // --- fight-league --- Fight League plays its sides: a fighter each in 1v1 and the free-for-alls, two teams in 2v2
  if (settings.mode === "fightLeague") return matchTeams(isFlMatch(settings.flMatch) ? settings.flMatch : "1v1");
  const n = settings.teams.length > 0 ? settings.teams.length : Math.max(settings.ballCount, settings.twoBalls ? 2 : 1);
  return Math.min(modeBallCap(settings.mode), clampBallCount(n));
}

/** The settings patch for a new ball count: `twoBalls` follows it, and a roster grows or shrinks with it. */
export function ballCountPatch(settings: Pick<BallCountFields, "teams">, count: number, names?: readonly string[]): { ballCount: number; twoBalls: boolean; teams?: TeamEntry[] } {
  const n = clampBallCount(count);
  const patch: { ballCount: number; twoBalls: boolean; teams?: TeamEntry[] } = { ballCount: n, twoBalls: n >= 2 };
  if (settings.teams.length > 0) patch.teams = resizeRoster(settings.teams, n, names);
  return patch;
}

/** The settings patch for a new roster: the ball count (and the two-ball switch) follow its size; an empty roster keeps the balls. */
export function rosterPatch(teams: TeamEntry[]): { teams: TeamEntry[]; ballCount?: number; twoBalls?: boolean } {
  const roster = resolveRoster(teams);
  if (roster.length === 0) return { teams: roster };
  return { teams: roster, ballCount: roster.length, twoBalls: roster.length >= 2 };
}

/**
 * Validates the team fields of a preset: an unknown position or a non-boolean flag falls back, the roster is
 * sanitised, the ball count clamped. A preset saved before the ball count existed has none: `twoBalls` then
 * means two. A roster sets the count to its size, and `twoBalls` follows the count.
 */
export function resolveTeamSettings(source: Partial<Record<keyof TeamSettings | "twoBalls", unknown>> | null | undefined): TeamSettings & { twoBalls: boolean } {
  const out = defaultTeamSettings();
  const s = source ?? {};
  out.teams = resolveRoster(s.teams);
  if (typeof s.showBallNames === "boolean") out.showBallNames = s.showBallNames;
  if (typeof s.showScoreboard === "boolean") out.showScoreboard = s.showScoreboard;
  if (isScoreboardPosition(s.scoreboardPosition)) out.scoreboardPosition = s.scoreboardPosition;
  const two = s.twoBalls === true;
  let count = s.ballCount === undefined || s.ballCount === null ? (two ? 2 : 1) : clampBallCount(s.ballCount, two ? 2 : 1);
  if (two && count < 2) count = 2;
  if (out.teams.length > 0) count = out.teams.length;
  out.ballCount = count;
  return { ...out, twoBalls: count >= 2 };
}

/** Picks the team fields out of the settings, copying the roster. */
export function teamSettingsOf(settings: TeamSettings): TeamSettings {
  return {
    ballCount: settings.ballCount,
    teams: settings.teams.map((t) => ({ ...t })),
    showBallNames: settings.showBallNames,
    showScoreboard: settings.showScoreboard,
    scoreboardPosition: settings.scoreboardPosition,
  };
}

/** What a mode change keeps: the roster and the scoreboard switches – and, with a roster, its balls. */
export function teamCarryOver(settings: TeamSettings): Partial<TeamSettings & { twoBalls: boolean }> {
  const kept = teamSettingsOf(settings);
  const out: Partial<TeamSettings & { twoBalls: boolean }> = { teams: kept.teams, showBallNames: kept.showBallNames, showScoreboard: kept.showScoreboard, scoreboardPosition: kept.scoreboardPosition };
  if (kept.teams.length > 0) {
    out.ballCount = kept.teams.length;
    out.twoBalls = kept.teams.length >= 2;
  }
  return out;
}

/** Writes the team fields that differ from `base` (the mode's defaults) under their short keys; `two` is written by settings.ts. */
export function writeTeamParams(settings: TeamSettings, base: TeamSettings, params: URLSearchParams): void {
  if (settings.teams.length > 0) params.set("teams", serializeTeams(settings.teams));
  else if (settings.ballCount > 2) params.set("nb", String(clampBallCount(settings.ballCount)));
  if (settings.showBallNames !== base.showBallNames) params.set("tn", settings.showBallNames ? "1" : "0");
  if (settings.showScoreboard !== base.showScoreboard) params.set("tsb", settings.showScoreboard ? "1" : "0");
  if (settings.scoreboardPosition !== base.scoreboardPosition) params.set("tsp", settings.scoreboardPosition);
}

/**
 * Reads the team fields from a URL into `settings` (called after `two` was read): `nb` sets the ball count
 * (`two=1` alone still means two balls), a roster sets it to its size, and `twoBalls` follows the count.
 */
export function readTeamParams(params: URLSearchParams, settings: TeamSettings & { twoBalls: boolean }): void {
  const roster = parseTeams(params.get("teams"));
  settings.teams = roster;
  const nb = params.get("nb");
  let count = nb !== null ? clampBallCount(nb, 1) : settings.twoBalls ? 2 : clampBallCount(settings.ballCount);
  if (settings.twoBalls && count < 2) count = 2;
  if (roster.length > 0) count = roster.length;
  settings.ballCount = count;
  settings.twoBalls = count >= 2;
  const tn = params.get("tn");
  if (tn === "1" || tn === "0") settings.showBallNames = tn === "1";
  const tsb = params.get("tsb");
  if (tsb === "1" || tsb === "0") settings.showScoreboard = tsb === "1";
  const tsp = params.get("tsp");
  if (isScoreboardPosition(tsp)) settings.scoreboardPosition = tsp;
}

/* ------------------------------------------------------------------ ranking */

/**
 * Orders two teams' stats: most escapes first, then most walls broken, then most bounces, then the earlier first
 * escape. Negative when `a` ranks above `b`, 0 for a dead heat.
 */
export function compareTeamStats(a: Readonly<BallStats>, b: Readonly<BallStats>): number {
  if (a.escapes !== b.escapes) return b.escapes - a.escapes;
  if (a.walls !== b.walls) return b.walls - a.walls;
  if (a.bounces !== b.bounces) return b.bounces - a.bounces;
  const ae = a.firstEscapeMs < 0 ? Infinity : a.firstEscapeMs;
  const be = b.firstEscapeMs < 0 ? Infinity : b.firstEscapeMs;
  if (ae === be) return 0;
  return ae < be ? -1 : 1;
}

/**
 * The team indices 0 … count − 1 from first to last (a dead heat keeps the roster order). Writes into `out`
 * (cleared first) so a renderer can rank every frame without allocating.
 */
export function rankTeams(stats: readonly Readonly<BallStats>[], count: number, out: number[] = []): number[] {
  out.length = 0;
  const n = Math.max(0, Math.min(count, stats.length));
  for (let i = 0; i < n; i++) {
    // Insertion sort (at most six teams, stable), shifting in place so no temporary arrays are made.
    let j = out.length;
    out.push(i);
    while (j > 0 && compareTeamStats(stats[i], stats[out[j - 1]]) < 0) {
      out[j] = out[j - 1];
      j--;
    }
    out[j] = i;
  }
  return out;
}

export interface TeamResult {
  /** Index of the winning team (-1 without teams). */
  winner: number;
  /** True when the top teams are level on every count (escapes, walls, bounces and the time of the first escape). */
  tie: boolean;
  /** The teams sharing first place (just the winner without a tie). */
  leaders: number[];
}

/** The outcome of a run: the winner by `compareTeamStats`, or the teams in a dead heat for first place. */
export function teamResult(stats: readonly Readonly<BallStats>[], count: number): TeamResult {
  const order = rankTeams(stats, count);
  if (order.length === 0) return { winner: -1, tie: false, leaders: [] };
  const best = stats[order[0]];
  const leaders = order.filter((i) => compareTeamStats(stats[i], best) === 0);
  return { winner: order[0], tie: leaders.length > 1, leaders };
}

/* ------------------------------------------------------------------ rendering */

/** What the canvas needs to draw the teams (null without a roster). */
export interface TeamRenderOptions {
  roster: TeamEntry[];
  showNames: boolean;
  showScoreboard: boolean;
  position: ScoreboardPosition;
}

export function teamRenderOptions(settings: TeamSettings): TeamRenderOptions | null {
  const roster = resolveRoster(settings.teams);
  if (roster.length === 0) return null;
  return { roster, showNames: settings.showBallNames, showScoreboard: settings.showScoreboard, position: settings.scoreboardPosition };
}

/** Whether teams play in `mode` (the modes that start with several balls). */
export function teamsPlayIn(mode: ModeId): boolean {
  return MULTI_BALL_MODES.includes(mode);
}

/**
 * The most teams a roster edited in `mode` may have: the teams that can play there (Grow: two), or MAX_TEAMS in a
 * mode without teams (the roster only waits there for a mode that plays it).
 */
export function maxTeamsIn(mode: ModeId): number {
  return teamsPlayIn(mode) ? modeBallCap(mode) : MAX_TEAMS;
}

/** The name to show for team `index`: its own, or `fallback(n)` ("Team 3") when it has none. */
export function teamDisplayName(team: TeamEntry | undefined, index: number, fallback: (n: number) => string): string {
  if (team?.name) return team.name;
  return fallback(index + 1);
}
