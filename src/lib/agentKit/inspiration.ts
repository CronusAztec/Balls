import { pictureFeatures, type VideoFeatures } from "@/lib/videoAnalysis/features";
import type { SortBy, VideoMeta } from "./videoSources";

/*
 * --- inspiration --- The inspire tool's report: what separates the most viewed of the trending simulation videos from the
 * rest, and what that means for our clips, in our own levers (modes, settings and their link keys, Blueprint mechanics,
 * clip length, the hook, captions, music tempo). Pure maths on numbers already measured – each video's VideoMeta
 * (videoSources.ts: views, likes, upload date) and VideoFeatures (lib/videoAnalysis: pace, motion, colour, loudness, tempo,
 * the loop seam) – so the same input gives the same report (tests/inspiration.test.ts). scripts/agent/inspire.mjs fetches,
 * measures and writes it (.agent-out/inspiration/<date>-<slug>/report.json and report.md) and grows the dataset
 * (.agent-out/inspiration/dataset.jsonl, one line per video, deduplicated by its key).
 *
 * The method, kept plain on purpose (a handful of videos, not a study):
 *  - every trait is compared over the videos that have it: the top third by the run's metric (views, or views per day)
 *    against the rest, by their medians, and by Spearman's rank correlation with the metric over all of them;
 *  - a difference counts once it is at least one trait `step` (a change a viewer would notice); a pattern is "clear" with
 *    at least 5 videos, |ρ| ≥ 0.4, a two-sided p-value of ρ below CLEAR_P (0.05) and a difference of a step or more, a
 *    "hint" with 3 or more, |ρ| ≥ 0.3, p below HINT_P (0.2) and half a step, and either needs ρ and the difference to
 *    point the same way. --- inspiration --- The p-value makes the bar depend on n (ρ must reach 1.0 at 5 videos, 0.74 at
 *    8, 0.45 at 20): it counts every ordering of up to EXACT_P_MAX videos (spearmanP), Student's t beyond. Every pattern
 *    prints its n and p, and one of fewer than SMALL_SAMPLE videos is called a hunch;
 *  - a theme (the title words of a mechanic) is weighed by ranks, never by summed views, which one hit decides: its videos'
 *    median view percentile against the others', with and without its best video, from three videos up (themeAdvised);
 *  - the recommendations take the most viewed videos' medians as the benchmark, say where our own renders (when given)
 *    are a step or more away, and name the lever that moves each number. Titles and channels are other people's text:
 *    only counted, never followed.
 */

export const INSPIRATION_VERSION = 1;
/** A first and a last frame this close (mean absolute luma difference, 0–1) count as a seamless loop. */
export const LOOP_SEAMLESS_DIFF = 0.04;
/** A tempo is used only when the beat detector is at least this sure of it (0–1). */
export const BPM_MIN_CONFIDENCE = 0.3;
/** The loudness our export normalises to (lib/audio/loudness.ts LOUDNESS_TARGET_LUFS). */
export const OUR_LOUDNESS_LUFS = -14;
/** The shortest clip the export renders (seconds; settings RANGES.recordingDuration.min). */
export const OUR_SHORTEST_CLIP_SEC = 10;
/** A trait turns into advice only when at least this many videos have it (one or two videos are an anecdote). */
export const MIN_VIDEOS_FOR_ADVICE = 3;
/** --- inspiration --- How a short-form run names the longest short-form video (videoSources.ts SHORT_MAX_SEC). */
const SHORT_FORM_LABEL = "3 minutes";
/**
 * --- inspiration --- A theme turns into advice only from this many videos: one video's views are its own, not its theme's,
 * and with two a single hit decides their median (the October runs' "×5 escaping rings" was one video of 3.6M views).
 */
export const MIN_THEME_VIDEOS = 3;
/** --- inspiration --- Themes that name the genre, not a mechanic: listed with the others, never advice. */
export const GENERIC_THEMES: readonly string[] = ["satisfying"];
/** --- inspiration --- A pattern is "clear" only below this two-sided p-value of its ρ (and from 5 videos, |ρ| ≥ 0.4). */
export const CLEAR_P = 0.05;
/** --- inspiration --- A pattern is a "hint" only below this p-value (and from 3 videos, |ρ| ≥ 0.3). */
export const HINT_P = 0.2;
/** --- inspiration --- Below this many videos a pattern is a hunch: the report says so beside it and in its notes. */
export const SMALL_SAMPLE = 20;
/** --- inspiration --- Up to this many pairs spearmanP counts every ordering (9! = 362,880); beyond, Student's t. */
export const EXACT_P_MAX = 9;

/** The settings an advice names, with their link keys (tests/inspiration.test.ts checks each against lib/settings.ts). */
export const LEVERS = {
  clipLength: { field: "recordingDuration", link: "dur" },
  resolution: { field: "recordingResolution", link: "res" },
  bpm: { field: "bpm", link: "bpm" },
  musicStart: { field: "musicStartOffset", link: "mso" },
  captions: { field: "captions", link: "cap" },
  slowMo: { field: "slowMoOnNearMiss", link: "slow" },
  shake: { field: "screenShake", link: "shake" },
  trails: { field: "showTrails", link: "trails" },
  colorTrail: { field: "colorTrail", link: "ctrail" }, // --- inspiration --- (the colourful trail: rainbow without trailColors)
  trailColors: { field: "trailColors", link: "trc" },
  reactiveBackground: { field: "reactiveBackground", link: "bg" },
  theme: { field: "themeId", link: "theme" },
  backgroundType: { field: "backgroundType", link: "bgt" },
  backgroundColors: { field: "backgroundColors", link: "bg1" }, // --- inspiration --- (two colours: bg1 and bg2 in a link)
} as const;
export type LeverId = keyof typeof LEVERS;

/**
 * --- inspiration --- The looks the look advice names, as values a patch sets: a muted and a vivid theme of lib/themes.ts
 * (tests/inspiration.test.ts checks they exist), and two backgrounds by their colours – every theme's own background is
 * dark (pastel's #2b2d42 → #4a4e69, mono's black), so "a light or mid background" is a gradient of its own, kept mid
 * enough that a theme's light balls still show on it. The dark one is the simulator's plain background.
 */
export const LOOKS = {
  calmTheme: "pastel",
  vividTheme: "neon",
  lightGround: ["#a7b0c0", "#6b7486"],
  darkGround: ["#0a0a0a", "#1e293b"],
} as const;

/** The modes made to loop (they end where they began). */
export const LOOP_MODES: readonly string[] = ["starChords", "ellipseFoci", "pendulum", "polyrhythm", "colourSort", "orbGrid"];

export interface Theme {
  id: string;
  label: string;
  /** Title words (lower case, one word each) that put a video in the theme. */
  words: readonly string[];
  /** Our modes that play it (ids of lib/physics/types.ts MODE_IDS). */
  modes: readonly string[];
  /** Built-in Blueprints that play it (lib/blueprint/catalog) and the mechanic in the Blueprint vocabulary. */
  blueprints: readonly string[];
  mechanic: string | null;
}

/**
 * What trending simulation videos are about, and which of our modes and Blueprint mechanics play the same idea. A theme's
 * words name its mechanic: no stop word or filler that any title carries ("out", "who", "first", "last" were, and put an
 * apple bursting out of a grid among the ring escapes).
 */
