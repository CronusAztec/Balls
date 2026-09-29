import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BORIS_MIN_RADIUS,
  BORIS_PERSONA,
  CHARACTER_RANGES,
  DEFAULT_CHARACTER,
  FACE_STYLES,
  MAX_NAME_LENGTH,
  TINY_FACE_RADIUS,
  borisPersonaPatch,
  characterRenderOptions,
  characterSoundsOn,
  faceGeometry,
  isFaceStyle,
  resolveCharacterSettings,
  sanitizeName,
} from "@/lib/character/character";
import { GRIN_HOLD_MS, OUCH_IMPACT, OUCH_MS, REST_MS, REST_SPEED, SHOCK_MS, createExpressionState, stepExpression, type ExpressionInput, type ExpressionState } from "@/lib/character/expression";
import {
  BLINK_MAX_GAP_MS,
  BLINK_MIN_GAP_MS,
  BLINK_MS,
  BlinkClock,
  DOUBLE_BLINK_GAP_MS,
  MAX_SQUASH,
  SQUASH_MS,
  blinkClosure,
  blinkSchedule,
  blinkSeed,
  lookTarget,
  smoothToward,
  squashAmount,
  squashScales,
  type Vec,
} from "@/lib/character/eyes";
import { CharacterTracker, MAX_CHARACTER_BALLS, type CharacterFrameInput, type TrackedBall } from "@/lib/character/tracker";
import { CHIRPS, CHIRP_MIN_GAP_MS, chirpAllowed, chirpForExpression, scheduleChirp } from "@/lib/audio/characterVoice";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
import { MODE_IDS } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

/**
 * Ball characters (lib/character, the "Boris" persona): the settings and their URL / preset validation, the face
 * geometry, the expression state machine, the eye-tracking maths, the seeded blink schedule, the squash maths, the
 * per-ball tracker (also on a real engine run, which it must never disturb) and the cat chirp.
 */

const vec = (): Vec => ({ x: 0, y: 0 });

