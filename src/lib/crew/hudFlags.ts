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
 *    points (nothing switches them off), but their words are on screen like any other message;
 *  - --- crew --- (AI studio step 4) MODE_END_BANNERS: the banners a mode draws at its own ending ("FREEDOM!", an arena's
 *    champion, Bullseye's callout). The Simple look draws no payoff words of its own beside one that comes in with the payoff
 *    (BANNER_WITH_PAYOFF_SEC; lib/bot/planner.ts clipCaptions: one ending), the Simple score and the screen view count it on
 *    screen from the second it comes in (endBannersIn), and G2 reads it as words to end on where it covers the quiet end.
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
  /** What a viewer sees, in plain words (the screen view): no claim's word ("winner", "out"…), as the screen view holds no intent. */
  words: string;
  /**
   * --- crew --- (studio round 1, 9) Its words sit at the top centre of the square, on the line the Top Text is drawn on: Spiral Glass's
   * question over its spiral. A Top Text beside it is drawn into it, the two lines one ("WiSmashll mDay1ly?", watched): gate G5.
   */
  topCentre?: true;
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
  // --- crew --- (AI studio step 4b) the two overlays a setting switches since then (Canvas.tsx `journeyHud`, `sgHud`): the Journey's
  // stage banner, the stage names at the wall and the clock (the mini-map is a picture), Spiral Glass's title and tiles left, the
  // share in its progress ring and its question over the spiral; neither counts down to the payoff
  { key: "journeyHud", modes: onlyIn("journey"), kind: "hud", on: (s) => s.journeyHud !== false, texts: () => 3, counts: false, words: "a banner as each stage begins, the stage names, a mini-map and a clock" },
  { key: "sgHud", modes: onlyIn("spiralGlass"), kind: "hud", on: (s) => s.sgHud !== false, texts: () => 3, counts: false, words: "a title with the tiles left, a ring with a share and a question over the spiral", topCentre: true },
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
  // --- crew --- (AI studio step 4) the HUDs of group B's modes, which no setting switches off (their renderers' drawOverlay)
  { mode: "conveyor", counts: false, words: "a title and a counter of the balls loaded and out" },
  { mode: "bullseye", counts: false, words: "a title, the shot counter and the running total" },
  { mode: "paddle", counts: false, words: "the score, the lives and the streak" },
  { mode: "mergeRing", counts: false, words: "a title, the merges, the top size, a ladder of the sizes and a question under the ring" },
  // --- crew --- (AI studio step 6) a Mode Lab game's own HUD (blueprintRenderer.ts drawOverlay: its title block in the square's top
  // left corner, which no setting switches off)
  { mode: "blueprint", counts: false, words: "the game's name and its counters in the top left corner" },
];

// --- crew --- (AI studio step 4) the modes' own endings
/**
 * A banner a mode draws over its square at its own ending, which no setting switches off (Canvas.tsx's end banners and the
 * modes' renderers): Power Layers' "FREEDOM! 10 hits · 16.7s", an arena's winner, Bullseye's callout. It comes in either at
 * the moment a clip times its payoff by ("payoff": the escape, the break, the first one out, the bullseye) or `leadSec` before
 * the run's own end ("finish": the mode ends its run that long after it, its hold), and stays to the clip's end – or `forSec`,
 * a callout that leaves. Measured against the engine on the ready templates' and the recipes' plans (AI studio step 4: the
 * banner came in within 0.1 s of the moment named here). `when`: only with these settings (a roster's banner).
 */
export interface ModeEndBanner {
  /** Its mode, or "any" (a roster's winner banner, wherever a roster plays). */
  mode: ModeId | "any";
  at: "payoff" | "finish";
  /** "finish": it comes in this long before the run's own end (s). */
  leadSec?: number;
  /** A callout that leaves after this long (s); absent: it stays to the clip's end. */
  forSec?: number;
  when?: (s: SimulatorSettings) => boolean;
  /** What a viewer sees, in plain words (the screen view): no claim's word ("winner", "out"…), as the screen view holds no intent. */
  words: string;
}

/**
 * --- crew --- (AI studio step 4) A banner that comes in within this of the payoff (s) is the payoff's own announcement: the
 * Simple look draws no payoff words beside it (planner.ts assemblePlan, ownEnding). One that comes later – Ball Drop's SETTLED!,
 * seconds after its last note – leaves the payoff its words.
 */
