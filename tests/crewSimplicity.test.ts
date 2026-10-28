import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById, RECIPES } from "@/lib/bot/playbook";
import { planClip, scoreClip, seededRandom, type ClipPlan } from "@/lib/bot/planner";
import { defaultCaption, type Caption } from "@/lib/captions";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { finderRequestOfSettings, DEFAULT_BOT_WORLD } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { captionRolesOf, planLikeFromSettings, runSync } from "@/lib/insights/score";
import { ACTION_GAIN_SEC, captionsAtEdge } from "@/lib/bot/planner";
import { ACTION_GRID, ACTION_STEP_SEC, actionCellsOf, actionSampleSec, type ActionTrack } from "@/lib/bot/actionTrack";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import {
  HUD_FLAGS,
  MODE_HUDS,
  RING_WALL_MODES,
  SIMPLE_BANDS,
  SIMPLE_DEDUCTIONS,
  SIMPLE_WEIGHTS,
  bandOf,
  crewClipOfPlan,
  crowding,
  hudCounts,
  hudsOn,
  overlaysOf,
  simpleScore,
  textOverActionSec,
  trendsMotionRef,
  type CrewClip,
  type SimpleDeductionId,
} from "@/lib/crew";

/*
 * --- crew --- The Simple score (lib/crew/simplicity.ts, C1 of the AI studio plan) and the HUD flags it reads
 * (lib/crew/hudFlags.ts): one hand-built case per deduction, the overlay inventory it counts on, the bands, a property test that
 * adding a caption, a HUD flag or an effect never raises it, bounded and deterministic, the watermark ignored, today's
 * ring-escape plan inside a pinned band, the HUD and ring-wall tables held to scoreClip and the engine, and the crew's
 * sources kept pure.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;

/**
 * A plan in a calm look: no wall glow, colour trail, rainbow walls, shake, confetti or Top Text, the countdown caption after
 * the hook. Look settings only (the cinematic camera stays on: it moves the run, so the plan's facts would not be its own).
 */
function calm(plan: ClipPlan): ClipPlan {
  const s: SimulatorSettings = { ...plan.settings, showWallGlow: false, colorTrail: false, rainbowWalls: false, screenShake: 0, wallBreakStyle: "shatter", particleStyle: "sparks", rainbowBall: false, topText: "", bottomText: "" };
  const hookEnd = Math.max(...s.captions.filter((_, i) => plan.captionRoles[i] === "hook").map((c) => c.end));
  s.captions = s.captions.map((c, i) => (plan.captionRoles[i] === "countdown" ? { ...c, start: hookEnd } : c));
  return { ...plan, settings: s };
}
const withRun = (plan: ClipPlan): CrewClip => crewClipOfPlan(plan, { run: runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec) });
const quick = (id: string, ending: "resolved" | "cliffhanger" = "resolved") => planClip(recipeById(id)!, 17, "reels", { copy, ending, search: false, episode: 3 });
/** The clip with its settings changed (and captions with their roles inferred, as a saved clip's are). */
function changed(clip: CrewClip, patch: Partial<SimulatorSettings>): CrewClip {
  const settings = { ...clip.settings, ...patch };
  const next: CrewClip = { ...clip, settings, topText: patch.topText ?? clip.topText, bottomText: patch.bottomText ?? clip.bottomText };
  if (patch.captions) {
    next.captions = patch.captions;
    next.captionRoles = [...clip.captionRoles, ...captionRolesOf(patch.captions.slice(clip.captions.length), clip.timing.clipSec)];
  }
  return next;
}
const caption = (type: Caption["type"], text: string, start: number, end = 0, position: Caption["position"] = "top"): Caption => ({ ...defaultCaption(type, { text }), start, end, position });
const points = (clip: CrewClip, id: SimpleDeductionId) => simpleScore(clip).deductions.filter((d) => d.id === id).reduce((s, d) => s + d.points, 0);

const cleanPlan = calm(planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 }));
const clean = withRun(cleanPlan);

