/**
 * Journey mode (feature gerald-journey): the stage list – which stages the ball clears on its way home, in which order
 * and how big each one is – as data, and its compact text form for the URL (`js`), presets and the panel.
 *
 * A stage is a kind and a size: "rings" (a compact concentric-rings escape like Classic), "glass" (panes from Glass
 * Smash), "pegs" (a Ball Drop peg field), "multipliers" (multiplier gate rows), "funnel" (a converging funnel),
 * "bullseye" (a landing target that scores) and "home" (the final doorway). The text form lists them top-down, comma
 * separated, a size suffix after a dash ("-s" small, "-l" large; medium has none): `rings,pegs-l,glass-s,home`. HOME is
 * always there and always last – `parseJourneyStages()` drops a "home" anywhere else and appends one when it is
 * missing – and at most `MAX_JOURNEY_STAGES` stages come before it. Everything here is pure; the auto sequence draws
 * from the generator it is given (the engine's seeded one), so a seed always makes the same journey.
 */

export const JOURNEY_STAGE_KINDS = ["rings", "glass", "pegs", "multipliers", "funnel", "bullseye", "home"] as const;
export type JourneyStageKind = (typeof JOURNEY_STAGE_KINDS)[number];

/** The kinds a journey may visit before HOME (the auto sequence and the panel's "add" menu pick from these). */
export const JOURNEY_TRAVEL_KINDS: readonly JourneyStageKind[] = ["rings", "glass", "pegs", "multipliers", "funnel", "bullseye"];

export const JOURNEY_SIZES = ["s", "m", "l"] as const;
export type JourneyStageSize = (typeof JOURNEY_SIZES)[number];

export interface JourneyStageSpec {
  kind: JourneyStageKind;
  size: JourneyStageSize;
}

/** Most stages before HOME. */
export const MAX_JOURNEY_STAGES = 12;
/** Longest text form the settings accept (12 stages of the longest name with a size, plus HOME). */
export const MAX_JOURNEY_TEXT = 200;

/**
 * The default journey – every kind of stage once, the rings twice (a small escape near the end, "the last stage is so
 * satisfying"): about 30 s at the default settings, the default clip length, with the seed moving it over some ±6 s,
 * which is what Find Simulation needs.
 */
export const DEFAULT_JOURNEY_STAGES = "rings,pegs,glass,multipliers,rings-s,funnel,bullseye,home";

export function isJourneyStageKind(value: unknown): value is JourneyStageKind {
  return typeof value === "string" && (JOURNEY_STAGE_KINDS as readonly string[]).includes(value);
}

export function isJourneyStageSize(value: unknown): value is JourneyStageSize {
  return typeof value === "string" && (JOURNEY_SIZES as readonly string[]).includes(value);
}

/** One token of the text form ("pegs-l", "glass", "RINGS-S"…), or null when it names no stage. */
export function parseJourneyToken(token: string): JourneyStageSpec | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const dash = t.lastIndexOf("-");
  const name = dash > 0 ? t.slice(0, dash) : t;
  const sizeText = dash > 0 ? t.slice(dash + 1) : "m";
  if (!isJourneyStageKind(name)) return null;
  const size: JourneyStageSize = isJourneyStageSize(sizeText) ? sizeText : sizeText === "small" ? "s" : sizeText === "large" ? "l" : "m";
  return { kind: name, size };
}

/**
 * The stage list of a text form: known tokens in order (unknown ones skipped), at most `MAX_JOURNEY_STAGES` before
 * HOME, a "home" anywhere but at the end dropped and HOME always last (its size kept when it was listed there). An
 * empty or unusable text gives just HOME.
 */
export function parseJourneyStages(text: unknown): JourneyStageSpec[] {
  const raw = typeof text === "string" ? text.slice(0, 4 * MAX_JOURNEY_TEXT) : "";
  const tokens = raw.split(/[,;\s|]+/);
  const out: JourneyStageSpec[] = [];
  let home: JourneyStageSpec | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const spec = parseJourneyToken(tokens[i]);
    if (!spec) continue;
    if (spec.kind === "home") {
      home = spec;
      continue;
    }
    home = null; // a HOME that is not the last listed stage does not count
    if (out.length < MAX_JOURNEY_STAGES) out.push(spec);
  }
  out.push(home ?? { kind: "home", size: "m" });
  return out;
}