describe("character settings", () => {
  it("are off by default in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect({ ballFace: d.ballFace, faceOverImage: d.faceOverImage, ballName: d.ballName, nameLabel: d.nameLabel, ballSquash: d.ballSquash, faceSounds: d.faceSounds }).toEqual(DEFAULT_CHARACTER);
      const query = settingsToSearchParams(d).toString();
      for (const key of ["face", "fimg", "bn", "nl", "sq", "fsnd"]) expect(new URLSearchParams(query).has(key)).toBe(false);
    }
    expect(DEFAULT_CHARACTER.ballFace).toBe("none");
    expect(DEFAULT_CHARACTER.ballSquash).toBe(0);
    expect(RANGES.ballSquash).toEqual(CHARACTER_RANGES.ballSquash);
  });

  it("round-trip through face / bn / nl / sq / fimg / fsnd", () => {
    const s = { ...defaultSettings("drop"), ballFace: "cat" as const, ballName: "Boris", nameLabel: false, ballSquash: 0.65, faceOverImage: true, faceSounds: true };
    const params = settingsToSearchParams(s);
    expect(params.get("face")).toBe("cat");
    expect(params.get("bn")).toBe("Boris");
    expect(params.get("nl")).toBe("0");
    expect(params.get("sq")).toBe("0.65");
    expect(params.get("fimg")).toBe("1");
    expect(params.get("fsnd")).toBe("1");
    const back = settingsFromSearchParams(params);
    expect({ ballFace: back.ballFace, ballName: back.ballName, nameLabel: back.nameLabel, ballSquash: back.ballSquash, faceOverImage: back.faceOverImage, faceSounds: back.faceSounds }).toEqual({
      ballFace: "cat",
      ballName: "Boris",
      nameLabel: false,
      ballSquash: 0.65,
      faceOverImage: true,
      faceSounds: true,
    });
  });

  it("reject unknown faces, trim names and clamp the squash from URLs and presets", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams(`face=robot&bn=${encodeURIComponent("  Boris\nthe Magnificent Round Escape Artist  ")}&sq=7`));
    expect(fromUrl.ballFace).toBe("none");
    expect(fromUrl.ballName.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(fromUrl.ballName.startsWith("Boris the")).toBe(true);
    expect(fromUrl.ballSquash).toBe(1);
    expect(settingsFromSearchParams(new URLSearchParams("sq=-3")).ballSquash).toBe(0);
    const preset = presetToSettings({ mode: "classic", ballFace: "wink" as never, ballName: 42 as never, nameLabel: "yes" as never, ballSquash: Number.NaN, faceSounds: 1 as never });
    expect({ ballFace: preset.ballFace, ballName: preset.ballName, nameLabel: preset.nameLabel, ballSquash: preset.ballSquash, faceSounds: preset.faceSounds }).toEqual({ ballFace: "none", ballName: "", nameLabel: true, ballSquash: 0, faceSounds: false });
    const good = presetToSettings({ mode: "box", ballFace: "cool", ballName: "Boris", ballSquash: 0.3 });
    expect([good.ballFace, good.ballName, good.ballSquash]).toEqual(["cool", "Boris", 0.3]);
    // Presets saved before the feature existed load with the character off.
    expect(presetToSettings({ mode: "classic", gravity: 500 }).ballFace).toBe("none");
  });

  it("validate names and faces", () => {
    expect(FACE_STYLES).toEqual(["none", "dot", "cute", "cool", "cat", "angry"]);
    expect(isFaceStyle("cat")).toBe(true);
    expect(isFaceStyle("Cat")).toBe(false);
    expect(sanitizeName("  Bo\tris  ")).toBe("Bo ris");
    expect(sanitizeName("😺".repeat(40))).toBe("😺".repeat(MAX_NAME_LENGTH));
    expect(sanitizeName(undefined)).toBe("");
    expect(resolveCharacterSettings(null)).toEqual(DEFAULT_CHARACTER);
  });

  it("the Boris persona sets the face, the name and the squash and only ever grows the ball", () => {
    expect(borisPersonaPatch({ ballRadius: 8 })).toEqual({ ...BORIS_PERSONA, ballRadius: BORIS_MIN_RADIUS });
    expect(borisPersonaPatch({ ballRadius: 25 }).ballRadius).toBe(25);
    expect(BORIS_PERSONA.ballName).toBe("Boris");
  });

  it("render options: the label follows the toggle, the cat chirps only without a hit sample", () => {
    const base = { ...DEFAULT_CHARACTER, hitSoundMode: "tones" };
    expect(characterRenderOptions({ ...base, ballName: "Boris" }).label).toBe("Boris");
    expect(characterRenderOptions({ ...base, ballName: "Boris", nameLabel: false }).label).toBe("");
    expect(characterSoundsOn({ ballFace: "cat", faceSounds: true, hitSoundMode: "tones" })).toBe(true);
    expect(characterSoundsOn({ ballFace: "cat", faceSounds: true, hitSoundMode: "sample" })).toBe(false);
    expect(characterSoundsOn({ ballFace: "cute", faceSounds: true, hitSoundMode: "tones" })).toBe(false);
    expect(characterSoundsOn({ ballFace: "cat", faceSounds: false, hitSoundMode: "tones" })).toBe(false);
  });
});