describe("the Simple score: the clean clip and the bands", () => {
  it("scores a calm one-line-at-a-time clip Simple, a bounded integer", () => {
    const s = simpleScore(clean);
    expect(s.band).toBe("simple");
    expect(s.score).toBeGreaterThanOrEqual(SIMPLE_BANDS.simple);
    expect(Number.isInteger(s.score)).toBe(true);
    // the hook and the countdown follow each other; only the countdown and the payoff words meet at the end
    expect(crowding(overlaysOf(clean), clean.timing.clipSec).most).toBe(2);
    for (const d of s.deductions) expect(SIMPLE_DEDUCTIONS).toContain(d.id);
  });

  it("names its band: 80 and above Simple, 60–79 a bit busy, below 60 busy", () => {
    expect([100, 80, 79, 60, 59, 0].map(bandOf)).toEqual(["simple", "simple", "aBitBusy", "aBitBusy", "busy", "busy"]);
  });

  it("is deterministic and stays within 0–100 however much is piled on", () => {
    expect(JSON.stringify(simpleScore(clean))).toBe(JSON.stringify(simpleScore(withRun(cleanPlan))));
    const piled = changed(clean, {
      showWallGlow: true, colorTrail: true, rainbowWalls: true, rainbowBall: true, reactiveBackground: true, screenShake: 2, cinematicEnabled: true, particleStyle: "confetti", wallBreakStyle: "all",
      trailThickness: 3, loopHud: true, topText: "Top", bottomText: "Bottom", ballName: "Gerald", nameLabel: true,
      captions: [...clean.captions, ...Array.from({ length: 12 }, (_, k) => caption("text", `Line number ${k} with many many words in it`, 0.2 * k, 0, k % 2 ? "top" : "bottom"))],
    });
    const s = simpleScore(piled);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.band).toBe("busy");
  });
});

describe("the overlay inventory", () => {
  it("counts a caption role group as one message, and the Top Text, the loop HUD's title and counter and the name label as their own", () => {
    const plan = quick("ring-escape");
    const clip = crewClipOfPlan(plan);
    const kinds = overlaysOf(clip).map((o) => o.kind);
    // the hook's two lines are one message; the countdown, the payoff words and the series label one each
    expect(kinds.filter((k) => k === "hook")).toHaveLength(1);
    expect(overlaysOf(clip).find((o) => o.kind === "hook")!.lines).toBe(plan.captionRoles.filter((r) => r === "hook").length);
    expect(kinds).toEqual(expect.arrayContaining(["hook", "countdown", "payoff", "topText"]));
    // Classic's loop HUD with its time in the ring: a title and a counter; without it, its title alone
    expect(clean.settings.mode).toBe("classic");
    const hud = overlaysOf(changed(clean, { loopHud: true, ringTimer: true, nameLabel: true, ballName: "Gerald" })).map((o) => o.id);
    expect(hud).toEqual(expect.arrayContaining(["hud:loopHud#0", "hud:loopHud#1", "nameLabel"]));
    expect(overlaysOf(changed(clean, { loopHud: true, ringTimer: false })).filter((o) => o.hud === "loopHud")).toHaveLength(1);
  });

  it("shows a cut's window from its first frame, with its hook pill, its address line and its end card", () => {
    const cut = { ...clean, cut: { startSec: 3, lengthSec: 10, hook: "Will it escape?", url: "example.org", cardSec: 1.5 } };
    const o = overlaysOf(cut);
    expect(o.find((x) => x.kind === "cutHook")).toMatchObject({ start: 0, end: 10 });
    expect(o.find((x) => x.kind === "cutUrl")).toMatchObject({ start: 0, end: 10 });
    expect(o.find((x) => x.kind === "endCard")).toMatchObject({ start: 10, end: 11.5 });
    // the source's countdown (from the hook's end, at 2.5 or 3 s) starts in the cut's first second or at its start
    const counter = o.find((x) => x.kind === "countdown")!;
    expect(counter.start).toBeLessThanOrEqual(0.0001);
    expect(o.every((x) => x.start >= 0 && x.end <= 11.5 + 1e-9)).toBe(true);
  });
});

