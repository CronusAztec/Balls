import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STRING_BATTLE_SETTINGS,
  SB_BALL_SCALE,
  SB_BOUNCE_MIDI,
  SB_CUT_SPAN,
  SB_FINALE_LAST_MS,
  SB_FINALE_RAMP_MS,
  SB_INVULN_MS,
  SB_PALETTE,
  SB_SPEED_SCALE,
  SB_SPEED_SPREAD,
  STRING_BATTLE_RANGES,
  StringBattleMode,
  anchorPoint,
  battleForcedWinner,
  bounceFrequency,
  cuttableSpan,
  cutsThread,
  finaleDue,
  finaleFactor,
  lineThroughRect,
  pluckFrequency,
  resolveStringBattleSettings,
  rigAbsorbs,
  sbHudShown,
  stringBattleBallName,
  stringBattleSettingFields,
  stringBattleSettingsOf,
  threadDistanceSq,
  timeoutLeaders,
  touchesThread,
  type StringBattleSettings,
} from "@/lib/physics/modes/stringBattle";
import { NOISE_SECONDS, NoiseCache, SHATTER_BURST, noiseSamples, scheduleShatterBurst, scheduleStringPluck } from "@/lib/audio/stringBattleTones";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { midiToFrequency } from "@/lib/audio/scales";
import { MODE_CARD_ORDER, MODE_CATEGORIES, MODE_CATEGORY_IDS, modesInCategory } from "@/lib/modes";
import { MODE_IDS, arenaRadius, type Ball, type ModeContext, type NewBall, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { BATTLE_WINNER_MODES, forcedWinnerApplies } from "@/lib/physics/rigged";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateOutcomeRun, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeClipSec, outcomeMatches } from "@/lib/simulation/outcomes";
import { emptyStats } from "@/lib/physics/ballStats";
import { slowViewEligible } from "@/lib/simulation/camera";
import { effectiveBallCount, teamResult } from "@/lib/teams";
import { TeamLayer, type TeamLabels } from "@/components/simulator/teamsRenderer";
import { DEFAULT_STRING_BATTLE_LABELS, StringBattleLayer, sbFaceLayout, type StringBattleRenderOptions } from "@/components/simulator/stringBattleRenderer";
import { drawFace } from "@/components/simulator/faceRenderer";

/**
 * String Battle (lib/physics/modes/stringBattle.ts, feature odd-string-battle): the settings (resolve, URL, presets),
 * the thread geometry (anchors on the ring, the cut test of a ball's move, the touch test, the neon lines), the rules
 * (cut / touch / collide, the shield, elimination, the last ball standing, the clip-limit verdict, the finale, the rigged
 * forced winner) on the mode with a hand-made context, and the battle in the engine: balls in the ring, threads on it,
 * the team stats, determinism and the finder (duration and winner, with and without the forced winner).
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;

function battle(stringBattle: Partial<StringBattleSettings> = {}, seed = 42, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "stringBattle", { ...modeSettings, stringBattle }, seed);
}

/** Runs until the battle ends (or `maxMs`), collecting the sound events; returns the simulated time. */
function runBattle(engine: ReturnType<typeof battle>, maxMs = 180_000, events: SoundEvent[] = []): number {
  let t = 0;
  while (t < maxMs && !engine.isSimulationFinished()) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
    t += STEP;
  }
  return t;
}

/* ------------------------------------------------------------------ a hand-made context for the rules */

interface Probe {
  ctx: ModeContext;
  balls: Ball[];
  sounds: SoundEvent[];
  bounces: number[];
  escapes: number[];
  walls: number[];
  nearMisses: number;
  impacts: number;
  setTime(ms: number): void;
  setConfig(patch: Partial<PhysicsConfig>): void;
}

function probe(cfg: PhysicsConfig = config): Probe {
  let balls: Ball[] = [];
  let nextId = 0;
  let time = 0;
  let conf = { ...cfg };
  let seed = 7;
  const p: Probe = {
    balls,
    sounds: [],
    bounces: [],
    escapes: [],
    walls: [],
    nearMisses: 0,
    impacts: 0,
    setTime: (ms) => {
      time = ms;
    },
    setConfig: (patch) => {
      conf = { ...conf, ...patch };
    },
    ctx: {} as ModeContext,
  };
  p.ctx = {
    get config() {
      return conf;
    },
    getBalls: () => balls,
    setBalls: (next: Ball[]) => {
      balls = next;
      p.balls = next;
    },
    addBall: (b: NewBall) => {
      balls.push({ ...b, id: nextId++, trail: [], trailIndex: 0, spin: 0, angle: 0 });
      p.balls = balls;
    },
    getNextId: () => nextId,
    random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    getElapsedMs: () => time,
    addPendingSoundEvent: (e: SoundEvent) => void p.sounds.push(e),
    recordWallContact: () => undefined,
    addWallHit: () => undefined,
    getPhysicsExtras: () => ({ airDrag: 0, windX: 0, windY: 0, spinStrength: 0, wallBounciness: 1, breathingAmplitude: 0, breathingSpeed: 1, rotatingGravity: 0 }),
    creditBounce: (b: Pick<Ball, "id" | "team">) => void p.bounces.push(b.team ?? -1),
    creditEscape: (b: Pick<Ball, "id" | "team">) => void p.escapes.push(b.team ?? -1),
    creditWallBreak: (b: Ball) => void p.walls.push(b.team ?? -1),
    noteNearMiss: () => void p.nearMisses++,
    noteImpact: () => void p.impacts++,
    setDestructionMode: () => undefined,
    setInfiniteMode: () => undefined,
    setBounceSpeedMultiplier: () => undefined,
  } as unknown as ModeContext;
  return p;
}

/** A mode with `settings` started in a probe context. */
function fight(settings: Partial<StringBattleSettings>, cfg: PhysicsConfig = config) {
  const mode = new StringBattleMode();
  mode.setSettings(settings);
  const pr = probe(cfg);
  mode.init(pr.ctx);
  return { mode, pr, view: mode.getView() };
}

/** Bounces the ball of `slot` off the ring at `angle` (a thread anchored there), then puts it `inset` px inside the ring on the same radius. */
function anchorAt(mode: StringBattleMode, pr: Probe, slot: number, angle: number, inset: number) {
  const v = mode.getView();
  const ball = pr.balls.find((b) => b.team === slot)!;
  const R = v.radius;
  ball.x = v.cx + Math.cos(angle) * (R - ball.radius + 1);
  ball.y = v.cy + Math.sin(angle) * (R - ball.radius + 1);
  ball.vx = Math.cos(angle) * 200;
  ball.vy = Math.sin(angle) * 200;
  mode.onBallStep(pr.ctx, ball, 1 / 240);
  ball.x = v.cx + Math.cos(angle) * (R - inset);
  ball.y = v.cy + Math.sin(angle) * (R - inset);
  ball.vx = 0;
  ball.vy = 0;
  return ball;
}

/** Moves the ball of `slot` from (x0, y0) to (x1, y1) as one sub-step (the post-sub-step pass sees the move). */
function sweep(mode: StringBattleMode, pr: Probe, slot: number, x0: number, y0: number, x1: number, y1: number) {
  const ball = pr.balls.find((b) => b.team === slot)!;
  const f = mode.getView().fighters[slot];
  f.px = x0;
  f.py = y0;
  ball.x = x1;
  ball.y = y1;
  mode.onPostSubStep(pr.ctx);
  return ball;
}