export const BANNER_WITH_PAYOFF_SEC = 1;

/**
 * The end banners (see ModeEndBanner). The holds are the modes' own: Bullseye's final banner 2.5 s before its end (FINAL_HOLD_MS),
 * Merge Ring's and Spiral Glass's 2 s, the conveyor's 1.5 s, the paddle's GAME OVER 2.2 s, the vortex's 1 s, Bouncing Orbs' 1.5 s,
 * the runner's LEVEL COMPLETE 1.6 s and Beat Drop's 0.6 s; every other comes in as the run ends (the page's holds after it). ---
 * crew --- (AI studio step 5) A rhythm field of Bouncing Orbs calls IN PHASE as its orbs land together, for 1.8 s.
 */
export const MODE_END_BANNERS: readonly ModeEndBanner[] = [
  { mode: "accumulation", at: "payoff", words: "an ESCAPED! banner with the frozen balls" },
  { mode: "portal", at: "payoff", words: "an ESCAPED! banner with the teleports" },
  { mode: "shatter", at: "payoff", words: "a SHATTERED! banner with the segments broken" },
  { mode: "powerLayers", at: "payoff", words: "a FREEDOM! banner with the hits and the time" },
  { mode: "journey", at: "payoff", when: (s) => s.journeyHud !== false /* --- crew --- (AI studio step 4b) the overlay's card */, words: "a HOME! card with the stages, the time and the score" },
  { mode: "race", at: "payoff", words: "a callout naming the first across the line" },
  { mode: "maze", at: "payoff", words: "a banner naming the first ball to leave, with its time and a line under it" },
  { mode: "bullseye", at: "payoff", forSec: 1.5, words: "a big BULLSEYE! callout" },
  { mode: "bullseye", at: "finish", leadSec: 2.5, words: "a final banner with the total and the best shot" },
  { mode: "mergeRing", at: "finish", leadSec: 2, words: "a FINAL FORM banner with the merges and the time (or OVERFLOW)" },
  { mode: "spiralGlass", at: "finish", leadSec: 2, words: "a GLASS CLEARED banner with the tiles and the time" },
  { mode: "conveyor", at: "finish", leadSec: 1.5, words: "a final banner with the balls loaded and escaped" },
  { mode: "paddle", at: "finish", leadSec: 2.2, words: "a GAME OVER banner with the hits and the best streak" },
  { mode: "vortex", at: "finish", leadSec: 1, words: "a final banner with the balls swallowed and the notes" },
  { mode: "orbGrid", at: "finish", leadSec: 1.5, words: "a banner: every orb at rest" },
  // --- crew --- (AI studio step 5) a rhythm field's IN PHASE callout as the orbs land together, for IN_PHASE_HOLD_MS (modes/orbRhythm.ts)
  { mode: "orbGrid", at: "payoff", forSec: 1.8, when: (s) => s.ogModel === "rhythm", words: "an IN PHASE banner: how many orbs land together, and at which second" },
  { mode: "runner", at: "finish", leadSec: 1.6, words: "a LEVEL COMPLETE! banner" },
  // --- crew --- (studio round 1, 11) Collision Playground's anti-collision switch, the moment its template times its payoff by: a flash
  // and its label for ANTI_LABEL_MS (collideRenderer.ts), every orb in a new colour
  { mode: "collide", at: "payoff", forSec: 2.2, when: (s) => s.cpAntiCollisionAt > 0, words: "a flash and an ANTI-COLLISION label across the middle, every orb in a new colour" },
  { mode: "beatDrop", at: "finish", leadSec: 0.6, words: "a banner on the last landing" },
  { mode: "multipliers", at: "finish", words: "a MADE IT HOME banner with the balls home" },
  { mode: "battle", at: "finish", words: "the champion's banner" },
  { mode: "ctf", at: "finish", words: "the champion's banner" },
  { mode: "stringBattle", at: "finish", words: "the champion's banner" },
  { mode: "fightLeague", at: "finish", words: "KO!, then the champion's banner and card" },
  { mode: "territory", at: "finish", words: "the champion's banner with the share of the board" },
  { mode: "landClaim", at: "finish", words: "the champion's banner with the land taken" },
  { mode: "drop", at: "finish", words: "a SETTLED! banner with the balls at rest" },
  { mode: "box", at: "finish", words: "a COUNTED DOWN! banner" },
  { mode: "pendulum", at: "finish", words: "a banner: every pendulum back in line" },
  { mode: "polyrhythm", at: "finish", words: "a banner: every dot aligned" },
  { mode: "illusion", at: "finish", words: "a COMPLETE! banner with the cycles" },
  // --- crew --- (AI studio step 6) a Mode Lab game's end banner as its finish rule fires, held END_HOLD_SEC before its run ends (modes/blueprint.ts)
  { mode: "blueprint", at: "finish", leadSec: 1.5, words: "a banner across the middle with the game's result and its time" },
  { mode: "any", at: "finish", when: (s) => rosterPlays(s), words: "the winning team's banner" },
];