export const THEMES: readonly Theme[] = [
  { id: "multiply", label: "multiplying balls", words: ["multiply", "multiplying", "multiplies", "clone", "clones", "double", "doubling", "duplicate", "swarm", "spawn", "spawns", "hatch"], modes: ["multiply", "multipliers", "spiralGlass", "brickRebuild"], blueprints: ["hatchery", "ringBreaker"], mechanic: "a hit that adds balls: tileBroken → spawn (Glass Hatchery), or ringPass → split (Ring Breaker)" },
  { id: "escape", label: "escaping rings", words: ["escape", "escapes", "escaping", "ring", "rings", "gap", "gaps", "circle", "circles", "trapped", "prison"], modes: ["classic", "accumulation", "shatter", "spiralGlass", "grow"], blueprints: ["ringBreaker", "growEscape"], mechanic: "rings with a gap that break on a pass: arena.shape rings with rings.breakOnPass" },
  { id: "marbleRun", label: "marble runs and pegs", words: ["marble", "marbles", "run", "escalator", "stairs", "staircase", "plinko", "peg", "pegs", "galton", "funnel", "track", "slide", "tower"], modes: ["drop", "bullseye", "beatMachine", "conveyor", "race"], blueprints: ["plinkoRace"], mechanic: "a peg field over a finish: obstacles pegGrid and an exit (Peg Race)" },
  { id: "race", label: "races", words: ["race", "racing", "races", "winner", "wins", "win", "fastest"], modes: ["race", "maze", "bullseye"], blueprints: ["plinkoRace"], mechanic: "first one out wins: finish escaped with winner firstOut" },
  { id: "battle", label: "battles", words: ["battle", "fight", "fights", "fighting", "war", "vs", "versus", "survive", "survival", "royale", "duel", "weapon", "weapons", "kill"], modes: ["battle", "fightLeague", "stringBattle", "territory", "landClaim"], blueprints: ["conquer"], mechanic: "teams that convert on contact: ballHit with otherTeam → team (Colour Conquest)" },
  { id: "satisfying", label: "satisfying and calm", words: ["satisfying", "asmr", "relaxing", "relax", "sleep", "calm", "calming", "oddly", "perfect", "perfectly", "fit"], modes: ["colourSort", "perfectFit", "orbGrid", "pendulum", "collide"], blueprints: [], mechanic: null },
  { id: "music", label: "music and notes", words: ["music", "song", "songs", "beat", "beats", "piano", "melody", "note", "notes", "rhythm", "sound", "sounds", "bass", "musical", "harp", "xylophone"], modes: ["beatDrop", "beatMachine", "runner", "vortex", "polyrhythm", "drop", "hoops"], blueprints: [], mechanic: "a note on the beat: sound.bpm with when beat → sound" },
  { id: "wave", label: "pendulums and waves", words: ["pendulum", "pendulums", "wave", "waves", "harmonic", "sync", "synchronized", "metronome", "metronomes"], modes: ["pendulum", "doublePendulum", "waveTank", "orbGrid", "polyrhythm"], blueprints: [], mechanic: null },
  { id: "grow", label: "growing balls", words: ["grow", "grows", "growing", "bigger", "giant", "huge", "size", "expand", "expands"], modes: ["grow", "mergeRing"], blueprints: ["growEscape", "tierClimb"], mechanic: "a bounce that grows the ball: wallHit → grow (Grow or Go)" },
  { id: "destroy", label: "breaking and smashing", words: ["glass", "break", "breaks", "breaking", "smash", "smashing", "destroy", "destroys", "destruction", "shatter", "crash", "explode", "explosion", "brick", "bricks", "layers"], modes: ["glass", "shatter", "powerLayers", "brickRebuild", "spiralGlass"], blueprints: ["hatchery"], mechanic: "tiles that chip on every hit: tiles with style glass and hp (Glass Hatchery)" },
  { id: "colour", label: "colours and painting", words: ["color", "colors", "colour", "colours", "colorful", "colourful", "rainbow", "paint", "painting", "fill", "fills"], modes: ["paint", "territory", "colourSort", "landClaim", "colorMatch"], blueprints: ["conquer"], mechanic: "a colour change on every hit: wallHit → recolor next" },
  { id: "merge", label: "merging", words: ["merge", "merges", "merging", "fuse", "fusion", "combine", "2048", "suika", "watermelon"], modes: ["mergeRing"], blueprints: ["tierClimb"], mechanic: "two of a tier merge: ballHit with sameTier → merge (Tier Climb)" },
  { id: "maze", label: "mazes", words: ["maze", "mazes", "labyrinth"], modes: ["maze"], blueprints: [], mechanic: null },
  // --- inspiration --- balls poured into a grid or a pile (the 3D "ball drop into grid" Shorts of October 2026)
  { id: "drop", label: "drops and piles", words: ["drop", "drops", "dropping", "fall", "falls", "falling", "pour", "pouring", "pile", "grid", "grids", "stack", "stacking"], modes: ["drop", "conveyor", "accumulation", "perfectFit", "multipliers"], blueprints: [], mechanic: null },
  { id: "string", label: "strings and drawings", words: ["string", "strings", "lines", "line", "art", "drawing", "draw", "draws", "spirograph", "geometry", "star", "stars"], modes: ["lines", "stringBattle", "starChords", "drawingMachine", "illusion"], blueprints: [], mechanic: null },
  { id: "spiral", label: "spirals and spinning", words: ["spiral", "vortex", "hole", "whirlpool", "spin", "spinning", "rotating", "hoop", "hoops"], modes: ["vortex", "spiralGlass", "hoops"], blueprints: [], mechanic: null },
  { id: "loop", label: "loops", words: ["loop", "looping", "loops", "infinite", "forever", "endless"], modes: LOOP_MODES, blueprints: [], mechanic: null },
];

/** The numbers each video is compared on. */
export interface ClipTraits {
  durationSec: number | null;
  /** 1 portrait, 0 landscape or square. */
  portrait: number | null;
  cutsPerMin: number | null;
  /** Mean motion after the first sample (mean absolute luma change between samples, 0–1). */
  motion: number | null;
  /** Mean motion in the first second (the hook). */
  hookMotion: number | null;
  /** First-second motion against the rest of the video (> 1: the opening moves more). */
  hookLift: number | null;
  firstMotionSec: number | null;
  peakMotionPos: number | null;
  meanLuma: number | null;
  meanSat: number | null;
  darkShare: number | null;
  loopSeamDiff: number | null;
  lufs: number | null;
  bpm: number | null;
  onsetsPerSec: number | null;
  firstSoundSec: number | null;
  silenceShare: number | null;
}
export type TraitKey = keyof ClipTraits;

export interface TraitSpec {
  key: TraitKey;
  label: string;
  unit: string;
  digits: number;
  /** A difference a viewer would notice (the unit a pattern's size is measured in). */
  step: number;
}

export const TRAITS: readonly TraitSpec[] = [
  { key: "durationSec", label: "length", unit: "s", digits: 1, step: 5 },
  { key: "portrait", label: "portrait share", unit: "", digits: 2, step: 0.25 },
  { key: "cutsPerMin", label: "cuts a minute", unit: "", digits: 1, step: 3 },
  { key: "motion", label: "motion", unit: "", digits: 3, step: 0.01 },
  { key: "hookMotion", label: "first-second motion", unit: "", digits: 3, step: 0.01 },
  { key: "hookLift", label: "hook lift (first second ÷ the rest)", unit: "×", digits: 2, step: 0.3 },
  { key: "firstMotionSec", label: "first motion", unit: "s", digits: 2, step: 0.5 },
  { key: "peakMotionPos", label: "peak motion position (0 start, 1 end)", unit: "", digits: 2, step: 0.15 },
  { key: "meanLuma", label: "brightness", unit: "", digits: 2, step: 0.05 },
  { key: "meanSat", label: "saturation", unit: "", digits: 2, step: 0.08 },
  { key: "darkShare", label: "dark share", unit: "", digits: 2, step: 0.1 },
  { key: "loopSeamDiff", label: "loop seam (0 seamless)", unit: "", digits: 3, step: 0.03 },
  { key: "lufs", label: "loudness", unit: "LUFS", digits: 1, step: 2 },
  { key: "bpm", label: "tempo", unit: "bpm", digits: 0, step: 10 },
  { key: "onsetsPerSec", label: "sound events a second", unit: "/s", digits: 1, step: 0.5 },
  { key: "firstSoundSec", label: "first sound", unit: "s", digits: 2, step: 0.3 },
  { key: "silenceShare", label: "silent share", unit: "", digits: 2, step: 0.1 },
];

/**
 * --- inspiration --- The traits a video has without being fetched whole: its page's length and shape, and its stills'
 * colours (inspire reads the stills of every video it does not fetch). The others – motion, cuts, the first second, the
 * loop seam, the sound – exist only for the videos inspire fetched, the top `top` of each list, so their "most viewed" and
 * "rest" are both within that top.
 */
export const LIST_TRAITS: readonly TraitKey[] = ["durationSec", "portrait", "meanLuma", "meanSat", "darkShare"];
/** --- inspiration --- Whether a trait spans the whole list ("list") or only the fetched top of it ("fetched"). */
export const traitScope = (key: TraitKey): "list" | "fetched" => (LIST_TRAITS.includes(key) ? "list" : "fetched");

/** --- inspiration --- What a video's numbers come from: the video measured whole, its public stills, or its page alone. */
export type Measured = "video" | "stills" | "page";
/** --- inspiration --- The traits a video's stills give (its colours); its length and shape then come from its page. */
export const STILLS_TRAITS: readonly TraitKey[] = ["meanLuma", "meanSat", "darkShare"];
/** --- inspiration --- Where one trait of a video comes from, given what the video was measured from. */
export const traitSource = (key: TraitKey, measured: Measured): Measured => (measured === "video" ? "video" : measured === "stills" && STILLS_TRAITS.includes(key) ? "stills" : "page");
/** --- inspiration --- How many of a trait's videos it was measured from, by source. */
export interface TraitSources {
  video: number;
  stills: number;
  page: number;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number, digits: number) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

/** The median of numbers (null for none). */
export function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Ranks from 1, ties sharing their mean rank. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation of two equally long lists (null below 3 pairs or when either does not vary). */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mx = mean(rx) as number;
  const my = mean(ry) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return round(sxy / Math.sqrt(sxx * syy), 3);
}

/* ------------------------------------------------------------------ --- inspiration --- how sure a ρ is */

