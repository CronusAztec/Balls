import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { loopHudModeText } from "@/lib/loop/hud";
import { teamsPlayIn } from "@/lib/teams";

/*
 * --- crew --- The HUDs and badges a clip draws over its picture, as the crew's rules count them (lib/crew/simplicity.ts, the
 * Simple score; lib/crew/dossier.ts, the HUDs in words). Two kinds:
 *  - HUD_FLAGS: the ones a setting switches, per mode (a String Battle's WEB DOMINION panel, Power Layers' corner badge, the
 *    loop HUD in any mode…). Each that is on and that the clip does not keep costs the Simple score its HUD points;
 *  - MODE_HUDS: the ones a mode always draws (the arena games' scoreboard band, Power Layers' layer count…). They cost no HUD
 *    points (nothing switches them off), but their words are on screen like any other message.
 * A HUD "counts" when it shows the countdown to the payoff – exactly the modes the planner's scoreClip credits with a HUD
 * countdown (lib/bot/planner.ts hudShowsCountdown; tests/crewSimplicity.test.ts holds the two together).
 *
 * RING_WALL_MODES: the modes whose engine builds circular walls, where the wall effects (wall glow, rainbow walls, the wall
 * break's burst, the shake on a break) are drawn at all; tests/crewSimplicity.test.ts checks the list against the engine.
 *
 * Pure: settings in, a list out. No engine, no clock.
 */

// --- crew ---

/** What a HUD shows, in the crew's own words. */
export type HudKind = "hud" | "badge" | "labels" | "picture";

export interface HudFlag {
  /** The setting that switches it (its id in the crew's records too). */
  key: keyof SimulatorSettings & string;
  /** The modes it is drawn in ("any": every mode). */
  modes: readonly ModeId[] | "any";
  kind: HudKind;
  /** On in these settings (in one of its modes). */
  on: (s: SimulatorSettings) => boolean;
  /** Whether it costs the Simple score its HUD points while on (the ball names: only past HUD_NAMES_FREE names). */
  costs?: (s: SimulatorSettings) => boolean;
  /** The text messages it puts on screen (0: a picture, not words). */
  texts: (s: SimulatorSettings) => number;
  /** It shows the countdown to the payoff. */
  counts: boolean;
  /** What a viewer sees, in plain words (the screen view). */
  words: string;
}

/** More ball names than this on screen cost the Simple score its HUD points. */
export const HUD_NAMES_FREE = 4;

const one = () => 1;
const none = () => 0;
const onlyIn = (...modes: ModeId[]): readonly ModeId[] => modes;
/** A roster that plays in this mode (the team names and the scoreboard are drawn only then). */
const rosterPlays = (s: SimulatorSettings) => teamsPlayIn(s.mode) && s.teams.length > 0;

/**
 * Whether the loop HUD draws a counter line under its title (Simulator.tsx's loop HUD words): the modes whose words have one,
 * Classic with its time in the ring, the drawing machine's orbits, the funnel's lap readout, the pyramid's blocks.
 */
export function loopHudHasCounter(s: SimulatorSettings): boolean {
  if (s.mode === "doublePendulum" && s.dpFan) return true; // (the chaos fan's grey state label)
  if (s.mode === "colourSort" || s.mode === "beatMachine" || s.mode === "waveTank" || s.mode === "brickRebuild") return true;
  if (s.mode === "drawingMachine") return s.dmMachine === "orbits";
  if (s.mode === "perfectFit") return false;
  if (s.mode === "vortex" && s.vxRelease === "rings") return s.vxLapReadout;
  if (s.mode === "landClaim" && s.lcLayout === "pyramid") return true;
  if (s.mode === "classic" && s.ringTimer) return true;
  return !!loopHudModeText(s.mode, { prLayout: s.prLayout, prTempos: s.prTempos })?.counter;
}