describe("one case per deduction", () => {
  it("text at once: 1 costs 0, 2 cost 5, 3 cost 15, 4 or more 30", () => {
    // (each extra its own message: a window of its own; no digit, so none reads as a counter)
    const at = (n: number) => changed(clean, { captions: [...clean.captions, ...Array.from({ length: n }, (_, k) => caption("text", `Extra ${"abcdefgh"[k]}`, 4, 6 + 0.1 * k, "bottom"))] });
    // the clean clip has its countdown alone at 4–6 s (and 2 at its end): one extra makes 2, two make 3, three make 4
    expect([0, 1, 2, 3, 5].map((n) => points(at(n), "textAtOnce"))).toEqual([5, 5, 15, 30, 30]);
  });

  it("the share with two or more: 20 × (share − 0.15)", () => {
    const busy = changed(clean, { captions: [...clean.captions, caption("text", "Always here", 0, 0, "bottom")] });
    const { busyShare } = crowding(overlaysOf(busy), busy.timing.clipSec);
    expect(busyShare).toBeCloseTo(1, 6);
    expect(points(busy, "busyShare")).toBeCloseTo(SIMPLE_WEIGHTS.busyShare * (1 - SIMPLE_WEIGHTS.busyShareFree), 1);
  });

  it("each persistent message beyond the first: 6", () => {
    expect(points(clean, "persistent")).toBe(0);
    expect(points(changed(clean, { topText: "Day 3" }), "persistent")).toBe(6);
    expect(points(changed(clean, { topText: "Day 3", bottomText: "example.org" }), "persistent")).toBe(12);
  });

  it("hook words over 7: 2 each, 10 at most; more than 2 hook lines: 5", () => {
    const hook = (text: string, lines = 1) => changed(clean, { captions: [...Array.from({ length: lines }, (_, k) => caption("text", k === 0 ? text : "more", 0, 2.5)), ...clean.captions.filter((_, i) => clean.captionRoles[i] !== "hook")] });
    const re = (c: CrewClip) => ({ ...c, captionRoles: captionRolesOf(c.captions, c.timing.clipSec), hook: null });
    expect(points(re(hook("one two three four five six seven")), "hookWords")).toBe(0);
    expect(points(re(hook("one two three four five six seven eight nine")), "hookWords")).toBe(4);
    expect(points(re(hook("w ".repeat(20).trim())), "hookWords")).toBe(10);
    expect(points(re(hook("a b", 2)), "hookLines")).toBe(0);
    expect(points(re(hook("a b", 3)), "hookLines")).toBe(5);
  });

  it("a message said twice: the AI's own hook 10, a cut's hook pill 6, payoff words the hook says 3, a countdown caption beside a counting HUD 5", () => {
    expect(points({ ...clean, hook: "A different hook" }, "aiHookDiffers")).toBe(10);
    expect(points({ ...clean, hook: clean.hook!.toUpperCase() }, "aiHookDiffers")).toBe(0);
    const cut = (hook: string) => ({ ...clean, cut: { startSec: 0, lengthSec: 12, hook, url: "", cardSec: 0 } });
    expect(points(cut("Another hook"), "cutHookDiffers")).toBe(6);
    expect(points(cut(clean.hook!), "cutHookDiffers")).toBe(0);
    const hookLine = clean.captions.find((_, i) => clean.captionRoles[i] === "hook")!.text;
    const repeat = changed(clean, { captions: clean.captions.map((c, i) => (clean.captionRoles[i] === "payoff" ? { ...c, text: hookLine } : c)) });
    expect(points({ ...repeat, captionRoles: clean.captionRoles }, "payoffRepeatsHook")).toBe(hookLine.trim().split(/\s+/).length >= 2 ? 3 : 0);
    // a Power Layers clip counts on its HUD; a countdown caption beside it says the count twice
    const pl = crewClipOfPlan(quick("power-layers"));
    expect(points(pl, "countdownBesideHud")).toBe(0);
    expect(points(changed(pl, { captions: [...pl.captions, { ...defaultCaption("countdown", { text: "[time]" }), start: 3, end: 0 }] }), "countdownBesideHud")).toBe(5);
  });

  it("each effect at its price, the wall effects only where the mode has ring walls", () => {
    const cases: [Partial<SimulatorSettings>, SimpleDeductionId, number][] = [
      [{ showWallGlow: true }, "wallGlow", 2],
      [{ trailThickness: 2 }, "thickTrails", 3],
      [{ colorTrail: true }, "colorTrail", 3],
      [{ rainbowWalls: true }, "rainbowWalls", 4],
      [{ rainbowBall: true }, "rainbowBall", 3],
      [{ reactiveBackground: true }, "reactiveBackground", 5],
      [{ screenShake: 0.15 }, "screenShake", 2.5],
      [{ screenShake: 0.9 }, "screenShake", 5],
      [{ particleStyle: "confetti" }, "burstParticles", 2],
      [{ wallBreakStyle: "confetti" }, "wallBreak", 2],
      [{ wallBreakStyle: "all" }, "wallBreak", 2],
    ];
    for (const [patch, id, cost] of cases) {
      expect([id, points(clean, id)]).toEqual([id, 0]);
      expect([id, points(changed(clean, patch), id)]).toEqual([id, cost]);
    }
    expect(points(clean, "cinematic")).toBe(SIMPLE_WEIGHTS.cinematic); // (the fixture keeps it: it moves the run)
    expect(points(changed(clean, { cinematicEnabled: false }), "cinematic")).toBe(0);
    // the ball's glow and a thin trail are free; trails off take the trail costs with them
    expect(simpleScore(changed(clean, { showGlow: true, showTrails: true, trailThickness: 0.8 })).score).toBe(simpleScore(clean).score);
    expect(points(changed(clean, { showTrails: false, colorTrail: true, trailThickness: 3 }), "colorTrail") + points(changed(clean, { showTrails: false, trailThickness: 3 }), "thickTrails")).toBe(0);
    // a mode without ring walls draws no wall glow, rainbow walls, wall burst or shake on a break
    const race = crewClipOfPlan(quick("square-race"));
    for (const id of ["wallGlow", "rainbowWalls", "wallBreak", "screenShake"] as const) expect([id, points(changed(race, { showWallGlow: true, rainbowWalls: true, wallBreakStyle: "all", screenShake: 1 }), id)]).toEqual([id, 0]);
  });

  it("each HUD flag on and not kept: 5; the HUD that counts kept when the countdown is the HUD's; the ball names past 4", () => {
    const sb = crewClipOfPlan(quick("string-battle"));
    expect(sb.countdown?.source).toBe("hud");
    expect(points(sb, "hud")).toBe(0); // (its WEB DOMINION panel counts the lives: kept)
    expect(points(changed(sb, { sbBadge: true }), "hud")).toBe(5);
    expect(simpleScore(changed(sb, { sbBadge: true }), { keepHuds: ["sbBadge", "sbHud"] }).deductions.some((d) => d.id === "hud")).toBe(false);
    expect(simpleScore(sb, { keepHuds: [] }).deductions.filter((d) => d.id === "hud").map((d) => d.values.flag)).toEqual(["sbHud"]);
    const race = crewClipOfPlan(quick("square-race"));
    expect(simpleScore(race).deductions.filter((d) => d.id === "hud").map((d) => d.values.flag)).toEqual(["rcStandings", "rcMiniMap"]);
    expect(points(changed(clean, { loopHud: true }), "hud")).toBe(5);
    // the ball names: free up to 4 names on screen
    const maze = crewClipOfPlan(quick("maze-race"));
    const names = (n: number) => changed(maze, { teams: maze.settings.teams.slice(0, 1).concat(Array.from({ length: n - 1 }, (_, k) => ({ name: `T${k}`, color: "#ffffff", emoji: "" }))), showScoreboard: false });
    expect(simpleScore(names(4)).deductions.some((d) => d.values.flag === "showBallNames")).toBe(false);
    expect(simpleScore(names(6)).deductions.some((d) => d.values.flag === "showBallNames")).toBe(true);
  });

  it("measured after a render: mean motion above twice the trends median 5, the first motion after 1.5 s 5 (soft, tagged)", () => {
    const ref = trendsMotionRef();
    expect(ref).not.toBeNull();
    // (the first sound with the first motion: a bounce is heard when it is seen; `sound` apart from it)
    const features = (motion: number, first: number | null, sound: number | null = first): ClipFeatures => ({ v: 1, sampleHz: 4, motion: [0, ...Array.from({ length: 40 }, () => motion)], firstMotionSec: first, peakMotionPos: 0.8, meanLuma: 0.1, meanSat: 0.5, darkShare: 0.8, soundEventsPerSec: 3, firstSoundSec: sound, gapEvents: 4, loopSeamDiff: 0.01, lufs: -14 });
    const measured = (f: ClipFeatures) => ({ ...clean, measured: { features: f, durationSec: clean.timing.clipSec, laggedFrames: 0, frames: 1000, watermarked: true, free: true } });
    expect(simpleScore(measured(features(ref!, 0.3))).deductions.filter((d) => d.measured)).toEqual([]);
    const busy = simpleScore(measured(features(3 * ref!, 2.5))).deductions.filter((d) => d.measured);
    expect(busy.map((d) => [d.id, d.points])).toEqual([["measuredMotion", 5], ["measuredFirstMotion", 5]]);
    expect(simpleScore(measured(features(3 * ref!, 0.3)), { motionRef: null }).deductions.some((d) => d.id === "measuredMotion")).toBe(false);
    // the first motion is the export's first impact, as gate G1 reads it: the picture's motion or the first bounce heard
    expect(simpleScore(measured(features(ref!, 7.5, 0.83))).deductions.filter((d) => d.measured)).toEqual([]);
    expect(simpleScore(measured(features(ref!, 2.5, 1.9))).deductions.filter((d) => d.measured).map((d) => [d.id, d.values.sec])).toEqual([["measuredFirstMotion", 1.9]]);
    // not measured before a render
    expect(simpleScore(clean).deductions.some((d) => d.measured)).toBe(false);
  });

  // --- templates --- (the studio's first review round, finding 26: Ball Drop's balls entering under a top hook)
  it("a text over the action: 2 a second it hides the run's moving balls 1 s or more longer than at the other edge, 10 at most; none without the run's track", () => {
    const hook = clean.captionRoles.map((r, i) => (r === "hook" ? i : -1)).filter((i) => i >= 0);
    const hookEnd = Math.max(...hook.map((i) => clean.captions[i].end));
    const samples = Math.ceil(clean.timing.clipSec / ACTION_STEP_SEC);
    const track = (sample: (k: number) => string): ActionTrack => ({ stepSec: ACTION_STEP_SEC, grid: ACTION_GRID, samples: Array.from({ length: samples }, (_, k) => sample(k)) });
    const withTrack = (t: ActionTrack | undefined, clip: CrewClip = clean): CrewClip => ({ ...clip, run: { ...clip.run!, action: t } });
    // balls moving under the top stack (cells 29 and 30 of 20 × 20: the middle of the square's second row) while the hook is up
    const whileHook = (cells: string) => (k: number) => (actionSampleSec({ stepSec: ACTION_STEP_SEC }, k) < hookEnd - 1e-9 ? cells : "");
    expect(actionCellsOf("0t0u")).toEqual([29, 30]);
    const hookSec = Array.from({ length: samples }, (_, k) => actionSampleSec({ stepSec: ACTION_STEP_SEC }, k)).filter((t) => t < hookEnd - 1e-9).length * ACTION_STEP_SEC;
    expect(hookSec).toBeGreaterThanOrEqual(ACTION_GAIN_SEC);
    const under = withTrack(track(whileHook("0t0u")));
    expect([textOverActionSec(under), points(under, "textOverAction")]).toEqual([hookSec, Math.min(SIMPLE_WEIGHTS.textOverActionMax, SIMPLE_WEIGHTS.textOverAction * hookSec)]);
    // the hook at the bottom of the square, read as before: nothing hidden there
    const atBottom = changed(clean, { captions: captionsAtEdge(clean.captions, hook, "bottom") });
    expect(textOverActionSec(withTrack(track(whileHook("0t0u")), atBottom))).toBe(0);
    // balls under both edges (cells 369 and 370: the square's 19th row, under the bottom stack): moving gains nothing
    expect(actionCellsOf("a9aa")).toEqual([369, 370]);
    expect(textOverActionSec(withTrack(track(whileHook("0t0ua9aa"))))).toBe(0);
    // half a second under the hook is no reason to move it: under ACTION_GAIN_SEC
    expect(textOverActionSec(withTrack(track((k) => (k === 0 ? "0t0u" : ""))))).toBe(0);
    // balls under the top stack the whole clip: every top text owes it, 10 at most
    expect(points(withTrack(track(() => "0t0u")), "textOverAction")).toBe(SIMPLE_WEIGHTS.textOverActionMax);
    // no track (a plan with no run, a run read without the clip's length): not counted
    expect([textOverActionSec({ ...clean, run: null }), textOverActionSec(withTrack(undefined)), points(withTrack(undefined), "textOverAction")]).toEqual([null, null, 0]);
    // a mode that draws its own band along the bottom: the bottom is no other edge for a top text
    expect(textOverActionSec(withTrack(track(whileHook("0t0u")), changed(clean, { loopHud: true })))).toBe(0);
  });

  it("ignores the watermark: its badge is fixed and protected", () => {
    const marked = { ...clean, measured: { features: null, durationSec: 10, laggedFrames: 0, frames: 600, watermarked: true, free: true } };
    const unmarked = { ...marked, measured: { ...marked.measured, watermarked: false, free: false } };
    expect(simpleScore(marked)).toEqual(simpleScore(unmarked));
    expect(simpleScore(changed(clean, { watermarkText: "my own mark" }))).toEqual(simpleScore(clean));
  });
});