/** ln Γ(x) for x > 0 (Lanczos, g = 7: about 15 digits). */
function lnGamma(x: number): number {
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  for (let i = 1; i < c.length; i++) a += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction of the incomplete beta function (modified Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const guard = (v: number) => (Math.abs(v) < tiny ? tiny : v);
  let c = 1;
  let d = 1 / guard(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    const even = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 / guard(1 + even * d);
    c = guard(1 + even / c);
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 / guard(1 + odd * d);
    c = guard(1 + odd / c);
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) break;
  }
  return h;
}

/** The regularised incomplete beta function I_x(a, b). */
function betaIncomplete(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/**
 * --- inspiration --- The two-sided p-value of Spearman's ρ of two equally long lists: the share of the orderings of the
 * second list whose |ρ| is at least the one seen. Up to EXACT_P_MAX pairs it counts every ordering (ties kept as their mean
 * ranks), beyond that it takes Student's t with n − 2 degrees of freedom, as the usual tables do. null where spearman is
 * null (below 3 pairs, or a list that does not vary). Pure and exact for the same input.
 */
export function spearmanP(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mx = mean(rx) as number;
  const my = mean(ry) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const rho = sxy / Math.sqrt(sxx * syy);
  if (n <= EXACT_P_MAX) {
    // every ordering of ry against rx (Heap's algorithm, one swap a step): Σ rx·ry moves by the two swapped terms, and ranks
    // are halves, so the sums are exact and the comparison needs no tolerance beyond rounding of the centre
    const centre = n * mx * my;
    const seen = Math.abs(sxy) - 1e-9;
    const a = [...ry];
    let dot = rx.reduce((s, r, i) => s + r * a[i], 0);
    let hits = 0;
    let total = 0;
    const count = () => {
      total++;
      if (Math.abs(dot - centre) >= seen) hits++;
    };
    count();
    const c = new Array<number>(n).fill(0);
    for (let i = 1; i < n; ) {
      if (c[i] < i) {
        const j = i % 2 === 0 ? 0 : c[i];
        dot += rx[j] * (a[i] - a[j]) + rx[i] * (a[j] - a[i]);
        [a[i], a[j]] = [a[j], a[i]];
        count();
        c[i]++;
        i = 1;
      } else {
        c[i] = 0;
        i++;
      }
    }
    return hits / total;
  }
  if (Math.abs(rho) >= 1) return 0;
  const df = n - 2;
  const t2 = (rho * rho * df) / (1 - rho * rho);
  return Math.min(1, Math.max(0, betaIncomplete(df / (df + t2), df / 2, 0.5)));
}

/** --- inspiration --- A p-value as the report prints it: "p < 0.001", "p 0.012", "p 0.18". */
export function pText(p: number | null): string {
  if (p === null) return "p –";
  if (p < 0.001) return "p < 0.001";
  return `p ${p < 0.1 ? round(p, 3) : round(p, 2)}`;
}

/** --- inspiration --- A video's colours measured on its public stills (the stills fallback: scripts/agent/stills.mjs). */
export interface StillsColour {
  meanLuma: number;
  meanSat: number;
  darkShare: number;
  /** The stills measured (the moments of the video, never the cover). */
  stills: number;
}

/** The colours of a video's stills (16 × 16 RGB samples, as the analyser measures a video's): null without one. */
export function stillsColour(samples: readonly Uint8Array[]): StillsColour | null {
  const frames = samples.filter((s) => s.length > 0);
  if (!frames.length) return null;
  const p = pictureFeatures(frames, 1);
  if (p.meanLuma === null || p.meanSat === null || p.darkShare === null) return null;
  return { meanLuma: p.meanLuma, meanSat: p.meanSat, darkShare: p.darkShare, stills: frames.length };
}

/**
 * A video's traits: its measured features where there are some, else what its page says (length, picture shape) and, for a
 * video seen only through its stills, their colours.
 */
export function clipTraits(features: VideoFeatures | null, meta?: Pick<VideoMeta, "durationSec" | "width" | "height"> | null, colour?: StillsColour | null): ClipTraits {
  const f = features;
  const c = f ? null : (colour ?? null);
  const width = f?.width ?? meta?.width ?? null;
  const height = f?.height ?? meta?.height ?? null;
  let motion: number | null = null;
  let hookMotion: number | null = null;
  if (f && f.motion.length > 1) {
    motion = mean(f.motion.slice(1));
    const hookSamples = f.motion.slice(1, Math.max(2, Math.floor(f.sampleHz) + 1));
    hookMotion = mean(hookSamples);
  }
  const bpmSure = f?.bpm !== null && f?.bpm !== undefined && (f.bpmConfidence ?? 0) >= BPM_MIN_CONFIDENCE;
  return {
    durationSec: f?.durationSec ?? meta?.durationSec ?? null,
    portrait: width !== null && height !== null ? (height > width ? 1 : 0) : null,
    cutsPerMin: f?.cutsPerMin ?? null,
    motion: motion === null ? null : round(motion, 4),
    hookMotion: hookMotion === null ? null : round(hookMotion, 4),
    hookLift: motion !== null && hookMotion !== null && motion > 0 ? round(hookMotion / motion, 3) : null,
    firstMotionSec: f?.firstMotionSec ?? null,
    peakMotionPos: f?.peakMotionPos ?? null,
    meanLuma: f?.meanLuma ?? c?.meanLuma ?? null,
    meanSat: f?.meanSat ?? c?.meanSat ?? null,
    darkShare: f?.darkShare ?? c?.darkShare ?? null,
    loopSeamDiff: f?.loopSeamDiff ?? null,
    lufs: f?.lufs ?? null,
    bpm: bpmSure ? (f?.bpm ?? null) : null,
    onsetsPerSec: f?.onsetsPerSec ?? null,
    firstSoundSec: f?.firstSoundSec ?? null,
    silenceShare: f && f.silenceSec !== null && f.analysedSec > 0 ? round(f.silenceSec / f.analysedSec, 3) : null,
  };
}

export interface TraitSummary {
  key: TraitKey;
  label: string;
  unit: string;
  /** Videos with the trait and a metric value. */
  n: number;
  top: number | null;
  rest: number | null;
  all: number | null;
  /** Our renders' median (when they were measured). */
  ours: number | null;
  /** Spearman's ρ of the trait against the metric. */
  rho: number | null;
  /** --- inspiration --- The two-sided p-value of that ρ (spearmanP; 4 decimals). */
  p: number | null;
  /** (top − rest) in steps. */
  effect: number | null;
  /** --- inspiration --- Over the whole list ("list": its page, its stills) or the fetched top of it only ("fetched"). */
  scope: "list" | "fetched";
  /** --- inspiration --- How many of the n it was measured from, by source (rows that say how they were measured). */
  from: TraitSources;
}

export interface Pattern {
  key: TraitKey;
  strength: "clear" | "hint";
  /** |ρ| × min(2, |effect|): how the patterns are ordered. */
  score: number;
  /** --- inspiration --- The videos it rests on and the p-value of its ρ: below SMALL_SAMPLE videos it is a hunch. */
  n: number;
  p: number;
  sentence: string;
}

export interface MetricRow {
  metric: number;
  traits: ClipTraits;
  /** --- inspiration --- What the video's numbers come from (counted in a trait's `from`). */
  measured?: Measured;
}

/** The top third by metric (at least one, and at least one left for the rest when there are two or more). */
export function topCount(n: number): number {
  if (n <= 1) return n;
  return Math.min(n - 1, Math.max(1, Math.round(n / 3)));
}

const fmt = (spec: TraitSpec, v: number | null) => (v === null ? "–" : `${round(v, spec.digits)}${spec.unit && spec.unit !== "×" ? ` ${spec.unit}` : spec.unit}`);

/** Every trait's medians (the top third, the rest, all), its ρ with the metric and its effect; and the patterns among them. */
export function traitSummaries(rows: readonly MetricRow[], ours: readonly ClipTraits[] = []): { summaries: TraitSummary[]; patterns: Pattern[] } {
  const summaries: TraitSummary[] = [];
  const patterns: Pattern[] = [];
  for (const spec of TRAITS) {
    const have = rows.filter((r) => r.traits[spec.key] !== null && Number.isFinite(r.metric)).sort((a, b) => b.metric - a.metric);
    const values = have.map((r) => r.traits[spec.key] as number);
    const k = topCount(have.length);
    const top = median(values.slice(0, k));
    const rest = median(values.slice(k));
    const rho = spearman(values, have.map((r) => r.metric));
    const pRaw = spearmanP(values, have.map((r) => r.metric));
    const p = pRaw === null ? null : round(pRaw, 4);
    const effect = top !== null && rest !== null ? round((top - rest) / spec.step, 2) : null;
    const ourValues = ours.map((t) => t[spec.key]).filter((v): v is number => v !== null);
    const from: TraitSources = { video: 0, stills: 0, page: 0 };
    for (const r of have) if (r.measured) from[traitSource(spec.key, r.measured)]++;
    summaries.push({ key: spec.key, label: spec.label, unit: spec.unit, n: have.length, top: top === null ? null : round(top, spec.digits + 1), rest: rest === null ? null : round(rest, spec.digits + 1), all: median(values) === null ? null : round(median(values) as number, spec.digits + 1), ours: ourValues.length ? round(median(ourValues) as number, spec.digits + 1) : null, rho, p, effect, scope: traitScope(spec.key), from });
    // --- inspiration --- (a ρ and a difference of the medians that point opposite ways are no pattern: the most viewed third
    // differs from the rest by something else than the ranking, as when lists of two genres are pooled)
    if (rho === null || pRaw === null || effect === null || Math.sign(rho) !== Math.sign(effect)) continue;
    // --- inspiration --- the bar depends on n through p: |ρ| 0.52 over 8 videos (p 0.18) is a hint, not "clear"
    const clear = have.length >= 5 && Math.abs(rho) >= 0.4 && pRaw < CLEAR_P && Math.abs(effect) >= 1;
    const hint = have.length >= 3 && Math.abs(rho) >= 0.3 && pRaw < HINT_P && Math.abs(effect) >= 0.5;
    if (!clear && !hint) continue;
    const more = effect > 0;
    patterns.push({
      key: spec.key,
      strength: clear ? "clear" : "hint",
      score: round(Math.abs(rho) * Math.min(2, Math.abs(effect)), 3),
      n: have.length,
      p: p as number,
      sentence: `The most viewed have ${more ? "more" : "less"} ${spec.label}: ${fmt(spec, top)} against ${fmt(spec, rest)} for the rest (ρ ${rho > 0 ? "+" : ""}${rho}, n ${have.length}, ${pText(pRaw)}).`,
    });
  }
  patterns.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  return { summaries, patterns };
}

const STOP_WORDS = new Set(
  "a an and are as at be by can do for from has have how i if in is it its just me my no not of on or our out so that the this to up vs was we what when which who will with you your shorts short video videos youtube tiktok reels reel fyp viral trending foryou subscribe like part new".split(" "),
);

/** A title's words: lower case, letters and digits only, without stop words and one-letter words. */
export function titleWords(title: string | null): string[] {
  if (!title) return [];
  return title
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

/** The largest number a title states ("20,000 balls" → 20000), a year aside ("2023 compilation"); null without one. */
export function titleNumber(title: string | null): number | null {
  if (!title) return null;
  let best: number | null = null;
  for (const m of title.matchAll(/\d{1,3}(?:[,.\s]\d{3})+|\d+/g)) {
    if (/^(19|20)\d\d$/.test(m[0])) continue;
    if (/^\s*%/.test(title.slice((m.index ?? 0) + m[0].length))) continue; // --- inspiration --- a share ("0% vs 100%") is no count
    const n = Number(m[0].replace(/[,.\s]/g, ""));
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

/** Whether a title belongs to a theme (any of its words). */
export function inTheme(theme: Theme, title: string | null): boolean {
  const words = new Set(title ? title.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u) : []);
  return theme.words.some((w) => words.has(w));
}

export interface ThemeShare {
  id: string;
  label: string;
  videos: number;
  /** The theme's share of all the views in the list (0–1). */
  viewShare: number;
  /**
   * --- inspiration --- Its share of the videos (0–1), and of the views per share of the videos (`lift`: above 1 its views
   * beat its count). Both sum views, so one hit decides them: they describe the list, they never make a theme advice.
   */
  videoShare: number;
  lift: number;
  /**
   * --- inspiration --- How its videos rank: the median view percentile of its videos in their own lists (0 the least
   * viewed, 1 the most), the same for the other videos, and its own median again without its best-ranked video – so one
   * outlier neither makes nor carries a theme. null without a video with views.
   */
  rank: number | null;
  restRank: number | null;
  rankWithoutTop: number | null;
  /** The share of the theme's views its most viewed video carries (0–1; null without views). */
  topShare: number | null;
  /** --- inspiration --- Whether it is advice: see themeAdvised. */
  advised: boolean;
  modes: string[];
  blueprints: string[];
  mechanic: string | null;
}

/** --- inspiration --- A video as the themes read it: its title, its views and, when the caller ranked it, its percentile. */
export interface ThemeVideo {
  title: string | null;
  views: number | null;
  /** Its view percentile in its own list (0–1); left out: ranked by views within this list. */
  pct?: number | null;
}

/**
 * --- inspiration --- Each value's percentile within its list: 0 the least, 1 the most, ties sharing theirs, 0.5 alone; null
 * for a missing one. Ranks, not sizes: a video of 3.6 million views is the top of its list as one of 80,000 is of another.
 */
export function percentiles(values: readonly (number | null)[]): (number | null)[] {
  const at = values.flatMap((v, i) => (v !== null && Number.isFinite(v) ? [i] : []));
  const out: (number | null)[] = values.map(() => null);
  const r = ranks(at.map((i) => values[i] as number));
  at.forEach((i, k) => {
    out[i] = at.length > 1 ? round((r[k] - 1) / (at.length - 1), 4) : 0.5;
  });
  return out;
}

/**
 * --- inspiration --- A theme is advice when its videos rank above the others': from MIN_THEME_VIDEOS videos, its median
 * view percentile above the others' with and without its best-ranked video, and it names a mechanic rather than the genre
 * ("satisfying" is in most titles of it). Summed views never decide it.
 */
export function themeAdvised(t: Pick<ThemeShare, "id" | "videos" | "rank" | "restRank" | "rankWithoutTop">): boolean {
  if (t.videos < MIN_THEME_VIDEOS || GENERIC_THEMES.includes(t.id)) return false;
  if (t.rank === null || t.restRank === null || t.rankWithoutTop === null) return false;
  return t.rank > t.restRank && t.rankWithoutTop > t.restRank;
}

/**
 * The themes of a list of videos (only themes with a video), the most viewed share first: their share of the views and of
 * the videos, how their videos rank against the others' (by each video's `pct`, else its view percentile in this list),
 * and whether that makes them advice (themeAdvised).
 */
export function themeShares(videos: readonly ThemeVideo[], knownModes: readonly string[]): ThemeShare[] {
  const total = videos.reduce((s, v) => s + (v.views ?? 0), 0);
  const known = new Set(knownModes);
  const own = percentiles(videos.map((v) => v.views));
  const pct = videos.map((v, i) => (v.pct !== undefined ? v.pct : own[i]));
  const at = (list: number[]) => (list.length ? round(median(list) as number, 3) : null);
  return THEMES.map((t) => {
    const inside = videos.map((v) => inTheme(t, v.title));
    const hits = videos.filter((_, i) => inside[i]);
    const views = hits.reduce((s, v) => s + (v.views ?? 0), 0);
    const viewShare = total > 0 ? views / total : 0;
    const videoShare = videos.length ? hits.length / videos.length : 0;
    const ranked = pct.filter((p, i): p is number => inside[i] && p !== null).sort((a, b) => b - a);
    const others = pct.filter((p, i): p is number => !inside[i] && p !== null);
    const top = hits.reduce((m, v) => Math.max(m, v.views ?? 0), 0);
    const share: Omit<ThemeShare, "advised"> = {
      id: t.id,
      label: t.label,
      videos: hits.length,
      viewShare: round(viewShare, 3),
      videoShare: round(videoShare, 3),
      lift: videoShare > 0 ? round(viewShare / videoShare, 2) : 0,
      rank: at(ranked),
      restRank: at(others),
      rankWithoutTop: at(ranked.slice(1)),
      topShare: views > 0 ? round(top / views, 3) : null,
      modes: t.modes.filter((m) => known.has(m)),
      blueprints: [...t.blueprints],
      mechanic: t.mechanic,
    };
    return { ...share, advised: themeAdvised(share) };
  })
    .filter((t) => t.videos > 0)
    .sort((a, b) => b.viewShare - a.viewShare || b.videos - a.videos || (a.id < b.id ? -1 : 1));
}

export interface TitleSummary {
  /** --- inspiration --- The titles counted, and how many of them are the top third (the most viewed). */
  n: number;
  top: number;
  /** The words most used in the top third's titles. */
  topWords: { word: string; videos: number }[];
  /** Share of titles stating a number of 100 or more ("20,000 balls"): the top third and the rest. */
  bigNumber: { top: number | null; rest: number | null };
  /** Share of titles asking a question. */
  question: { top: number | null; rest: number | null };
  /** --- inspiration --- Every title format (TITLE_FORMATS): its share of the top third's titles, the rest's and all of them. */
  formats: { id: string; label: string; top: number | null; rest: number | null; all: number | null }[];
}

/** --- inspiration --- The title formats trending videos use, each a test on the title. */
export const TITLE_FORMATS: readonly { id: string; label: string; test: (title: string) => boolean }[] = [
  { id: "question", label: "a question", test: (t) => t.includes("?") },
  { id: "bigNumber", label: "a count of 100 or more", test: (t) => (titleNumber(t) ?? 0) >= 100 },
  { id: "versus", label: "a versus (A vs B)", test: (t) => /(^|[^\p{L}])(vs\.?|versus)([^\p{L}]|$)/iu.test(t) },
  { id: "escalation", label: "a scale stepped up (0% vs 100%, small to big)", test: (t) => /\d+\s*%\s*(vs\.?|to|→|->)\s*\d+\s*%|\b(small|low|slow|weak|tiny)\s+(to|vs\.?|&)\s+(big|high|fast|strong|giant|huge)\b|\bbig\s*&\s*small\b|\blevel\s*\d+/iu.test(t) },
  { id: "series", label: "a numbered series (Day 12, Part 3)", test: (t) => /\b(day|part|ep|episode)\s*\d+/iu.test(t) },
];

/** What the titles of the most viewed say, against the rest (the list sorted by `metric`, most first). */
export function titleSummary(videos: readonly Pick<VideoMeta, "title">[], metric: readonly number[]): TitleSummary {
  const order = videos.map((v, i) => ({ v, m: metric[i] ?? 0 })).sort((a, b) => b.m - a.m);
  const k = topCount(order.length);
  const top = order.slice(0, k).map((x) => x.v);
  const rest = order.slice(k).map((x) => x.v);
  const counts = new Map<string, number>();
  for (const v of top) for (const w of new Set(titleWords(v.title))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const share = (list: typeof top, test: (t: string | null) => boolean) => (list.length ? round(list.filter((v) => test(v.title)).length / list.length, 2) : null);
  const big = (t: string | null) => (titleNumber(t) ?? 0) >= 100;
  const asks = (t: string | null) => !!t && t.includes("?");
  return {
    n: order.length,
    top: k,
    topWords: [...counts.entries()]
      .filter(([, n]) => n >= Math.min(2, top.length))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 12)
      .map(([word, videos]) => ({ word, videos })),
    bigNumber: { top: share(top, big), rest: share(rest, big) },
    question: { top: share(top, asks), rest: share(rest, asks) },
    formats: TITLE_FORMATS.map((f) => {
      const test = (t: string | null) => !!t && f.test(t);
      return { id: f.id, label: f.label, top: share(top, test), rest: share(rest, test), all: share([...top, ...rest], test) };
    }),
  };
}

export interface Lever {
  kind: "setting" | "mode" | "blueprint" | "tool";
  /** A settings field, a mode id, a Blueprint catalog id, or a tool of the toolbox. */
  name: string;
  /** The share-link key of a setting. */
  link?: string;
  /** --- inspiration --- (a colour list – backgroundColors, trailColors – as its #rrggbb colours; [] for the rainbow trail) */
  value?: string | number | boolean | readonly string[];
}

export interface Recommendation {
  area: "length" | "hook" | "pace" | "look" | "sound" | "loop" | "format" | "title" | "mode" | "blueprint";
  advice: string;
  levers: Lever[];
  evidence: string;
  /** pattern: it separates the most viewed; benchmark: what the most viewed do; gap: our renders are a step away; theme: what they are about. */
  basis: "pattern" | "benchmark" | "gap" | "theme";
  /** --- inspiration --- The traits it rests on, the pattern's first (their n, ρ and p tag it in a prompt); [] for titles and themes. */
  traits: TraitKey[];
}

/** --- inspiration --- A percentile (0–1) as a whole number, and a share as a percentage ("–" for none). */
const percent = (p: number | null) => (p === null ? "–" : String(Math.round(p * 100)));
const shareText = (share: number | null) => (share === null ? "–" : `${Math.round(share * 100)}%`);
/** --- inspiration --- How far a theme's videos rank above the others' (its median percentile less theirs). */
const themeMargin = (t: ThemeShare) => (t.rank ?? 0) - (t.restRank ?? 0);

const setting = (id: LeverId, value?: Lever["value"]): Lever => ({ kind: "setting", name: LEVERS[id].field, link: LEVERS[id].link, ...(value !== undefined ? { value } : {}) });

/** --- inspiration --- The traits an advice rests on (those weighed), the ones with a pattern first. */
function restsOn(...pairs: [TraitKey, { pattern?: Pattern } | null | undefined][]): TraitKey[] {
  return pairs
    .filter(([, x]) => !!x)
    .sort((a, b) => (b[1]?.pattern ? 1 : 0) - (a[1]?.pattern ? 1 : 0))
    .map(([k]) => k);
}

/** One trait's benchmark, its pattern (when it has one) and our gap, as evidence and a basis. */
function weigh(s: TraitSummary | undefined, patterns: readonly Pattern[], spec: TraitSpec | undefined) {
  if (!s || !spec || s.top === null || s.n < MIN_VIDEOS_FOR_ADVICE) return null;
  const pattern = patterns.find((p) => p.key === s.key);
  const gap = s.ours !== null && Math.abs(s.ours - s.top) >= spec.step;
  const parts = [`most viewed ${fmt(spec, s.top)}`, s.rest !== null ? `rest ${fmt(spec, s.rest)}` : null, s.rho !== null ? `ρ ${s.rho > 0 ? "+" : ""}${s.rho} (n ${s.n})` : `n ${s.n}`, s.ours !== null ? `ours ${fmt(spec, s.ours)}` : null];
  return { top: s.top, all: s.all, ours: s.ours, gap, evidence: parts.filter(Boolean).join(", "), basis: (gap ? "gap" : pattern ? "pattern" : "benchmark") as Recommendation["basis"], pattern };
}

/** The recommendations: each measured trait's benchmark turned into our levers, then the themes' modes and mechanics. */
export function recommendations(summaries: readonly TraitSummary[], patterns: readonly Pattern[], themes: readonly ThemeShare[], titles: TitleSummary): Recommendation[] {
  const by = (k: TraitKey) => summaries.find((s) => s.key === k);
  const spec = (k: TraitKey) => TRAITS.find((t) => t.key === k);
  const w = (k: TraitKey) => weigh(by(k), patterns, spec(k));
  const out: Recommendation[] = [];

  const length = w("durationSec");
  if (length) {
    const sec = Math.max(OUR_SHORTEST_CLIP_SEC, Math.round(length.top));
    out.push({ area: "length", advice: `Render ${sec} s clips${length.top < OUR_SHORTEST_CLIP_SEC ? ` (the shortest the export makes; the most viewed run ${round(length.top, 1)} s)` : ""}${length.gap ? `: ours run ${round(length.ours as number, 1)} s` : ""}.`, levers: [setting("clipLength", sec)], evidence: length.evidence, basis: length.basis, traits: ["durationSec"] });
  }

  const hook = w("hookMotion");
  const first = w("firstMotionSec");
  if (hook || first) {
    const by1 = first ? round(first.top, 2) : null;
    out.push({
      area: "hook",
      advice: `Move from the first frame${by1 !== null ? ` (the most viewed are moving by ${by1} s)` : ""}: pick a seed whose first second already moves (simulate a few seeds and keep the one with the earliest action), and open on a question caption at 0 s.`,
      levers: [{ kind: "tool", name: "simulate" }, setting("captions", "question at 0 s"), setting("shake")],
      evidence: [hook?.evidence, first?.evidence].filter(Boolean).join("; "),
      basis: hook?.basis === "gap" || first?.basis === "gap" ? "gap" : hook?.pattern || first?.pattern ? "pattern" : "benchmark",
      traits: restsOn(["hookMotion", hook], ["firstMotionSec", first]),
    });
  }

  const lift = w("hookLift");
  if (lift && lift.top < 1 && lift.basis !== "benchmark") out.push({ area: "hook", advice: "The most viewed build up rather than open on their busiest moment: save the climax (slow motion on a near miss) for the second half.", levers: [setting("slowMo", true)], evidence: lift.evidence, basis: lift.basis, traits: ["hookLift"] });

  const peak = w("peakMotionPos");
  if (peak && (peak.pattern || peak.gap)) out.push({ area: "pace", advice: `Put the busiest moment ${peak.top >= 0.5 ? "late" : "early"} (about ${Math.round(peak.top * 100)}% in): choose the seed and the clip length so the finish lands there, and slow it down on a near miss.`, levers: [setting("clipLength"), setting("slowMo", true)], evidence: peak.evidence, basis: peak.basis, traits: ["peakMotionPos"] });

  const cuts = w("cutsPerMin");
  if (cuts) {
    const many = cuts.top >= 6;
    out.push({ area: "pace", advice: many ? `The most viewed cut about ${Math.round(cuts.top)} times a minute: render several seeds of one link and cut between them, or show two at once in split screen.` : "One continuous take works: the most viewed hardly cut, so let the run play out.", levers: many ? [{ kind: "tool", name: "render" }] : [], evidence: cuts.evidence, basis: cuts.basis, traits: ["cutsPerMin"] });
  }

  const sat = w("meanSat");
  const dark = w("darkShare");
  const luma = w("meanLuma");
  if (sat || dark || luma) {
    const vivid = sat !== null && sat.top >= 0.45;
    const darkBg = dark !== null && dark.top >= 0.4;
    // --- inspiration --- our renders against the trending clips as a whole: brightness seldom separates the most viewed, but
    // a picture far darker (or brighter) than all of them is a gap worth a test (two steps of brightness: 0.1 on 0–1)
    const step = spec("meanLuma")?.step ?? 0.05;
    const tone = luma && luma.ours !== null && luma.all !== null ? (luma.ours < luma.all - 2 * step ? "darker" : luma.ours > luma.all + 2 * step ? "brighter" : null) : null;
    const toneText = tone && luma ? `${tone === "darker" ? "lighten" : "darken"} the picture: ours are ${tone} than the trending clips (brightness ${round(luma.ours as number, 2)} against ${round(luma.all as number, 2)}), so try ${tone === "darker" ? "a light or mid background" : "a dark background"} on a few renders` : "";
    // --- inspiration --- each clause from its own number only: no saturation, no word on the colours (a trend summary drops
    // a number its searches disagree on), and no clause at all, no look advice
    const colours = sat ? (vivid ? `Use saturated colours (a vivid theme such as ${LOOKS.vividTheme}, rainbow trails)` : `Keep the colours calm (a muted theme such as ${LOOKS.calmTheme}, no trails)`) : null;
    // --- inspiration --- ours darker than the most viewed by a step of dark share, theirs dark as well: a dark ground that is
    // not all black – the dark pair as a gradient, black to slate, about two thirds of it under DARK_LUMA – never the solid
    // black that would widen the gap (the first TikTok run: ours 90% dark against their 71%)
    const dim = darkBg && dark.gap && dark.ours !== null && dark.ours > dark.top;
    const ground = dim ? `a dark background that is not all black (a gradient from black to slate: ours are ${Math.round((dark.ours as number) * 100)}% dark against ${Math.round(dark.top * 100)}%)` : darkBg ? "a dark background" : dark ? "a light or mid background" : null;
    const advice = colours ? `${colours}${toneText ? `, and ${toneText}` : ground ? ` on ${ground}` : ""}.` : toneText ? `${toneText[0].toUpperCase()}${toneText.slice(1)}.` : ground ? `Use ${ground}.` : null;
    // --- inspiration --- levers that make the look, each with its value: the theme (its palette), the trails (rainbow: the
    // colourful trail with no trail colours) and the background by its colours, the light one being no theme's
    const groundTone = tone === "darker" ? "light" : tone === "brighter" ? "dark" : dim ? "dim" : darkBg ? "dark" : dark ? "light" : null;
    const colourLevers = !colours ? [] : vivid ? [setting("theme", LOOKS.vividTheme), setting("trails", true), setting("colorTrail", true), setting("trailColors", [])] : [setting("theme", LOOKS.calmTheme), setting("trails", false)];
    const groundLevers = groundTone === "light" ? [setting("backgroundType", "gradient"), setting("backgroundColors", LOOKS.lightGround)] : groundTone === "dim" ? [setting("backgroundType", "gradient"), setting("backgroundColors", LOOKS.darkGround)] : groundTone === "dark" ? [setting("backgroundType", "solid"), setting("backgroundColors", LOOKS.darkGround)] : [];
    if (advice)
      out.push({
        area: "look",
        advice,
        levers: [...colourLevers, ...groundLevers],
        evidence: [sat?.evidence, dark?.evidence, luma ? `brightness: ${luma.evidence}${luma.all !== null ? `, all ${round(luma.all, 2)}` : ""}` : null].filter(Boolean).join("; "),
        basis: tone || sat?.basis === "gap" || dark?.basis === "gap" ? "gap" : sat?.pattern || dark?.pattern || luma?.pattern ? "pattern" : "benchmark",
        traits: restsOn(["meanSat", colours ? sat : null], ["darkShare", ground ? dark : null], ["meanLuma", tone ? luma : null]),
      });
  }

  const bpm = w("bpm");
  if (bpm) out.push({ area: "sound", advice: `Set the music to about ${Math.round(bpm.top)} bpm (Beat Drop, Beat Machines and Beat Runner land on it) and start it on the first bounce.`, levers: [setting("bpm", Math.round(bpm.top)), setting("musicStart"), { kind: "mode", name: "beatDrop" }, { kind: "mode", name: "beatMachine" }], evidence: bpm.evidence, basis: bpm.basis, traits: ["bpm"] });

  const onsets = w("onsetsPerSec");
  if (onsets && onsets.top >= 2) out.push({ area: "sound", advice: `A sound on every hit: the most viewed carry about ${round(onsets.top, 1)} sound events a second, so pick a mode where many balls collide and each hit plays a note.`, levers: [{ kind: "mode", name: "collide" }, { kind: "mode", name: "drop" }], evidence: onsets.evidence, basis: onsets.basis, traits: ["onsetsPerSec"] });

  const lufs = w("lufs");
  if (lufs && Math.abs(lufs.top - OUR_LOUDNESS_LUFS) >= 2) out.push({ area: "sound", advice: `The most viewed are mixed at about ${round(lufs.top, 1)} LUFS, against the ${OUR_LOUDNESS_LUFS} LUFS our export normalises to: ${lufs.top > OUR_LOUDNESS_LUFS ? "a louder master is common, ours stays at the streaming target" : "ours is already louder"}.`, levers: [], evidence: lufs.evidence, basis: "benchmark", traits: ["lufs"] });

  const loop = w("loopSeamDiff");
  if (loop && loop.top <= LOOP_SEAMLESS_DIFF) out.push({ area: "loop", advice: "The most viewed loop: their last frame meets their first. Use a mode made to loop, or end the clip where the run looks like its start.", levers: LOOP_MODES.map((m) => ({ kind: "mode" as const, name: m })), evidence: loop.evidence, basis: loop.basis, traits: ["loopSeamDiff"] });

  const portrait = w("portrait");
  if (portrait && portrait.top >= 0.5) out.push({ area: "format", advice: "Portrait 1080 × 1920, as the most viewed are.", levers: [setting("resolution", "1080x1920")], evidence: portrait.evidence, basis: portrait.basis, traits: ["portrait"] });

  if (titles.bigNumber.top !== null && titles.bigNumber.top >= 0.5 && (titles.bigNumber.rest === null || titles.bigNumber.top > titles.bigNumber.rest))
    out.push({ area: "title", advice: "Count something big in the title and on screen (\"20,000 balls\"): a ball counter caption and a mode where the count climbs.", levers: [setting("captions", "wallCounter"), { kind: "mode", name: "multiply" }, { kind: "mode", name: "multipliers" }], evidence: `titles with a number of 100 or more: most viewed ${titles.bigNumber.top}, rest ${titles.bigNumber.rest ?? "–"}`, basis: "pattern", traits: [] });

  // --- inspiration --- a question in the title: the comment bait the playbook's cliffhangers are made of
  if (titles.question.top !== null && titles.question.top >= 0.34 && (titles.question.rest === null || titles.question.top > titles.question.rest))
    out.push({ area: "title", advice: 'Ask what the viewer waits to see, in the title and in a question caption at 0 s ("Will the last ball get out?").', levers: [setting("captions", "question at 0 s")], evidence: `titles asking a question: most viewed ${titles.question.top}, rest ${titles.question.rest ?? "–"}`, basis: "pattern", traits: [] });

  // --- inspiration --- a theme is advice only when its videos rank above the others' (themeAdvised: three videos or more,
  // with and without its best one, a mechanic and not the genre's own word), the furthest above first
  for (const t of [...themes].filter((x) => x.advised).sort((a, b) => themeMargin(b) - themeMargin(a) || (a.id < b.id ? -1 : 1)).slice(0, 3)) {
    const videos = `${t.videos} video${t.videos === 1 ? "" : "s"}`;
    out.push({ area: "mode", advice: `"${t.label}" ranks above the rest: its ${videos} have a median view percentile of ${percent(t.rank)} against ${percent(t.restRank)} for the others (${percent(t.rankWithoutTop)} without the best of them): play it with ${t.modes.length ? t.modes.join(", ") : "a Blueprint"}.`, levers: t.modes.map((m) => ({ kind: "mode" as const, name: m })), evidence: `theme words in the titles of ${videos}; the most viewed carries ${shareText(t.topShare)} of their views`, basis: "theme", traits: [] });
    if (t.mechanic) out.push({ area: "blueprint", advice: `As a Blueprint: ${t.mechanic}. Check it with bp-check until it is playable.`, levers: [...t.blueprints.map((b) => ({ kind: "blueprint" as const, name: b })), { kind: "tool", name: "bp-check" }], evidence: `theme "${t.label}"`, basis: "theme", traits: [] });
  }
  const order: Record<Recommendation["basis"], number> = { gap: 0, pattern: 1, benchmark: 2, theme: 3 };
  return out.map((r, i) => ({ r, i })).sort((a, b) => order[a.r.basis] - order[b.r.basis] || a.i - b.i).map((x) => x.r);
}

export interface AnalysedVideo {
  meta: VideoMeta;
  /** The downloaded file (repository-relative), when it was fetched. */
  file?: string | null;
  features?: VideoFeatures | null;
  /** Repository-relative paths of the frames tool's contact sheets. */
  frames?: { dir: string; sheet: string | null; hookSheet: string | null } | null;
  /** Why it could not be fetched or measured (null for a video inspire did not try to fetch: one past its top). */
  error?: string | null;
  /**
   * --- inspiration --- Its public stills (scripts/agent/stills.mjs), for a video not measured whole: one that could not be
   * fetched, and every one of the list past the top inspire fetches.
   */
  stills?: VideoStills | null;
}

/** --- inspiration --- A video's stills as saved: their folder, their contact sheet, each still and their colours. */
export interface VideoStills {
  dir: string;
  sheet: string | null;
  files: { file: string; label: string; at: number | null }[];
  colour: StillsColour | null;
}

export interface OwnClip {
  file: string;
  features: VideoFeatures;
}

export interface InspirationInput {
  query: string | null;
  /** ISO time of the run. */
  at: string;
  sortBy: SortBy;
  /** Every trending video found (titles and themes are read over all of them). */
  candidates: readonly VideoMeta[];
  /** The ones fetched and measured (or that failed), and those past the top seen through their stills. */
  analysed: readonly AnalysedVideo[];
  ours: readonly OwnClip[];
  /** The site's mode ids (a theme names only modes that exist). */
  modes: readonly string[];
  /**
   * --- inspiration --- A short-form run (inspire's maxDurationSec at most SHORT_MAX_SEC): only the short-form videos are
   * compared, as our clips are short-form; a long compilation is another format, listed but left out of the numbers.
   */
  shortForm?: boolean;
  /** --- inspiration --- How many of the list inspire tried to fetch whole, from the top (its `top`). */
  top?: number;
}

export interface ReportVideo {
  rank: number;
  key: string;
  url: string;
  platform: string;
  title: string | null;
  channel: string | null;
  views: number | null;
  viewsPerDay: number | null;
  likes: number | null;
  comments: number | null;
  likeRate: number | null;
  durationSec: number | null;
  uploadDate: string | null;
  short: boolean;
  analysed: boolean;
  file: string | null;
  frames: AnalysedVideo["frames"];
  error: string | null;
  /** --- inspiration --- What its picture traits come from: the video, its public stills (colours only), or its page alone. */
  measured: "video" | "stills" | "page";
  stills: VideoStills | null;
  /** --- inspiration --- Whether it counts in the traits, patterns, titles and themes (a short-form run leaves long-form videos out). */
  compared: boolean;
  traits: ClipTraits;
}

export interface InspirationReport {
  v: typeof INSPIRATION_VERSION;
  query: string | null;
  at: string;
  metric: SortBy;
  counts: { candidates: number; analysed: number; failed: number; ours: number };
  /** --- inspiration --- Videos seen only through their public stills (fetching them failed). */
  stillsOnly: number;
  videos: ReportVideo[];
  traits: TraitSummary[];
  patterns: Pattern[];
  titles: TitleSummary;
  themes: ThemeShare[];
  recommendations: Recommendation[];
  ours: { files: string[] } | null;
  notes: string[];
}

/**
 * --- inspiration --- The note of a run with fewer than MIN_VIDEOS_FOR_ADVICE videos measured whole: how many were measured
 * whole, how many seen through their stills (the colours alone) and how many read from their pages (the length and shape
 * alone), so a colour pattern of stills beside it is not read as a picture measured whole. The motion, cuts, loop seam and
 * sound need videos measured whole; the colours need as many videos with a picture, whole or stills.
 */
export function measuredNote(whole: number, stills: number, pages: number): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const counts = [
    whole ? `Only ${whole} ${plural(whole, "video was", "videos were")} measured whole` : "No video was measured whole",
    stills ? `${stills} ${plural(stills, "was", "were")} seen through ${plural(stills, "its", "their")} public stills (the colours alone)` : "",
    pages ? `${pages} ${plural(pages, "was", "were")} read from ${plural(pages, "its page", "their pages")} (the length and shape alone)` : "",
  ].filter(Boolean);
  const listed = counts.length > 2 ? `${counts.slice(0, -1).join(", ")} and ${counts[counts.length - 1]}` : counts.join(" and ");
  const known = whole ? `rest on ${whole === 1 ? "that one video" : `those ${whole}`}` : "are unknown";
  const colours = whole + stills < MIN_VIDEOS_FOR_ADVICE ? `; the colours need ${MIN_VIDEOS_FOR_ADVICE} measured whole or seen through their stills` : "";
  return `${listed}: the motion, cuts, loop seam and sound ${known} and need at least ${MIN_VIDEOS_FOR_ADVICE} videos measured whole for advice or a pattern${colours}.`;
}

const metricOf = (m: Pick<VideoMeta, "views" | "viewsPerDay">, by: SortBy) => (by === "viewsPerDay" ? m.viewsPerDay : m.views);

/** The whole report (see the header). */
export function buildInspirationReport(input: InspirationInput): InspirationReport {
  const analysedByKey = new Map(input.analysed.map((a) => [a.meta.key, a]));
  const all = [...input.candidates];
  for (const a of input.analysed) if (!all.some((c) => c.key === a.meta.key)) all.push(a.meta);
  const videos: ReportVideo[] = all.map((meta, i) => {
    const a = analysedByKey.get(meta.key);
    const features = a?.features ?? null;
    const stills = features ? null : (a?.stills ?? null);
    return {
      rank: i + 1,
      key: meta.key,
      url: meta.url,
      platform: meta.platform,
      title: meta.title,
      channel: meta.channel,
      views: meta.views,
      viewsPerDay: meta.viewsPerDay,
      likes: meta.likes,
      comments: meta.comments,
      likeRate: meta.likeRate,
      durationSec: meta.durationSec,
      uploadDate: meta.uploadDate,
      short: meta.short,
      analysed: !!features,
      file: a?.file ?? null,
      frames: a?.frames ?? null,
      error: a?.error ?? null,
      measured: features ? "video" : stills ? "stills" : "page",
      stills,
      compared: !input.shortForm || meta.short,
      traits: clipTraits(features, meta, stills?.colour),
    };
  });
  const compared = videos.filter((v) => v.compared);
  const rows: MetricRow[] = compared.flatMap((v) => {
    const m = metricOf(v, input.sortBy);
    return m === null ? [] : [{ metric: m, traits: v.traits, measured: v.measured }];
  });
  const oursTraits = input.ours.map((o) => clipTraits(o.features));
  const { summaries, patterns } = traitSummaries(rows, oursTraits);
  const titled = compared.filter((v) => metricOf(v, input.sortBy) !== null);
  const titles = titleSummary(titled, titled.map((v) => metricOf(v, input.sortBy) as number));
  const themes = themeShares(compared, input.modes);
  const analysedCount = videos.filter((v) => v.analysed).length;
  const stillsOnly = videos.filter((v) => v.measured === "stills").length;
  const notes = [
    `Groups: the top third by ${input.sortBy === "viewsPerDay" ? "views per day" : "views"} against the rest, per trait over the videos that have it; ρ is Spearman's rank correlation with the same metric.`,
    "A handful of videos shows tendencies, not laws: test a recommendation on a few renders before making it a default.",
    "Titles and channel names are other creators' text, counted here as data.",
  ];
  // --- inspiration --- a pattern of fewer than SMALL_SAMPLE videos is a hunch: |ρ| has to be large to mean anything
  const hunches = patterns.filter((p) => p.n < SMALL_SAMPLE);
  if (rows.length > 0 && rows.length < SMALL_SAMPLE) notes.push(`Small sample: ${rows.length} video${rows.length === 1 ? "" : "s"} compared, fewer than ${SMALL_SAMPLE}, so treat every pattern as a hunch until a larger run agrees (each pattern prints its n and p; "clear" needs p below ${CLEAR_P}, a "hint" below ${HINT_P}).`);
  else if (hunches.length) notes.push(`Small sample for ${hunches.map((p) => `${TRAITS.find((t) => t.key === p.key)?.label ?? p.key} (n ${p.n})`).join(", ")}: fewer than ${SMALL_SAMPLE} videos have ${hunches.length === 1 ? "it" : "them"}, so treat ${hunches.length === 1 ? "that pattern" : "those patterns"} as a hunch until a larger run agrees.`);
  if (analysedCount < MIN_VIDEOS_FOR_ADVICE) notes.push(measuredNote(analysedCount, stillsOnly, videos.length - analysedCount - stillsOnly));
  // --- inspiration --- a short-form run compares short-form videos only
  const longForm = videos.length - compared.length;
  if (longForm) notes.push(compared.length ? `${longForm} long-form video${longForm === 1 ? " is" : "s are"} listed but left out of the numbers (landscape, longer than ${SHORT_FORM_LABEL} or not a Short): our clips are short-form.` : `No short-form video was found, so nothing is compared: try a shorter query with a hashtag feed (ball simulation, physics simulation) or give TikTok, Instagram or YouTube Shorts links.`);
  // --- inspiration --- the stills fallback, and the stills of the list past the top
  const failedStills = videos.filter((v) => v.measured === "stills" && v.error).length;
  const listStills = stillsOnly - failedStills;
  if (failedStills) notes.push(`${failedStills} video${failedStills === 1 ? "" : "s"} could not be fetched and ${failedStills === 1 ? "was" : "were"} seen through YouTube's public stills (the opening frame, 25%, 50%, 75% and the cover): their brightness, saturation and dark share come from those four moments, not the whole video, and their stills-sheet.png shows them.`);
  if (listStills) notes.push(`${listStills} video${listStills === 1 ? "" : "s"} past the ${input.top ?? "fetched"} fetched ${listStills === 1 ? "was" : "were"} seen through ${listStills === 1 ? "its" : "their"} public stills alone (four moments each, no download), so the colours compare the most viewed with the whole list.`);
  // --- inspiration --- what the motion and sound traits compare: the fetched top of the list only
  const fetched = compared.filter((v) => v.measured === "video").length;
  if (fetched > 0 && fetched < compared.length) notes.push(`Motion, cuts, the first second, the loop seam and the sound come only from the ${fetched} video${fetched === 1 ? "" : "s"} measured whole (the top of the list): for those traits "the most viewed" and "the rest" are both within ${fetched === 1 ? "it" : "them"} (a trait's scope says so). The length, the shape and the colours span ${stillsOnly ? "the list" : "every video that has them"}.`);
  return {
    v: INSPIRATION_VERSION,
    query: input.query,
    at: input.at,
    metric: input.sortBy,
    counts: { candidates: all.length, analysed: analysedCount, failed: input.analysed.filter((a) => !a.features && !!a.error).length, ours: input.ours.length },
    stillsOnly,
    videos,
    traits: summaries,
    patterns,
    titles,
    themes,
    recommendations: recommendations(summaries, patterns, themes, titles),
    ours: input.ours.length ? { files: input.ours.map((o) => o.file) } : null,
    notes,
  };
}

/** Markdown-safe text: one line, no table pipes, no markup that could link or embed. */
export function mdText(text: string | null, max = 80): string {
  if (!text) return "–";
  const t = text.replace(/[|`*_[\]<>#\\]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || "–";
}

/** --- inspiration --- A lever's value as text: a colour list as [#a, #b] ([] the rainbow trail). */
export const leverValueText = (value: NonNullable<Lever["value"]>): string => (Array.isArray(value) ? `[${value.join(", ")}]` : String(value));

const n = (v: number | null, digits = 0) => (v === null ? "–" : round(v, digits).toLocaleString("en-US"));

/** The report as Markdown (report.md beside report.json). */
export function inspirationMarkdown(r: InspirationReport): string {
  const lines: string[] = [];
  lines.push(`# Inspiration: ${mdText(r.query ?? "given links", 120)}`, "");
  const failedStills = r.videos.filter((v) => v.measured === "stills" && v.error).length;
  const listStills = r.videos.filter((v) => v.measured === "stills" && !v.error).length;
  lines.push(`${r.at} · ${r.counts.candidates} trending video${r.counts.candidates === 1 ? "" : "s"} · ${r.counts.analysed} measured whole · ${r.counts.failed} not fetched${failedStills ? ` (${failedStills} seen from stills)` : ""}${listStills ? ` · ${listStills} more seen from stills` : ""} · ${r.counts.ours} of our renders · ranked by ${r.metric === "viewsPerDay" ? "views per day" : "views"}`, "");
  lines.push("## Recommendations", "");
  for (const rec of r.recommendations) {
    const levers = rec.levers.map((l) => (l.kind === "setting" ? `${l.name} (\`${l.link}\`${l.value !== undefined ? ` ${leverValueText(l.value)}` : ""})` : `${l.kind} ${l.name}`)).join(", ");
    lines.push(`- **${rec.area}** (${rec.basis}): ${rec.advice}${levers ? ` Levers: ${levers}.` : ""} _${rec.evidence}_`);
  }
  lines.push("", "## Patterns that separate the most viewed", "");
  if (!r.patterns.length) lines.push("- None clear in this run (too few videos, or the traits do not separate them).");
  for (const p of r.patterns) lines.push(`- ${p.strength}${p.n < SMALL_SAMPLE ? " (small sample: treat it as a hunch)" : ""}: ${p.sentence}`);
  lines.push("", "## Traits", "", "| Trait | Most viewed | Rest | All | Ours | ρ | p | n | Over |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of r.traits) lines.push(`| ${t.label} | ${t.top ?? "–"} | ${t.rest ?? "–"} | ${t.all ?? "–"} | ${t.ours ?? "–"} | ${t.rho ?? "–"} | ${t.p === null ? "–" : pText(t.p).replace(/^p /, "")} | ${t.n} | ${t.scope === "fetched" ? "the fetched top" : "the list"} |`);
  lines.push("", "## Themes", "");
  for (const t of r.themes.slice(0, 6)) lines.push(`- ${t.label}${t.advised ? " (ranks above the rest)" : ""}: ${t.videos} video${t.videos === 1 ? "" : "s"} (${Math.round(t.videoShare * 100)}% of them) with ${Math.round(t.viewShare * 100)}% of the views, the most viewed carrying ${shareText(t.topShare)} of theirs; median view percentile ${percent(t.rank)} against ${percent(t.restRank)} for the others (${percent(t.rankWithoutTop)} without its best). Ours: ${t.modes.join(", ") || "–"}${t.blueprints.length ? `; Blueprints ${t.blueprints.join(", ")}` : ""}.`);
  if (r.titles.topWords.length) lines.push("", `Words of the most viewed titles: ${r.titles.topWords.map((w) => `${mdText(w.word, 30)} (${w.videos})`).join(", ")}.`);
  lines.push("", "## Videos", "", "| # | Views | Views/day | Length | Cuts/min | Hook motion | Tempo | Title | Link | Sheet |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const v of r.videos) {
    const sheet = v.frames?.sheet ? `\`${v.frames.sheet}\`` : v.stills?.sheet ? `stills: \`${v.stills.sheet}\`` : v.error ? `not fetched: ${mdText(v.error, 60)}` : "–";
    lines.push(`| ${v.rank}${v.compared ? "" : " (long-form)"} | ${n(v.views)} | ${n(v.viewsPerDay)} | ${v.durationSec === null ? "–" : `${round(v.durationSec, 1)} s`} | ${n(v.traits.cutsPerMin, 1)} | ${n(v.traits.hookMotion, 3)} | ${n(v.traits.bpm)} | ${mdText(v.title, 60)} | <${v.url}> | ${sheet} |`);
  }
  if (r.ours) lines.push("", "## Our renders", "", ...r.ours.files.map((f) => `- \`${f}\``));
  lines.push("", "## Notes", "", ...r.notes.map((x) => `- ${x}`), "");
  return lines.join("\n");
}

/** One line of the dataset: a video's numbers, traits and features, without the motion curve and the cut list. */
export function datasetRecord(v: ReportVideo, features: VideoFeatures | null, query: string | null, at: string): Record<string, unknown> {
  const f = features ? { ...features, motion: undefined, cuts: features.cuts.length } : null;
  return {
    v: INSPIRATION_VERSION,
    key: v.key,
    url: v.url,
    platform: v.platform,
    title: v.title,
    channel: v.channel,
    views: v.views,
    viewsPerDay: v.viewsPerDay,
    likes: v.likes,
    comments: v.comments,
    likeRate: v.likeRate,
    durationSec: v.durationSec,
    uploadDate: v.uploadDate,
    short: v.short,
    query,
    analysedAt: at,
    traits: v.traits,
    features: f ? JSON.parse(JSON.stringify(f)) : null,
  };
}

/**
 * The dataset lines to append: the records whose key the dataset (its JSONL text) does not hold yet, each once. A line of
 * the dataset that cannot be read is left as it is and holds no key.
 */
export function datasetAppend(existing: string, records: readonly Record<string, unknown>[]): { lines: string[]; added: number; skipped: number; total: number } {
  const keys = new Set<string>();
  let total = 0;
  for (const line of existing.split("\n")) {
    if (!line.trim()) continue;
    total++;
    try {
      const o = JSON.parse(line) as { key?: unknown };
      if (typeof o.key === "string") keys.add(o.key);
    } catch {
      /* kept as it is */
    }
  }
  const lines: string[] = [];
  let skipped = 0;
  for (const r of records) {
    const key = typeof r.key === "string" ? r.key : null;
    if (!key || keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    lines.push(JSON.stringify(r));
  }
  return { lines, added: lines.length, skipped, total: total + lines.length };
}

/** A run folder's name: <YYYY-MM-DD>-<query slug> (letters, digits and dashes, at most 40 of them). */
export function runFolderName(at: string, query: string | null): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(at)?.[0] ?? "run";
  const slug = (query ?? "links")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${date}-${slug || "query"}`;
}