/** Runs `body` with requestAnimationFrame on a timer (the finder yields to the page between batches). */
async function withFrames<T>(body: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  try {
    return await body();
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}

/* ------------------------------------------------------------------ settings */

describe("string battle settings", () => {
  it("resolve: defaults, clamping and fallbacks", () => {
    expect(resolveStringBattleSettings(null)).toEqual(DEFAULT_STRING_BATTLE_SETTINGS);
    expect(DEFAULT_STRING_BATTLE_SETTINGS).toMatchObject({ balls: 4, lives: 4, rule: "cut", style: "web", duration: 0, badge: true, hud: true });
    const r = resolveStringBattleSettings({ balls: 9, lives: 0, maxStrings: 99, duration: -5, finaleSpeed: 7, wobble: 2 });
    expect(r).toMatchObject({ balls: 6, lives: 1, maxStrings: 40, duration: 0, finaleSpeed: 3, wobble: 1 });
    expect(resolveStringBattleSettings({ balls: 3.6, lives: 2.2, finaleSpeed: 1.26 })).toMatchObject({ balls: 4, lives: 2, finaleSpeed: 1.3 });
    const junk = { rule: "slice", style: "retro", badge: "yes", hud: 1, balls: "x" } as unknown as Partial<StringBattleSettings>;
    expect(resolveStringBattleSettings(junk)).toEqual(DEFAULT_STRING_BATTLE_SETTINGS);
    for (const key of Object.keys(STRING_BATTLE_RANGES) as (keyof typeof STRING_BATTLE_RANGES)[]) expect(RANGES[key]).toEqual(STRING_BATTLE_RANGES[key]);
    expect(STRING_BATTLE_RANGES.sbBalls).toMatchObject({ min: 2, max: 6 });
    expect(STRING_BATTLE_RANGES.sbLives).toMatchObject({ min: 1, max: 9 });
    expect(STRING_BATTLE_RANGES.sbMaxStrings).toMatchObject({ min: 3, max: 40 });
    expect(STRING_BATTLE_RANGES.sbFinaleSpeed).toMatchObject({ min: 1, max: 3 });
  });

  it("are the defaults in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(stringBattleSettingsOf(d)).toEqual(DEFAULT_STRING_BATTLE_SETTINGS);
      const params = new URLSearchParams(settingsToSearchParams(d).toString());
      for (const key of ["sbn", "sbl", "sbm", "sbr", "sbst", "sbd", "sbf", "sbw", "sbb", "sbh"]) expect(params.has(key)).toBe(false);
    }
  });

  it("round-trip through the URL and presets, clamped on the way in", () => {
    const s = { ...defaultSettings("stringBattle"), ...stringBattleSettingFields({ balls: 6, lives: 7, maxStrings: 25, rule: "touch", style: "neon", duration: 45, finaleSpeed: 2.2, wobble: 0.35, badge: false, hud: false }) };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("stringBattle");
    expect(params.get("sbn")).toBe("6");
    expect(params.get("sbr")).toBe("touch");
    expect(params.get("sbst")).toBe("neon");
    expect(params.get("sbf")).toBe("2.2");
    expect(params.get("sbb")).toBe("0");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=stringBattle&sbn=40&sbl=-2&sbm=1&sbr=laser&sbst=x&sbd=900&sbf=0&sbw=5&sbb=maybe"));
    expect(stringBattleSettingsOf(bad)).toEqual({ ...DEFAULT_STRING_BATTLE_SETTINGS, balls: 6, lives: 1, maxStrings: 3, duration: 180, finaleSpeed: 1, wobble: 1 });
    const loaded = presetToSettings({ mode: "stringBattle", sbBalls: 1, sbLives: 12, sbRule: "nope", sbStyle: "neon", sbHud: "on" } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(stringBattleSettingsOf(loaded)).toMatchObject({ balls: 2, lives: 9, rule: "cut", style: "neon", hud: true });
  });

  it("registers the mode: its id, its card and the battle family", () => {
    expect(MODE_IDS).toContain("stringBattle");
    expect(MODE_CARD_ORDER).toContain("stringBattle");
    expect(MODE_CATEGORIES.stringBattle).toBe("battle");
    expect(MODE_CATEGORY_IDS).toContain("battle");
    expect(modesInCategory("battle")).toEqual(["stringBattle"]);
    expect(MODE_CATEGORY_IDS.flatMap((c) => modesInCategory(c)).sort()).toEqual([...MODE_CARD_ORDER].sort());
  });

  it("names and paints the balls from the palette, and plays one scale degree per ball", () => {
    expect(SB_PALETTE.map((p) => p.name)).toEqual(["HOTPINK", "AQUA", "ACID", "VIOLET", "SUN", "MINT"]);
    expect(stringBattleBallName(1)).toBe("AQUA");
    expect(stringBattleBallName(7)).toBe("AQUA");
    for (let i = 0; i < 6; i++) expect(bounceFrequency(i)).toBeCloseTo(midiToFrequency(SB_BOUNCE_MIDI[i]), 9);
    expect(new Set(SB_BOUNCE_MIDI.map((m) => m % 12))).toEqual(new Set([0, 2, 4, 7, 9]));
    expect(sbHudShown({ hud: true, style: "web" })).toBe(true);
    expect(sbHudShown({ hud: true, style: "neon" })).toBe(false);
    expect(sbHudShown({ hud: false, style: "web" })).toBe(false);
  });
});

/* ------------------------------------------------------------------ geometry */

