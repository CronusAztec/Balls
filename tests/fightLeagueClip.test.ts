import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { CAPTION_WINNER_TOKEN, sanitizeCaption } from "@/lib/captions";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { findSimulation, simulateOutcomeRun, simulateSeed, type FinderRequest } from "@/lib/simulation/finder";
import { clipConstraintsMet, finishWindowMiss, outcomeMatches, outcomeMiss, type RunSummary } from "@/lib/simulation/outcomes";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { FL_INTRO_MS, flRunSummary } from "@/lib/physics/modes/fightLeague";
import { FL_FINALE_SEC } from "@/lib/physics/modes/fightLeagueFx";
import { FL_WIN_HOLD_SEC } from "@/lib/physics/modes/fightLeague";
import {
  FL_CLIP_BUCKETS,
  FL_CLIP_BUCKET_SEC,
  FL_CLIP_KO_WINDOW,
  FL_CLIP_PACE_SEEDS,
  FL_CLIP_QUESTION_SEC,
  FL_CLIP_STORIES,
  flClipCaptions,
  flClipKoFraction,
  flClipKoInWindow,
  flClipNamesOf,
  flClipPlanAttr,
  flClipRecordingSec,
  flClipStories,
  flClipStoryOutcome,
  flClipTopText,
  flClipUpsetPossible,
  flClipWinnerName,
  flMedianSec,
  flPacedHp,
  isFlClipCaption,
  planFlClip,
  type FlClipPlan,
} from "@/lib/physics/modes/fightLeagueClip";
import { measureFlKoSec } from "@/components/simulator/fightLeague/makeClip";

/*
 * --- fl-overhaul --- (Stage 6) "Make a clip" (lib/physics/modes/fightLeagueClip.ts): the pure planner – the KO window at 82–88 %
 * of the bucket, the pace, the stories' outcomes, the show plans, the clip length, the question captions and the Top Text in
 * en / pl / es – the finder's new constraints (finishWithin, cutWhileOn) and an end-to-end find for Thor vs Loki.
 */

const LOCALES = { en, pl, es } as const;
const WORLD = { width: 880, height: 495 };
const fmt = (locale: string, key: string, values: Record<string, unknown> = {}) => {
  const controls = (LOCALES as Record<string, { Controls: Record<string, string> }>)[locale].Controls;
  const text = controls[key];
  if (text === undefined) throw new Error(`missing ${locale} Controls.${key}`);
  return String(new IntlMessageFormat(text, locale).format(values as Record<string, string>));
};