describe("monotonic: adding a caption, a HUD flag or an effect never raises Simple (a property test)", () => {
  const WORDS = ["ball", "ring", "go", "now", "fast", "who", "wins", "watch", "this", "three", "out", "end"];
  const FLAGS: Partial<SimulatorSettings>[] = [...HUD_FLAGS.map((f) => (f.key === "plBadge" ? { plBadge: "both" as const } : { [f.key]: true } as Partial<SimulatorSettings>)), { bounceMath: [{ param: "speed", trigger: "wall", every: 1, op: "add", amount: 1 }] as unknown as SimulatorSettings["bounceMath"], bounceMathHud: true }];
  const EFFECTS: ((s: SimulatorSettings) => Partial<SimulatorSettings>)[] = [
    () => ({ showWallGlow: true }),
    () => ({ showTrails: true }),
    () => ({ colorTrail: true }),
    (s) => ({ trailThickness: s.trailThickness + 0.5 }),
    () => ({ rainbowWalls: true }),
    () => ({ rainbowBall: true }),
    () => ({ reactiveBackground: true }),
    (s) => ({ screenShake: s.screenShake + 0.1 }),
    () => ({ cinematicEnabled: true }),
    () => ({ particleStyle: "confetti" }),
    () => ({ wallBreakStyle: "all" }),
    () => ({ topText: "Day 4" }),
    () => ({ bottomText: "example.org" }),
    () => ({ nameLabel: true, ballName: "Gerald" }),
  ];
  const bases: CrewClip[] = [clean, crewClipOfPlan(quick("ring-escape")), crewClipOfPlan(quick("string-battle", "cliffhanger")), crewClipOfPlan(quick("power-layers")), crewClipOfPlan(quick("maze-race")), crewClipOfPlan(quick("fight-duel")), { ...clean, cut: { startSec: 2, lengthSec: 9, hook: "", url: "example.org", cardSec: 1 } }];

  it("holds over 300 seeded runs of 6 additions", () => {
    const rng = seededRandom(20261028);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
    for (let run = 0; run < 300; run++) {
      let clip = bases[run % bases.length];
      let last = simpleScore(clip).score;
      for (let step = 0; step < 6; step++) {
        const kind = rng();
        if (kind < 0.4) {
          const start = Math.round(rng() * clip.timing.clipSec * 10) / 10;
          const end = rng() < 0.4 ? 0 : start + 0.5 + Math.round(rng() * 60) / 10;
          const text = Array.from({ length: 1 + Math.floor(rng() * 9) }, () => pick(WORDS)).join(" ") + (rng() < 0.2 ? "?" : "");
          clip = changed(clip, { captions: [...clip.captions, caption(pick(["text", "text", "question", "countdown", "wallCounter"] as const), text, start, end, pick(["top", "center", "bottom"] as const))] });
        } else if (kind < 0.7) clip = changed(clip, pick(FLAGS));
        else clip = changed(clip, pick(EFFECTS)(clip.settings));
        const now = simpleScore(clip).score;
        expect(now).toBeLessThanOrEqual(last);
        last = now;
      }
    }
  });
});

