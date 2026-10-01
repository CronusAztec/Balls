import type { ModeId } from "@/lib/physics/types";
import { FREEDOM_HOLD_SEC, POWER_LAYERS_RANGES, powerLayersFixedDurationSec, type PlSequence } from "@/lib/physics/modes/powerLayers";
import type { SimulatorSettings } from "@/lib/settings";
import type { TeamEntry } from "@/lib/teams";

/*
 * --- viral-bot --- The playbook of the viral video bot as data: what docs/virality-playbook.md found (sections 1–3) turned
 * into constants the planner (planner.ts) plans with and the score (scoreClip) checks against, and the recipes – one per
 * format the three accounts go viral with – each a seeded settings generator over sensible ranges of the existing
 * SimulatorSettings. Pure: no DOM, no clock, no Math.random; every random choice comes from the `rng` a recipe is handed.
 *
 * Adding a recipe: append a `BotRecipe` to RECIPES (id, family, mode, payoff, countdown, strategy, a `settings()` generator
 * that keeps every value on its RANGES step), add its copy under `ViralBot.recipes.<copyKey>` in messages/en.json, pl.json
 * and es.json (name, hook, cliffHook, payoff, question, cliffQuestion, keywords, hashtags, series) and run the bot tests –
 * they check every recipe's settings against RANGES for many seeds and the copy in the three locales.
 */

/** The three series the bot rotates day by day (docs/virality-playbook.md §3.11): escapes, music-first rhythm, battles. */
export const BOT_FAMILIES = ["escape", "rhythm", "battle"] as const;
export type BotFamily = (typeof BOT_FAMILIES)[number];

export const BOT_PLATFORMS = ["reels", "tiktok", "shorts"] as const;
export type BotPlatform = (typeof BOT_PLATFORMS)[number];

/** Length buckets (§3.7): short 8–15 s, standard 15–30 s (the Reels default), long 60–90 s (the TikTok Creator Rewards cut). */
export const LENGTH_BUCKETS = ["short", "standard", "long"] as const;
export type LengthBucket = (typeof LENGTH_BUCKETS)[number];
export const BUCKET_SECONDS: Record<LengthBucket, { min: number; max: number }> = {
  short: { min: 8, max: 15 },
  standard: { min: 15, max: 30 },
  long: { min: 60, max: 90 },
};

/** §3.5: resolved (the payoff shown, a tight loop back to frame one) or cut-before-the-result (the "who won?" ending). */
export const ENDING_STYLES = ["resolved", "cliffhanger"] as const;
export type EndingStyle = (typeof ENDING_STYLES)[number];
/** What the user picks: a style, or "auto" – the bot alternates, clip by clip and day by day, and labels each clip. */
export const ENDING_CHOICES = ["auto", "resolved", "cliffhanger"] as const;
export type EndingChoice = (typeof ENDING_CHOICES)[number];

/** §3.4: the payoff someone would send to a friend. */
export const PAYOFF_TYPES = ["escape", "fill", "shatter", "winner", "flip", "cliffhanger"] as const;
export type PayoffType = (typeof PAYOFF_TYPES)[number];

/** §3.3: the countdown you can feel – shown by a caption, or by the mode's own HUD / picture. */
export const COUNTDOWN_KINDS = ["walls", "lives", "layers", "percent", "timer"] as const;
export type CountdownKind = (typeof COUNTDOWN_KINDS)[number];
export type CountdownSource = "caption" | "hud";

/**
 * How the planner times the payoff (planner.ts):
 * - `escape`: the first escape of any ball (the finder's escapes-at / never-escapes predicates);
 * - `winner`: the first escape or the finish, and who won (the finder's winner predicate);
 * - `finish`: the mode's own end (the finder's duration search) – or, for Glass Smash, the moment the ball reaches HOME;
 * - `fixed`: the run length is fixed by the settings (the finder's `fixedRunDurationSec()` – Power Layers);
 * - `cycle`: the pattern realigns at the end of its cycle (Pendulum Wave, Polyrhythm) – analytic;
 * - `fill`: a measured moment – the ball fills its ring (Grow) or the balls fill the screen (Multiply).
 */
export const PAYOFF_STRATEGIES = ["escape", "winner", "finish", "fixed", "cycle", "fill"] as const;
export type PayoffStrategy = (typeof PAYOFF_STRATEGIES)[number];