describe("face geometry", () => {
  it("scales linearly with the ball size and keeps the pupils inside the eyes", () => {
    for (const style of FACE_STYLES) {
      if (style === "none") continue;
      const a = faceGeometry(style, 10);
      const b = faceGeometry(style, 30);
      for (const key of Object.keys(a) as (keyof typeof a)[]) expect(b[key]).toBeCloseTo(3 * a[key], 9);
      if (style !== "dot") {
        expect(a.maxLook + a.pupilR).toBeLessThanOrEqual(a.eyeR);
        expect(a.maxLook).toBeGreaterThan(0);
      }
      // Both eyes stay on the ball, even looking sideways with the face turned.
      expect(a.eyeDx + a.eyeR + a.maxLook + a.faceShift).toBeLessThan(10);
    }
  });

  it("reduces a face on a tiny ball to two dots", () => {
    expect(faceGeometry("cute", TINY_FACE_RADIUS - 1)).toEqual(faceGeometry("dot", TINY_FACE_RADIUS - 1));
    expect(faceGeometry("cute", TINY_FACE_RADIUS)).not.toEqual(faceGeometry("dot", TINY_FACE_RADIUS));
  });
});

describe("expression state machine", () => {
  const input = (patch: Partial<ExpressionInput>): ExpressionInput => ({ now: 0, dt: 16, impact: 0, wallBreak: false, escaped: false, finished: false, speed: 400, ...patch });
  /** Runs the machine at 60 fps from `from` for `ms`, returning the expression at the end. */
  const run = (state: ExpressionState, from: number, ms: number, patch: Partial<ExpressionInput> = {}) => {
    for (let t = from + 16; t <= from + ms; t += 16) stepExpression(state, input({ now: t, ...patch }));
    return state.expression;
  };

  it("starts neutral and stays neutral in plain flight", () => {
    const st = createExpressionState();
    expect(st.expression).toBe("neutral");
    expect(run(st, 0, 2000)).toBe("neutral");
  });

  it("says ouch on a hard hit, for OUCH_MS, and ignores soft ones", () => {
    const st = createExpressionState();
    expect(stepExpression(st, input({ now: 100, impact: 0.5 * OUCH_IMPACT }))).toBeNull();
    expect(st.expression).toBe("neutral");
    expect(stepExpression(st, input({ now: 116, impact: OUCH_IMPACT }))).toBe("ouch");
    expect(st.expression).toBe("ouch");
    // A second hard hit while wincing extends the ouch without triggering it again.
    expect(stepExpression(st, input({ now: 200, impact: 2 }))).toBeNull();
    expect(run(st, 200, OUCH_MS - 20)).toBe("ouch");
    expect(run(st, 200 + OUCH_MS - 20, 40)).toBe("neutral");
  });

  it("goes wide-eyed when a wall breaks, and a hit does not cut the shock short", () => {
    const st = createExpressionState();
    expect(stepExpression(st, input({ now: 50, wallBreak: true }))).toBe("shock");
    expect(stepExpression(st, input({ now: 66, impact: 3 }))).toBeNull();
    expect(st.expression).toBe("shock");
    expect(run(st, 66, SHOCK_MS - 40)).toBe("shock");
    expect(run(st, 50 + SHOCK_MS - 10, 40)).toBe("neutral");
    // ...but a shock overrides an ouch.
    stepExpression(st, input({ now: 5000, impact: 3 }));
    expect(stepExpression(st, input({ now: 5016, wallBreak: true }))).toBe("shock");
  });

  it("grins at the escape and at the finish, over everything, and lingers after", () => {
    const st = createExpressionState();
    stepExpression(st, input({ now: 10, wallBreak: true }));
    expect(stepExpression(st, input({ now: 26, escaped: true }))).toBe("grin");
    expect(stepExpression(st, input({ now: 42, escaped: true, wallBreak: true, impact: 5 }))).toBeNull();
    expect(st.expression).toBe("grin");
    expect(run(st, 42, GRIN_HOLD_MS - 40)).toBe("grin");
    expect(run(st, 42 + GRIN_HOLD_MS, 40)).toBe("neutral");
    const done = createExpressionState();
    expect(stepExpression(done, input({ now: 1, finished: true }))).toBe("grin");
  });

  it("closes its eyes happily after resting, and only while the clock runs", () => {
    const st = createExpressionState();
    // Paused: no time passes, so the ball never counts as resting.
    for (let i = 0; i < 200; i++) stepExpression(st, input({ now: 0, dt: 0, speed: 0 }));
    expect(st.expression).toBe("neutral");
    expect(run(st, 0, REST_MS - 40, { speed: 0.5 * REST_SPEED })).toBe("neutral");
    expect(run(st, REST_MS - 40, 80, { speed: 0.5 * REST_SPEED })).toBe("happy");
    stepExpression(st, input({ now: REST_MS + 100, speed: 5 * REST_SPEED }));
    expect(st.expression).toBe("neutral");
    // A hard hit wakes a resting ball.
    run(st, REST_MS + 100, 2 * REST_MS, { speed: 0 });
    expect(st.expression).toBe("happy");
    expect(stepExpression(st, input({ now: 5000, impact: 2, speed: 0 }))).toBe("ouch");
  });
});