/** The HUDs and badges a setting switches (the plan's HUD_FLAGS), in a fixed order. */
export const HUD_FLAGS: readonly HudFlag[] = [
  { key: "sbHud", modes: onlyIn("stringBattle"), kind: "hud", on: (s) => s.sbHud, texts: one, counts: true, words: "a panel with lives and kills" },
  { key: "sbBadge", modes: onlyIn("stringBattle"), kind: "badge", on: (s) => s.sbBadge, texts: one, counts: false, words: "a flashing-lights warning badge" },
  { key: "tyHud", modes: onlyIn("territory"), kind: "hud", on: (s) => s.tyHud, texts: one, counts: false, words: "percentages, a bar and a timer" },
  { key: "tyBadge", modes: onlyIn("territory"), kind: "badge", on: (s) => s.tyBadge, texts: one, counts: false, words: "a flashing-lights warning badge" },
  { key: "mzHud", modes: onlyIn("maze"), kind: "hud", on: (s) => s.mzHud, texts: one, counts: false, words: "each ball's distance to the exit" },
  { key: "mzBadge", modes: onlyIn("maze"), kind: "badge", on: (s) => s.mzBadge, texts: one, counts: false, words: "a flashing-lights warning badge" },
  { key: "plBadge", modes: onlyIn("powerLayers"), kind: "badge", on: (s) => s.plBadge !== "none", texts: one, counts: false, words: "a corner badge" },
  { key: "plPills", modes: onlyIn("powerLayers"), kind: "labels", on: (s) => s.plPills, texts: one, counts: false, words: "two rule labels at the top" },
  { key: "rcStandings", modes: onlyIn("race"), kind: "hud", on: (s) => s.rcStandings, texts: one, counts: false, words: "live standings with names and gaps" },
  { key: "rcMiniMap", modes: onlyIn("race"), kind: "picture", on: (s) => s.rcMiniMap, texts: none, counts: false, words: "a mini-map of the track" },
  { key: "flHud", modes: onlyIn("fightLeague"), kind: "hud", on: (s) => s.flHud, texts: one, counts: true, words: "names, health bars and stat lines" },
  { key: "flDmgNumbers", modes: onlyIn("fightLeague"), kind: "picture", on: (s) => s.flDmgNumbers, texts: none, counts: false, words: "floating damage numbers" },
  { key: "ogHud", modes: onlyIn("orbGrid"), kind: "hud", on: (s) => s.ogHud, texts: one, counts: false, words: "a line naming the orbs" },
  { key: "lcHud", modes: onlyIn("landClaim"), kind: "hud", on: (s) => s.lcHud, texts: one, counts: false, words: "a title with a bar and a counter per side" },
  { key: "loopHud", modes: "any", kind: "hud", on: (s) => s.loopHud, texts: (s) => 1 + (loopHudHasCounter(s) ? 1 : 0), counts: false, words: "a title at the top and a counter at the bottom" },
  { key: "bounceMathHud", modes: "any", kind: "badge", on: (s) => s.bounceMathHud && s.bounceMath.length > 0, texts: one, counts: false, words: "a badge with the bounce rules" },
  { key: "prNumbers", modes: onlyIn("polyrhythm"), kind: "labels", on: (s) => s.prNumbers, texts: one, counts: false, words: "numbers on the dots" },
  { key: "showScoreboard", modes: "any", kind: "hud", on: (s) => s.showScoreboard && rosterPlays(s), texts: one, counts: false, words: "a scoreboard per team" },
  {
    key: "showBallNames",
    modes: "any",
    kind: "labels",
    on: (s) => s.showBallNames && rosterPlays(s),
    costs: (s) => s.teams.length > HUD_NAMES_FREE,
    texts: one,
    counts: false,
    words: "a name next to each ball",
  },
];

export interface ModeHud {
  mode: ModeId;
  /** It shows the countdown to the payoff. */
  counts: boolean;
  words: string;
}

/** The HUDs a mode always draws: no setting switches them off (the planner's countdown HUDs without a flag). */
export const MODE_HUDS: readonly ModeHud[] = [
  { mode: "powerLayers", counts: true, words: "the layers left" },
  { mode: "battle", counts: true, words: "a band with the squares left and their chips" },
  { mode: "race", counts: true, words: "the race's progress" },
  { mode: "ctf", counts: true, words: "a band with the score and the clock" },
  { mode: "glass", counts: true, words: "the stage banner and the stage dots" },
  { mode: "multipliers", counts: true, words: "the ball counter at home" },
];

/** The modes whose engine builds circular walls: the wall effects are drawn only there. */
export const RING_WALL_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow", "journey", "conveyor"];

export function hasRingWalls(mode: ModeId): boolean {
  return RING_WALL_MODES.includes(mode);
}

/** One HUD on screen. */
export interface HudOn {
  /** The flag's setting, or "mode:<mode>" for a HUD the mode always draws. */
  id: string;
  kind: HudKind;
  /** A setting switches it (it may cost HUD points). */
  flag: boolean;
  /** It costs HUD points while on and not kept (a flag only). */
  costs: boolean;
  texts: number;
  counts: boolean;
  words: string;
}

const applies = (flag: HudFlag, mode: ModeId) => flag.modes === "any" || flag.modes.includes(mode);

/** The HUDs these settings draw, the mode's own first, then the flags in HUD_FLAGS order. */
export function hudsOn(s: SimulatorSettings): HudOn[] {
  const out: HudOn[] = [];
  for (const h of MODE_HUDS) if (h.mode === s.mode) out.push({ id: `mode:${h.mode}`, kind: "hud", flag: false, costs: false, texts: 1, counts: h.counts, words: h.words });
  for (const f of HUD_FLAGS) {
    if (!applies(f, s.mode) || !f.on(s)) continue;
    out.push({ id: f.key, kind: f.kind, flag: true, costs: f.costs ? f.costs(s) : true, texts: f.texts(s), counts: f.counts, words: f.words });
  }
  return out;
}

/** Whether a HUD on screen shows the countdown (scoreClip's countdownHud: the HUD alone counts down to the payoff). */
export function hudCounts(s: SimulatorSettings): boolean {
  return hudsOn(s).some((h) => h.counts);
}

/** The HUD flag ids a clip keeps by default: the ones that count down, when its countdown is the HUD's. */
export function defaultKeptHuds(s: SimulatorSettings, countdownSource: "caption" | "hud" | null): string[] {
  return countdownSource === "hud" ? hudsOn(s).filter((h) => h.flag && h.counts).map((h) => h.id) : [];
}
// --- end crew ---