describe("today's bot clips", () => {
  it("puts today's ring-escape plan in a pinned band: busy, its text stacked and its effects on", () => {
    const plan = planClip(recipeById("ring-escape")!, 7, "reels", { copy, ending: "resolved", episode: 3 });
    const s = simpleScore(withRun(plan));
    expect(s.band).toBe("busy");
    expect(s.score).toBeGreaterThanOrEqual(35);
    expect(s.score).toBeLessThanOrEqual(55);
    expect(s.deductions.map((d) => d.id)).toEqual(expect.arrayContaining(["textAtOnce", "busyShare", "persistent", "colorTrail", "screenShake"]));
  });

  it("scores every recipe's quick plan, both endings, inside 0–100 and below the Simple band in today's look", () => {
    for (const recipe of RECIPES) {
      for (const ending of ["resolved", "cliffhanger"] as const) {
        const s = simpleScore(crewClipOfPlan(planClip(recipe, 5, "tiktok", { copy, ending, search: false, episode: 2 })));
        expect([recipe.id, s.score >= 0 && s.score < SIMPLE_BANDS.simple]).toEqual([recipe.id, true]);
      }
    }
  });
});

describe("the HUD flags and the ring-wall modes", () => {
  it("lists only real settings, each in real modes", () => {
    const keys = new Set(Object.keys(defaultSettings("classic")));
    for (const f of HUD_FLAGS) {
      expect([f.key, keys.has(f.key)]).toEqual([f.key, true]);
      if (f.modes !== "any") for (const m of f.modes) expect(MODE_IDS).toContain(m);
    }
    for (const h of MODE_HUDS) expect(MODE_IDS).toContain(h.mode);
    expect(new Set(HUD_FLAGS.map((f) => f.key)).size).toBe(HUD_FLAGS.length);
  });

  it("counts down exactly where scoreClip credits a HUD countdown (planner.ts hudShowsCountdown)", () => {
    const variants: SimulatorSettings[] = MODE_IDS.map((m) => ({ ...defaultSettings(m), recordingDuration: 20 }));
    variants.push({ ...defaultSettings("stringBattle"), sbHud: false }, { ...defaultSettings("fightLeague"), flHud: false });
    for (const s of variants) {
      const like = planLikeFromSettings({ ...s, captions: [] }, { firstImpactSec: 0.5, payoffSec: 17, clipSec: 20 }, { platform: "reels" });
      const key = scoreClip(like as unknown as ClipPlan).reasons.find((r) => r.id === "countdown")!.key;
      expect([s.mode, s.sbHud, s.flHud, key === "countdownHud"]).toEqual([s.mode, s.sbHud, s.flHud, hudCounts(s)]);
    }
  });

  it("draws the wall effects where the engine builds circular walls, and only there", () => {
    for (const mode of MODE_IDS) {
      const s = defaultSettings(mode);
      const req = finderRequestOfSettings(s, DEFAULT_BOT_WORLD, 5);
      const engine = createEngineForSettings(req.physicsConfig, req.mode, req.modeSettings, 1);
      engine.update(1000 / 60, 0);
      expect([mode, engine.getCircularWalls().length > 0]).toEqual([mode, RING_WALL_MODES.includes(mode)]);
    }
  });

  it("puts every HUD on in a mode's defaults on screen with its words", () => {
    for (const mode of MODE_IDS) for (const h of hudsOn(defaultSettings(mode))) expect([mode, h.id, h.words.length > 0, h.texts >= 0]).toEqual([mode, h.id, true, true]);
  });
});

describe("the crew's sources are pure", () => {
  it("use no clock, no randomness and no engine (a run is simulated elsewhere and handed in)", () => {
    const dir = path.join(__dirname, "../src/lib/crew");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(["clarity.ts", "simplicity.ts", "hudFlags.ts", "dossier.ts", "clip.ts", "index.ts"]));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect([f, /Math\.random|Date\.now|new Date\b|performance\.now/.test(src)]).toEqual([f, false]);
      expect([f, /from "@\/lib\/(physics\/engine|simulation\/finder)"/.test(src)]).toEqual([f, false]);
      expect([f, src.includes("// --- crew ---")]).toEqual([f, true]);
    }
  });
});