/** A platform's defaults: the bucket that suits it, the ones that fit at all, its own tag and the times to post (local). */
export interface PlatformProfile {
  id: BotPlatform;
  defaultBucket: LengthBucket;
  buckets: readonly LengthBucket[];
  /** Added to the niche hashtags. */
  tag: string;
  /**
   * Local posting times ("HH:MM"), when the audience is online (§2 "early velocity", §3.12). No source measures these for
   * this niche: they are the usual lunch / after-work / evening slots – replace them with your own Insights data.
   */
  postingTimes: readonly string[];
}

export const PLATFORMS: Record<BotPlatform, PlatformProfile> = {
  reels: { id: "reels", defaultBucket: "standard", buckets: ["short", "standard", "long"], tag: "#reels", postingTimes: ["12:00", "18:00", "21:00"] },
  tiktok: { id: "tiktok", defaultBucket: "standard", buckets: ["short", "standard", "long"], tag: "#fyp", postingTimes: ["13:00", "19:00", "22:00"] },
  shorts: { id: "shorts", defaultBucket: "short", buckets: ["short", "standard"], tag: "#shorts", postingTimes: ["12:00", "17:00", "20:00"] },
};

/**
 * The modes whose own scoreboard band covers the top of the square (arenaGames.ts HUD_BAND: "7 LEFT" and the contestant
 * chips of the battle royale, the score and the clock of capture the flag) – right where the recorder draws the Top Text.
 * Their series label goes in the Bottom Text instead, and the canvas starts the top captions below the band.
 */
export const TOP_HUD_MODES: readonly ModeId[] = ["battle", "ctf"];

/** §3.8: vertical 1080 × 1920 at 60 fps. */
export const BOT_FRAME = { width: 1080, height: 1920, fps: 60, resolution: "1080x1920" } as const;

/**
 * §3.2 / §1: the rule and the countdown stay out of the platform UI – never in the bottom 20 % (caption, buttons) or the
 * right 12 % (like / comment / share) of the frame.
 */
export const SAFE_ZONE = { bottom: 0.2, right: 0.12 } as const;

/**
 * §3.4: the payoff lands in the last 10–20 % of the clip (the ideal band). A run that ends on its own a second after its
 * payoff (Classic, Power Layers) puts it later on a long clip, so the planner accepts it up to 97 % and the score marks it down.
 */
export const PAYOFF_BAND = { from: 0.8, to: 0.9, accept: 0.97 } as const;
/** §3.5: a cut-before-the-result clip ends 0.5–1 s before the payoff. */
export const CLIFF_GAP_SEC = { min: 0.5, max: 1 } as const;
/** §3.1: the first impact happens inside the first second. */
export const FIRST_IMPACT_SEC = 1;
/** §3.2: the hook is on screen for the first 2–3 s. */
export const HOOK_SEC = { min: 2, max: 3 } as const;
/** §3.10: 5–10 niche hashtags. */
export const HASHTAG_COUNT = { min: 5, max: 10 } as const;

/**
 * §3.11 recurring contestants: the series roster every battle uses in this order, so the same names and colours come back
 * episode after episode (the names are proper names, the same in every language).
 */
export const SERIES_ROSTER: readonly TeamEntry[] = [
  { name: "Blaze", color: "#ff2e63", emoji: "🔥" },
  { name: "Wave", color: "#08d9d6", emoji: "💧" },
  { name: "Volt", color: "#f9f871", emoji: "⚡" },
  { name: "Moss", color: "#3ddc84", emoji: "🍀" },
  { name: "Nova", color: "#b967ff", emoji: "🔮" },
  { name: "Tang", color: "#ff9a3c", emoji: "🍊" },
];

/** §1 geraldbounces: one character with a face and a promise; ours is Pip (our own, not theirs). */
export const MASCOT = { name: "Pip", face: "cute" as const, color: "#f9f871" };

/** §3.6: a note per bounce – piano or xylophone by default. The voices are the synth's (lib/audio/instruments.ts). */
export const INSTRUMENT_PRESETS = {
  piano: { instrument: "triangle", melodyInstrument: "pluck", scale: "major" },
  xylophone: { instrument: "marimba", melodyInstrument: "marimba", scale: "pentatonic" },
} as const satisfies Record<string, Pick<SimulatorSettings, "instrument" | "melodyInstrument" | "scale">>;
export type InstrumentPreset = keyof typeof INSTRUMENT_PRESETS;