describe("thread geometry", () => {
  it("anchors a bounce on the ring, on the impact's radius", () => {
    const out = { x: 0, y: 0, angle: 0 };
    anchorPoint(400, 300, 200, 580, 300, out);
    expect(out).toMatchObject({ x: 600, y: 300, angle: 0 });
    anchorPoint(400, 300, 200, 400 - 30, 300 - 40, out);
    expect(Math.hypot(out.x - 400, out.y - 300)).toBeCloseTo(200, 9);
    expect(out.x).toBeCloseTo(400 - 120, 9);
    expect(out.y).toBeCloseTo(300 - 160, 9);
  });

  it("measures the distance to the cuttable part of a thread: its anchor side, short of its ball", () => {
    const q = { x: 0, y: 0 };
    // The whole thread (share 1) from (0, 0) to its ball at (100, 0): the last 30 px next to the ball are not cuttable.
    expect(threadDistanceSq(0, 0, 100, 0, 40, 5, 30, q, 1)).toBeCloseTo(25, 9);
    expect(q).toEqual({ x: 40, y: 0 });
    expect(threadDistanceSq(0, 0, 100, 0, 90, 0, 30, q, 1)).toBeCloseTo(400, 9); // clamped to x = 70
    expect(q.x).toBeCloseTo(70, 9);
    expect(threadDistanceSq(0, 0, 100, 0, -10, 0, 30, undefined, 1)).toBeCloseTo(100, 9);
    expect(threadDistanceSq(0, 0, 20, 0, 5, 0, 30, undefined, 1)).toBe(Infinity); // too short to cut
    // By default the whole thread cuts and burns – up to the stub next to its ball.
    expect(SB_CUT_SPAN).toBe(1);
    expect(cuttableSpan(200, 30)).toBeCloseTo(170, 9);
    expect(cuttableSpan(40, 30)).toBeCloseTo(10, 9);
    expect(threadDistanceSq(0, 0, 200, 0, 150, 0, 30, q)).toBeCloseTo(0, 9);
    expect(q.x).toBeCloseTo(150, 9);
    expect(threadDistanceSq(0, 0, 200, 0, 190, 0, 30, q)).toBeCloseTo(400, 9); // clamped to x = 170
    // A smaller share is a ring-side-only variant: the rest passes through.
    expect(cuttableSpan(200, 30, 0.35)).toBeCloseTo(70, 9);
    expect(threadDistanceSq(0, 0, 200, 0, 150, 0, 30, q, 0.35)).toBeCloseTo(80 ** 2, 6);
    expect(q.x).toBeCloseTo(70, 9);
    // The touch rule: a ball of radius 10 at 8 px from the thread touches it; at 12 px it does not; next to the owner never.
    expect(touchesThread(0, 0, 200, 0, 12, 60, 8, 10)).toBe(true);
    expect(touchesThread(0, 0, 200, 0, 12, 60, 12, 10)).toBe(false);
    expect(touchesThread(0, 0, 200, 0, 12, 190, 3, 10)).toBe(false);
    // Anywhere along the thread burns, the ball-side part too (up to the owner's stub: 12 + 10 + SB_REACH_GAP short of it).
    expect(touchesThread(0, 0, 200, 0, 12, 160, 8, 10)).toBe(true);
    expect(touchesThread(0, 0, 200, 0, 12, 160, 8, 10, 0.35)).toBe(false);
  });

  it("cuts only when the ball's own move crosses the thread", () => {
    const q = { x: 0, y: 0 };
    // Across the thread (0,0)→(200,0) at x = 50: a cut at (50, 0).
    expect(cutsThread(0, 0, 200, 0, 30, 50, -3, 50, 3, q)).toBe(true);
    expect(q.x).toBeCloseTo(50, 9);
    expect(q.y).toBeCloseTo(0, 9);
    // Along it, short of it, beyond its anchor, next to its ball: no cut.
    expect(cutsThread(0, 0, 200, 0, 30, 20, 0, 60, 0)).toBe(false);
    expect(cutsThread(0, 0, 200, 0, 30, 50, -9, 50, -1)).toBe(false);
    expect(cutsThread(0, 0, 200, 0, 30, -5, -3, -5, 3)).toBe(false);
    expect(cutsThread(0, 0, 200, 0, 30, 185, -3, 185, 3)).toBe(false);
    // A ball at rest never cuts – a thread swinging over it is not its move.
    expect(cutsThread(0, 0, 200, 0, 30, 50, 1, 50, 1)).toBe(false);
    // Touching the thread from one side (landing on it) is not yet a cut; going through is.
    expect(cutsThread(0, 0, 200, 0, 30, 50, -3, 50, 0)).toBe(true);
    expect(cutsThread(0, 0, 200, 0, 30, 50, 0, 50, 3)).toBe(false);
    // The whole thread cuts, its ball-side part too – a ring-side-only share would let the ball pass there.
    expect(cutsThread(0, 0, 200, 0, 30, 120, -3, 120, 3)).toBe(true);
    expect(cutsThread(0, 0, 200, 0, 30, 160, -3, 160, 3)).toBe(true);
    expect(cutsThread(0, 0, 200, 0, 30, 120, -3, 120, 3, undefined, 0.35)).toBe(false);
  });

  it("extends a thread to the infinite line through its anchor and ball inside the canvas (the neon style)", () => {
    const seg = { x1: 0, y1: 0, x2: 0, y2: 0 };
    expect(lineThroughRect(100, 50, 200, 50, 0, 0, 800, 600, seg)).toBe(true);
    expect(seg).toEqual({ x1: 0, y1: 50, x2: 800, y2: 50 });
    expect(lineThroughRect(0, 0, 1, 1, 0, 0, 800, 600, seg)).toBe(true);
    expect(seg.x1).toBeCloseTo(0, 9);
    expect(seg.y1).toBeCloseTo(0, 9);
    expect(seg.x2).toBeCloseTo(600, 9);
    expect(seg.y2).toBeCloseTo(600, 9);
    expect(lineThroughRect(400, 0, 400, 10, 0, 0, 800, 600, seg)).toBe(true);
    expect(seg).toEqual({ x1: 400, y1: 0, x2: 400, y2: 600 });
    expect(lineThroughRect(-10, 700, 10, 705, 0, 0, 800, 600, seg)).toBe(false); // passes below the canvas
    expect(lineThroughRect(5, 5, 5, 5, 0, 0, 800, 600, seg)).toBe(false);
  });

  it("pitches a pluck by the thread's length and the finale ramps smoothly", () => {
    expect(pluckFrequency(0, 200)).toBeCloseTo(midiToFrequency(86), 9);
    expect(pluckFrequency(400, 200)).toBeCloseTo(midiToFrequency(60), 9);
    expect(pluckFrequency(100, 200)).toBeGreaterThan(pluckFrequency(300, 200));
    expect(finaleFactor(-5, 2)).toBe(1);
    expect(finaleFactor(0, 2)).toBe(1);
    expect(finaleFactor(SB_FINALE_RAMP_MS / 2, 2)).toBeCloseTo(1.5, 9);
    expect(finaleFactor(SB_FINALE_RAMP_MS * 3, 2.5)).toBeCloseTo(2.5, 9);
    expect(finaleFactor(SB_FINALE_RAMP_MS, 0.5)).toBe(1);
    expect(finaleDue(3, 1, 0, 0)).toBe(false);
    expect(finaleDue(2, 2, 0, 0)).toBe(false);
    expect(finaleDue(2, 1, 0, 0)).toBe(true);
    expect(finaleDue(1, 1, 0, 0)).toBe(false);
    expect(finaleDue(4, 4, 30_000 - SB_FINALE_LAST_MS, 30)).toBe(true);
    expect(finaleDue(4, 4, 30_000 - SB_FINALE_LAST_MS - 1, 30)).toBe(false);
  });

  it("judges a clip limit by lives, and the rig keeps its chosen ball in the lead", () => {
    const f = (alive: boolean, lives: number) => ({ alive, lives });
    expect(timeoutLeaders([f(true, 2), f(true, 3), f(false, 0), f(true, 3)], -1)).toEqual([1, 3]);
    expect(timeoutLeaders([f(true, 2), f(true, 3), f(false, 0), f(true, 3)], 3)).toEqual([3]);
    expect(timeoutLeaders([f(true, 2), f(true, 3)], 0)).toEqual([1]); // not among the leaders: no rig
    expect(timeoutLeaders([f(false, 0), f(false, 0)], -1)).toEqual([]);
    expect(battleForcedWinner(2, 4)).toBe(2);
    expect(battleForcedWinner(4, 4)).toBe(-1);
    expect(battleForcedWinner(undefined, 4)).toBe(-1);
    expect(battleForcedWinner(1.5, 4)).toBe(-1);
    const fighters = [f(true, 3), f(true, 3), f(true, 2)];
    expect(rigAbsorbs(1, -1, fighters)).toBe(false);
    expect(rigAbsorbs(0, 1, fighters)).toBe(false); // not the chosen ball
    expect(rigAbsorbs(1, 1, fighters)).toBe(true); // 2 < 3: it would fall behind ball 0
    expect(rigAbsorbs(1, 1, [f(true, 3), f(true, 3), f(false, 0)].map((x, i) => (i === 0 ? f(true, 2) : x)))).toBe(false);
    expect(rigAbsorbs(1, 1, [f(false, 0), f(true, 1)])).toBe(true); // never its last life
  });
});

/* ------------------------------------------------------------------ the rules on the mode */