describe("eye tracking", () => {
  it("looks along the velocity, further the faster it flies, never beyond the eye's reach", () => {
    const out = vec();
    expect(lookTarget(0, 0, 3, out)).toEqual({ x: 0, y: 0 });
    let last = 0;
    for (const speed of [10, 50, 100, 300, 800, 5000, 1e7]) {
      const angle = speed / 97;
      lookTarget(speed * Math.cos(angle), speed * Math.sin(angle), 3, out);
      const len = Math.hypot(out.x, out.y);
      expect(len).toBeGreaterThan(last);
      expect(len).toBeLessThanOrEqual(3);
      // Same direction as the velocity: no cross component.
      expect(Math.abs(out.x * Math.sin(angle) - out.y * Math.cos(angle))).toBeLessThan(1e-9);
      expect(out.x * Math.cos(angle) + out.y * Math.sin(angle)).toBeGreaterThan(0);
      last = len;
    }
    expect(lookTarget(Number.NaN, 5, 3, out)).toEqual({ x: 0, y: 0 });
    expect(lookTarget(100, 0, 0, out)).toEqual({ x: 0, y: 0 });
  });

  it("eases toward the target the same way at any frame rate", () => {
    const oneStep = smoothToward(0, 1, 32);
    const twoSteps = smoothToward(smoothToward(0, 1, 16), 1, 16);
    expect(twoSteps).toBeCloseTo(oneStep, 12);
    expect(smoothToward(0.3, 1, 0)).toBe(0.3);
    expect(smoothToward(0, 1, 10000)).toBeCloseTo(1, 9);
    expect(smoothToward(0, 1, 16, 0)).toBe(1);
  });
});

