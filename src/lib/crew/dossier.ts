import type { SimulatorSettings } from "@/lib/settings";
import { hasRingWalls, hudsOn } from "./hudFlags";
import { runWinnerOf, shownSecOf, type CrewClip } from "./clip";
import { clarityOf, type Clarity } from "./clarity";
import { crowding, drawnHookText, overlaysOf, type Overlay, type SimpleOptions } from "./simplicity";

/*
 * --- crew --- The clip dossier: what the crew's roles read about one clip, in two views.
 *
 *  - The intent view (`intentView()`, at most INTENT_MAX characters): everything the maker meant and everything measured – the
 *    template, its claim, the mode, platform, bucket, ending, length and seed; the beats (first impact, the hook's window, the
 *    countdown, the payoff and what it is, the cut, the end); the words (the drawn hook, the AI's own hook, the payoff, the
 *    question, the Top and Bottom Text); the text timeline; effects and HUDs; the gates; both scores with their reasons; the
 *    run's facts (winner, escape, finish, and what it plays and how it moves at the payoff – gate G2's reading); what a render
 *    measured (the watermark's address too); the other candidates' template and hook; a two-line
 *    research gap. One `key: value` line per DOSSIER_KEYS key, always in that order, so the same clip gives the same bytes on
 *    every run (the skeptic's and the reviewer's prompts share it, and a model's cache reuses it). The skeptic cites these keys
 *    as its evidence; `facts` holds each key's value as data for the evidence check.
 *  - The screen view (`screenView()`, at most SCREEN_MAX characters): only what is drawn and heard – a neutral line of the
 *    scene (from the settings' numbers, never the mode's name), the length, the look and the sound in words, every text with
 *    its seconds and place, the HUDs in words, a cut's extras, and after a render the motion in 8 parts and the sound events a
 *    second. It holds no intent: no template, format, claim, recipe or idea, and none of the words "template", "idea",
 *    "intent" or "payoff" outside the clip's own drawn words (tests/crewDossier.test.ts). The cold viewer reads it.
 *
 * Both views trim deterministically to their budgets: long quotes shorter first, then lists, then the drawn words to roles.
 * The intent view keeps the clip's own words (words.*, the winner) whole at every level (WORDS_MAX each): the skeptic and the
 * reviewer judge the hook by them, so the other candidates' hooks and the research are cut first (the studio's real run, with
 * three other candidates and two research lines, had shown the hook "15 pendulums. Wait for the chord." as "15 pendulums.
 * Wait …"). Pure: no clock, no randomness.
 */

// --- crew ---

export const INTENT_MAX = 1400;
export const SCREEN_MAX = 1200;
/** The longest quote of the clip's own words in the intent view, at every trim level (a hook has at most 42 characters). */
export const WORDS_MAX = 64;

/** The keys of the intent view, in its order: what the skeptic cites as evidence. */
export const DOSSIER_KEYS = [
  "clip.template",
  "clip.claim",
  "clip.mode",
  "clip.platform",
  "clip.bucket",
  "clip.ending",
  "clip.length",
  "clip.seed",
  "beats.firstImpact",
  "beats.hook",
  "beats.countdown",
  "beats.payoff",
  "beats.cut",
  "beats.end",
  "words.hook",
  "words.aiHook",
  "words.payoff",
  "words.question",
  "words.topText",
  "words.bottomText",
  "text.timeline",
  "text.atOnce",
  "look.effects",
  "look.huds",
  "gates",
  "score.simple",
  "score.simpleDeductions",
  "score.playbook",
  "score.playbookLost",
  "run.winner",
  "run.escape",
  "run.finish",
  "run.payoffMoment",
  "measured.firstMotion",
  "measured.peakMotion",
  "measured.lagged",
  "measured.watermark",
  "others",
  "research",
] as const;
export type DossierKey = (typeof DOSSIER_KEYS)[number];

export function isDossierKey(value: unknown): value is DossierKey {
  return typeof value === "string" && (DOSSIER_KEYS as readonly string[]).includes(value);
}

/** A fact's value: a number, words, a flag, none (null), a list, or a small record of numbers. */
export type DossierValue = string | number | boolean | null | readonly (string | number)[] | { readonly [k: string]: string | number | boolean | null };

export interface IntentDossier {
  v: 1;
  facts: { readonly [K in DossierKey]: DossierValue };
  text: string;
}