/** The end banners these settings draw (their mode's, and a roster's where one plays). */
export function endBannersOf(s: SimulatorSettings): ModeEndBanner[] {
  return MODE_END_BANNERS.filter((b) => (b.mode === s.mode || b.mode === "any") && (!b.when || b.when(s)));
}

/** A clip's timing as the end banners read it: its ending, its payoff, its end and the run's own end (s; null: past the clip). */
export interface EndBannerTiming {
  ending: "resolved" | "cliffhanger";
  payoffSec: number | null;
  clipSec: number;
  /** Where the run ends on its own inside the clip (null: it goes on past the clip, or it is not known). */
  runEndSec: number | null;
}

/** An end banner on screen: from `start` to `end` (s of the clip). */
export interface EndBannerOn {
  banner: ModeEndBanner;
  start: number;
  end: number;
}

/**
 * The end banners a clip shows, each with its seconds: "payoff" ones from the payoff of a resolved clip (a cut one ends before
 * it), "finish" ones from `leadSec` before the run's own end where that is inside the clip; two that come and go at the same
 * seconds are one (a roster's banner where the mode's own comes in as well, at its end, is one ending).
 */
export function endBannersIn(s: SimulatorSettings, t: EndBannerTiming): EndBannerOn[] {
  const out: EndBannerOn[] = [];
  for (const banner of endBannersOf(s)) {
    let start: number | null = null;
    if (banner.at === "payoff") start = t.ending === "resolved" && t.payoffSec !== null ? t.payoffSec : null;
    else if (t.runEndSec !== null) start = Math.max(0, t.runEndSec - (banner.leadSec ?? 0));
    if (start === null || !(start < t.clipSec - 1e-9)) continue;
    const end = banner.forSec !== undefined ? Math.min(t.clipSec, start + banner.forSec) : t.clipSec;
    if (out.some((o) => Math.abs(o.start - start!) < 1e-6 && Math.abs(o.end - end) < 1e-6)) continue;
    out.push({ banner, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}
// --- end of the modes' own endings

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
  /** --- crew --- (studio round 1, 9) Its words sit at the top centre of the square, where the Top Text is drawn (HudFlag.topCentre). */
  topCentre?: true;
}

const applies = (flag: HudFlag, mode: ModeId) => flag.modes === "any" || flag.modes.includes(mode);

/** The HUDs these settings draw, the mode's own first, then the flags in HUD_FLAGS order. */
export function hudsOn(s: SimulatorSettings): HudOn[] {
  const out: HudOn[] = [];
  for (const h of MODE_HUDS) if (h.mode === s.mode) out.push({ id: `mode:${h.mode}`, kind: "hud", flag: false, costs: false, texts: 1, counts: h.counts, words: h.words });
  for (const f of HUD_FLAGS) {
    if (!applies(f, s.mode) || !f.on(s)) continue;
    out.push({ id: f.key, kind: f.kind, flag: true, costs: f.costs ? f.costs(s) : true, texts: f.texts(s), counts: f.counts, words: f.words, ...(f.topCentre ? { topCentre: true as const } : {}) });
  }
  return out;
}

/** Whether a HUD on screen shows the countdown (scoreClip's countdownHud: the HUD alone counts down to the payoff). */
export function hudCounts(s: SimulatorSettings): boolean {
  return hudsOn(s).some((h) => h.counts);
}

/** The HUD flag ids a clip keeps by default: the ones that count down, when its countdown is the HUD's. */
export function defaultKeptHuds(s: SimulatorSettings, countdownSource: "caption" | "hud" | "picture" | null): string[] {
  return countdownSource === "hud" ? hudsOn(s).filter((h) => h.flag && h.counts).map((h) => h.id) : [];
}
// --- end crew ---