describe("blink schedule", () => {
  it("is the same for the same seed and ball, and differs between balls", () => {
    const a = blinkSchedule(blinkSeed(1234, 0), 120000);
    expect(blinkSchedule(blinkSeed(1234, 0), 120000)).toEqual(a);
    expect(blinkSchedule(blinkSeed(1234, 1), 120000)).not.toEqual(a);
    expect(blinkSchedule(blinkSeed(1235, 0), 120000)).not.toEqual(a);
    expect(blinkSeed(1234, 0)).toBe(blinkSeed(1234, 0));
  });

  it("blinks every 1.8–5 s, sometimes twice in a row, never three times and never at the start", () => {
    for (const seed of [1, 99, 123456, -42]) {
      const times = blinkSchedule(blinkSeed(seed, 3), 300000);
      expect(times[0]).toBeGreaterThanOrEqual(BLINK_MIN_GAP_MS);
      let doubles = 0;
      for (let i = 1; i < times.length; i++) {
        const gap = times[i] - times[i - 1];
        if (Math.abs(gap - DOUBLE_BLINK_GAP_MS) < 1e-9) {
          doubles++;
          // The blink after a double is a normal gap away.
          if (i + 1 < times.length) expect(times[i + 1] - times[i]).toBeGreaterThanOrEqual(BLINK_MIN_GAP_MS);
        } else {
          expect(gap).toBeGreaterThanOrEqual(BLINK_MIN_GAP_MS);
          expect(gap).toBeLessThanOrEqual(BLINK_MAX_GAP_MS);
        }
      }
      expect(times.length).toBeGreaterThan(50);
      expect(doubles).toBeGreaterThan(0);
    }
  });

  it("closes fast, opens slower and is shut at the peak", () => {
    expect(blinkClosure(-0.1)).toBe(0);
    expect(blinkClosure(0)).toBe(0);
    expect(blinkClosure(0.4)).toBeCloseTo(1, 12);
    expect(blinkClosure(0.2)).toBeCloseTo(0.5, 12);
    expect(blinkClosure(0.7)).toBeCloseTo(0.5, 12);
    expect(blinkClosure(1)).toBe(0);
  });

  it("does not depend on when or how often it is sampled, and starts over on a restart", () => {
    const seed = blinkSeed(777, 5);
    const schedule = blinkSchedule(seed, 60000);
    const reference = (t: number) => {
      for (const start of schedule) if (t >= start && t < start + BLINK_MS) return blinkClosure((t - start) / BLINK_MS);
      return 0;
    };
    // 60 fps, a jittery 30 fps and an 8× playback that samples every 133 ms all see the same lids at the same times.
    for (const step of [16.666, 33.3, 133.3]) {
      const clock = new BlinkClock(seed);
      for (let t = 0, i = 0; t < 60000; t += step * (1 + 0.3 * Math.sin(i++))) expect(clock.closure(t)).toBeCloseTo(reference(t), 12);
    }
    const clock = new BlinkClock(seed);
    const first = schedule[0] + 0.4 * BLINK_MS;
    expect(clock.closure(first)).toBeCloseTo(1, 9);
    clock.closure(40000);
    // Time went back (a restart): the same schedule from the top.
    expect(clock.closure(first)).toBeCloseTo(1, 9);
    expect(clock.closure(first + BLINK_MS)).toBe(0);
  });
});

describe("squash and stretch", () => {
  it("squashes first, then stretches, stays bounded and settles", () => {
    expect(squashAmount(0, 1.5, 0)).toBe(0);
    expect(squashAmount(10, 0, 1)).toBe(0);
    expect(squashAmount(-5, 1, 1)).toBe(0);
    expect(squashAmount(SQUASH_MS, 1.5, 1)).toBe(0);
    expect(squashAmount(0, 1.5, 1)).toBeCloseTo(MAX_SQUASH, 12);
    let min = 0;
    let max = 0;
    for (let t = 0; t < SQUASH_MS; t += 2) {
      const d = squashAmount(t, 3, 1);
      min = Math.min(min, d);
      max = Math.max(max, d);
      expect(Math.abs(squashAmount(t, 3, 0.5))).toBeLessThanOrEqual(0.5 * MAX_SQUASH + 1e-12);
    }
    expect(max).toBeCloseTo(MAX_SQUASH, 9);
    expect(min).toBeLessThan(0);
    expect(-min).toBeLessThan(0.5 * max);
    expect(Math.abs(squashAmount(SQUASH_MS - 1, 3, 1))).toBeLessThan(0.01);
    // Harder hits squash more (until they saturate).
    expect(squashAmount(0, 0.5, 1)).toBeLessThan(squashAmount(0, 1, 1));
  });

  it("keeps the area of the ball", () => {
    const out = vec();
    for (const d of [-0.1, 0, 0.2, MAX_SQUASH]) {
      squashScales(d, out);
      expect(out.x * out.y).toBeCloseTo(1, 12);
      expect(out.x).toBeCloseTo(1 - d, 12);
    }
  });
});

