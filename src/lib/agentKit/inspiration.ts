import type { VideoFeatures } from "@/lib/videoAnalysis/features";
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
 *    at least 5 videos, |ρ| ≥ 0.4 and a difference of a step or more, a "hint" with 3 or more, |ρ| ≥ 0.3 and half a step;
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
  trailColors: { field: "trailColors", link: "trc" },
  reactiveBackground: { field: "reactiveBackground", link: "bg" },
  theme: { field: "themeId", link: "theme" },
  backgroundType: { field: "backgroundType", link: "bgt" },
} as const;
export type LeverId = keyof typeof LEVERS;

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

/** What trending simulation videos are about, and which of our modes and Blueprint mechanics play the same idea. */
export const THEMES: readonly Theme[] = [
  { id: "multiply", label: "multiplying balls", words: ["multiply", "multiplying", "multiplies", "clone", "clones", "double", "doubling", "duplicate", "swarm", "spawn", "spawns", "hatch"], modes: ["multiply", "multipliers", "spiralGlass", "brickRebuild"], blueprints: ["hatchery", "ringBreaker"], mechanic: "a hit that adds balls: tileBroken → spawn (Glass Hatchery), or ringPass → split (Ring Breaker)" },
  { id: "escape", label: "escaping rings", words: ["escape", "escapes", "escaping", "ring", "rings", "gap", "gaps", "circle", "circles", "trapped", "prison", "out"], modes: ["classic", "accumulation", "shatter", "spiralGlass", "grow"], blueprints: ["ringBreaker", "growEscape"], mechanic: "rings with a gap that break on a pass: arena.shape rings with rings.breakOnPass" },
  { id: "marbleRun", label: "marble runs and pegs", words: ["marble", "marbles", "run", "escalator", "stairs", "staircase", "plinko", "peg", "pegs", "galton", "funnel", "track", "slide", "tower"], modes: ["drop", "bullseye", "beatMachine", "conveyor", "race"], blueprints: ["plinkoRace"], mechanic: "a peg field over a finish: obstacles pegGrid and an exit (Peg Race)" },
  { id: "race", label: "races", words: ["race", "racing", "races", "winner", "wins", "win", "first", "fastest", "who"], modes: ["race", "maze", "bullseye"], blueprints: ["plinkoRace"], mechanic: "first one out wins: finish escaped with winner firstOut" },
  { id: "battle", label: "battles", words: ["battle", "fight", "fights", "fighting", "war", "vs", "versus", "survive", "survival", "royale", "duel", "weapon", "weapons", "last", "kill"], modes: ["battle", "fightLeague", "stringBattle", "territory", "landClaim"], blueprints: ["conquer"], mechanic: "teams that convert on contact: ballHit with otherTeam → team (Colour Conquest)" },
  { id: "satisfying", label: "satisfying and calm", words: ["satisfying", "asmr", "relaxing", "relax", "sleep", "calm", "calming", "oddly", "perfect", "perfectly", "fit"], modes: ["colourSort", "perfectFit", "orbGrid", "pendulum", "collide"], blueprints: [], mechanic: null },
  { id: "music", label: "music and notes", words: ["music", "song", "songs", "beat", "beats", "piano", "melody", "note", "notes", "rhythm", "sound", "sounds", "bass", "musical", "harp", "xylophone"], modes: ["beatDrop", "beatMachine", "runner", "vortex", "polyrhythm", "drop", "hoops"], blueprints: [], mechanic: "a note on the beat: sound.bpm with when beat → sound" },
  { id: "wave", label: "pendulums and waves", words: ["pendulum", "pendulums", "wave", "waves", "harmonic", "sync", "synchronized", "metronome", "metronomes"], modes: ["pendulum", "doublePendulum", "waveTank", "orbGrid", "polyrhythm"], blueprints: [], mechanic: null },
  { id: "grow", label: "growing balls", words: ["grow", "grows", "growing", "bigger", "giant", "huge", "size", "expand", "expands"], modes: ["grow", "mergeRing"], blueprints: ["growEscape", "tierClimb"], mechanic: "a bounce that grows the ball: wallHit → grow (Grow or Go)" },
  { id: "destroy", label: "breaking and smashing", words: ["glass", "break", "breaks", "breaking", "smash", "smashing", "destroy", "destroys", "destruction", "shatter", "crash", "explode", "explosion", "brick", "bricks", "layers"], modes: ["glass", "shatter", "powerLayers", "brickRebuild", "spiralGlass"], blueprints: ["hatchery"], mechanic: "tiles that chip on every hit: tiles with style glass and hp (Glass Hatchery)" },
  { id: "colour", label: "colours and painting", words: ["color", "colors", "colour", "colours", "colorful", "colourful", "rainbow", "paint", "painting", "fill", "fills"], modes: ["paint", "territory", "colourSort", "landClaim", "colorMatch"], blueprints: ["conquer"], mechanic: "a colour change on every hit: wallHit → recolor next" },
  { id: "merge", label: "merging", words: ["merge", "merges", "merging", "fuse", "fusion", "combine", "2048", "suika", "watermelon"], modes: ["mergeRing"], blueprints: ["tierClimb"], mechanic: "two of a tier merge: ballHit with sameTier → merge (Tier Climb)" },
  { id: "maze", label: "mazes", words: ["maze", "mazes", "labyrinth"], modes: ["maze"], blueprints: [], mechanic: null },
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

/** A video's traits: its measured features where there are some, else what its page says (length, picture shape). */
export function clipTraits(features: VideoFeatures | null, meta?: Pick<VideoMeta, "durationSec" | "width" | "height"> | null): ClipTraits {
  const f = features;
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
    meanLuma: f?.meanLuma ?? null,
    meanSat: f?.meanSat ?? null,
    darkShare: f?.darkShare ?? null,
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
  /** (top − rest) in steps. */
  effect: number | null;
}

export interface Pattern {
  key: TraitKey;
  strength: "clear" | "hint";
  /** |ρ| × min(2, |effect|): how the patterns are ordered. */
  score: number;
  sentence: string;
}

export interface MetricRow {
  metric: number;
  traits: ClipTraits;
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
    const effect = top !== null && rest !== null ? round((top - rest) / spec.step, 2) : null;
    const ourValues = ours.map((t) => t[spec.key]).filter((v): v is number => v !== null);
    summaries.push({ key: spec.key, label: spec.label, unit: spec.unit, n: have.length, top: top === null ? null : round(top, spec.digits + 1), rest: rest === null ? null : round(rest, spec.digits + 1), all: median(values) === null ? null : round(median(values) as number, spec.digits + 1), ours: ourValues.length ? round(median(ourValues) as number, spec.digits + 1) : null, rho, effect });
    if (rho === null || effect === null) continue;
    const clear = have.length >= 5 && Math.abs(rho) >= 0.4 && Math.abs(effect) >= 1;
    const hint = have.length >= 3 && Math.abs(rho) >= 0.3 && Math.abs(effect) >= 0.5;
    if (!clear && !hint) continue;
    const more = effect > 0;
    patterns.push({
      key: spec.key,
      strength: clear ? "clear" : "hint",
      score: round(Math.abs(rho) * Math.min(2, Math.abs(effect)), 3),
      sentence: `The most viewed have ${more ? "more" : "less"} ${spec.label}: ${fmt(spec, top)} against ${fmt(spec, rest)} for the rest (ρ ${rho > 0 ? "+" : ""}${rho} over ${have.length} videos).`,
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
  modes: string[];
  blueprints: string[];
  mechanic: string | null;
}

/** The themes of a list of videos by their share of the views (most first; only themes with a video). */
export function themeShares(videos: readonly Pick<VideoMeta, "title" | "views">[], knownModes: readonly string[]): ThemeShare[] {
  const total = videos.reduce((s, v) => s + (v.views ?? 0), 0);
  const known = new Set(knownModes);
  return THEMES.map((t) => {
    const hits = videos.filter((v) => inTheme(t, v.title));
    const views = hits.reduce((s, v) => s + (v.views ?? 0), 0);
    return { id: t.id, label: t.label, videos: hits.length, viewShare: total > 0 ? round(views / total, 3) : 0, modes: t.modes.filter((m) => known.has(m)), blueprints: [...t.blueprints], mechanic: t.mechanic };
  })
    .filter((t) => t.videos > 0)
    .sort((a, b) => b.viewShare - a.viewShare || b.videos - a.videos || (a.id < b.id ? -1 : 1));
}

export interface TitleSummary {
  /** The words most used in the top third's titles. */
  topWords: { word: string; videos: number }[];
  /** Share of titles stating a number of 100 or more ("20,000 balls"): the top third and the rest. */
  bigNumber: { top: number | null; rest: number | null };
  /** Share of titles asking a question. */
  question: { top: number | null; rest: number | null };
}

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
    topWords: [...counts.entries()]
      .filter(([, n]) => n >= Math.min(2, top.length))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 12)
      .map(([word, videos]) => ({ word, videos })),
    bigNumber: { top: share(top, big), rest: share(rest, big) },
    question: { top: share(top, asks), rest: share(rest, asks) },
  };
}