describe("the combat rules", () => {
  it("starts every ball inside the ring, numbered with its lives, in its palette colour, without gravity", () => {
    const { pr, view } = fight({ balls: 5, lives: 3 });
    expect(view.count).toBe(5);
    expect(view.alive).toBe(5);
    expect(view.radius).toBeCloseTo(arenaRadius(config), 9);
    expect(pr.balls.map((b) => b.team)).toEqual([0, 1, 2, 3, 4]);
    for (const b of pr.balls) {
      expect(Math.hypot(b.x - view.cx, b.y - view.cy)).toBeLessThan(view.radius - b.radius);
      expect(b.radius).toBeCloseTo(config.ballRadius * SB_BALL_SCALE, 9);
      expect(b.gravityScale).toBe(0);
      expect(b.color).toBe(SB_PALETTE[b.team!].color);
    }
    expect(view.fighters.map((f) => f.lives)).toEqual([3, 3, 3, 3, 3]);
  });

  it("anchors a thread on the ring at every bounce and detaches the oldest beyond the limit", () => {
    const { mode, pr, view } = fight({ balls: 2, maxStrings: 3 });
    for (let k = 0; k < 5; k++) {
      pr.setTime(100 * k);
      anchorAt(mode, pr, 0, 0.3 + 0.5 * k, 60);
    }
    const f = view.fighters[0];
    expect(f.strings.length).toBe(3);
    for (const s of f.strings) expect(Math.hypot(s.ax - view.cx, s.ay - view.cy)).toBeCloseTo(view.radius, 9);
    const expected = [0.3 + 1.0, 0.3 + 1.5, 0.3 + 2.0].map((a) => Math.atan2(Math.sin(a), Math.cos(a)));
    f.strings.forEach((s, i) => expect(s.angle).toBeCloseTo(expected[i], 9));
    expect(view.ghostCount).toBe(2); // two detached threads fading
    expect(view.ghosts.slice(0, 2).every((g) => g.kind === "fade")).toBe(true);
    expect(pr.bounces).toEqual([0, 0, 0, 0, 0]);
    const notes = pr.sounds.filter((e) => e.type === "hit" && !e.sbSound);
    expect(notes.length).toBe(5);
    expect(notes.every((e) => e.frequency === bounceFrequency(0))).toBe(true);
  });

  it("cut: crossing an enemy thread snaps it and costs its owner a life; its web is then shielded", () => {
    const { mode, pr, view } = fight({ balls: 2, lives: 2, rule: "cut" });
    const B = anchorAt(mode, pr, 1, 0, 150); // ball 1's thread lies along y = cy from x = cx + R toward the centre
    const x = view.cx + view.radius - 40;
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].lives).toBe(1);
    expect(view.fighters[1].strings.length).toBe(0);
    expect(view.fighters[0].lives).toBe(2);
    expect(view.cuts).toBe(1);
    expect(view.livesLost).toBe(1);
    expect(view.ghosts.slice(0, view.ghostCount).some((g) => g.kind === "snap" && Math.abs(g.qx - x) < 1e-6 && Math.abs(g.qy - view.cy) < 1e-6)).toBe(true);
    const pluck = pr.sounds.find((e) => e.sbSound === "pluck");
    expect(pluck?.frequency).toBeCloseTo(pluckFrequency(150, view.radius), 9);
    // Within the shield its new thread cannot be cut.
    pr.setTime(1000);
    anchorAt(mode, pr, 1, 0, 150);
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].lives).toBe(1);
    expect(view.fighters[1].strings.length).toBe(1);
    // After it, the next cut takes the last life: the ball shatters, its killer scores and wins.
    pr.setTime(1000 + SB_INVULN_MS.cut);
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].lives).toBe(0);
    expect(view.fighters[1].alive).toBe(false);
    expect(pr.balls.includes(B)).toBe(false);
    expect(view.bursts.length).toBe(1);
    expect(pr.sounds.some((e) => e.sbSound === "shatter")).toBe(true);
    expect(view.fighters[0].kills).toBe(1);
    expect(pr.walls).toEqual([0]);
    expect(view.finished).toBe(true);
    expect(view.winner).toBe(0);
    expect(pr.escapes).toEqual([0]);
    expect(pr.nearMisses).toBe(1); // slow motion on the final cut
    expect(pr.impacts).toBe(1);
    expect(mode.isFinished()).toBe(true);
  });

  it("cut: crossing an enemy thread next to its ball – not only near the ring – cuts it too", () => {
    const { mode, pr, view } = fight({ balls: 2, lives: 2, rule: "cut" });
    anchorAt(mode, pr, 1, 0, 200); // ball 1 hangs 200 px in from its anchor
    const B = pr.balls.find((b) => b.team === 1)!;
    const reach = 2 * B.radius + 2;
    // 80 % of the way from the anchor to the ball, clear of the stub next to the ball.
    const x = view.cx + view.radius - 0.8 * 200;
    expect(view.cx + view.radius - 200 + reach).toBeLessThan(x);
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].lives).toBe(1);
    expect(view.cuts).toBe(1);
  });

  it("cut: a ball never cuts its own threads, nor an enemy's next to the enemy's body", () => {
    const { mode, pr, view } = fight({ balls: 2, rule: "cut" });
    anchorAt(mode, pr, 0, 0, 150);
    const own = view.cx + view.radius - 40;
    // Ball 0 flies across its own thread.
    sweep(mode, pr, 0, own, view.cy - 30, own, view.cy + 30);
    expect(view.fighters[0].strings.length).toBe(1);
    // Ball 1 crosses ball 0's thread right next to ball 0: out of reach.
    const near = view.cx + view.radius - 150 + 20;
    sweep(mode, pr, 1, near, view.cy - 40, near, view.cy + 40);
    expect(view.fighters[0].strings.length).toBe(1);
    expect(view.fighters[0].lives).toBe(DEFAULT_STRING_BATTLE_SETTINGS.lives);
  });

  it("touch: touching an enemy thread costs the toucher a life (the laser snaps), and the toucher is shielded", () => {
    const { mode, pr, view } = fight({ balls: 2, lives: 3, rule: "touch" });
    anchorAt(mode, pr, 1, Math.PI / 2, 160); // a thread along x = cx, from the bottom of the ring upward
    const A = pr.balls.find((b) => b.team === 0)!;
    A.x = view.cx + A.radius * 0.5;
    A.y = view.cy + view.radius - 40;
    mode.onPostSubStep(pr.ctx);
    expect(view.fighters[0].lives).toBe(2);
    expect(view.fighters[1].lives).toBe(3);
    expect(view.fighters[1].strings.length).toBe(0);
    // Shielded: the next laser does nothing.
    anchorAt(mode, pr, 1, Math.PI / 2, 160);
    mode.onPostSubStep(pr.ctx);
    expect(view.fighters[0].lives).toBe(2);
    expect(view.fighters[1].strings.length).toBe(1);
    pr.setTime(SB_INVULN_MS.touch + 1);
    mode.onPostSubStep(pr.ctx);
    expect(view.fighters[0].lives).toBe(1);
  });

  it("collide: the slower ball of a collision loses a life", () => {
    const { mode, pr, view } = fight({ balls: 3, lives: 2, rule: "collide" });
    const [a, b] = pr.balls;
    view.fighters[0].preSpeed = 150;
    view.fighters[1].preSpeed = 220;
    mode.onBallCollision(pr.ctx, a, b);
    expect(view.fighters.map((f) => f.lives)).toEqual([1, 2, 2]);
    pr.setTime(SB_INVULN_MS.collide + 1);
    view.fighters[0].preSpeed = 300;
    mode.onBallCollision(pr.ctx, a, b);
    expect(view.fighters.map((f) => f.lives)).toEqual([1, 1, 2]);
    view.fighters[0].preSpeed = view.fighters[1].preSpeed = 250;
    pr.setTime(2 * SB_INVULN_MS.collide + 2);
    mode.onBallCollision(pr.ctx, a, b); // a dead heat costs nothing
    expect(view.fighters.map((f) => f.lives)).toEqual([1, 1, 2]);
    // The cut rule ignores collisions.
    const other = fight({ balls: 2, rule: "cut" });
    other.view.fighters[0].preSpeed = 1;
    other.mode.onBallCollision(other.pr.ctx, other.pr.balls[0], other.pr.balls[1]);
    expect(other.view.fighters[0].lives).toBe(DEFAULT_STRING_BATTLE_SETTINGS.lives);
  });

  it("collide: every ring bounce draws the cruising speed afresh, so the slower ball changes from clash to clash", () => {
    const { mode, pr, view } = fight({ balls: 2, rule: "collide" });
    const ball = pr.balls[0];
    const f = view.fighters[0];
    const factors = new Set<number>();
    for (let k = 0; k < 12; k++) {
      const angle = k * 0.5;
      ball.x = view.cx + Math.cos(angle) * (view.radius - ball.radius + 2);
      ball.y = view.cy + Math.sin(angle) * (view.radius - ball.radius + 2);
      ball.vx = Math.cos(angle) * 150;
      ball.vy = Math.sin(angle) * 150;
      mode.onBallStep(pr.ctx, ball, 1 / 240);
      factors.add(f.cruise);
      expect(f.cruise).toBeGreaterThanOrEqual(1 - SB_SPEED_SPREAD);
      expect(f.cruise).toBeLessThanOrEqual(1 + SB_SPEED_SPREAD);
      // It leaves the ring at its new cruising speed, and that is the speed a clash compares.
      expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(config.ballSpeed * SB_SPEED_SCALE * f.cruise, 6);
      expect(f.preSpeed).toBeCloseTo(Math.hypot(ball.vx, ball.vy), 9);
    }
    expect(factors.size).toBe(12);
  });

  it("the forced winner never loses its last life and never falls behind", () => {
    // Cut rule: its thread still snaps, but a life it cannot afford is absorbed.
    const { mode, pr, view } = fight({ balls: 2, lives: 2, rule: "cut" }, { ...config, forcedWinner: 1 });
    mode.onPreUpdate(pr.ctx);
    expect(view.forcedWinner).toBe(1);
    const right = view.cx + view.radius - 40;
    const left = view.cx - view.radius + 40;
    anchorAt(mode, pr, 1, 0, 150);
    sweep(mode, pr, 0, right, view.cy - 30, right, view.cy + 30);
    expect(view.fighters[1].lives).toBe(2); // 2 → 1 would put it behind ball 0
    expect(view.fighters[1].strings.length).toBe(0);
    expect(view.shields).toBe(1);
    // The chosen ball cuts ball 0's thread: ball 0 pays.
    pr.setTime(10_000);
    anchorAt(mode, pr, 0, Math.PI, 150);
    sweep(mode, pr, 1, left, view.cy - 30, left, view.cy + 30);
    expect(view.fighters[0].lives).toBe(1);
    // Ahead now, it may drop to level…
    pr.setTime(20_000);
    anchorAt(mode, pr, 1, 0, 150);
    sweep(mode, pr, 0, right, view.cy - 30, right, view.cy + 30);
    expect(view.fighters[1].lives).toBe(1);
    // …but never lose its last life.
    pr.setTime(30_000);
    anchorAt(mode, pr, 1, 0, 150);
    sweep(mode, pr, 0, right, view.cy - 30, right, view.cy + 30);
    expect(view.fighters[1].lives).toBe(1);
    expect(view.shields).toBe(2);
    // Collide rule: the chosen ball wins a clash it could not afford to lose.
    const c = fight({ balls: 2, lives: 2, rule: "collide" }, { ...config, forcedWinner: 1 });
    c.mode.onPreUpdate(c.pr.ctx);
    c.view.fighters[0].preSpeed = 300;
    c.view.fighters[1].preSpeed = 100;
    c.mode.onBallCollision(c.pr.ctx, c.pr.balls[0], c.pr.balls[1]);
    expect(c.view.fighters.map((f) => f.lives)).toEqual([1, 2]);
    // The rig follows the config.
    pr.setConfig({ forcedWinner: -1 });
    mode.onPreUpdate(pr.ctx);
    expect(view.forcedWinner).toBe(-1);
  });

  it("the clip limit judges the survivors by lives; the finale starts with two balls, one a cut from the end", () => {
    const { mode, pr, view } = fight({ balls: 3, lives: 3, duration: 20 });
    view.fighters[0].lives = 2;
    view.fighters[2].lives = 1;
    pr.setTime(20_000 - SB_FINALE_LAST_MS);
    mode.onPostUpdate(pr.ctx);
    expect(view.finale).toBe(true);
    expect(view.finished).toBe(false);
    pr.setTime(20_000);
    mode.onPostUpdate(pr.ctx);
    expect(view.finished).toBe(true);
    expect(view.winner).toBe(1);
    expect(pr.escapes).toEqual([1]);
    // Without a clip limit: two balls left and one at its last life.
    const two = fight({ balls: 2, lives: 3 });
    two.pr.setTime(5000);
    two.mode.onPostUpdate(two.pr.ctx);
    expect(two.view.finale).toBe(false);
    two.view.fighters[1].lives = 1;
    two.mode.onPostUpdate(two.pr.ctx);
    expect(two.view.finale).toBe(true);
    expect(two.view.finaleStartMs).toBe(5000);
    two.pr.setTime(5000 + SB_FINALE_RAMP_MS);
    two.mode.onPreUpdate(two.pr.ctx);
    expect(two.view.finaleFactor).toBeCloseTo(DEFAULT_STRING_BATTLE_SETTINGS.finaleSpeed, 9);
  });

  it("keeps the rebound off the ring pointing inward at the ball's cruising speed", () => {
    const { mode, pr, view } = fight({ balls: 2 });
    const ball = pr.balls[0];
    for (let k = 0; k < 40; k++) {
      const angle = (k / 40) * 2 * Math.PI;
      ball.x = view.cx + Math.cos(angle) * (view.radius - ball.radius + 2);
      ball.y = view.cy + Math.sin(angle) * (view.radius - ball.radius + 2);
      ball.vx = Math.cos(angle + 0.7) * 180;
      ball.vy = Math.sin(angle + 0.7) * 180;
      mode.onBallStep(pr.ctx, ball, 1 / 240);
      const inward = -(ball.vx * Math.cos(angle) + ball.vy * Math.sin(angle)) / Math.hypot(ball.vx, ball.vy);
      expect(inward).toBeGreaterThan(Math.sin(0.2));
      expect(Math.hypot(ball.x - view.cx, ball.y - view.cy)).toBeLessThanOrEqual(view.radius - ball.radius + 1e-9);
    }
  });
});