describe("character tracker", () => {
  const frameInput = (now: number, patch: Partial<CharacterFrameInput> = {}): CharacterFrameInput => ({
    now,
    seed: 42,
    refSpeed: 400,
    accelAllowance: 800,
    wallBreak: false,
    finished: false,
    centerX: 400,
    centerY: 300,
    escapeRadius: Infinity,
    ...patch,
  });
  const ball = (id: number, x: number, y: number, vx: number, vy: number, radius = 10): TrackedBall => ({ id, x, y, vx, vy, radius });

  it("turns a rebound into an ouch with the impact normal pointing away from the wall", () => {
    const tracker = new CharacterTracker();
    const b = ball(0, 400, 300, 400, 0);
    tracker.update([b], frameInput(0));
    // Plain flight with gravity: no impact.
    b.x += 6.7;
    b.vy += 6;
    tracker.update([b], frameInput(16.7));
    expect(tracker.get(0)!.expression.expression).toBe("neutral");
    expect(tracker.get(0)!.impactStrength).toBe(0);
    // It hits a wall on its right: the velocity flips.
    b.vx = -400;
    tracker.update([b], frameInput(33.4));
    const st = tracker.get(0)!;
    expect(st.expression.expression).toBe("ouch");
    expect(tracker.triggered).toBe("ouch");
    expect(tracker.primaryExpression).toBe("ouch");
    expect(st.impactAt).toBe(33.4);
    expect(st.impactStrength).toBeGreaterThan(1.9);
    expect(st.impactNx).toBeCloseTo(-1, 2);
    // The eyes turn toward the new direction.
    for (let t = 50; t < 400; t += 16.7) tracker.update([b], frameInput(t));
    expect(tracker.get(0)!.lookX).toBeLessThan(-0.5);
    expect(tracker.triggered).toBeNull();
  });

  it("shocks every ball at a wall break, grins at the escape and the finish", () => {
    const tracker = new CharacterTracker();
    const balls = [ball(0, 400, 300, 300, 0), ball(1, 420, 300, -300, 0)];
    tracker.update(balls, frameInput(0));
    tracker.update(balls, frameInput(16, { wallBreak: true }));
    expect(tracker.get(0)!.expression.expression).toBe("shock");
    expect(tracker.get(1)!.expression.expression).toBe("shock");
    expect(tracker.triggered).toBe("shock");
    // Ball 0 flies out past the outermost intact wall (radius 200 around the centre).
    balls[0].x = 400 + 215;
    tracker.update(balls, frameInput(32, { escapeRadius: 200 }));
    expect(tracker.get(0)!.expression.expression).toBe("grin");
    expect(tracker.get(1)!.expression.expression).toBe("shock");
    expect(tracker.triggered).toBe("grin");
    tracker.update(balls, frameInput(48, { finished: true }));
    expect(tracker.get(1)!.expression.expression).toBe("grin");
  });

  it("looks where a hand-moved ball goes (Pendulum Wave bobs have no velocity) and rests when still", () => {
    const tracker = new CharacterTracker();
    const bob = ball(3, 100, 100, 0, 0);
    tracker.update([bob], frameInput(0));
    for (let t = 16; t <= 320; t += 16) {
      bob.y += 4; // moving down at 250 px/s
      tracker.update([bob], frameInput(t));
    }
    const st = tracker.get(3)!;
    expect(st.lookY).toBeGreaterThan(0.5);
    expect(Math.abs(st.lookX)).toBeLessThan(1e-6);
    expect(st.expression.expression).toBe("neutral");
    for (let t = 336; t <= 336 + REST_MS + 50; t += 16) tracker.update([bob], frameInput(t));
    expect(tracker.get(3)!.expression.expression).toBe("happy");
  });

  it("blinks on the schedule of the seed and the ball, and starts over on a restart or a new seed", () => {
    const tracker = new CharacterTracker();
    const b = ball(7, 400, 300, 0, 0);
    const clock = new BlinkClock(blinkSeed(42, 7));
    for (let t = 0; t < 20000; t += 16.666) {
      tracker.update([b], frameInput(t));
      expect(tracker.get(7)!.closure).toBeCloseTo(clock.closure(t), 12);
    }
    tracker.update([b], frameInput(20000, { wallBreak: true }));
    expect(tracker.get(7)!.expression.expression).toBe("shock");
    // Restart: the time goes back to 0 and the ball starts over.
    tracker.update([b], frameInput(0));
    expect(tracker.get(7)!.expression.expression).toBe("neutral");
    tracker.update([b], frameInput(16, { wallBreak: true }));
    tracker.update([b], frameInput(32, { seed: 43 }));
    expect(tracker.get(7)!.expression.expression).toBe("neutral");
  });

  it("gives a character to at most MAX_CHARACTER_BALLS balls", () => {
    const tracker = new CharacterTracker();
    const many = Array.from({ length: MAX_CHARACTER_BALLS + 20 }, (_, i) => ball(i, i, 0, 100, 0));
    tracker.update(many, frameInput(0));
    expect(tracker.count).toBe(MAX_CHARACTER_BALLS);
    expect(tracker.get(MAX_CHARACTER_BALLS - 1)).toBeDefined();
    expect(tracker.get(MAX_CHARACTER_BALLS)).toBeUndefined();
  });

  it("reads a real run without disturbing it, and replays the same faces for the same seed", () => {
    const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
    const play = (withFaces: boolean) => {
      const engine = new PhysicsEngine({ ...config });
      engine.setSeed(2024);
      engine.initMode("classic");
      const tracker = new CharacterTracker();
      const seen: string[] = [];
      let broken = 0;
      for (let frame = 0; frame < 60 * 12; frame++) {
        engine.update(16.666);
        if (!withFaces) continue;
        const events = engine.consumeSoundEvents();
        const walls = engine.getCircularWalls();
        let escapeRadius = 0;
        for (let i = 0; i < walls.length; i++) if (!engine.getBrokenWalls().has(i)) escapeRadius = Math.max(escapeRadius, walls[i].radius);
        tracker.update(engine.getBalls(), {
          now: engine.getElapsedMs(),
          seed: engine.getSeed(),
          refSpeed: 400,
          accelAllowance: 800,
          wallBreak: events.some((e) => e.type === "gap"),
          finished: engine.isSimulationFinished(),
          centerX: 400,
          centerY: 300,
          escapeRadius,
        });
        if (events.some((e) => e.type === "gap")) broken++;
        seen.push(tracker.primaryExpression);
      }
      const b = engine.getBalls()[0];
      return { seen, broken, fingerprint: b ? [b.x, b.y, b.vx, b.vy] : [], elapsed: engine.getElapsedMs() };
    };
    const a = play(true);
    const b = play(true);
    const plain = play(false);
    expect(a.seen).toEqual(b.seen);
    expect(a.fingerprint).toEqual(plain.fingerprint);
    expect(a.elapsed).toBe(plain.elapsed);
    expect(a.seen).toContain("ouch");
    expect(a.seen).toContain("neutral");
    if (a.broken > 0) expect(a.seen).toContain("shock");
  });
});