export interface Lever {
  kind: "setting" | "mode" | "blueprint" | "tool";
  /** A settings field, a mode id, a Blueprint catalog id, or a tool of the toolbox. */
  name: string;
  /** The share-link key of a setting. */
  link?: string;
  value?: string | number | boolean;
}

export interface Recommendation {
  area: "length" | "hook" | "pace" | "look" | "sound" | "loop" | "format" | "title" | "mode" | "blueprint";
  advice: string;
  levers: Lever[];
  evidence: string;
  /** pattern: it separates the most viewed; benchmark: what the most viewed do; gap: our renders are a step away; theme: what they are about. */
  basis: "pattern" | "benchmark" | "gap" | "theme";
}

const setting = (id: LeverId, value?: string | number | boolean): Lever => ({ kind: "setting", name: LEVERS[id].field, link: LEVERS[id].link, ...(value !== undefined ? { value } : {}) });

/** One trait's benchmark, its pattern (when it has one) and our gap, as evidence and a basis. */
function weigh(s: TraitSummary | undefined, patterns: readonly Pattern[], spec: TraitSpec | undefined) {
  if (!s || !spec || s.top === null || s.n < MIN_VIDEOS_FOR_ADVICE) return null;
  const pattern = patterns.find((p) => p.key === s.key);
  const gap = s.ours !== null && Math.abs(s.ours - s.top) >= spec.step;
  const parts = [`most viewed ${fmt(spec, s.top)}`, s.rest !== null ? `rest ${fmt(spec, s.rest)}` : null, s.rho !== null ? `ρ ${s.rho > 0 ? "+" : ""}${s.rho} (n ${s.n})` : `n ${s.n}`, s.ours !== null ? `ours ${fmt(spec, s.ours)}` : null];
  return { top: s.top, ours: s.ours, gap, evidence: parts.filter(Boolean).join(", "), basis: (gap ? "gap" : pattern ? "pattern" : "benchmark") as Recommendation["basis"], pattern };
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
    out.push({ area: "length", advice: `Render ${sec} s clips${length.top < OUR_SHORTEST_CLIP_SEC ? ` (the shortest the export makes; the most viewed run ${round(length.top, 1)} s)` : ""}${length.gap ? `: ours run ${round(length.ours as number, 1)} s` : ""}.`, levers: [setting("clipLength", sec)], evidence: length.evidence, basis: length.basis });
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
    });
  }

  const lift = w("hookLift");
  if (lift && lift.top < 1 && lift.basis !== "benchmark") out.push({ area: "hook", advice: "The most viewed build up rather than open on their busiest moment: save the climax (slow motion on a near miss) for the second half.", levers: [setting("slowMo", true)], evidence: lift.evidence, basis: lift.basis });

  const peak = w("peakMotionPos");
  if (peak && (peak.pattern || peak.gap)) out.push({ area: "pace", advice: `Put the busiest moment ${peak.top >= 0.5 ? "late" : "early"} (about ${Math.round(peak.top * 100)}% in): choose the seed and the clip length so the finish lands there, and slow it down on a near miss.`, levers: [setting("clipLength"), setting("slowMo", true)], evidence: peak.evidence, basis: peak.basis });

  const cuts = w("cutsPerMin");
  if (cuts) {
    const many = cuts.top >= 6;
    out.push({ area: "pace", advice: many ? `The most viewed cut about ${Math.round(cuts.top)} times a minute: render several seeds of one link and cut between them, or show two at once in split screen.` : "One continuous take works: the most viewed hardly cut, so let the run play out.", levers: many ? [{ kind: "tool", name: "render" }] : [], evidence: cuts.evidence, basis: cuts.basis });
  }

  const sat = w("meanSat");
  const dark = w("darkShare");
  if (sat || dark) {
    const vivid = sat !== null && sat.top >= 0.45;
    const darkBg = dark !== null && dark.top >= 0.4;
    out.push({
      area: "look",
      advice: `${vivid ? "Use saturated colours (rainbow trails, a vivid theme)" : "Keep the colours calm (a muted theme)"}${darkBg ? " on a dark background" : dark ? " on a light or mid background" : ""}.`,
      levers: [setting("theme"), setting("trailColors"), setting("trails", true), setting("backgroundType")],
      evidence: [sat?.evidence, dark?.evidence].filter(Boolean).join("; "),
      basis: sat?.basis === "gap" || dark?.basis === "gap" ? "gap" : sat?.pattern || dark?.pattern ? "pattern" : "benchmark",
    });
  }

  const bpm = w("bpm");
  if (bpm) out.push({ area: "sound", advice: `Set the music to about ${Math.round(bpm.top)} bpm (Beat Drop, Beat Machines and Beat Runner land on it) and start it on the first bounce.`, levers: [setting("bpm", Math.round(bpm.top)), setting("musicStart"), { kind: "mode", name: "beatDrop" }, { kind: "mode", name: "beatMachine" }], evidence: bpm.evidence, basis: bpm.basis });

  const onsets = w("onsetsPerSec");
  if (onsets && onsets.top >= 2) out.push({ area: "sound", advice: `A sound on every hit: the most viewed carry about ${round(onsets.top, 1)} sound events a second, so pick a mode where many balls collide and each hit plays a note.`, levers: [{ kind: "mode", name: "collide" }, { kind: "mode", name: "drop" }], evidence: onsets.evidence, basis: onsets.basis });

  const lufs = w("lufs");
  if (lufs && Math.abs(lufs.top - OUR_LOUDNESS_LUFS) >= 2) out.push({ area: "sound", advice: `The most viewed are mixed at about ${round(lufs.top, 1)} LUFS, against the ${OUR_LOUDNESS_LUFS} LUFS our export normalises to: ${lufs.top > OUR_LOUDNESS_LUFS ? "a louder master is common, ours stays at the streaming target" : "ours is already louder"}.`, levers: [], evidence: lufs.evidence, basis: "benchmark" });

  const loop = w("loopSeamDiff");
  if (loop && loop.top <= LOOP_SEAMLESS_DIFF) out.push({ area: "loop", advice: "The most viewed loop: their last frame meets their first. Use a mode made to loop, or end the clip where the run looks like its start.", levers: LOOP_MODES.map((m) => ({ kind: "mode" as const, name: m })), evidence: loop.evidence, basis: loop.basis });

  const portrait = w("portrait");
  if (portrait && portrait.top >= 0.5) out.push({ area: "format", advice: "Portrait 1080 × 1920, as the most viewed are.", levers: [setting("resolution", "1080x1920")], evidence: portrait.evidence, basis: portrait.basis });

  if (titles.bigNumber.top !== null && titles.bigNumber.top >= 0.5 && (titles.bigNumber.rest === null || titles.bigNumber.top > titles.bigNumber.rest))
    out.push({ area: "title", advice: "Count something big in the title and on screen (\"20,000 balls\"): a ball counter caption and a mode where the count climbs.", levers: [setting("captions", "wallCounter"), { kind: "mode", name: "multiply" }, { kind: "mode", name: "multipliers" }], evidence: `titles with a number of 100 or more: most viewed ${titles.bigNumber.top}, rest ${titles.bigNumber.rest ?? "–"}`, basis: "pattern" });

  for (const t of themes.slice(0, 3)) {
    const videos = `${t.videos} video${t.videos === 1 ? "" : "s"}`;
    out.push({ area: "mode", advice: `"${t.label}" holds ${Math.round(t.viewShare * 100)}% of the views (${videos}): play it with ${t.modes.length ? t.modes.join(", ") : "a Blueprint"}.`, levers: t.modes.map((m) => ({ kind: "mode" as const, name: m })), evidence: `theme words in the titles of ${videos}`, basis: "theme" });
    if (t.mechanic) out.push({ area: "blueprint", advice: `As a Blueprint: ${t.mechanic}. Check it with bp-check until it is playable.`, levers: [...t.blueprints.map((b) => ({ kind: "blueprint" as const, name: b })), { kind: "tool", name: "bp-check" }], evidence: `theme "${t.label}"`, basis: "theme" });
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
  error?: string | null;
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
  /** The ones fetched and measured (or that failed). */
  analysed: readonly AnalysedVideo[];
  ours: readonly OwnClip[];
  /** The site's mode ids (a theme names only modes that exist). */
  modes: readonly string[];
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
  traits: ClipTraits;
}