/** Runs the finder's frame loop on timers (Node has no requestAnimationFrame). */
async function withFrames<T>(body: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  try {
    return await body();
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}

const fight = (patch: Partial<SimulatorSettings> = {}): SimulatorSettings => ({ ...defaultSettings("fightLeague"), ...patch });

const single = (bucket: "short" | "standard" | "long", story: (typeof FL_CLIP_STORIES)[number], base: number | null = 16, hp = 100): FlClipPlan => planFlClip({ kind: "single", bucket, story, hp, baseKoSec: base, bossWaves: 6, showEstimateSec: 0 });

describe("Make a clip: the planner", () => {
  it("puts the final KO of one match at 82–88 % of every bucket (the duration search's window for any KO)", () => {
    for (const bucket of FL_CLIP_BUCKETS) {
      const clip = FL_CLIP_BUCKET_SEC[bucket];
      const plan = single(bucket, "any");
      expect(plan.clipSec).toBe(clip);
      expect(plan.window!.fromSec).toBeCloseTo(0.82 * clip, 6);
      expect(plan.window!.toSec).toBeCloseTo(0.88 * clip, 6);
      expect(plan.outcome).toBeNull();
      expect(plan.targetSec - plan.toleranceSec).toBeCloseTo(plan.window!.fromSec, 6);
      expect(plan.targetSec + plan.toleranceSec).toBeCloseTo(plan.window!.toSec, 6);
      expect(plan.targetSec / clip).toBeCloseTo(0.85, 6);
      expect(flClipPlanAttr(plan)).toBe(`${bucket}|any|82-88`);
    }
    expect(FL_CLIP_BUCKET_SEC).toEqual({ short: 15, standard: 25, long: 75 });
  });

  it("searches a story through its Stage 5 outcome with the KO window", () => {
    for (const story of ["upset", "clutch", "comeback", "ability"] as const) {
      const plan = single("standard", story);
      expect(plan.outcome?.kind).toBe(flClipStoryOutcome(story));
      expect(plan.outcome?.finishWithin).toEqual(plan.window);
      expect(plan.cliffhanger).toBe(false);
    }
    expect(flClipStoryOutcome("ability")).toBe("ability-finish");
  });

  it("cuts a cliffhanger in the clip's last second with every side low and the fight still on", () => {
    const plan = single("standard", "cliffhanger");
    expect(plan.outcome).toMatchObject({ kind: "both-low-at", atSec: 24.5, toleranceSec: 0.5, cutWhileOn: true });
    expect(plan.cliffhanger).toBe(true);
    expect(flClipRecordingSec(plan, 24.3, FL_FINALE_SEC, FL_WIN_HOLD_SEC)).toBe(25);
    expect(flClipKoFraction(plan, 24.3, 25)).toBeNull();
    expect(flClipPlanAttr(plan)).toBe("standard|cliffhanger|cut");
  });

  it("paces the match to the clip: the HP that puts the measured median KO at the window's middle", () => {
    // Thor vs Loki at 100 HP: a median KO about 16 s in – the standard clip wants 21.25 s
    const hp = flPacedHp(100, 16, 21.25);
    expect(hp).toBe(Math.round((100 * (21.25 - FL_INTRO_MS / 1000)) / (16 - FL_INTRO_MS / 1000)));
    expect(flPacedHp(100, 21, 21.25)).toBe(100); // close enough: no restart for a nudge
    expect(flPacedHp(100, null, 21.25)).toBe(100);
    expect(flPacedHp(3, 400, 12.75)).toBe(1); // never below 1 (and uncapped above)
    expect(flPacedHp(100, 4, 63.75)).toBeGreaterThan(300);
    expect(single("long", "any", 16).hp).toBe(flPacedHp(100, 16, 0.85 * 75));
    expect(flMedianSec([3, 1, 2])).toBe(2);
    expect(flMedianSec([4, 1, 3, 2])).toBe(2.5);
    expect(flMedianSec([])).toBeNull();
  });

  it("ends a show with its verdict: the champion, the boss falling at its last wave, any finished show", () => {
    const champion = planFlClip({ kind: "bracket", bucket: "long", story: "champion", hp: 100, baseKoSec: null, bossWaves: 6, showEstimateSec: 150 });
    expect(champion.window).toBeNull();
    expect(champion.outcome).toMatchObject({ kind: "champion", team: 0 });
    const boss = planFlClip({ kind: "boss", bucket: "standard", story: "boss", hp: 100, baseKoSec: null, bossWaves: 6, showEstimateSec: 120 });
    expect(boss.outcome).toMatchObject({ kind: "boss-falls-at", count: 6 });
    const any = planFlClip({ kind: "series", bucket: "standard", story: "any", hp: 100, baseKoSec: 30, bossWaves: 6, showEstimateSec: 55 });
    expect(any.outcome).toBeNull();
    expect(any.hp).toBe(100); // a show is not paced
    expect([any.targetSec, any.toleranceSec]).toEqual([55, 55]);
    expect(flClipPlanAttr(any)).toBe("standard|any|show");
    // the clip: the bucket, or the whole show with its finale and the winner's hold when that is longer
    expect(flClipRecordingSec(any, 12, FL_FINALE_SEC, FL_WIN_HOLD_SEC)).toBe(25);
    expect(flClipRecordingSec(any, 150.2, FL_FINALE_SEC, FL_WIN_HOLD_SEC)).toBe(Math.ceil(150.2 + FL_FINALE_SEC + FL_WIN_HOLD_SEC));
  });

  it("offers the stories the format can tell", () => {
    expect(flClipStories({ kind: "single", pinned: 2, upsetPossible: true })).toEqual(["any", "upset", "clutch", "comeback", "ability", "cliffhanger"]);
    expect(flClipStories({ kind: "single", pinned: 2, upsetPossible: false })).not.toContain("upset");
    expect(flClipStories({ kind: "bracket", pinned: 1, upsetPossible: true })).toContain("champion");
    expect(flClipStories({ kind: "bracket", pinned: 0, upsetPossible: true })).not.toContain("champion");
    expect(flClipStories({ kind: "boss", pinned: 1, upsetPossible: true })).toContain("boss");
    expect(flClipStories({ kind: "series", pinned: 2, upsetPossible: true })).not.toContain("cliffhanger");
    expect(flClipUpsetPossible([0.44, 0.56])).toBe(false); // Thor vs Loki: no side under 40 %
    expect(flClipUpsetPossible([0.3, 0.7])).toBe(true);
    expect(flClipUpsetPossible(null)).toBe(true); // a random slot: anybody may be the underdog
  });

  it("places the found KO inside the clip's window", () => {
    const plan = single("standard", "any");
    const rec = flClipRecordingSec(plan, 21.4, FL_FINALE_SEC, FL_WIN_HOLD_SEC);
    expect(rec).toBe(25);
    expect(flClipKoInWindow(plan, 21.4)).toBe(true);
    expect(flClipKoInWindow(plan, 19)).toBe(false);
    const f = flClipKoFraction(plan, 21.4, rec)!;
    expect(f).toBeGreaterThanOrEqual(FL_CLIP_KO_WINDOW.from);
    expect(f).toBeLessThanOrEqual(FL_CLIP_KO_WINDOW.to);
  });
});

describe("Make a clip: the captions and the Top Text in en, pl and es", () => {
  it("asks 'Who wins?' for 2.5 s and answers with the winner's token; a cliffhanger asks again and never answers", () => {
    for (const locale of ["en", "pl", "es"]) {
      const question = fmt(locale, "flClipQuestion");
      const answer = fmt(locale, "flClipAnswer", { winner: CAPTION_WINNER_TOKEN });
      expect(question.length, locale).toBeGreaterThan(3);
      expect(answer, locale).toContain(CAPTION_WINNER_TOKEN);
      const [q] = flClipCaptions(single("standard", "any"), { question, answer });
      expect(q).toMatchObject({ type: "question", text: question, answer, position: "top", start: 0, end: FL_CLIP_QUESTION_SEC });
      expect(sanitizeCaption(q)).toEqual(q);
      expect(isFlClipCaption(q, question)).toBe(true);
      const cliff = flClipCaptions(single("standard", "cliffhanger"), { question, answer });
      expect(cliff).toHaveLength(2);
      for (const c of cliff) {
        expect(c.answer).toBe("");
        expect(sanitizeCaption(c)).toEqual(c);
      }
      expect(cliff[1].start).toBeGreaterThan(FL_CLIP_QUESTION_SEC);
      expect(cliff[1].start).toBeLessThan(25);
    }
  });

  it("writes the Top Text for viewers with the sound off: the duel, the boss rush, the bracket", () => {
    const expected = { en: ["Thor vs Loki", "Can Gerald beat all 6?", "8 fighters. 1 champion."], pl: ["Thor vs Loki", "Czy Gerald pokona wszystkich 6?", "8 wojowników. 1 mistrz."], es: ["Thor vs Loki", "¿Puede Gerald vencer a los 6?", "8 luchadores. 1 campeón."] } as const;
    for (const locale of ["en", "pl", "es"] as const) {
      const templates = {
        duel: (a: string, b: string) => fmt(locale, "flClipTopDuel", { a, b }),
        boss: (boss: string, n: number) => fmt(locale, "flClipTopBoss", { boss, n }),
        bracket: (n: number) => fmt(locale, "flClipTopBracket", { n }),
      };
      const names = { a: "Thor", b: "Loki", boss: "Gerald", n: 6 };
      expect(flClipTopText("single", names, templates)).toBe(expected[locale][0]);
      expect(flClipTopText("series", names, templates)).toBe(expected[locale][0]);
      expect(flClipTopText("boss", names, templates)).toBe(expected[locale][1]);
      expect(flClipTopText("bracket", { ...names, n: 8 }, templates)).toBe(expected[locale][2]);
      expect(flClipTopText("single", { ...names, a: "A".repeat(50), b: "B".repeat(50) }, templates).length).toBeLessThanOrEqual(60);
    }
  });

  it("has every key of the block in the three languages (no reference branding)", () => {
    const keys = ["flCreator", "flCreatorTip", "flMakeClip", "flMakeClipTip", "flClipBucket", "flClipStory", "flClipQuestion", "flClipAnswer", "flClipTopDuel", "flClipTopBoss", "flClipTopBracket", "flClipBusy", "flClipMeasuring", "flClipSearching", "flClipFound", "flClipFoundCut", "flClipMissed", ...FL_CLIP_BUCKETS.map((b) => `flClipBucket_${b}`), ...FL_CLIP_STORIES.map((s) => `flClipStory_${s}`)];
    for (const locale of ["en", "pl", "es"] as const) {
      const controls = LOCALES[locale].Controls as Record<string, string>;
      for (const k of keys) {
        expect(controls[k], `${locale} ${k}`).toBeTruthy();
        expect(controls[k].toLowerCase(), `${locale} ${k}`).not.toMatch(/ballthing|tiktok|instagram/);
      }
      expect(fmt(locale, "flClipBucket_standard", { sec: 25 })).toContain("25");
    }
  });
});

describe("the finder's clip constraints", () => {
  const run = (finished: boolean, sec: number, fl: Partial<RunSummary["fl"]> = {}): RunSummary => ({ mode: "fightLeague", durationMs: 1000 * sec, finished, firstEscapeMs: -1, teams: [], fl: { show: "single", upset: false, comeback: false, perfect: false, clutch: true, leadChanges: 1, finisher: "weapon:hammer", abilityFinish: false, bothLowMs: -1, championEntrant: -1, championSide: -1, gamesPlayed: 1, bossDefeated: 0, decider: false, sudden: false, winnerHpFrac: 0.05, ...fl } });

  it("finishWithin: the story matches only with the run's end in the window; the miss counts the distance", () => {
    const o = { kind: "clutch" as const, clipSec: 25, finishWithin: { fromSec: 20.5, toSec: 22 } };
    expect(outcomeMatches(o, run(true, 21))).toBe(true);
    expect(outcomeMatches(o, run(true, 19))).toBe(false);
    expect(outcomeMatches(o, run(true, 23))).toBe(false);
    expect(outcomeMatches(o, run(false, 21))).toBe(false);
    expect(outcomeMatches({ kind: "clutch", clipSec: 25 }, run(true, 19))).toBe(true); // without the window: as before
    expect(finishWindowMiss(o, run(true, 19))).toBeCloseTo(1.5, 6);
    expect(outcomeMiss(o, run(true, 23))).toBeCloseTo(1, 6);
    expect(outcomeMiss(o, run(true, 21))).toBe(0);
  });

  it("cutWhileOn: a cliffhanger only while the fight is still on at the window's end", () => {
    const o = { kind: "both-low-at" as const, clipSec: 25, atSec: 24.5, toleranceSec: 0.5, cutWhileOn: true };
    expect(outcomeMatches(o, run(false, 25, { bothLowMs: 24_200 }))).toBe(true);
    expect(outcomeMatches(o, run(true, 24.6, { bothLowMs: 24_200 }))).toBe(false);
    expect(clipConstraintsMet({ cutWhileOn: true }, { finished: false, durationMs: 25_000 })).toBe(true);
  });

  it("stops following a seed once its KO window has passed", () => {
    const s = fight();
    const request = finderRequestOfSettings(s, WORLD, 120);
    const summary = simulateOutcomeRun(1, request, { kind: "clutch", clipSec: 15, finishWithin: { fromSec: 3, toSec: 4 } });
    expect(summary.finished).toBe(false);
    expect(summary.durationMs).toBeLessThan(4600);
  });
});

describe("Make a clip end to end (Thor vs Loki)", () => {
  it("measures the matchup's pace reproducibly", { timeout: 60_000 }, () => {
    const s = fight();
    const a = measureFlKoSec(s, WORLD);
    const b = measureFlKoSec(s, WORLD);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a!).toBeGreaterThan(5);
    expect(FL_CLIP_PACE_SEEDS.length).toBeGreaterThanOrEqual(8);
  });

  it("finds a standard clip whose final KO lands at 82–88 % after pacing the HP, and names its winner", { timeout: 120_000 }, async () => {
    const base = fight();
    const plan = planFlClip({ kind: "single", bucket: "standard", story: "any", hp: base.flHp, baseKoSec: measureFlKoSec(base, WORLD), bossWaves: 6, showEstimateSec: 0 });
    expect(plan.hp).toBeGreaterThan(100); // Thor vs Loki at 100 HP is over well before 20 s
    const s = fight({ flHp: plan.hp });
    const request: FinderRequest = { ...finderRequestOfSettings(s, WORLD, 60), targetDurationSec: plan.targetSec, toleranceSec: plan.toleranceSec, maxSeeds: 200 };
    const found = await withFrames(() => findSimulation(request, () => undefined));
    expect(found.found).toBe(true);
    expect(flClipKoInWindow(plan, found.duration)).toBe(true);
    // the replay ends at that KO, at 82–88 % of the 25 s clip
    const ms = simulateSeed(found.seed, request, 60_000);
    expect(ms / 1000).toBeCloseTo(found.duration, 6);
    const rec = flClipRecordingSec(plan, found.duration, FL_FINALE_SEC, FL_WIN_HOLD_SEC);
    expect(rec).toBe(25);
    const frac = flClipKoFraction(plan, found.duration, rec)!;
    expect(frac).toBeGreaterThanOrEqual(0.82 - 1e-9);
    expect(frac).toBeLessThanOrEqual(0.88 + 1e-9);
    // the "[winner]" the question's answer names, and the Top Text's names
    const engine = createEngineForSettings(request.physicsConfig, "fightLeague", request.modeSettings, found.seed);
    while (!engine.isSimulationFinished()) engine.update(1000 / 60, 0);
    const v = engine.getFightLeagueView();
    const winner = flClipWinnerName(v);
    expect(["Thor", "Loki"]).toContain(winner);
    expect(flClipNamesOf(v)).toMatchObject({ a: "Thor", b: "Loki" });
    expect(flRunSummary(v).bouts).toBe(1);
  });

  it("finds a clutch win with its KO in the window (the story's outcome plus finishWithin)", { timeout: 120_000 }, async () => {
    const base = fight();
    const plan = planFlClip({ kind: "single", bucket: "standard", story: "clutch", hp: base.flHp, baseKoSec: measureFlKoSec(base, WORLD), bossWaves: 6, showEstimateSec: 0 });
    const s = fight({ flHp: plan.hp });
    const request: FinderRequest = { ...finderRequestOfSettings(s, WORLD, 60), maxSeeds: 600, outcome: plan.outcome! };
    const found = await withFrames(() => findSimulation(request, () => undefined));
    expect(found.found).toBe(true);
    expect(flClipKoInWindow(plan, found.duration)).toBe(true);
    const summary = simulateOutcomeRun(found.seed, request, plan.outcome!);
    expect(summary.fl?.clutch).toBe(true);
  });
});