/** Built-in public-domain melodies (lib/audio/songs.ts ids) that climb and build – no third-party audio (§3.6). */
export const RISING_MELODIES = ["mountain-king", "ode-to-joy", "canon-in-d", "william-tell", "entertainer", "twinkle-twinkle"] as const;

/** §3.9: neon on black – the Neon theme's colours over a black background, glow and trails on. */
export const BOT_LOOK = { themeId: "neon", background: ["#000000", "#0b0014"] as const } as const;

/** The days are counted from here: day 1 of the series (episode numbers, family rotation, ending alternation). */
export const BOT_EPOCH = "2026-09-29";

/* ------------------------------------------------------------------ the checklist the score reads (§3) */

export const CHECKLIST = [
  { id: "motion", points: 10, step: 1 },
  { id: "hook", points: 15, step: 2 },
  { id: "countdown", points: 10, step: 3 },
  { id: "payoff", points: 20, step: 4 },
  { id: "length", points: 10, step: 7 },
  { id: "sound", points: 10, step: 6 },
  { id: "ending", points: 10, step: 5 },
  { id: "series", points: 10, step: 11 },
  { id: "look", points: 5, step: 9 },
] as const;
export type ChecklistId = (typeof CHECKLIST)[number]["id"];

/* ------------------------------------------------------------------ recipes */

/** What a recipe's settings generator gets from the planner. */
export interface RecipeContext {
  /** Seeded, 0 ≤ x < 1. */
  rng: () => number;
  bucket: LengthBucket;
  ending: EndingStyle;
  /** When the planner would like the payoff (s): analytic recipes set their cycle to it, the others use it as a hint. */
  payoffTarget: number;
  /** The series roster (SERIES_ROSTER). */
  roster: readonly TeamEntry[];
}

/** The copy a recipe's hook is filled with: `{seconds}`, `{count}`, `{lives}`, `{panes}`, `{layers}`, `{name}`, `{episode}`. */
export type HookVars = Record<string, string | number>;

export interface BotRecipe {
  /** Kebab-case id, used in file names and the manifest. */
  id: string;
  /** Key of its copy under `ViralBot.recipes` in messages/*.json. */
  copyKey: string;
  family: BotFamily;
  /** The modes it plays in; the generator picks one (the first is the main one). */
  modes: readonly ModeId[];
  payoff: PayoffType;
  countdown: { kind: CountdownKind; source: CountdownSource };
  strategy: PayoffStrategy;
  /** Teams from the series roster it plays with (0: none). */
  teams?: boolean;
  /** Pip plays the ball (face and name). */
  character?: boolean;
  /** The mode's own notes are the melody (rhythm recipes): no MIDI melody on top. */
  musicFirst?: boolean;
  /** The endings it can take (both by default); the first one stands in for one it cannot. */
  endings?: readonly EndingStyle[];
  /** The length buckets its mode can fill (all three by default): a battle is over in 20 s, a pendulum wave can take 90. */
  buckets?: readonly LengthBucket[];
  /** The mode-specific settings, seeded; `mode` must be one of `modes`. Every value on its RANGES step. */
  settings: (ctx: RecipeContext) => Partial<SimulatorSettings> & { mode: ModeId };
  /** The variables of its hook and captions for these settings. */
  hookVars: (s: SimulatorSettings) => HookVars;
  /**
   * Variables whose words come from the copy for these settings: variable → path under `ViralBot` (e.g. Power Layers'
   * `{rule}` → `plRules.fibonacci`), so the hook states the rule the clip really plays by, in the clip's language.
   */
  copyVars?: (s: SimulatorSettings) => Record<string, string>;
}

/* seeded helpers ---------------------------------------------------------- */

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** An integer in [min, max]. */
export function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}

/** A value in [min, max] on the grid min + k·step (rounded to the step's decimals). */
export function stepBetween(rng: () => number, min: number, max: number, step: number): number {
  const n = Math.round((max - min) / step);
  return roundTo(min + step * intBetween(rng, 0, n), step);
}