/* ------------------------------------------------------------------ in the engine */

describe("the String Battle in the engine", () => {
  it("keeps every ball inside the ring and every thread on it, and ends with one ball standing", () => {
    const engine = battle({}, 3);
    const view = engine.getStringBattleView();
    expect(engine.getCircularWalls()).toEqual([]);
    let maxDist = 0;
    let t = 0;
    while (t < 120_000 && !engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      t += STEP;
      for (const b of engine.getBalls()) maxDist = Math.max(maxDist, Math.hypot(b.x - view.cx, b.y - view.cy) + b.radius);
      for (const f of view.fighters) {
        expect(f.strings.length).toBeLessThanOrEqual(view.settings.maxStrings);
        for (const s of f.strings) expect(Math.abs(Math.hypot(s.ax - view.cx, s.ay - view.cy) - view.radius)).toBeLessThan(1e-6);
      }
    }
    expect(maxDist).toBeLessThanOrEqual(view.radius + 1e-6);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(view.alive).toBe(1);
    expect(engine.getBalls().length).toBe(1);
    expect(view.winner).toBe(engine.getBalls()[0].team);
    expect(view.livesLost).toBe(4 * 4 - view.fighters[view.winner].lives);
    // The team stats rank the battle exactly as the mode did.
    const stats = engine.getTeamStats().slice(0, view.count);
    expect(stats.map((s) => s.escapes)).toEqual(view.fighters.map((f) => (f.slot === view.winner ? 1 : 0)));
    expect(stats.map((s) => s.walls)).toEqual(view.fighters.map((f) => f.kills));
    expect(stats.map((s) => s.bounces)).toEqual(view.fighters.map((f) => f.stats.bounces));
    expect(teamResult(stats, view.count).winner).toBe(view.winner);
    expect(t / 1000).toBeGreaterThan(5);
  });

  it("plays a note per bounce, a pluck per cut and a noise burst per shatter", () => {
    const engine = battle({}, 11);
    const events: SoundEvent[] = [];
    runBattle(engine, 120_000, events);
    const view = engine.getStringBattleView();
    const notes = events.filter((e) => e.type === "hit" && !e.sbSound);
    expect(notes.length).toBe(view.bounces);
    expect(new Set(notes.map((e) => e.frequency))).toEqual(new Set([0, 1, 2, 3].map(bounceFrequency)));
    expect(events.filter((e) => e.sbSound === "shatter").length).toBe(view.count - 1);
    expect(events.filter((e) => e.sbSound === "pluck").length).toBeGreaterThan(0);
  });

  it("is deterministic for a seed, and every rule and style ends", () => {
    const trace = (engine: ReturnType<typeof battle>) => {
      const out: number[] = [];
      for (let i = 0; i < 900; i++) {
        engine.update(STEP, 0);
        if (i % 60 === 0) for (const b of engine.getBalls()) out.push(Math.round(b.x * 1000), Math.round(b.y * 1000));
      }
      const v = engine.getStringBattleView();
      return [...out, v.cuts, v.livesLost, v.bounces];
    };
    expect(trace(battle({}, 5))).toEqual(trace(battle({}, 5)));
    expect(trace(battle({}, 5))).not.toEqual(trace(battle({}, 6)));
    for (const rule of ["cut", "touch", "collide"] as const) {
      for (const balls of [2, 6]) {
        const engine = battle({ rule, balls, lives: 2 }, 21);
        runBattle(engine, 240_000);
        expect(engine.isSimulationFinished(), `${rule} ${balls}`).toBe(true);
      }
    }
    // The neon style changes nothing but the drawing.
    expect(trace(battle({ style: "neon", hud: false, badge: false }, 5))).toEqual(trace(battle({}, 5)));
  });

  it("follows a resize: the ring and the anchors scale with the arena", () => {
    const engine = battle({}, 8);
    for (let i = 0; i < 240; i++) engine.update(STEP, 0);
    engine.setConfig({ width: 1200, height: 900 });
    const view = engine.getStringBattleView();
    expect(view.radius).toBeCloseTo(arenaRadius({ ...config, width: 1200, height: 900 }), 9);
    expect(engine.getCircularWalls()).toEqual([]);
    for (const f of view.fighters) for (const s of f.strings) expect(Math.hypot(s.ax - 600, s.ay - 450)).toBeCloseTo(view.radius, 6);
  });

  it("a resize mid-battle keeps every ball where it was in the ring and costs no thread and no life", () => {
    const portrait = { ...config, width: 1080, height: 1920 };
    const sizes = [
      { width: 1920, height: 1080 }, // a phone turned: the same ring, the canvas stretched the other way
      { width: 450, height: 800 }, // a smaller window: the ring shrinks
      { width: 1400, height: 900 },
    ];
    let resized = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const size = sizes[seed % sizes.length];
      const engine = battle({}, seed, portrait);
      for (let i = 0; i < 90 + 11 * seed; i++) engine.update(STEP, 0);
      const view = engine.getStringBattleView();
      if (view.finished) continue;
      const before = new Map(engine.getBalls().map((b) => [b.id, { u: (b.x - view.cx) / view.radius, w: (b.y - view.cy) / view.radius }]));
      engine.setConfig(size);
      resized++;
      for (const b of engine.getBalls()) {
        const f = view.fighters[b.team!];
        // Where it was in the ring (a ball keeps its size: in a smaller ring it is kept just inside), inside the ring,
        // and its previous position (the cut rule's move) moved with it.
        const was = before.get(b.id)!;
        const rho = Math.hypot(was.u, was.w) * view.radius;
        const k = rho > view.radius - b.radius ? (view.radius - b.radius) / rho : 1;
        expect((b.x - view.cx) / view.radius, `seed ${seed}`).toBeCloseTo(was.u * k, 9);
        expect((b.y - view.cy) / view.radius, `seed ${seed}`).toBeCloseTo(was.w * k, 9);
        expect(Math.hypot(b.x - view.cx, b.y - view.cy) + b.radius, `seed ${seed}`).toBeLessThanOrEqual(view.radius + 1e-6);
        expect([f.x, f.y, f.px, f.py]).toEqual([b.x, b.y, b.x, b.y]);
      }
      const { cuts, livesLost } = view;
      engine.update(STEP, 0);
      expect([view.cuts, view.livesLost], `seed ${seed}`).toEqual([cuts, livesLost]);
    }
    expect(resized).toBeGreaterThan(20);
    // The same battle turned from portrait to landscape (the ring's size unchanged) plays on exactly as if nothing happened.
    const trace = (turn: boolean) => {
      const engine = battle({}, 13, portrait);
      for (let i = 0; i < 200; i++) engine.update(STEP, 0);
      if (turn) engine.setConfig({ width: 1920, height: 1080 });
      runBattle(engine);
      const v = engine.getStringBattleView();
      return [v.winner, v.cuts, v.livesLost, v.bounces, Math.round(v.finishedMs)];
    };
    expect(trace(true)).toEqual(trace(false));
  });

  it("collide: the ball that spawned fastest does not win nearly every battle (chaos, not a verdict at spawn)", () => {
    let fastestWins = 0;
    let battles = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const engine = battle({ rule: "collide", lives: 3 }, seed, { ...config, width: 450, height: 800 });
      const view = engine.getStringBattleView();
      const spawn = view.fighters.map((f) => f.cruise);
      const fastest = spawn.indexOf(Math.max(...spawn));
      runBattle(engine, 300_000);
      if (!view.finished) continue;
      battles++;
      if (view.winner === fastest) fastestWins++;
    }
    expect(battles).toBeGreaterThanOrEqual(20);
    // About one in four of a four-ball battle; spawn-fixed it was 59 of 60.
    expect(fastestWins / battles).toBeLessThan(0.5);
  });
});