export interface ScreenView {
  v: 1;
  text: string;
}

/** Another candidate of the same run, as the skeptic sees it (so it can say "the same as another"). */
export interface OtherCandidate {
  template: string;
  hook: string;
}

export interface DossierInput {
  /** The clip's clarity check (computed when absent). */
  clarity?: Clarity;
  /** The other candidates' template and hook (at most 4 are shown). */
  others?: readonly OtherCandidate[];
  /** The research gap: at most two lines (the research brief's, a later step). */
  research?: readonly string[];
  simpleOptions?: SimpleOptions;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(100 * n);
/** A text as one quoted line, at most `max` characters of it ("…" where cut); 0: none of it. */
function quote(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  const chars = Array.from(flat);
  return `"${chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join("")}…` : flat}"`;
}
/** A counter caption's placeholders as a reader sees them change ("🧱 n/total", "⏱ m:ss", "pct %"). */
const counterWords = (text: string) => text.replace(/\[n\]/g, "n").replace(/\[total\]/g, "total").replace(/\[time\]/g, "m:ss").replace(/\[pct\]/g, "pct %");

/** The effects a clip's look adds (the Simple score's effect terms, in words). */
export function effectWords(s: SimulatorSettings): string[] {
  const ring = hasRingWalls(s.mode);
  const out: string[] = [];
  if (s.showGlow) out.push("glowing ball");
  if (ring && s.showWallGlow) out.push("glowing walls");
  if (s.showTrails) out.push(s.colorTrail ? "colour-cycling trails" : s.trailThickness > 0.8 + 1e-9 ? "thick trails" : "thin trails");
  if (ring && s.rainbowWalls) out.push("rainbow walls");
  if (s.rainbowBall) out.push("rainbow ball");
  if (s.reactiveBackground) out.push("background pulsing with the sound");
  if (ring && s.screenShake > 0) out.push(`screen shake ${r1(s.screenShake)} on wall breaks`);
  if (s.cinematicEnabled) out.push("camera zooms in at big moments");
  if (s.particleStyle === "confetti") out.push("multi-colour confetti bursts");
  if (ring && (s.wallBreakStyle === "confetti" || s.wallBreakStyle === "all")) out.push("walls burst into confetti");
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The scene in neutral words, from the settings' numbers: what is on screen at the start, never the mode's name or what the
 * clip is meant to show (the plan's example: "one ball inside 12 rings, one gap each").
 */
export function sceneOf(s: SimulatorSettings): string {
  const balls = s.teams.length > 1 ? `${s.teams.length} coloured balls` : s.ballFace !== "none" ? "one ball with a face" : "one ball";
  switch (s.mode) {
    case "classic":
    case "accumulation":
    case "portal":
      return `${balls} inside ${plural(s.wallCount, "spinning ring", "spinning rings")}, one gap in each`;
    case "shatter":
    case "colorMatch":
      return `${balls} inside ${plural(s.wallCount, "ring", "rings")}`;
    case "multiply":
      return `${balls} inside a spinning ring with one gap`;
    case "grow":
      return `${balls}, small, bouncing inside a ring`;
    case "multipliers":
      return `${plural(s.mpStartBalls, "ball", "balls")} above a board of ${plural(s.mpRows, "gate row", "gate rows")} marked with numbers`;
    case "powerLayers":
      // (the ball bounces between a ceiling and the top of the stack and drills down through it)
      return `one ball bouncing on top of a stack of ${s.plLayers} coloured layers`;
    case "pendulum":
      return pendulumScene(s);
    case "polyrhythm":
      return `${s.prCount} dots moving at different speeds`;
    case "drop":
      return `${s.dropBallCount} balls above ${plural(s.dropRows, "row", "rows")} of pegs`;
    case "glass":
      return `${balls} above ${plural(s.glassStages, "floor", "floors")} of glass panes`;
    case "stringBattle":
      return `${s.sbBalls} coloured balls, each tied to the ring by strings`;
    case "ctf":
      return `two teams of ${s.ctfPerTeam} squares on a field, a flag on each side`;
    case "battle":
      return `${s.btCount} coloured squares in a ${s.btArena === "circle" ? "round" : "square"} arena`;
    case "race":
      return `${s.rcRacers} coloured squares at the start of a track`;
    case "fightLeague":
      return s.flMatch === "bracket" ? `${Math.round(s.flBracketSize)} fighter balls with weapons, two at a time` : s.flMatch === "boss" ? "one fighter ball with a weapon against a line of others" : "fighter balls with weapons in an arena";
    default:
      return s.teams.length > 1 ? `${s.teams.length} coloured balls in an arena` : "balls moving in an arena";
  }
}

/** A pendulum set as its layout draws it (lib/physics/modes/pendulum.ts PENDULUM_LAYOUTS): a row, a ring, a wheel's spokes, rails, a floor. */
function pendulumScene(s: SimulatorSettings): string {
  const n = s.pwCount;
  const spokes = (turning: boolean) => {
    const shape = s.pwPolygon >= 3 ? `slowly turning ${s.pwPolygon}-sided shape` : turning ? "slowly turning wheel" : "wheel";
    return `${n} balls on the spokes of a ${shape}, each swinging to and from the center along its spoke`;
  };
  switch (s.pwLayout) {
    case "arc":
      return `${n} pendulums hanging inward from a ring, each a little longer than the last`;
    case "circle":
      return spokes(false);
    case "galaxy":
      return spokes(true);
    case "sliding":
      return `${n} balls sliding left and right on stacked rails`;
    case "bouncing":
      return `${n} balls bouncing on a floor, each at its own pace`;
    default:
      return `${n} pendulums side by side, each a little longer than the last`;
  }
}

const roundOver = (o: Overlay, clip: CrewClip) => (o.end >= shownSecOf(clip) - 1e-6 ? "end" : `${r1(o.end)}`);

/** The intent view (see the header). */
export function intentView(clip: CrewClip, input: DossierInput = {}): IntentDossier {
  const clarity = input.clarity ?? clarityOf(clip, input.simpleOptions);
  const overlays = overlaysOf(clip);
  const shown = shownSecOf(clip);
  const { most, busyShare } = crowding(overlays, shown);
  const s = clip.settings;
  const drawn = drawnHookText(clip);
  const groupWords = (role: string) => overlays.filter((o) => o.kind === role).map((o) => o.words).join(" / ");
  const payoffWords = groupWords("payoff");
  const questionWords = groupWords("question");
  const hookOverlay = overlays.find((o) => o.kind === "hook");
  const counter = overlays.find((o) => o.kind === "countdown");
  const huds = hudsOn(s);
  const effects = effectWords(s);
  const failed = clarity.gates.filter((g) => !g.ok);
  const lost = clarity.playbook.reasons.filter((r) => r.points < r.max);
  const winner = clip.run ? runWinnerOf(clip) : null;
  const run = clip.run;
  const m = clip.measured;
  const f = m?.features ?? null;
  const others = (input.others ?? []).slice(0, 4);
  const research = (input.research ?? []).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2);
  const p = clip.payoff;

  const facts: { [K in DossierKey]: DossierValue } = {
    "clip.template": clip.template ?? (clip.recipe ? `recipe:${clip.recipe}` : null),
    "clip.claim": clip.claim,
    "clip.mode": s.mode === clip.mode ? clip.mode : `${clip.mode}->${s.mode}`,
    "clip.platform": clip.platform,
    "clip.bucket": clip.bucket,
    "clip.ending": clip.ending,
    "clip.length": r1(shown),
    "clip.seed": clip.seed,
    "beats.firstImpact": clip.timing.firstImpactSec === null ? null : r1(clip.timing.firstImpactSec),
    "beats.hook": hookOverlay ? { from: r1(hookOverlay.start), to: r1(hookOverlay.end) } : null,
    "beats.countdown": clip.countdown ? { kind: clip.countdown.kind, source: clip.countdown.source, from: counter ? r1(counter.start) : null } : null,
    "beats.payoff": p.atSec === null ? null : { sec: r1(p.atSec), position: p.position === null ? null : Math.round(p.position * 100) / 100, cutGap: p.cutGapSec === null ? null : r1(p.cutGapSec), what: p.type },
    "beats.cut": clip.cut ? { from: r1(clip.cut.startSec), length: r1(clip.cut.lengthSec), card: r1(clip.cut.cardSec) } : null,
    "beats.end": { sec: r1(shown), afterPayoff: p.atSec === null ? null : r1(clip.timing.clipSec - p.atSec) },
    "words.hook": drawn || null,
    "words.aiHook": clip.hook && clip.hook.trim() ? clip.hook.trim() : null,
    "words.payoff": payoffWords || null,
    "words.question": questionWords || null,
    "words.topText": clip.topText.trim() || null,
    "words.bottomText": clip.bottomText.trim() || null,
    "text.timeline": overlays.filter((o) => o.kind !== "hud" && o.kind !== "nameLabel").map((o) => `${r1(o.start)}-${roundOver(o, clip)} ${o.kind}`),
    "text.atOnce": { most, busyPct: pct(busyShare) },
    "look.effects": effects,
    "look.huds": huds.map((h) => h.id),
    gates: failed.map((g) => `${g.id}:${g.key}`),
    "score.simple": clarity.simple.score,
    "score.simpleDeductions": clarity.simple.deductions.map((d) => `${d.id}${d.values.flag ? `:${d.values.flag}` : ""}-${d.points}`),
    "score.playbook": clarity.playbook.score,
    "score.playbookLost": lost.map((r) => `${r.id}-${r.max - r.points}:${r.key}`),
    "run.winner": run ? winner : null,
    "run.escape": run ? (run.firstEscapeSec >= 0 ? r1(run.firstEscapeSec) : run.homeSec >= 0 ? r1(run.homeSec) : -1) : null,
    "run.finish": run ? (run.finishSec >= 0 ? r1(run.finishSec) : -1) : null,
    // --- crew --- (gate G2's reading of the payoff: what sounds there, how the balls move against the run's median)
    "run.payoffMoment": momentFact(clip),
    "measured.firstMotion": f ? (f.firstMotionSec === null ? -1 : r1(f.firstMotionSec)) : null,
    "measured.peakMotion": f && f.peakMotionPos !== null ? Math.round(f.peakMotionPos * 100) / 100 : null,
    "measured.lagged": m && m.laggedFrames !== null && m.frames ? r1((100 * m.laggedFrames) / m.frames) : null,
    "measured.watermark": m ? m.watermarked : null,
    others: others.map((o) => `${o.template}: ${o.hook}`),
    research,
  };

  // the text, at the first trim level that fits (the clip's own words whole at every level: the others' quotes go first)
  const levels: TrimLevel[] = [
    { words: WORDS_MAX, quote: 64, list: 8, timelineWords: 40 },
    { words: WORDS_MAX, quote: 40, list: 6, timelineWords: 24 },
    { words: WORDS_MAX, quote: 28, list: 4, timelineWords: 14 },
    { words: WORDS_MAX, quote: 20, list: 3, timelineWords: 0 },
    { words: WORDS_MAX, quote: 8, list: 2, timelineWords: 0 },
  ];
  let text = "";
  for (const level of levels) {
    text = renderIntent(clip, facts, overlays, level).join("\n");
    if (text.length <= INTENT_MAX) break;
  }
  if (text.length > INTENT_MAX) text = clampLines(text, INTENT_MAX, (l) => l.startsWith("words.hook: ") || l.startsWith("words.aiHook: "));
  return { v: 1, facts, text };
}

/** --- crew --- The run's payoff moment as data (null: not read, or read around another second than the clip's payoff). */
function momentFact(clip: CrewClip): DossierValue {
  const m = clip.run?.moment;
  if (!m || clip.payoff.atSec === null || Math.abs(m.atSec - clip.payoff.atSec) > 0.01) return null;
  return { sec: r1(m.atSec), sounds: m.sounds, notes: m.notes, chordMax: m.chordMax, accent: m.accent, motionPct: m.motion !== null && m.motionMedian !== null && m.motionMedian > 0 ? pct(m.motion / m.motionMedian) : null };
}

/** --- crew --- The moment in words: "14 s: 1 sound, 15 notes at most at once, accented; motion 92% of the run's median". */
function momentLine(clip: CrewClip, v: DossierValue): string {
  if (clip.run === null) return "unknown (no run)";
  if (v === null || typeof v !== "object" || Array.isArray(v)) return clip.payoff.atSec === null ? "no payoff in the run" : "not read";
  const m = v as { sec: number; sounds: number; notes: number; chordMax: number; accent: boolean; motionPct: number | null };
  const when = clip.ending === "cliffhanger" ? `${m.sec} s (after the clip ends)` : `${m.sec} s`;
  const sound = m.sounds === 0 ? "no sound" : `${m.sounds} sound${m.sounds === 1 ? "" : "s"}, ${m.chordMax} note${m.chordMax === 1 ? "" : "s"} at most at once${m.accent ? ", accented" : ""}`;
  return `${when}: ${sound}; ${m.motionPct === null ? "no balls to move" : `motion ${m.motionPct}% of the run's median`}`;
}

interface TrimLevel {
  /** The clip's own words (words.*, the run's winner). */
  words: number;
  /** Every other quote: the timeline's, the other candidates' (16 more), the research's (twice it). */
  quote: number;
  list: number;
  timelineWords: number;
}

const none = "none";
const listOf = (items: readonly (string | number)[], max: number) => (items.length === 0 ? none : items.length > max ? `${items.slice(0, max).join(", ")} (+${items.length - max})` : items.join(", "));

function renderIntent(clip: CrewClip, f: { [K in DossierKey]: DossierValue }, overlays: readonly Overlay[], t: TrimLevel): string[] {
  const p = clip.payoff;
  const q = (v: DossierValue) => (typeof v === "string" ? quote(v, t.words) : none);
  const line = (key: DossierKey, value: string) => `${key}: ${value}`;
  // (the words of the first hook, payoff, question and edge lines are quoted under words.*: the timeline names them by kind)
  const quoted = new Set<string>();
  const timeline = overlays
    .filter((o) => o.kind !== "hud" && o.kind !== "nameLabel")
    .map((o) => {
      const named = ["hook", "payoff", "question", "topText", "bottomText"].includes(o.kind) && !quoted.has(o.kind);
      quoted.add(o.kind);
      const words = o.kind === "countdown" ? counterWords(o.words) : o.words;
      return `${r1(o.start)}-${roundOver(o, clip)} ${o.kind}${!named && t.timelineWords > 0 && words ? ` ${quote(words, t.timelineWords)}` : ""}`;
    });
  const atOnce = f["text.atOnce"] as { most: number; busyPct: number };
  const payoff = f["beats.payoff"] as { sec: number; position: number | null; cutGap: number | null; what: string | null } | null;
  const end = f["beats.end"] as { sec: number; afterPayoff: number | null };
  const hook = f["beats.hook"] as { from: number; to: number } | null;
  const countdown = f["beats.countdown"] as { kind: string; source: string; from: number | null } | null;
  const cut = f["beats.cut"] as { from: number; length: number; card: number } | null;
  const run = (v: DossierValue, label: string) => (clip.run === null ? "unknown (no run)" : v === -1 || v === null ? `no ${label} in the run` : typeof v === "number" ? `${label} at ${v} s` : String(v));
  const measured = (v: DossierValue, fmt: (x: number) => string) => (clip.measured === null ? "not rendered" : v === null ? "not measured" : typeof v === "number" ? fmt(v) : String(v));
  const sound = clip.measured?.features?.firstSoundSec;
  const firstSound = typeof sound === "number" && Number.isFinite(sound) && sound >= 0 ? r1(sound) : null;
  return [
    line("clip.template", f["clip.template"] === null ? none : String(f["clip.template"])),
    line("clip.claim", f["clip.claim"] === null ? none : String(f["clip.claim"])),
    line("clip.mode", String(f["clip.mode"])),
    line("clip.platform", String(f["clip.platform"])),
    line("clip.bucket", String(f["clip.bucket"])),
    line("clip.ending", String(f["clip.ending"])),
    line("clip.length", `${f["clip.length"]} s${clip.cut ? " (the cut)" : ""}, recorded ${clip.timing.recordingDuration} s`),
    line("clip.seed", f["clip.seed"] === null ? none : String(f["clip.seed"])),
    line("beats.firstImpact", f["beats.firstImpact"] === null ? "unknown" : `${f["beats.firstImpact"]} s`),
    line("beats.hook", hook ? `${hook.from}-${hook.to} s` : none),
    // (--- templates --- review round 2, 22: a Simple clip whose picture is its countdown draws no counter)
    line("beats.countdown", countdown ? (countdown.source === "picture" ? "no counter drawn: the picture alone" : `${countdown.kind} by ${countdown.source}${countdown.from !== null ? ` from ${countdown.from} s` : ""}`) : none),
    line("beats.payoff", payoff ? `${payoff.what ?? "moment"} at ${payoff.sec} s${payoff.position !== null ? ` (${Math.round(100 * payoff.position)}%)` : ""}${payoff.cutGap !== null ? `, ${payoff.cutGap} s after the clip ends` : ""}` : p.atSec === null ? "none in the run" : none),
    line("beats.cut", cut ? `from ${cut.from} s for ${cut.length} s, end card ${cut.card} s` : none),
    line("beats.end", `${end.sec} s${end.afterPayoff === null ? "" : end.afterPayoff >= 0 ? `, ${end.afterPayoff} s after the payoff` : `, ${r1(-end.afterPayoff)} s before the payoff`}`),
    line("words.hook", q(f["words.hook"])),
    line("words.aiHook", q(f["words.aiHook"])),
    line("words.payoff", q(f["words.payoff"])),
    line("words.question", q(f["words.question"])),
    line("words.topText", q(f["words.topText"])),
    line("words.bottomText", q(f["words.bottomText"])),
    line("text.timeline", listOf(timeline, t.list + 2).replace(/, /g, "; ")),
    line("text.atOnce", `${atOnce.most} at most, 2+ for ${atOnce.busyPct}% of the clip`),
    line("look.effects", listOf(f["look.effects"] as string[], t.list)),
    line("look.huds", listOf(f["look.huds"] as string[], t.list)),
    line("gates", (f.gates as string[]).length ? `fail ${listOf(f.gates as string[], t.list)}` : "all pass"),
    line("score.simple", String(f["score.simple"])),
    line("score.simpleDeductions", listOf(f["score.simpleDeductions"] as string[], t.list)),
    line("score.playbook", String(f["score.playbook"])),
    line("score.playbookLost", listOf(f["score.playbookLost"] as string[], t.list)),
    line("run.winner", clip.run === null ? "unknown (no run)" : f["run.winner"] === null ? "no winner" : quote(String(f["run.winner"]), t.words)),
    // (Glass Smash's ball reaching home is its way out; a fill is when the screen or the ring is full)
    line("run.escape", clip.run && clip.run.firstEscapeSec < 0 && clip.run.homeSec >= 0 ? `home at ${r1(clip.run.homeSec)} s` : run(f["run.escape"], "first escape")),
    line("run.finish", `${run(f["run.finish"], "finish")}${clip.run && clip.run.fillSec >= 0 ? `, filled at ${r1(clip.run.fillSec)} s` : ""}`),
    line("run.payoffMoment", momentLine(clip, f["run.payoffMoment"])),
    // (gate G1 reads the earlier of the two: a small ball on a dark background can move long before the picture says so)
    line("measured.firstMotion", measured(f["measured.firstMotion"], (x) => `${x < 0 ? "no motion" : `${x} s`}${firstSound !== null ? ` (first sound ${firstSound} s)` : ""}`)),
    line("measured.peakMotion", measured(f["measured.peakMotion"], (x) => `${Math.round(100 * x)}% in`)),
    line("measured.lagged", measured(f["measured.lagged"], (x) => `${x}% of frames`)),
    // (--- crew --- the address it draws: gate G8 refuses a local build's)
    line("measured.watermark", clip.measured && typeof clip.measured.watermarkDomain === "string" && f["measured.watermark"] !== null ? `${String(f["measured.watermark"])}, draws ${quote(clip.measured.watermarkDomain, 40)}` : measured(f["measured.watermark"], (x) => String(x))),
    line("others", (f.others as string[]).length ? (f.others as string[]).slice(0, t.list).map((o) => quote(o, t.quote + 16)).join("; ") : none),
    line("research", (f.research as string[]).length ? (f.research as string[]).map((r) => quote(r, t.quote * 2)).join(" / ") : none),
  ];
}

/** The last resort: every line but the kept ones (the hooks: WORDS_MAX at most) cut to an equal share of the rest (deterministic). */
function clampLines(text: string, max: number, keep: (line: string) => boolean = () => false): string {
  const lines = text.split("\n");
  const kept = lines.filter(keep);
  const room = max - (lines.length - 1) - kept.reduce((n, l) => n + l.length, 0);
  const share = Math.max(12, Math.floor(room / Math.max(1, lines.length - kept.length)));
  const out = lines.map((l) => (keep(l) || l.length <= share ? l : `${l.slice(0, share - 1)}…`)).join("\n");
  return out.length <= max ? out : out.slice(0, max);
}

const where = (position: string) => (position === "center" ? "middle" : position);

/** The screen view (see the header). `scene`: a binding's own scene line (default: sceneOf the settings). */
export function screenView(clip: CrewClip, options: { scene?: string } = {}): ScreenView {
  const levels = [
    { quote: 64, list: 10 },
    { quote: 40, list: 8 },
    { quote: 24, list: 6 },
    { quote: 14, list: 4 },
  ];
  let text = "";
  for (const level of levels) {
    text = renderScreen(clip, options.scene, level).join("\n");
    if (text.length <= SCREEN_MAX) break;
  }
  if (text.length > SCREEN_MAX) text = clampLines(text, SCREEN_MAX);
  return { v: 1, text };
}

function renderScreen(clip: CrewClip, scene: string | undefined, t: { quote: number; list: number }): string[] {
  const s = clip.settings;
  const shown = shownSecOf(clip);
  const overlays = overlaysOf(clip);
  const lines: string[] = [];
  lines.push(`scene: ${(scene ?? sceneOf(s)).replace(/\s+/g, " ").trim()}`);
  lines.push(`length: ${r1(shown)} s, vertical video`);
  const dark = s.backgroundColors.every((c) => luminance(c) < 0.12);
  const look = [`${dark ? "dark" : "light"} ${s.backgroundType === "gradient" ? "gradient " : ""}background`, ...effectWords(s)];
  if (s.ballFace !== "none") look.push("a face on the ball");
  lines.push(`look: ${look.join(", ")}`);
  lines.push(`sound: a note on every bounce (${s.instrument} voice, ${s.scale} scale)`);
  const texts = overlays.filter((o) => o.captions && o.captions.length > 0);
  lines.push(`texts (${texts.length}):`);
  for (const o of texts.slice(0, t.list)) {
    const c = clip.captions[o.captions![0]];
    const counter = o.kind === "countdown";
    const words = counter ? `a live counter ${quote(counterWords(o.words), t.quote)}` : quote(o.words, t.quote);
    lines.push(`- ${o.end >= shown - 1e-6 ? `${r1(o.start)} s to the end` : `${r1(o.start)}-${r1(o.end)} s`}, ${where(c.position)}${o.lines > 1 ? `, ${o.lines} lines` : ""}: ${words}`);
  }
  if (texts.length > t.list) lines.push(`- and ${texts.length - t.list} more`);
  if (clip.topText.trim()) lines.push(`top line, all along: ${quote(clip.topText, t.quote)}`);
  if (clip.bottomText.trim()) lines.push(`bottom line, all along: ${quote(clip.bottomText, t.quote)}`);
  if (s.nameLabel && s.ballName.trim()) lines.push(`a name under the ball: ${quote(s.ballName, t.quote)}`);
  const huds = hudsOn(s);
  lines.push(`also on screen: ${huds.length ? huds.slice(0, t.list).map((h) => h.words).join("; ") : "nothing else"}`);
  if (clip.cut) {
    const c = clip.cut;
    const extras = [c.hook.trim() ? `a pill on top ${quote(c.hook, t.quote)}` : "", c.url.trim() ? `an address line ${quote(c.url, t.quote)}` : "", c.cardSec > 0 ? `then an end card for ${r1(c.cardSec)} s` : ""].filter(Boolean);
    lines.push(`shown as a cut from ${r1(c.startSec)} s for ${r1(c.lengthSec)} s${extras.length ? `: ${extras.join(", ")}` : ""}`);
  }
  const f = clip.measured?.features ?? null;
  if (f && "motion" in f && Array.isArray(f.motion) && f.motion.length > 1) lines.push(`motion in 8 parts (0 still - 9 most): ${motionBuckets(f.motion).join(" ")}`);
  if (f && f.soundEventsPerSec !== null) lines.push(`sounds a second: ${r1(f.soundEventsPerSec)}`);
  return lines;
}

/** The motion curve in 8 equal parts, each its mean scaled to 0–9 against the largest part. */
export function motionBuckets(motion: readonly number[]): number[] {
  const samples = motion.slice(1);
  const n = samples.length;
  const parts = Array.from({ length: 8 }, (_, k) => {
    const a = Math.floor((k * n) / 8);
    const b = Math.max(a + 1, Math.floor(((k + 1) * n) / 8));
    const slice = samples.slice(a, Math.min(n, b));
    return slice.length ? slice.reduce((x, y) => x + y, 0) / slice.length : 0;
  });
  const top = Math.max(...parts);
  return parts.map((v) => (top > 0 ? Math.round((9 * v) / top) : 0));
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
// --- end crew ---