/** `value` on the grid min + k·step inside [min, max]. */
export function snapStep(value: number, range: { min: number; max: number; step: number }): number {
  const clamped = Math.max(range.min, Math.min(range.max, value));
  return roundTo(range.min + Math.round((clamped - range.min) / range.step) * range.step, range.step);
}

function roundTo(value: number, step: number): number {
  const s = String(step);
  const decimals = s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
  return Number(value.toFixed(decimals));
}

/** Glass Smash: about how long (s) the ball takes to reach HOME through 1, 2, … 10 stages of six single-hit panes a row. */
const GLASS_HOME_SEC = [2, 4, 8, 16, 26, 40, 55, 72, 90, 110] as const;

const roster = (ctx: RecipeContext, n: number) => ctx.roster.slice(0, n).map((t) => ({ ...t }));
const byBucket = <T,>(ctx: RecipeContext, values: Record<LengthBucket, T>): T => values[ctx.bucket];

/* Power Layers: the payoff (the ball falls free) comes a fixed time into the run, set by the layers, the sequence and the speed. */

/** The moment (s) a Power Layers run breaks free: the fixed run length less the celebration (--- unlimited --- `unlimited`: resolved past the sliders, as the engine does). */
export function powerLayersPayoffSec(layers: number, sequence: PlSequence, speed: number, unlimited = false): number | null {
  const total = powerLayersFixedDurationSec({ layers, sequence, speed }, unlimited);
  return total === null ? null : total - FREEDOM_HOLD_SEC;
}

/**
 * Layers, sequence and speed whose payoff comes closest to `target` (the doubling rule first – the classic hook of the
 * format; a longer clip needs a slower sequence, and the hook's `{rule}` then names that one, see `copyVars`).
 */
export function powerLayersForPayoff(rng: () => number, target: number): { plLayers: number; plSequence: PlSequence; plSpeed: number } {
  const R = POWER_LAYERS_RANGES;
  const startLayers = stepBetween(rng, 200, R.plLayers.max, R.plLayers.step);
  let best = { plLayers: startLayers, plSequence: "double" as PlSequence, plSpeed: 1, miss: Infinity };
  for (const sequence of ["double", "fibonacci", "plusOne"] as const) {
    for (let layers = startLayers; layers >= 100; layers -= 50) {
      for (let k = 0; k <= Math.round((R.plSpeed.max - R.plSpeed.min) / R.plSpeed.step); k++) {
        const speed = roundTo(R.plSpeed.min + k * R.plSpeed.step, R.plSpeed.step);
        const payoff = powerLayersPayoffSec(layers, sequence, speed);
        if (payoff === null) continue;
        const miss = Math.abs(payoff - target);
        if (miss < best.miss - 1e-9) best = { plLayers: layers, plSequence: sequence, plSpeed: speed, miss };
      }
    }
    if (best.miss <= 0.5) break; // the doubling rule reaches it: keep the classic hook
  }
  return { plLayers: best.plLayers, plSequence: best.plSequence, plSpeed: best.plSpeed };
}

/**
 * The recipes, in family order. The copy (hook, questions, hashtags…) lives in messages/*.json under
 * `ViralBot.recipes.<copyKey>`; the numbers below are the ranges each format works in.
 */