describe("cat chirp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps expressions to chirps and spaces them out", () => {
    expect(chirpForExpression("ouch")).toBe("ouch");
    expect(chirpForExpression("shock")).toBe("shock");
    expect(chirpForExpression("grin")).toBe("grin");
    expect(chirpForExpression("happy")).toBeNull();
    expect(chirpForExpression("neutral")).toBeNull();
    expect(chirpForExpression(null)).toBeNull();
    expect(chirpAllowed(-Infinity, 0)).toBe(true);
    expect(chirpAllowed(1000, 1000 + CHIRP_MIN_GAP_MS - 1)).toBe(false);
    expect(chirpAllowed(1000, 1000 + CHIRP_MIN_GAP_MS)).toBe(true);
    // A restart (time went back) never silences the cat.
    expect(chirpAllowed(5000, 10)).toBe(true);
  });

  /** A tiny fake Web Audio graph: records oscillators (type, start, stop, frequency values) and filters. */
  function fakeGraph() {
    const oscillators: { type: string; start: number; stop: number; freqs: number[] }[] = [];
    const filters: { type: string; q: number; freqs: number[] }[] = [];
    const param = (value = 0) => {
      const p = {
        value,
        values: [] as number[],
        setValueAtTime: (v: number) => void p.values.push(v),
        linearRampToValueAtTime: (v: number) => void p.values.push(v),
        exponentialRampToValueAtTime: (v: number) => void p.values.push(v),
        cancelScheduledValues: () => undefined,
        cancelAndHoldAtTime: () => undefined,
      };
      return p;
    };
    const node = () => ({ connect: () => undefined, disconnect: () => undefined });
    const ctx = {
      state: "running",
      currentTime: 0,
      sampleRate: 48000,
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
      createGain: () => ({ ...node(), gain: param(1) }),
      createAnalyser: () => ({ ...node(), fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128 }),
      createMediaStreamDestination: () => ({ ...node(), stream: {} }),
      createBiquadFilter: () => {
        const f = { ...node(), type: "lowpass", Q: param(1), frequency: param(350) };
        return new Proxy(f, {
          get(target, key) {
            return target[key as keyof typeof target];
          },
          set(target, key, value) {
            (target as Record<string, unknown>)[key as string] = value;
            if (key === "type") filters.push({ type: value, q: 0, freqs: target.frequency.values });
            return true;
          },
        });
      },
      createOscillator: () => {
        const entry = { type: "sine", start: -1, stop: -1, freqs: [] as number[] };
        const frequency = param(0);
        const osc = {
          ...node(),
          frequency,
          get type() {
            return entry.type;
          },
          set type(v: string) {
            entry.type = v;
          },
          start: (when = 0) => {
            if (frequency.value === 1) return; // the recorder's keep-alive oscillator
            entry.start = when;
            entry.freqs = frequency.values;
            oscillators.push(entry);
          },
          stop: (when = 0) => {
            entry.stop = when;
          },
        };
        return osc;
      },
    };
    return { ctx, oscillators, filters };
  }

  it("synthesises a meow: a sawtooth through a gliding band-pass, snapped to the scale", () => {
    const g = fakeGraph();
    scheduleChirp(g.ctx as unknown as BaseAudioContext, {} as AudioNode, CHIRPS.grin, 2, (f) => f * 2);
    expect(g.oscillators).toHaveLength(1);
    const osc = g.oscillators[0];
    expect(osc.type).toBe("sawtooth");
    expect(osc.start).toBe(2);
    expect(osc.stop).toBeCloseTo(2 + CHIRPS.grin.duration + 0.02, 9);
    // The contour keeps its shape, moved by the snap of its peak.
    expect(osc.freqs).toEqual(CHIRPS.grin.pitch.map((f) => 2 * f));
    expect(g.filters).toHaveLength(1);
    expect(g.filters[0].type).toBe("bandpass");
    expect(g.filters[0].freqs).toEqual([...CHIRPS.grin.formant]);
    for (const recipe of Object.values(CHIRPS)) {
      expect(recipe.duration).toBeLessThan(0.5);
      expect(recipe.gain).toBeLessThan(0.25);
    }
  });

  it("plays through the ToneGenerator on the beat grid", async () => {
    const g = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return g.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4", scale: "major", rootNote: 0 });
    g.ctx.currentTime = 0.1;
    tone.playCharacterChirp("ouch");
    const chirp = g.oscillators.at(-1)!;
    expect(chirp.type).toBe("sawtooth");
    expect(chirp.start).toBeCloseTo(0.5, 9);
    // The peak (820 Hz) is snapped to C major: G#5 → A5 (880 Hz) or G5 (784 Hz), and the rest follows.
    const ratio = chirp.freqs[1] / CHIRPS.ouch.pitch[1];
    expect([880 / 820, 783.99 / 820].some((r) => Math.abs(r - ratio) < 0.01)).toBe(true);
    expect(chirp.freqs[0] / CHIRPS.ouch.pitch[0]).toBeCloseTo(ratio, 9);
  });
});