export interface InspirationReport {
  v: typeof INSPIRATION_VERSION;
  query: string | null;
  at: string;
  metric: SortBy;
  counts: { candidates: number; analysed: number; failed: number; ours: number };
  videos: ReportVideo[];
  traits: TraitSummary[];
  patterns: Pattern[];
  titles: TitleSummary;
  themes: ThemeShare[];
  recommendations: Recommendation[];
  ours: { files: string[] } | null;
  notes: string[];
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
      traits: clipTraits(features, meta),
    };
  });
  const rows: MetricRow[] = videos.flatMap((v) => {
    const m = metricOf(v, input.sortBy);
    return m === null ? [] : [{ metric: m, traits: v.traits }];
  });
  const oursTraits = input.ours.map((o) => clipTraits(o.features));
  const { summaries, patterns } = traitSummaries(rows, oursTraits);
  const titled = videos.filter((v) => metricOf(v, input.sortBy) !== null);
  const titles = titleSummary(titled, titled.map((v) => metricOf(v, input.sortBy) as number));
  const themes = themeShares(videos, input.modes);
  const analysedCount = videos.filter((v) => v.analysed).length;
  const notes = [
    `Groups: the top third by ${input.sortBy === "viewsPerDay" ? "views per day" : "views"} against the rest, per trait over the videos that have it; ρ is Spearman's rank correlation with the same metric.`,
    "A handful of videos shows tendencies, not laws: test a recommendation on a few renders before making it a default.",
    "Titles and channel names are other creators' text, counted here as data.",
  ];
  if (analysedCount < MIN_VIDEOS_FOR_ADVICE) notes.push(`Only ${analysedCount} video${analysedCount === 1 ? " was" : "s were"} measured: the picture and sound traits need at least ${MIN_VIDEOS_FOR_ADVICE} for advice or a pattern (the length comes from the pages).`);
  return {
    v: INSPIRATION_VERSION,
    query: input.query,
    at: input.at,
    metric: input.sortBy,
    counts: { candidates: all.length, analysed: analysedCount, failed: input.analysed.filter((a) => !a.features).length, ours: input.ours.length },
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

const n = (v: number | null, digits = 0) => (v === null ? "–" : round(v, digits).toLocaleString("en-US"));

/** The report as Markdown (report.md beside report.json). */
export function inspirationMarkdown(r: InspirationReport): string {
  const lines: string[] = [];
  lines.push(`# Inspiration: ${mdText(r.query ?? "given links", 120)}`, "");
  lines.push(`${r.at} · ${r.counts.candidates} trending video${r.counts.candidates === 1 ? "" : "s"} · ${r.counts.analysed} measured · ${r.counts.failed} not fetched · ${r.counts.ours} of our renders · ranked by ${r.metric === "viewsPerDay" ? "views per day" : "views"}`, "");
  lines.push("## Recommendations", "");
  for (const rec of r.recommendations) {
    const levers = rec.levers.map((l) => (l.kind === "setting" ? `${l.name} (\`${l.link}\`${l.value !== undefined ? ` ${l.value}` : ""})` : `${l.kind} ${l.name}`)).join(", ");
    lines.push(`- **${rec.area}** (${rec.basis}): ${rec.advice}${levers ? ` Levers: ${levers}.` : ""} _${rec.evidence}_`);
  }
  lines.push("", "## Patterns that separate the most viewed", "");
  if (!r.patterns.length) lines.push("- None clear in this run (too few videos, or the traits do not separate them).");
  for (const p of r.patterns) lines.push(`- ${p.strength}: ${p.sentence}`);
  lines.push("", "## Traits", "", "| Trait | Most viewed | Rest | All | Ours | ρ | n |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const t of r.traits) lines.push(`| ${t.label} | ${t.top ?? "–"} | ${t.rest ?? "–"} | ${t.all ?? "–"} | ${t.ours ?? "–"} | ${t.rho ?? "–"} | ${t.n} |`);
  lines.push("", "## Themes", "");
  for (const t of r.themes.slice(0, 6)) lines.push(`- ${t.label}: ${Math.round(t.viewShare * 100)}% of the views, ${t.videos} video${t.videos === 1 ? "" : "s"}. Ours: ${t.modes.join(", ") || "–"}${t.blueprints.length ? `; Blueprints ${t.blueprints.join(", ")}` : ""}.`);
  if (r.titles.topWords.length) lines.push("", `Words of the most viewed titles: ${r.titles.topWords.map((w) => `${mdText(w.word, 30)} (${w.videos})`).join(", ")}.`);
  lines.push("", "## Videos", "", "| # | Views | Views/day | Length | Cuts/min | Hook motion | Tempo | Title | Link | Sheet |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const v of r.videos) {
    const sheet = v.frames?.sheet ? `\`${v.frames.sheet}\`` : v.error ? `not fetched: ${mdText(v.error, 60)}` : "–";
    lines.push(`| ${v.rank} | ${n(v.views)} | ${n(v.viewsPerDay)} | ${v.durationSec === null ? "–" : `${round(v.durationSec, 1)} s`} | ${n(v.traits.cutsPerMin, 1)} | ${n(v.traits.hookMotion, 3)} | ${n(v.traits.bpm)} | ${mdText(v.title, 60)} | <${v.url}> | ${sheet} |`);
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