export const RECIPES: readonly BotRecipe[] = [
  /* ---------------------------------------------------------------- escape */
  {
    id: "ring-escape",
    copyKey: "ringEscape",
    family: "escape",
    modes: ["classic", "portal", "accumulation"],
    payoff: "escape",
    countdown: { kind: "walls", source: "caption" },
    strategy: "escape",
    settings: (ctx) => {
      // A minute-long escape needs Classic's slow grind through six to eight rings (Portal and Accumulation are out sooner).
      const mode = ctx.bucket === "long" ? "classic" : pick(ctx.rng, ["classic", "portal", "accumulation"] as const);
      const walls = byBucket(ctx, { short: [2, 3], standard: [3, 5], long: [6, 8] });
      return {
        mode,
        wallCount: intBetween(ctx.rng, walls[0], walls[1]),
        gapSize: ctx.bucket === "long" ? stepBetween(ctx.rng, 0.4, 0.5, 0.05) : stepBetween(ctx.rng, mode === "classic" ? 0.45 : 0.3, mode === "classic" ? 0.6 : 0.4, 0.05),
        ballSpeed: stepBetween(ctx.rng, 450, 600, 10),
        rotationSpeed: stepBetween(ctx.rng, 0.8, 1.6, 0.1),
        ballRadius: intBetween(ctx.rng, 8, 11),
        cameraZoom: stepBetween(ctx.rng, 0.15, 0.3, 0.05),
      };
    },
    hookVars: (s) => ({ seconds: s.recordingDuration, walls: s.wallCount }),
  },
  {
    id: "pip-escape",
    copyKey: "pipEscape",
    family: "escape",
    modes: ["portal", "classic"],
    payoff: "escape",
    countdown: { kind: "walls", source: "caption" },
    strategy: "escape",
    character: true,
    settings: (ctx) => {
      const mode = ctx.bucket === "long" ? "classic" : pick(ctx.rng, ["portal", "classic"] as const);
      const walls = byBucket(ctx, { short: [2, 3], standard: [3, 5], long: [6, 8] });
      return {
        mode,
        wallCount: intBetween(ctx.rng, walls[0], walls[1]),
        gapSize: ctx.bucket === "long" ? stepBetween(ctx.rng, 0.4, 0.5, 0.05) : stepBetween(ctx.rng, mode === "classic" ? 0.45 : 0.3, mode === "classic" ? 0.6 : 0.4, 0.05),
        ballSpeed: stepBetween(ctx.rng, 420, 560, 10),
        rotationSpeed: stepBetween(ctx.rng, 0.8, 1.4, 0.1),
        ballRadius: intBetween(ctx.rng, 14, 18),
        ballSquash: stepBetween(ctx.rng, 0.4, 0.7, 0.05),
        cameraZoom: stepBetween(ctx.rng, 0.2, 0.35, 0.05),
      };
    },
    hookVars: (s) => ({ name: s.ballName || MASCOT.name, seconds: s.recordingDuration, walls: s.wallCount }),
  },
  {
    id: "grow-fill",
    copyKey: "growFill",
    family: "escape",
    modes: ["grow"],
    payoff: "fill",
    countdown: { kind: "percent", source: "caption" },
    strategy: "fill",
    buckets: ["short", "standard"],
    settings: (ctx) => ({
      mode: "grow",
      growRate: byBucket(ctx, { short: intBetween(ctx.rng, 7, 10), standard: intBetween(ctx.rng, 5, 8), long: 3 }),
      ballSpeed: byBucket(ctx, { short: stepBetween(ctx.rng, 500, 650, 10), standard: stepBetween(ctx.rng, 450, 600, 10), long: stepBetween(ctx.rng, 150, 250, 10) }),
      ballRadius: intBetween(ctx.rng, 6, 9),
      growLines: ctx.rng() < 0.5,
      rainbowBall: true,
    }),
    hookVars: () => ({}),
  },
  {
    id: "clone-per-pass",
    copyKey: "clonePerPass",
    family: "escape",
    modes: ["multiply"],
    payoff: "fill",
    countdown: { kind: "timer", source: "caption" },
    strategy: "fill",
    settings: (ctx) => ({
      mode: "multiply",
      // The clones come faster with more of them per escape: four fill the screen in 15–25 s on most seeds, two take a minute.
      multiplySpawnCount: byBucket(ctx, { short: 4, standard: intBetween(ctx.rng, 3, 4), long: 2 }),
      gapSize: stepBetween(ctx.rng, 0.3, 0.45, 0.05),
      ballSpeed: stepBetween(ctx.rng, 400, 520, 10),
      ballRadius: intBetween(ctx.rng, 6, 8),
      rainbowBall: true,
    }),
    hookVars: (s) => ({ count: s.multiplySpawnCount }),
  },
  {
    id: "multipliers-board",
    copyKey: "multipliersBoard",
    family: "escape",
    modes: ["multipliers"],
    payoff: "fill",
    countdown: { kind: "percent", source: "caption" },
    strategy: "finish",
    buckets: ["short", "standard"],
    settings: (ctx) => ({
      mode: "multipliers",
      mpRows: byBucket(ctx, { short: intBetween(ctx.rng, 5, 7), standard: intBetween(ctx.rng, 7, 11), long: intBetween(ctx.rng, 14, 20) }),
      mpStartBalls: intBetween(ctx.rng, 1, 3),
      mpMaxBalls: stepBetween(ctx.rng, 300, 800, 50),
    }),
    hookVars: (s) => ({ rows: s.mpRows }),
  },
  {
    id: "power-layers",
    copyKey: "powerLayers",
    family: "escape",
    modes: ["powerLayers"],
    payoff: "escape",
    countdown: { kind: "layers", source: "hud" },
    strategy: "fixed",
    settings: (ctx) => ({
      mode: "powerLayers",
      ...powerLayersForPayoff(ctx.rng, ctx.payoffTarget),
      plDrift: stepBetween(ctx.rng, 0.3, 0.7, 0.05),
      plBadge: "sound",
      plPills: false, // the hook caption states the rule where the pills would sit
    }),
    hookVars: (s) => ({ layers: s.plLayers, sequence: s.plSequence }),
    // The rule on screen is the sequence the run plays (ViralBot.plRules), and #itdoubles only when it doubles (plTags).
    copyVars: (s) => ({ rule: `plRules.${s.plSequence}`, ruleTag: `plTags.${s.plSequence}` }),
  },
  /* ---------------------------------------------------------------- rhythm (music-first, project.jdm) */
  {
    id: "pendulum-wave",
    copyKey: "pendulumWave",
    family: "rhythm",
    modes: ["pendulum"],
    payoff: "flip",
    countdown: { kind: "percent", source: "caption" },
    strategy: "cycle",
    musicFirst: true,
    settings: (ctx) => {
      const cycle = Math.max(10, Math.min(180, Math.round(ctx.payoffTarget)));
      return {
        mode: "pendulum",
        pwCount: intBetween(ctx.rng, 15, 24),
        pwCycleSeconds: cycle,
        pwBaseOscillations: Math.max(4, Math.min(80, Math.round(cycle * (0.8 + 0.4 * ctx.rng())))),
        pwAmplitude: intBetween(ctx.rng, 30, 45),
        pwLayout: pick(ctx.rng, ["row", "arc", "circle"] as const),
        pwTrails: stepBetween(ctx.rng, 0.3, 0.6, 0.05),
        pwSoundOn: "center",
        pwPitchDirection: "up",
        pwWaveChord: true,
        pwCycles: 0, // the clip length ends it: the row comes back in line at the payoff, a moment before the end
      };
    },
    hookVars: (s) => ({ count: s.pwCount, seconds: s.pwCycleSeconds }),
  },
  {
    id: "polyrhythm",
    copyKey: "polyrhythm",
    family: "rhythm",
    modes: ["polyrhythm"],
    payoff: "flip",
    countdown: { kind: "percent", source: "caption" },
    strategy: "cycle",
    musicFirst: true,
    settings: (ctx) => ({
      mode: "polyrhythm",
      prTempos: "harmonic",
      prCount: intBetween(ctx.rng, 8, 16),
      prCycleSeconds: Math.max(1, Math.min(300, Math.round(ctx.payoffTarget * 2) / 2)),
      prLayout: pick(ctx.rng, ["rings", "arcs", "metronomes"] as const),
      prPolygon: ctx.rng() < 0.5,
      prNumbers: true,
      prCycles: 0,
    }),
    hookVars: (s) => ({ count: s.prCount, seconds: s.prCycleSeconds }),
  },
  {
    id: "drop-symphony",
    copyKey: "dropSymphony",
    family: "rhythm",
    modes: ["drop"],
    payoff: "fill",
    countdown: { kind: "timer", source: "caption" },
    strategy: "finish",
    musicFirst: true,
    buckets: ["short", "standard"],
    settings: (ctx) => ({
      mode: "drop",
      dropBallCount: byBucket(ctx, { short: intBetween(ctx.rng, 8, 14), standard: intBetween(ctx.rng, 14, 24), long: intBetween(ctx.rng, 30, 40) }),
      dropSizeVariation: stepBetween(ctx.rng, 0.4, 0.8, 0.05),
      dropGravityVariation: stepBetween(ctx.rng, 0.2, 0.6, 0.05),
      dropRows: intBetween(ctx.rng, 6, 10),
      dropSpawnInterval: byBucket(ctx, { short: stepBetween(ctx.rng, 0.2, 0.4, 0.1), standard: stepBetween(ctx.rng, 0.4, 0.8, 0.1), long: stepBetween(ctx.rng, 1.2, 1.8, 0.1) }),
      dropLoop: false,
    }),
    hookVars: (s) => ({ count: s.dropBallCount }),
  },
  {
    id: "glass-smash",
    copyKey: "glassSmash",
    family: "rhythm",
    modes: ["glass"],
    payoff: "shatter",
    countdown: { kind: "timer", source: "caption" },
    strategy: "finish",
    character: true,
    settings: (ctx) => {
      // Seconds to HOME with six single-hit panes a row, by stage count (measured; every stage adds a third more panes).
      const target = ctx.payoffTarget;
      const glassStages = GLASS_HOME_SEC.reduce((best, sec, i) => (Math.abs(sec - target) < Math.abs(GLASS_HOME_SEC[best] - target) ? i : best), 0) + 1;
      return {
        mode: "glass",
        glassStages,
        glassRows: intBetween(ctx.rng, 6, 7),
        glassHp: 1,
        glassMoving: glassStages >= 3 && ctx.rng() < 0.6,
        glassHoles: glassStages >= 2 && ctx.rng() < 0.5,
        ballRadius: intBetween(ctx.rng, 12, 16),
        ballSquash: stepBetween(ctx.rng, 0.4, 0.7, 0.05),
      };
    },
    hookVars: (s) => ({ name: s.ballName || MASCOT.name, stages: s.glassStages }),
  },
  /* ---------------------------------------------------------------- battle (recurring contestants) */
  {
    id: "string-battle",
    copyKey: "stringBattle",
    family: "battle",
    modes: ["stringBattle"],
    payoff: "winner",
    countdown: { kind: "lives", source: "hud" },
    strategy: "winner",
    teams: true,
    // The winner banner holds 3 s after the last cut: a battle fills 15–30 s, never a minute.
    buckets: ["standard"],
    settings: (ctx) => {
      const balls = byBucket(ctx, { short: intBetween(ctx.rng, 3, 4), standard: 4, long: 6 });
      return {
        mode: "stringBattle",
        sbBalls: balls,
        sbLives: byBucket(ctx, { short: intBetween(ctx.rng, 2, 3), standard: intBetween(ctx.rng, 3, 4), long: intBetween(ctx.rng, 7, 9) }),
        sbRule: "cut",
        sbStyle: "web",
        sbHud: true,
        sbBadge: false, // the hook caption holds the top of the frame
        sbDuration: 0,
        sbFinaleSpeed: stepBetween(ctx.rng, 1.4, 2, 0.1),
        teams: roster(ctx, balls),
        ballCount: balls,
        twoBalls: true,
      };
    },
    hookVars: (s) => ({ lives: s.sbLives, count: s.sbBalls }),
  },
  {
    id: "territory",
    copyKey: "territory",
    family: "battle",
    modes: ["ctf"],
    payoff: "flip",
    countdown: { kind: "timer", source: "caption" },
    strategy: "finish",
    teams: true,
    // Capture the flag ends at its time limit – the clip length – with the leader's banner: a cut clip would end on a result.
    endings: ["resolved"],
    buckets: ["standard", "long"],
    settings: (ctx) => ({
      mode: "ctf",
      ctfPerTeam: intBetween(ctx.rng, 2, 3),
      ctfScoreToWin: byBucket(ctx, { short: intBetween(ctx.rng, 1, 2), standard: intBetween(ctx.rng, 2, 3), long: intBetween(ctx.rng, 6, 9) }),
      arenaNudge: stepBetween(ctx.rng, 0.3, 0.6, 0.05),
      teams: roster(ctx, 2),
      ballCount: 2,
      twoBalls: true,
    }),
    hookVars: (s) => ({ a: s.teams[0]?.name ?? "", b: s.teams[1]?.name ?? "" }),
  },
  {
    id: "battle-royale",
    copyKey: "battleRoyale",
    family: "battle",
    modes: ["battle"],
    payoff: "winner",
    countdown: { kind: "lives", source: "hud" },
    strategy: "finish",
    teams: true,
    buckets: ["standard"],
    settings: (ctx) => ({
      mode: "battle",
      btCount: byBucket(ctx, { short: intBetween(ctx.rng, 4, 6), standard: intBetween(ctx.rng, 6, 10), long: intBetween(ctx.rng, 14, 20) }),
      btHp: byBucket(ctx, { short: intBetween(ctx.rng, 3, 5), standard: intBetween(ctx.rng, 5, 8), long: intBetween(ctx.rng, 12, 18) }),
      btDamage: 1,
      btArena: pick(ctx.rng, ["box", "circle"] as const),
      btShrink: true,
      btPowerUps: ctx.rng() < 0.7,
      arenaNudge: stepBetween(ctx.rng, 0.3, 0.6, 0.05),
      teams: roster(ctx, 6),
      ballCount: 6,
      twoBalls: true,
    }),
    hookVars: (s) => ({ count: s.btCount }),
  },
  {
    id: "square-race",
    copyKey: "squareRace",
    family: "battle",
    modes: ["race"],
    payoff: "winner",
    countdown: { kind: "percent", source: "hud" },
    strategy: "finish",
    teams: true,
    settings: (ctx) => ({
      mode: "race",
      rcRacers: intBetween(ctx.rng, 4, 6),
      rcShape: "square",
      rcTrackLength: byBucket(ctx, { short: intBetween(ctx.rng, 3, 4), standard: intBetween(ctx.rng, 4, 7), long: intBetween(ctx.rng, 14, 20) }),
      rcLaps: 1,
      rcFeature: "mixed",
      rcCamera: "leader",
      rcCup: false,
      rcStandings: true,
      rcMiniMap: true,
      rcWinner: -1,
      teams: roster(ctx, 6),
      ballCount: 6,
      twoBalls: true,
    }),
    hookVars: (s) => ({ count: s.rcRacers }),
  },
  {
    id: "maze-race",
    copyKey: "mazeRace",
    family: "battle",
    modes: ["classic"],
    payoff: "winner",
    countdown: { kind: "walls", source: "caption" },
    strategy: "winner",
    teams: true,
    // The winner banner holds 3 s after the first ball is out: an 8–15 s clip would bury the payoff in its middle.
    buckets: ["standard"],
    settings: (ctx) => {
      const balls = intBetween(ctx.rng, 3, 4);
      const walls = byBucket(ctx, { short: [3, 4], standard: [4, 6], long: [7, 9] });
      return {
        mode: "classic",
        wallCount: intBetween(ctx.rng, walls[0], walls[1]),
        gapSize: stepBetween(ctx.rng, 0.4, 0.55, 0.05),
        wallThickness: intBetween(ctx.rng, 2, 3),
        rotationSpeed: stepBetween(ctx.rng, 0.6, 1.4, 0.1),
        ballSpeed: stepBetween(ctx.rng, 420, 560, 10),
        ballRadius: intBetween(ctx.rng, 7, 9),
        teams: roster(ctx, balls),
        ballCount: balls,
        twoBalls: true,
        showScoreboard: true,
        showBallNames: true,
      };
    },
    hookVars: (s) => ({ count: s.ballCount }),
  },
];