/** The text form of a stage list (sizes as suffixes, medium without one). Assumes a normalised list (HOME last). */
export function formatJourneyStages(stages: readonly JourneyStageSpec[]): string {
  return stages.map((s) => (s.size === "m" ? s.kind : `${s.kind}-${s.size}`)).join(",");
}

/** Normalises any value into a valid text form: parsed, cleaned and formatted again (so the URL and presets only ever hold good lists). */
export function sanitizeJourneyStages(value: unknown): string {
  return formatJourneyStages(parseJourneyStages(value));
}

/** Weights of the sizes in an auto sequence: medium twice as likely as small or large. */
const SIZE_WEIGHTS: readonly [JourneyStageSize, number][] = [
  ["s", 1],
  ["m", 2],
  ["l", 1],
];

/**
 * A seeded random journey of `count` stages before HOME (1–`MAX_JOURNEY_STAGES`): each stage a travel kind that is not
 * the previous one's, with a size (small, medium, large at 1 : 2 : 1), and HOME last. Two numbers per stage from
 * `random`, always, so the same generator state makes the same journey.
 */
export function generateJourneyStages(count: number, random: () => number): JourneyStageSpec[] {
  const n = Math.max(1, Math.min(MAX_JOURNEY_STAGES, Math.round(Number.isFinite(count) ? count : 1)));
  const out: JourneyStageSpec[] = [];
  let previous: JourneyStageKind | null = null;
  const kinds = JOURNEY_TRAVEL_KINDS;
  const total = SIZE_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  for (let i = 0; i < n; i++) {
    const u = random();
    const v = random();
    // A kind other than the previous one: pick among the others.
    const choices = previous === null ? kinds.length : kinds.length - 1;
    let k = Math.min(choices - 1, Math.floor(u * choices));
    if (previous !== null && k >= kinds.indexOf(previous)) k++;
    const kind = kinds[k];
    let pick = v * total;
    let size: JourneyStageSize = "m";
    for (const [s, w] of SIZE_WEIGHTS) {
      if (pick < w) {
        size = s;
        break;
      }
      pick -= w;
    }
    out.push({ kind, size });
    previous = kind;
  }
  out.push({ kind: "home", size: "m" });
  return out;
}

/* ------------------------------------------------------------------ list edits (the panel) */

/** Moves stage `index` one place up (−1) or down (+1); HOME stays last. Returns the new text form. */
export function moveJourneyStage(text: string, index: number, direction: -1 | 1): string {
  const stages = parseJourneyStages(text);
  const last = stages.length - 1;
  const to = index + direction;
  if (index < 0 || index >= last || to < 0 || to >= last) return formatJourneyStages(stages);
  const [spec] = stages.splice(index, 1);
  stages.splice(to, 0, spec);
  return formatJourneyStages(stages);
}

/** Removes stage `index` (HOME cannot be removed). */
export function removeJourneyStage(text: string, index: number): string {
  const stages = parseJourneyStages(text);
  if (index >= 0 && index < stages.length - 1) stages.splice(index, 1);
  return formatJourneyStages(stages);
}

/** Adds a stage of `kind` right before HOME (nothing when the list is full). */
export function addJourneyStage(text: string, kind: JourneyStageKind, size: JourneyStageSize = "m"): string {
  const stages = parseJourneyStages(text);
  if (kind !== "home" && stages.length - 1 < MAX_JOURNEY_STAGES) stages.splice(stages.length - 1, 0, { kind, size });
  return formatJourneyStages(stages);
}

/** Sets the size of stage `index` (HOME included). */
export function resizeJourneyStage(text: string, index: number, size: JourneyStageSize): string {
  const stages = parseJourneyStages(text);
  if (index >= 0 && index < stages.length && isJourneyStageSize(size)) stages[index] = { ...stages[index], size };
  return formatJourneyStages(stages);
}