/* ------------------------------------------------------------------ the finder and the rig */

describe("Find Simulation and the forced winner", () => {
  const request = (patch: Partial<FinderRequest> = {}): FinderRequest => ({
    targetDurationSec: 30,
    toleranceSec: 0.5,
    maxSeeds: 40,
    maxSimTimeSec: 120,
    physicsConfig: config,
    mode: "stringBattle",
    modeSettings: { ...modeSettings, stringBattle: {} },
    ...patch,
  });

  it("offers the run length and the winner, the balls being the teams", () => {
    expect(runNeverFinishes("stringBattle", { drop: {}, box: {} })).toBe(false);
    expect(BATTLE_WINNER_MODES).toContain("stringBattle");
    expect(availableOutcomes("stringBattle", { endless: false, neverEscape: false, ballCount: 4 })).toEqual(["duration", "winner"]);
    expect(forcedWinnerApplies("stringBattle", 4, 3)).toBe(true);
    expect(forcedWinnerApplies("stringBattle", 4, 4)).toBe(false);
    expect(effectiveBallCount({ ...defaultSettings("stringBattle"), sbBalls: 5 })).toBe(5);
    expect(effectiveBallCount({ ...defaultSettings("stringBattle"), teams: [{ name: "A", color: "#ff0000", emoji: "" }], sbBalls: 3 })).toBe(3);
    expect(effectiveBallCount({ ...defaultSettings("classic"), sbBalls: 5 })).toBe(1);
  });

  it("replays a seed's length exactly and finds a battle of a given length", { timeout: 60_000 }, async () => {
    const len = simulateSeed(99, request(), 120_000);
    expect(simulateSeed(99, request(), 120_000)).toBe(len);
    const target = Math.round(len / 1000);
    const found = await withFrames(() => findSimulation(request({ targetDurationSec: target, toleranceSec: 2 }), () => undefined));
    expect(found.found).toBe(true);
    expect(Math.abs(simulateSeed(found.seed, request(), 120_000) / 1000 - target)).toBeLessThanOrEqual(2);
  });

  it("judges the winner outcome by the last ball standing", () => {
    const engine = battle({}, 4);
    const length = runBattle(engine);
    const winner = engine.getStringBattleView().winner;
    const outcome = { kind: "winner" as const, clipSec: 90, team: winner };
    const run = simulateOutcomeRun(4, request(), outcome);
    expect(run.teams.length).toBe(4);
    expect(run.finished).toBe(true);
    expect(run.durationMs).toBeCloseTo(length, 6);
    expect(outcomeMatches(outcome, run)).toBe(true);
    expect(outcomeMatches({ ...outcome, team: (winner + 1) % 4 }, run)).toBe(false);
    // A search for another ball gives the battle up as soon as that ball is out.
    const loser = simulateOutcomeRun(4, request(), { ...outcome, team: (winner + 1) % 4 });
    expect(loser.finished).toBe(false);
    expect(loser.durationMs).toBeLessThan(length);
    expect(outcomeMatches({ ...outcome, team: (winner + 1) % 4 }, loser)).toBe(false);
  });

  it("judges a battle's winner at its end, not the clip's: lives 9 and a 30 s clip", () => {
    const req = request({ maxSimTimeSec: 60, modeSettings: { ...modeSettings, stringBattle: { lives: 9 } } });
    let matched = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const engine = battle({ lives: 9 }, seed);
      const length = runBattle(engine, 300_000);
      const winner = engine.getStringBattleView().winner;
      for (let team = 0; team < 4; team++) {
        const outcome = { kind: "winner" as const, clipSec: 30, team };
        const run = simulateOutcomeRun(seed, req, outcome);
        const ok = outcomeMatches(outcome, run);
        if (ok) {
          matched++;
          // A match is a finished battle the chosen ball won – the same battle the page plays.
          expect(run.finished, `seed ${seed} team ${team}`).toBe(true);
          expect(team, `seed ${seed}`).toBe(winner);
          expect(run.durationMs).toBeCloseTo(length, 6);
          expect(outcomeClipSec(outcome, run)).toBeCloseTo(length / 1000, 6);
        } else if (length <= 60_000) expect(team === winner, `seed ${seed} team ${team}`).toBe(false);
      }
    }
    expect(matched).toBeGreaterThan(0);
    // Mid-battle at the clip's end the leader is no winner yet.
    const unfinished = { mode: "stringBattle" as const, durationMs: 30_000, finished: false, firstEscapeMs: -1, teams: [0, 1, 2, 3].map((i) => ({ ...emptyStats(), bounces: 10 + i, walls: i === 2 ? 1 : 0 })) };
    expect(outcomeMatches({ kind: "winner", clipSec: 30, team: 2 }, unfinished)).toBe(false);
    expect(outcomeMatches({ kind: "winner", clipSec: 30, team: 2 }, { ...unfinished, mode: undefined })).toBe(true); // any other mode: the scoreboard at the clip's end
  });

  it("finds a battle a chosen ball wins with lives 9 and a 30 s clip – and the found seed plays out that way", { timeout: 60_000 }, async () => {
    const stringBattle = { lives: 9 };
    const outcome = { kind: "winner" as const, clipSec: 30, team: 2 };
    const found = await withFrames(() => findSimulation(request({ maxSimTimeSec: 60, outcome, modeSettings: { ...modeSettings, stringBattle } }), () => undefined));
    expect(found.found).toBe(true);
    expect(found.finished).toBe(true);
    const engine = battle(stringBattle, found.seed);
    const length = runBattle(engine, 300_000);
    expect(engine.getStringBattleView().winner).toBe(2);
    expect(found.duration).toBeCloseTo(length / 1000, 6); // the clip the page records: the whole battle
  });

  it("the forced winner wins every battle, under every rule and with a clip limit", () => {
    for (const rule of ["cut", "touch", "collide"] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const engine = battle({ rule, lives: 3 }, seed, { ...config, forcedWinner: 2 });
        runBattle(engine, 240_000);
        const view = engine.getStringBattleView();
        expect(view.finished, `${rule} ${seed}`).toBe(true);
        expect(view.winner, `${rule} ${seed}`).toBe(2);
        expect(teamResult(engine.getTeamStats().slice(0, 4), 4).winner).toBe(2);
      }
    }
    const limited = battle({ duration: 10, lives: 9 }, 3, { ...config, forcedWinner: 1 });
    runBattle(limited, 60_000);
    expect(limited.getStringBattleView().winner).toBe(1);
  });

  it("finds a battle a chosen ball wins, and at once with the forced winner", { timeout: 60_000 }, async () => {
    const outcome = { kind: "winner" as const, clipSec: 90, team: 1 };
    const found = await withFrames(() => findSimulation(request({ outcome }), () => undefined));
    expect(found.found).toBe(true);
    const engine = battle({}, found.seed);
    runBattle(engine);
    expect(engine.getStringBattleView().winner).toBe(1);
    const rigged = await withFrames(() => findSimulation(request({ outcome: { ...outcome, team: 3 }, physicsConfig: { ...config, forcedWinner: 3 } }), () => undefined));
    expect(rigged.found).toBe(true);
    expect(rigged.seedsTested).toBe(1);
  });

  it("slows down on the final cut like a near miss (the camera draws its balls between steps)", () => {
    const engine = battle({}, 9);
    const before = engine.getNearMissSerial();
    const shakes = engine.getWallBreakSerial();
    runBattle(engine);
    expect(engine.getNearMissSerial()).toBe(before + 1);
    expect(engine.getWallBreakSerial()).toBe(shakes + 3); // a shake per shattered ball
    expect(slowViewEligible("stringBattle")).toBe(true);
  });
});