/** Whether a recipe's mode can fill a bucket. */
export function supportsBucket(recipe: Pick<BotRecipe, "buckets">, bucket: LengthBucket): boolean {
  return !recipe.buckets || recipe.buckets.includes(bucket);
}

/** The bucket a recipe plays for a wanted one: that one when it can, else the nearest it can (standard first). */
export function recipeBucket(recipe: Pick<BotRecipe, "buckets">, wanted: LengthBucket): LengthBucket {
  if (supportsBucket(recipe, wanted)) return wanted;
  const order: LengthBucket[] = wanted === "long" ? ["standard", "short"] : wanted === "short" ? ["standard", "long"] : ["short", "long"];
  return order.find((b) => supportsBucket(recipe, b)) ?? wanted;
}

export function recipeById(id: string | null | undefined): BotRecipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipesOfFamily(family: BotFamily): BotRecipe[] {
  return RECIPES.filter((r) => r.family === family);
}

export function isBotFamily(value: unknown): value is BotFamily {
  return typeof value === "string" && (BOT_FAMILIES as readonly string[]).includes(value);
}
export function isBotPlatform(value: unknown): value is BotPlatform {
  return typeof value === "string" && (BOT_PLATFORMS as readonly string[]).includes(value);
}
export function isLengthBucket(value: unknown): value is LengthBucket {
  return typeof value === "string" && (LENGTH_BUCKETS as readonly string[]).includes(value);
}
export function isEndingChoice(value: unknown): value is EndingChoice {
  return typeof value === "string" && (ENDING_CHOICES as readonly string[]).includes(value);
}