/* ------------------------------------------------------------------ sounds */

describe("the String Battle sounds", () => {
  it("seed their noise, so a shatter sounds the same every time", () => {
    const a = noiseSamples(1000);
    expect(a).toEqual(noiseSamples(1000));
    expect(a.every((v) => v >= -1 && v < 1)).toBe(true);
    expect(Math.abs(a.reduce((s, v) => s + v, 0) / a.length)).toBeLessThan(0.1);
    expect(noiseSamples(10, 1)).not.toEqual(noiseSamples(10, 2));
  });

  const graph = () => {
    const started: { kind: string; type?: string; frequency?: number; at: number }[] = [];
    const param = (value = 0) => ({ value, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined });
    const node = () => ({ connect: () => undefined, disconnect: () => undefined });
    let time = 0;
    const ctx = {
      state: "running",
      get currentTime() {
        return time;
      },
      sampleRate: 48000,
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
      decodeAudioData: async () => ({ duration: 0.3 }),
      createGain: () => ({ ...node(), gain: param(1) }),
      createAnalyser: () => ({ ...node(), fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128 }),
      createMediaStreamDestination: () => ({ ...node(), stream: {} }),
      createBiquadFilter: () => ({ ...node(), type: "", frequency: param(0), Q: param(0) }),
      createBufferSource: () => {
        const src = { ...node(), buffer: null as unknown, playbackRate: param(1), onended: null, start: (when = 0) => void started.push({ kind: "buffer", at: when }), stop: () => undefined };
        return src;
      },
      createBuffer: (channels: number, length: number, sampleRate: number) => ({ sampleRate, length, duration: length / sampleRate, copyToChannel: () => undefined, getChannelData: () => new Float32Array(length) }),
      createOscillator: () => {
        const osc = { ...node(), type: "sine", frequency: param(0), onended: null, start: (when = 0) => void (osc.frequency.value !== 1 && started.push({ kind: "osc", type: osc.type, frequency: osc.frequency.value, at: when })), stop: () => undefined };
        return osc;
      },
    };
    return { ctx, started, setTime: (t: number) => (time = t) };
  };

  it("schedule a pluck (a string and its snap) and a shatter (the noise burst and three tinkles)", () => {
    const g = graph();
    const out = g.ctx.createGain();
    scheduleStringPluck(g.ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 440, 1.5, (f) => 2 * f);
    expect(g.started.filter((s) => s.kind === "buffer").map((s) => s.at)).toEqual([1.5]); // the Karplus–Strong string
    expect(g.started.find((s) => s.kind === "osc")).toMatchObject({ frequency: 880 * 4, at: 1.5 });
    g.started.length = 0;
    const noise = new NoiseCache().get(g.ctx as unknown as BaseAudioContext);
    expect(noise.length).toBe(Math.round(48000 * NOISE_SECONDS));
    scheduleShatterBurst(g.ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 2, noise);
    expect(g.started.filter((s) => s.kind === "buffer").map((s) => s.at)).toEqual([2]);
    const tinkles = g.started.filter((s) => s.kind === "osc");
    expect(tinkles.map((s) => s.frequency)).toEqual([...SHATTER_BURST.tinkles]);
    for (let i = 1; i < tinkles.length; i++) expect(tinkles[i].at).toBeGreaterThan(tinkles[i - 1].at);
  });

  describe("through the ToneGenerator", () => {
    let g: ReturnType<typeof graph>;
    let tone: ToneGenerator;
    beforeEach(async () => {
      g = graph();
      const ctx = g.ctx;
      vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return ctx; } });
      vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      tone = new ToneGenerator();
      await tone.start();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("snaps the pluck to the scale and puts the effects on the beat grid", () => {
      tone.setMusicSettings({ instrument: "triangle", melodyInstrument: "sine", scale: "major", rootNote: 0, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/8" });
      g.setTime(1.01);
      tone.playStringBattle("pluck", 460);
      const snap = g.started.find((s) => s.kind === "osc")!;
      expect(snap.frequency! / 4).toBeCloseTo(440, 6); // A4, snapped from 460 Hz
      expect(snap.at).toBeCloseTo(1.25, 6);
      g.started.length = 0;
      tone.playStringBattle("shatter");
      expect(g.started.filter((s) => s.kind === "buffer").length).toBe(1);
      expect(g.started.filter((s) => s.kind === "osc").length).toBe(3);
    });
  });
});

/* ------------------------------------------------------------------ review fix (modes-boris-odd) */

/** A 2D context that records the texts and circles drawn (everything else is a no-op). */
function recordingCtx() {
  const texts: { text: string; x: number; y: number }[] = [];
  const circles: { x: number; y: number; r: number }[] = [];
  const target: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => texts.push({ text: String(text), x, y }),
    measureText: (text: string) => ({ width: 7 * String(text).length }),
    arc: (x: number, y: number, r: number) => circles.push({ x, y, r }),
    ellipse: (x: number, y: number, rx: number, ry: number) => circles.push({ x, y, r: Math.max(rx, ry) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  const ctx = new Proxy(target, {
    get: (t, key) => (typeof key === "string" && !(key in t) ? (t[key] = () => {}) : t[key as string]),
    set: (t, key, value) => {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, circles };
}

const TEAM_LABELS: TeamLabels = { bounces: "Bounces", walls: "Walls", escapes: "Escapes", kills: "Kills", win: "Win", wins: (name) => `${name} wins!`, tie: "It's a tie!", team: (n) => `Team ${n}` };
const RED_BLUE = [
  { name: "Red", color: "#ef4444", emoji: "" },
  { name: "Blue", color: "#3b82f6", emoji: "" },
];

describe("review fixes (modes-boris-odd)", () => {
  it("keeps the forced winner with the merge interaction: a merge that would absorb the chosen ball keeps it in the battle", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 24; seed++) {
      const engine = battle({ balls: 4 }, seed, { ...config, ballInteraction: "merge", forcedWinner: 1 });
      runBattle(engine, 300_000);
      const v = engine.getStringBattleView();
      expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
      expect(v.winner, `seed ${seed}`).toBe(1);
      expect(v.fighters[1].alive, `seed ${seed}`).toBe(true);
    }
  });

  it("names a String Battle's kills and its win in the teams banner and scoreboard, not walls and escapes", () => {
    const engine = battle({ balls: 2, hud: false }, 5);
    runBattle(engine);
    expect(engine.isSimulationFinished()).toBe(true);
    const layer = new TeamLayer();
    layer.beginFrame(engine, { roster: RED_BLUE, showNames: true, showScoreboard: true, position: "top-left", labels: TEAM_LABELS });
    const { ctx, texts } = recordingCtx();
    layer.drawOverlay(ctx, engine, { width: 800, height: 600, dtMs: 16, inset: 0, modeBanner: false });
    const drawn = texts.map((t) => t.text);
    expect(drawn).toEqual(expect.arrayContaining(["Bounces", "Kills", "Win"]));
    expect(drawn.some((t) => /Walls|Escapes/.test(t))).toBe(false);
    expect(drawn.some((t) => / wins!$/.test(t))).toBe(true);
    const sub = drawn.find((t) => t.startsWith("Kills "));
    expect(sub).toMatch(/^Kills \d+ · Bounces \d+$/);
    // The ring modes keep their words.
    const ring = createEngineForSettings({ ...config, ballCount: 2 }, "classic", modeSettings, 3);
    const ringLayer = new TeamLayer();
    ringLayer.beginFrame(ring, { roster: RED_BLUE, showNames: true, showScoreboard: true, position: "top-left", labels: TEAM_LABELS });
    const rec = recordingCtx();
    ringLayer.drawOverlay(rec.ctx, ring, { width: 800, height: 600, dtMs: 16, inset: 0, modeBanner: false });
    expect(rec.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Bounces", "Walls", "Escapes"]));
  });

  it("moves the warning badge to the top-right corner when the teams scoreboard takes the top-left one, and reports the top HUD", () => {
    const engine = battle({ balls: 4 }, 7);
    const view = engine.getStringBattleView();
    const layer = new StringBattleLayer();
    const o: StringBattleRenderOptions = { dpr: 1, roster: [], showNames: false, wallThickness: 4, labels: DEFAULT_STRING_BATTLE_LABELS, nowMs: 0, simDtMs: 0, contacts: null, width: 800, height: 600 };
    const badgeX = (badgeRight: boolean) => {
      const { ctx, texts } = recordingCtx();
      const bottom = layer.drawOverlay(ctx, view, o, { inset: 0, dtMs: 0, teamBanner: false, badgeRight });
      return { x: texts.find((t) => t.text === DEFAULT_STRING_BATTLE_LABELS.badgeTop)!.x, bottom };
    };
    const left = badgeX(false);
    const right = badgeX(true);
    expect(left.x).toBeLessThan(400);
    expect(right.x).toBeGreaterThan(400);
    // The web style's HUD (top right, a row per ball) is the lowest top item; both reach into the captions' column.
    expect(left.bottom).toBeGreaterThan(0.15 * 600);
    const noHud = battle({ balls: 4, hud: false }, 7).getStringBattleView();
    const { ctx } = recordingCtx();
    const badgeOnly = layer.drawOverlay(ctx, noHud, o, { inset: 0, dtMs: 0, teamBanner: false });
    expect(badgeOnly).toBeGreaterThan(0);
    expect(badgeOnly).toBeLessThan(left.bottom);
  });

  it("draws the fighters' faces as two eyes above the lives in the web style (the whole face in the neon style)", () => {
    expect(sbFaceLayout("web")).toEqual({ shape: "circle", countdown: true });
    expect(sbFaceLayout("neon")).toBeNull();
    const r = 20;
    const { ctx, circles } = recordingCtx();
    drawFace(ctx, 100, 100, r, "cute", { expression: "neutral", closure: 0, lookX: 0, lookY: 0 }, "#ef4444", { compact: true });
    expect(circles.length).toBeGreaterThan(0);
    // The lives are drawn at 1.15 r around the centre: the eyes stay above the digit's top (about 0.35 r above the centre).
    for (const c of circles) expect(c.y + c.r).toBeLessThan(100 - 0.35 * r);
  });
});
