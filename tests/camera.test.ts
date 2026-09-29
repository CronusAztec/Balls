import { describe, expect, it, vi } from "vitest";
import {
  CAMERA_RANGES,
  DEFAULT_CAMERA_SETTINGS,
  FOLLOW_EASE,
  MAX_CAMERA_SCALE,
  MAX_SHAKE_FRACTION,
  REPLAY_MIN_MS,
  REPLAY_MODES,
  REPLAY_POST_ROLL_MS,
  REPLAY_WINDOW_MS,
  SHAKE_DECAY_MS,
  SLOW_MO_COOLDOWN_MS,
  SLOW_MO_RAMP_IN_MS,
  SlowMotion,
  allBallsOutside,
  cameraFeaturesOn,
  cameraSettingsOf,
  cameraTransform,
  createCameraFrame,
  createCameraView,
  fitScale,
  followLimit,
  replayDurationMs,
  replayEligible,
  replayTimeAt,
  resolveCameraSettings,
  shakeAmplitude,
  shakeEnvelope,
  shakeOffset,
  slowMoTimeScale,
  stepCameraView,
  worldToScreen,
  zoomScale,
  type CameraSettings,
} from "@/lib/simulation/camera";
import { REPLAY_MAX_BALLS, REPLAY_TRAIL, ReplayBuffer } from "@/lib/simulation/replay";
import { CinematicCamera } from "@/components/simulator/cameraRenderer";
import { CinematicDirector } from "@/lib/physics/director";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type Ball, type CircularWall, type ModeId, type PhysicsConfig } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

const STEP = 1000 / 60;

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

function makeEngine(mode: ModeId, seed: number, overrides: Partial<PhysicsConfig> = {}, cinematic = true) {
  const engine = new PhysicsEngine({ ...config, ...overrides });
  engine.setCinematicEnabled(cinematic);
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

function ball(id: number, x: number, y: number, radius = 8, color = "#ffffff"): Ball {
  return { id, x, y, vx: 0, vy: 0, radius, color, trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

const NO_BROKEN: ReadonlySet<number> = new Set<number>();
const WALLS: CircularWall[] = [{ radius: 100, gaps: [{ startAngle: 0, endAngle: 0.4 }] }];

/** A canvas context that only records the transform calls the camera makes. */
function fakeCtx() {
  return { translate: vi.fn(), scale: vi.fn() } as unknown as CanvasRenderingContext2D & { translate: ReturnType<typeof vi.fn>; scale: ReturnType<typeof vi.fn> };
}

/** An element with a dataset, for CinematicCamera.syncData(). */
function fakeCanvas() {
  return { dataset: {} as DOMStringMap } as HTMLCanvasElement;
}

const ALL_ON: CameraSettings = { cameraZoom: 0.8, screenShake: 1, slowMoOnNearMiss: true, slowMoFactor: 0.3, slowMoMs: 900, replayOnEscape: true };

/**
 * Drives an engine the way Canvas.tsx does: every 16.666 ms frame adds `frameMs × timeScale` to an accumulator
 * that is spent in 16.666 ms engine updates, the camera recording after each and running its frame logic after
 * the physics. Returns one fingerprint per physics step (the step's clock and every ball's position).
 */
function driveWithCamera(engine: PhysicsEngine, cam: CinematicCamera, frames: number, onFrame?: (frame: number) => void) {
  const steps: string[] = [];
  let accumulator = 0;
  let last = engine.getElapsedMs();
  const ctx = fakeCtx();
  for (let f = 0; f < frames; f++) {
    accumulator += 16.666 * cam.timeScale();
    if (accumulator > 250) accumulator = 250;
    while (accumulator >= 16.666) {
      engine.update(16.666, 0);
      cam.afterStep(engine);
      accumulator -= 16.666;
      if (engine.getElapsedMs() !== last) {
        last = engine.getElapsedMs();
        steps.push(fingerprint(engine));
      }
    }
    cam.frame(engine, 16.666, true);
    cam.applyView(ctx, engine, false, 400, 300, 255, 600, 0, 0);
    onFrame?.(f);
  }
  return steps;
}

function fingerprint(engine: PhysicsEngine) {
  return `${engine.getElapsedMs().toFixed(3)}:${engine
    .getBalls()
    .map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)}`)
    .join(";")}`;
}

function drivePlain(engine: PhysicsEngine, frames: number) {
  const steps: string[] = [];
  let last = engine.getElapsedMs();
  for (let f = 0; f < frames; f++) {
    engine.update(16.666, 0);
    if (engine.getElapsedMs() !== last) {
      last = engine.getElapsedMs();
      steps.push(fingerprint(engine));
    }
  }
  return steps;
}

/* ------------------------------------------------------------------ settings */

describe("camera settings", () => {
  it("are off by default in every mode and part of RANGES", () => {
    expect(cameraFeaturesOn(DEFAULT_CAMERA_SETTINGS)).toBe(false);
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(cameraSettingsOf(d)).toEqual(DEFAULT_CAMERA_SETTINGS);
    }
    for (const key of Object.keys(CAMERA_RANGES) as (keyof typeof CAMERA_RANGES)[]) expect(RANGES[key]).toEqual(CAMERA_RANGES[key]);
    expect(CAMERA_RANGES.slowMoFactor).toMatchObject({ min: 0.2, max: 0.8 });
    expect(CAMERA_RANGES.slowMoMs).toMatchObject({ min: 200, max: 1500 });
    expect(CAMERA_RANGES.cameraZoom).toMatchObject({ min: 0, max: 1 });
    expect(CAMERA_RANGES.screenShake).toMatchObject({ min: 0, max: 1 });
  });

  it("resolve: clamps numbers, falls back on bad values and only accepts real booleans", () => {
    expect(resolveCameraSettings(null)).toEqual(DEFAULT_CAMERA_SETTINGS);
    expect(resolveCameraSettings({ cameraZoom: 5, screenShake: -2, slowMoFactor: 0.01, slowMoMs: 99999 })).toMatchObject({ cameraZoom: 1, screenShake: 0, slowMoFactor: 0.2, slowMoMs: 1500 });
    expect(resolveCameraSettings({ cameraZoom: NaN, slowMoMs: 333.4, slowMoFactor: 0.95 })).toMatchObject({ cameraZoom: 0, slowMoMs: 333, slowMoFactor: 0.8 });
    const junk = { cameraZoom: "x", slowMoOnNearMiss: "yes", replayOnEscape: 1 } as unknown as Partial<CameraSettings>;
    expect(resolveCameraSettings(junk)).toEqual(DEFAULT_CAMERA_SETTINGS);
    expect(resolveCameraSettings({ slowMoOnNearMiss: true, replayOnEscape: true })).toMatchObject({ slowMoOnNearMiss: true, replayOnEscape: true });
  });

  it("travel through the URL and stay out of it at their defaults", () => {
    const base = defaultSettings("classic");
    const plain = settingsToSearchParams(base);
    for (const key of ["cz", "shake", "slow", "slowf", "slowms", "replay"]) expect(plain.has(key)).toBe(false);
    const s = { ...base, ...ALL_ON };
    const params = settingsToSearchParams(s);
    expect(params.get("cz")).toBe("0.8");
    expect(params.get("shake")).toBe("1");
    expect(params.get("slow")).toBe("1");
    expect(params.get("slowf")).toBe("0.3");
    expect(params.get("slowms")).toBe("900");
    expect(params.get("replay")).toBe("1");
    expect(cameraSettingsOf(settingsFromSearchParams(params))).toEqual(ALL_ON);
  });

  it("clamp hand-edited URLs and presets", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams("mode=portal&cz=7&shake=-1&slowf=0.01&slowms=5&slow=2"));
    expect(cameraSettingsOf(fromUrl)).toEqual({ ...DEFAULT_CAMERA_SETTINGS, cameraZoom: 1, screenShake: 0, slowMoFactor: 0.2, slowMoMs: 200 });
    const preset = presetToSettings({ mode: "classic", cameraZoom: 3, slowMoMs: 50, replayOnEscape: "1" as unknown as boolean });
    expect(cameraSettingsOf(preset)).toEqual({ ...DEFAULT_CAMERA_SETTINGS, cameraZoom: 1, slowMoMs: 200 });
    // A preset saved before the camera existed loads with the camera off.
    expect(cameraSettingsOf(presetToSettings({ mode: "shatter", gravity: 500 }))).toEqual(DEFAULT_CAMERA_SETTINGS);
  });
});

/* ------------------------------------------------------------------ zoom and follow */

describe("camera zoom and follow", () => {
  it("maps the zoom setting to a view scale and widens the follow when zoomed", () => {
    expect(zoomScale(0)).toBe(1);
    expect(zoomScale(1)).toBeCloseTo(MAX_CAMERA_SCALE, 12);
    expect(zoomScale(0.5)).toBeCloseTo(1 + 0.5 * (MAX_CAMERA_SCALE - 1), 12);
    expect(zoomScale(4)).toBeCloseTo(MAX_CAMERA_SCALE, 12);
    expect(zoomScale(-1)).toBe(1);
    expect(zoomScale(NaN)).toBe(1);
    expect(followLimit(100, 1)).toBe(50);
    expect(followLimit(100, 0.5)).toBe(50);
    expect(followLimit(100, MAX_CAMERA_SCALE)).toBeCloseTo(100 * (1 - 0.5 / MAX_CAMERA_SCALE), 12);
  });

  it("fitScale keeps a second ball in frame without ever zooming out below 1", () => {
    expect(fitScale(2, 0, 300)).toBe(2);
    expect(fitScale(2.2, 30, 100)).toBe(2.2);
    expect(fitScale(2.2, 50, 100)).toBeCloseTo(1.8, 12);
    expect(fitScale(2.2, 500, 100)).toBe(1);
  });

  it("with zoom 0 reproduces the classic camera follow exactly", () => {
    const view = createCameraView();
    const f = createCameraFrame();
    Object.assign(f, { centerX: 400, centerY: 300, arena: 255, halfView: 300, zoom: 0, follow: true, hasTarget: true });
    let camX = 0;
    let camY = 0;
    const t = { scale: 1, tx: 0, ty: 0 };
    for (let i = 0; i < 400; i++) {
      const bx = 400 + 240 * Math.cos(i * 0.05);
      const by = 300 + 200 * Math.sin(i * 0.031);
      f.targetX = bx;
      f.targetY = by;
      // The classic follow of Canvas.tsx.
      const limit = 0.5 * 255;
      camX += (Math.max(-limit, Math.min(limit, 400 - bx)) - camX) * 0.08;
      camY += (Math.max(-limit, Math.min(limit, 300 - by)) - camY) * 0.08;
      stepCameraView(view, f);
      cameraTransform(view, 400, 300, 0, 0, t);
      expect(view.scale).toBe(1);
      expect(t.tx).toBeCloseTo(camX, 9);
      expect(t.ty).toBeCloseTo(camY, 9);
    }
    expect(FOLLOW_EASE).toBe(0.08);
  });

  it("zooms toward the ball, keeps the focus inside the arena and resets without follow", () => {
    const view = createCameraView();
    const f = createCameraFrame();
    Object.assign(f, { centerX: 400, centerY: 300, arena: 255, halfView: 300, zoom: 1, follow: true, hasTarget: true, targetX: 400 + 5000, targetY: 300 });
    for (let i = 0; i < 600; i++) stepCameraView(view, f);
    expect(view.scale).toBeCloseTo(MAX_CAMERA_SCALE, 6);
    expect(view.offsetX).toBeCloseTo(followLimit(255, MAX_CAMERA_SCALE), 3);
    expect(view.offsetY).toBeCloseTo(0, 6);
    // A second ball far from the first zooms out to keep both in frame.
    f.spread = 400;
    for (let i = 0; i < 600; i++) stepCameraView(view, f);
    expect(view.scale).toBeCloseTo(fitScale(MAX_CAMERA_SCALE, 400, 300), 3);
    f.follow = false;
    stepCameraView(view, f);
    expect(view).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("puts the focus on the canvas centre, scaled around it, plus the shake", () => {
    const view = { offsetX: 40, offsetY: -25, scale: 2 };
    const t = cameraTransform(view, 400, 300, 0, 0, { scale: 1, tx: 0, ty: 0 });
    const p = worldToScreen(t, 440, 275, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(400, 12);
    expect(p.y).toBeCloseTo(300, 12);
    const q = worldToScreen(t, 450, 275, { x: 0, y: 0 });
    expect(q.x - p.x).toBeCloseTo(20, 12); // 10 world px at 2× are 20 screen px
    const shaken = worldToScreen(cameraTransform(view, 400, 300, 3, -4, { scale: 1, tx: 0, ty: 0 }), 440, 275, { x: 0, y: 0 });
    expect(shaken.x).toBeCloseTo(403, 12);
    expect(shaken.y).toBeCloseTo(296, 12);
  });
});

/* ------------------------------------------------------------------ shake */

describe("screen shake", () => {
  it("decays to nothing over 300 ms", () => {
    expect(SHAKE_DECAY_MS).toBe(300);
    expect(shakeEnvelope(0)).toBe(1);
    expect(shakeEnvelope(150)).toBeCloseTo(0.25, 12);
    expect(shakeEnvelope(300)).toBe(0);
    expect(shakeEnvelope(1000)).toBe(0);
    expect(shakeEnvelope(-1)).toBe(0);
    expect(shakeEnvelope(NaN)).toBe(0);
    for (let t = 1; t < 300; t++) expect(shakeEnvelope(t)).toBeLessThan(shakeEnvelope(t - 1));
  });

  it("scales with the setting and the canvas and stays inside its amplitude", () => {
    expect(shakeAmplitude(1, 1000)).toBeCloseTo(1000 * MAX_SHAKE_FRACTION, 12);
    expect(shakeAmplitude(0.5, 1000)).toBeCloseTo(500 * MAX_SHAKE_FRACTION, 12);
    expect(shakeAmplitude(0, 1000)).toBe(0);
    expect(shakeAmplitude(3, 1000)).toBeCloseTo(1000 * MAX_SHAKE_FRACTION, 12);
    const out = { x: 0, y: 0 };
    let moved = 0;
    for (let t = 0; t < 300; t += 3) {
      shakeOffset(t, 20, 7, out);
      expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(20 + 1e-9);
      moved = Math.max(moved, Math.hypot(out.x, out.y));
    }
    expect(moved).toBeGreaterThan(5);
    expect(shakeOffset(300, 20, 7, out)).toEqual({ x: 0, y: 0 });
  });

  it("is deterministic and turns from one break to the next", () => {
    const a = shakeOffset(40, 10, 3, { x: 0, y: 0 });
    const b = shakeOffset(40, 10, 3, { x: 0, y: 0 });
    const c = shakeOffset(40, 10, 4, { x: 0, y: 0 });
    expect(a).toEqual(b);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------ slow motion */

describe("slow motion", () => {
  it("eases into the factor, holds it and eases back to real time within the window", () => {
    expect(slowMoTimeScale(-1, 700, 0.4)).toBe(1);
    expect(slowMoTimeScale(0, 700, 0.4)).toBe(1);
    expect(slowMoTimeScale(SLOW_MO_RAMP_IN_MS / 2, 700, 0.4)).toBeCloseTo(0.7, 12);
    expect(slowMoTimeScale(300, 700, 0.4)).toBeCloseTo(0.4, 12);
    expect(slowMoTimeScale(699, 700, 0.4)).toBeGreaterThan(0.99);
    expect(slowMoTimeScale(700, 700, 0.4)).toBe(1);
    for (let t = 0; t < 700; t += 5) {
      const k = slowMoTimeScale(t, 700, 0.2);
      expect(k).toBeGreaterThanOrEqual(0.2 - 1e-12);
      expect(k).toBeLessThanOrEqual(1);
    }
    // Short windows still ramp in and out.
    expect(slowMoTimeScale(100, 200, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("runs a window per near miss, extends it on another and cools down afterwards", () => {
    const slow = new SlowMotion();
    expect(slow.timeScale(700, 0.4)).toBe(1);
    expect(slow.trigger(700)).toBe(true);
    expect(slow.started).toBe(1);
    slow.advance(200, 700);
    expect(slow.timeScale(700, 0.4)).toBeCloseTo(0.4, 12);
    // Another near miss inside the window: held again, not a new window.
    slow.advance(400, 700);
    expect(slow.trigger(700)).toBe(true);
    expect(slow.started).toBe(1);
    slow.advance(100, 700);
    expect(slow.timeScale(700, 0.4)).toBeCloseTo(0.4, 12);
    // Past the end: real time, and a near miss during the cooldown is ignored.
    slow.advance(700, 700);
    expect(slow.timeScale(700, 0.4)).toBe(1);
    expect(slow.trigger(700)).toBe(false);
    slow.advance(SLOW_MO_COOLDOWN_MS, 700);
    expect(slow.trigger(700)).toBe(true);
    expect(slow.started).toBe(2);
    slow.reset();
    expect(slow.timeScale(700, 0.4)).toBe(1);
  });

  it("slows the simulated time of a window to roughly the factor", () => {
    const slow = new SlowMotion();
    slow.trigger(1000);
    let sim = 0;
    for (let t = 0; t < 1000; t += 10) {
      sim += 10 * slow.timeScale(1000, 0.25);
      slow.advance(10, 1000);
    }
    expect(sim).toBeGreaterThan(250);
    expect(sim).toBeLessThan(500);
  });
});

/* ------------------------------------------------------------------ replay helpers */

describe("escape replay helpers", () => {
  it("replays 2 s at half speed in the escape modes only", () => {
    expect(REPLAY_WINDOW_MS).toBe(2000);
    expect(replayDurationMs(2000)).toBe(4000);
    expect(replayDurationMs(-5)).toBe(0);
    expect(replayTimeAt(0, 100, 2100)).toBe(100);
    expect(replayTimeAt(1000, 100, 2100)).toBe(600);
    expect(replayTimeAt(99999, 100, 2100)).toBe(2100);
    expect(replayTimeAt(-5, 100, 2100)).toBe(100);
    for (const mode of MODE_IDS) expect(replayEligible(mode)).toBe(REPLAY_MODES.includes(mode));
    expect(REPLAY_MODES).toEqual(["classic", "accumulation", "portal", "shatter", "colorMatch"]);
    expect(replayEligible(null)).toBe(false);
  });

  it("tells when every ball is outside a ring", () => {
    expect(allBallsOutside([], 0, 0, 100)).toBe(false);
    expect(allBallsOutside([ball(0, 50, 0)], 0, 0, 100)).toBe(false);
    expect(allBallsOutside([ball(0, 108, 0)], 0, 0, 100)).toBe(false); // touching the wall
    expect(allBallsOutside([ball(0, 109, 0)], 0, 0, 100)).toBe(true);
    expect(allBallsOutside([ball(0, 200, 0), ball(1, 0, 20)], 0, 0, 100)).toBe(false);
    expect(allBallsOutside([ball(0, 200, 0), ball(1, 0, -300)], 0, 0, 100)).toBe(true);
  });
});

/* ------------------------------------------------------------------ replay buffer */

describe("ReplayBuffer", () => {
  const record = (buf: ReplayBuffer, k: number, balls: Ball[], rotation = 0, broken: ReadonlySet<number> = NO_BROKEN, serial = 0) => buf.record(k * STEP, balls, WALLS, [rotation], broken, serial);

  it("samples recorded frames and interpolates between them", () => {
    const buf = new ReplayBuffer();
    for (let k = 1; k <= 10; k++) record(buf, k, [ball(3, 10 * k, 5 * k)]);
    expect(buf.size).toBe(10);
    let v = buf.sample(4 * STEP, WALLS)!;
    expect(v.balls).toHaveLength(1);
    expect(v.balls[0]).toMatchObject({ id: 3, x: 40, y: 20 });
    v = buf.sample(4.5 * STEP, WALLS)!;
    expect(v.balls[0].x).toBeCloseTo(45, 9);
    expect(v.balls[0].y).toBeCloseTo(22.5, 9);
    expect(v.time).toBeCloseTo(4.5 * STEP, 9);
    expect(buf.sample(-100, WALLS)!.balls[0].x).toBe(10);
    expect(buf.sample(1e9, WALLS)!.balls[0].x).toBe(100);
    expect(new ReplayBuffer().sample(0, WALLS)).toBeNull();
  });

  it("keeps only its capacity, oldest frames out first, and replays the last 2 s", () => {
    const buf = new ReplayBuffer();
    const n = buf.capacity + 50;
    for (let k = 1; k <= n; k++) record(buf, k, [ball(1, k, 0)]);
    expect(buf.size).toBe(buf.capacity);
    expect(buf.startTime()).toBeCloseTo((n - buf.capacity + 1) * STEP, 9);
    expect(buf.endTime()).toBeCloseTo(n * STEP, 9);
    expect(buf.windowStart()).toBeCloseTo(n * STEP - REPLAY_WINDOW_MS, 9);
    expect(buf.capacity * STEP).toBeGreaterThanOrEqual(REPLAY_WINDOW_MS + REPLAY_POST_ROLL_MS);
    expect(buf.sample(buf.windowStart(), WALLS)!.balls[0].x).toBeCloseTo(n - REPLAY_WINDOW_MS / STEP, 6);
  });

  it("builds each ball's trail from its recorded positions, oldest first", () => {
    const buf = new ReplayBuffer();
    for (let k = 1; k <= 40; k++) record(buf, k, [ball(9, k, 2 * k)]);
    const v = buf.sample(40 * STEP, WALLS)!;
    const trail = v.balls[0].trail;
    expect(trail).toHaveLength(REPLAY_TRAIL);
    expect(v.balls[0].trailIndex).toBe(0);
    for (let i = 1; i < trail.length; i++) expect(trail[i].x).toBeGreaterThan(trail[i - 1].x);
    expect(trail[trail.length - 1]).toEqual({ x: 40, y: 80 });
    expect(trail[0]).toEqual({ x: 40 - (REPLAY_TRAIL - 1), y: 2 * (40 - (REPLAY_TRAIL - 1)) });
    // Between two frames the trail ends where the ball is drawn.
    const mid = buf.sample(30.5 * STEP, WALLS)!.balls[0].trail;
    expect(mid).toHaveLength(REPLAY_TRAIL);
    expect(mid[mid.length - 1].x).toBeCloseTo(30.5, 9);
    expect(mid[mid.length - 2].x).toBe(30);
    // Early in the buffer the trail is shorter.
    expect(buf.sample(buf.startTime(), WALLS)!.balls[0].trail).toHaveLength(1);
  });

  it("follows balls by id when their order changes and leaves the vanished ones where they were", () => {
    const buf = new ReplayBuffer();
    record(buf, 1, [ball(1, 0, 0), ball(2, 100, 0)]);
    record(buf, 2, [ball(2, 110, 0), ball(1, 10, 0)]);
    record(buf, 3, [ball(2, 120, 0)]);
    const idsAndX = (v: { balls: Ball[] }) => v.balls.map((b) => [b.id, Math.round(1e6 * b.x) / 1e6]);
    expect(idsAndX(buf.sample(1.5 * STEP, WALLS)!)).toEqual([
      [1, 5],
      [2, 105],
    ]);
    expect(idsAndX(buf.sample(2.5 * STEP, WALLS)!)).toEqual([
      [2, 115],
      [1, 10],
    ]);
  });

  it("caps the balls it records", () => {
    const buf = new ReplayBuffer();
    const many = Array.from({ length: REPLAY_MAX_BALLS + 10 }, (_, i) => ball(i, i, 0));
    record(buf, 1, many);
    expect(buf.sample(STEP, WALLS)!.balls).toHaveLength(REPLAY_MAX_BALLS);
  });

  it("replays walls: rotation the short way round, radii, the broken set and the break count", () => {
    const buf = new ReplayBuffer();
    buf.record(STEP, [ball(1, 0, 0)], WALLS, [2 * Math.PI - 0.1], NO_BROKEN, 4);
    buf.record(2 * STEP, [ball(1, 0, 0)], [{ radius: 110, gaps: WALLS[0].gaps }], [0.1], new Set([0]), 5);
    const v = buf.sample(1.5 * STEP, WALLS)!;
    expect(v.rotations[0] % (2 * Math.PI)).toBeCloseTo(0, 9);
    expect(v.walls[0].radius).toBeCloseTo(105, 9);
    expect(v.walls[0].gaps).toBe(WALLS[0].gaps);
    expect(v.broken.size).toBe(0);
    expect(v.breakSerial).toBe(4);
    const w = buf.sample(2 * STEP, WALLS)!;
    expect([...w.broken]).toEqual([0]);
    expect(w.brokenMask).toBe(1);
    expect(w.breakSerial).toBe(5);
  });

  it("starts over on a restart, ignores repeated times and stops recording once frozen", () => {
    const buf = new ReplayBuffer();
    for (let k = 1; k <= 60; k++) record(buf, k, [ball(1, k, 0)]);
    record(buf, 60, [ball(1, 999, 0)]);
    expect(buf.sample(60 * STEP, WALLS)!.balls[0].x).toBe(60);
    record(buf, 1, [ball(1, -1, 0)]);
    expect(buf.size).toBe(1);
    buf.freeze();
    record(buf, 2, [ball(1, -2, 0)]);
    expect(buf.size).toBe(1);
    buf.clear();
    expect(buf.isFrozen()).toBe(false);
    expect(buf.size).toBe(0);
  });

  it("freezes once every ball has been outside for the post-roll", () => {
    const buf = new ReplayBuffer();
    buf.noteEscape(1000, true);
    expect(buf.escapeTime()).toBe(1000);
    buf.noteEscape(1200, false); // back inside (a portal): the clock starts over
    expect(buf.escapeTime()).toBe(-1);
    buf.noteEscape(1300, true);
    buf.noteEscape(1300 + REPLAY_POST_ROLL_MS - 1, true);
    expect(buf.isFrozen()).toBe(false);
    buf.noteEscape(1300 + REPLAY_POST_ROLL_MS, true);
    expect(buf.isFrozen()).toBe(true);
  });

  it("samples into the same objects every time (no allocation per frame)", () => {
    const buf = new ReplayBuffer();
    for (let k = 1; k <= 30; k++) record(buf, k, [ball(1, k, 0), ball(2, 0, k)]);
    const a = buf.sample(10 * STEP, WALLS)!;
    const b0 = a.balls[0];
    const t0 = a.balls[0].trail;
    const w0 = a.walls[0];
    const b = buf.sample(20.5 * STEP, WALLS)!;
    expect(b).toBe(a);
    expect(b.balls[0]).toBe(b0);
    expect(b.balls[0].trail).toBe(t0);
    expect(b.walls[0]).toBe(w0);
  });
});

/* ------------------------------------------------------------------ engine events */

describe("camera events from the engine", () => {
  it("counts every wall-break (gap) event, the engine's and the modes'", () => {
    for (const mode of ["classic", "portal", "shatter", "accumulation"] as ModeId[]) {
      const engine = makeEngine(mode, 77, { gapSize: 0.8, wallCount: 4 });
      let gaps = 0;
      for (let i = 0; i < 60 * 40; i++) {
        engine.update(STEP, 0);
        for (const ev of engine.consumeSoundEvents()) if (ev.type === "gap") gaps++;
        if (engine.isSimulationFinished()) break;
      }
      expect(gaps, mode).toBeGreaterThan(0);
      expect(engine.getWallBreakSerial(), mode).toBe(gaps);
    }
  });

  it("exposes the director's near misses as an event, with the director on or off", () => {
    for (const cinematic of [true, false]) {
      const engine = makeEngine("classic", 4242, {}, cinematic);
      for (let i = 0; i < 60 * 60 && !engine.isSimulationFinished(); i++) engine.update(STEP, 0);
      expect(engine.getNearMissSerial(), `director ${cinematic ? "on" : "off"}`).toBeGreaterThan(0);
    }
    const director = new CinematicDirector();
    director.setEnabled(false);
    const gap = { startAngle: 0, endAngle: 1 };
    // Through the middle of a wide gap: no near miss; right at its edge: one.
    expect(director.adjustGapPass(ball(0, 100 * Math.cos(0.5), 100 * Math.sin(0.5)), 100, 0, gap, 0, 0)).toBeNull();
    expect(director.getNearMissSerial()).toBe(0);
    expect(director.adjustGapPass(ball(0, 100 * Math.cos(0.05), 100 * Math.sin(0.05)), 100, 0, gap, 0, 0)).toBeNull();
    expect(director.getNearMissSerial()).toBe(1);
  });

  it("never changes a seeded run: slow motion, zoom, shake and the replay only change the clock and the picture", () => {
    for (const mode of ["classic", "shatter", "portal"] as ModeId[]) {
      const plain = drivePlain(makeEngine(mode, 99, { gapSize: 0.5 }), 60 * 20);
      const engine = makeEngine(mode, 99, { gapSize: 0.5 });
      const cam = new CinematicCamera();
      cam.settings = ALL_ON;
      const steps = driveWithCamera(engine, cam, 60 * 40);
      const n = Math.min(plain.length, steps.length);
      expect(n, mode).toBeGreaterThan(600);
      expect(steps.slice(0, n), mode).toEqual(plain.slice(0, n));
      // Portal's ring has no gaps to squeeze through, so it never slows down; the ring modes do.
      if (mode !== "portal") expect(cam.slowMo.started, mode).toBeGreaterThan(0);
      expect(Number.isFinite(cam.view.scale) && cam.view.scale > 1, mode).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ the camera on a real run */

describe("CinematicCamera", () => {
  it("slows the clock on near misses: fewer physics steps per frame in the window", () => {
    const engine = makeEngine("classic", 4242);
    const cam = new CinematicCamera();
    cam.settings = { ...DEFAULT_CAMERA_SETTINGS, slowMoOnNearMiss: true, slowMoFactor: 0.2, slowMoMs: 1500 };
    let slowest = 1;
    const steps = driveWithCamera(engine, cam, 60 * 30, () => {
      slowest = Math.min(slowest, cam.timeScale());
    });
    expect(cam.slowMo.started).toBeGreaterThan(0);
    expect(slowest).toBeLessThan(0.3);
    expect(steps.length).toBeLessThan(60 * 30 - 30);
    // Off: the clock runs at real time.
    const off = new CinematicCamera();
    const plainSteps = driveWithCamera(makeEngine("classic", 4242), off, 60 * 30);
    expect(off.slowMo.started).toBe(0);
    expect(plainSteps.length).toBeGreaterThan(steps.length);
  });

  it("shakes on wall breaks and zooms toward the ball, mirroring its state onto the canvas", () => {
    const engine = makeEngine("classic", 31, { gapSize: 0.8 });
    const cam = new CinematicCamera();
    cam.settings = { ...DEFAULT_CAMERA_SETTINGS, cameraZoom: 1, screenShake: 1 };
    const canvas = fakeCanvas();
    let shook = false;
    const ctx = fakeCtx();
    for (let f = 0; f < 60 * 20 && !shook; f++) {
      engine.update(16.666, 0);
      cam.afterStep(engine);
      cam.frame(engine, 16.666, true);
      ctx.translate.mockClear();
      cam.applyView(ctx, engine, false, 400, 300, 255, 600, 0, 0);
      cam.syncData(canvas);
      if (Number(canvas.dataset.cameraShakes) > 0) shook = true;
    }
    expect(shook).toBe(true);
    expect(engine.getWallBreakSerial()).toBeGreaterThan(0);
    expect(Number(canvas.dataset.cameraScale)).toBeGreaterThan(1.5);
    expect(canvas.dataset.cameraReplay).toBe("idle");
    expect(ctx.translate).toHaveBeenCalledTimes(1);
    // Everything off: the classic view is left alone and the data attributes disappear.
    cam.settings = DEFAULT_CAMERA_SETTINGS;
    for (let f = 0; f < 400; f++) cam.applyView(ctx, engine, false, 400, 300, 255, 600, 0, 0);
    ctx.translate.mockClear();
    expect(cam.applyView(ctx, engine, false, 400, 300, 255, 600, 0, 0)).toBe(false);
    expect(ctx.translate).not.toHaveBeenCalled();
    cam.syncData(canvas);
    expect(canvas.dataset.cameraReplay).toBeUndefined();
  });

  for (const [mode, overrides] of [
    ["classic", { gapSize: 1, wallCount: 2 }],
    ["accumulation", { gapSize: 1 }],
  ] as [ModeId, Partial<PhysicsConfig>][]) {
    it(`replays the last 2 s of a ${mode} escape at half speed before the end screen`, () => {
      const engine = makeEngine(mode, 5, overrides);
      const cam = new CinematicCamera();
      cam.settings = { ...DEFAULT_CAMERA_SETTINGS, replayOnEscape: true };
      const spawn = vi.spyOn(engine, "spawnWallBreakByStyle");
      let finishedAt = -1;
      let playFrames = 0;
      let holdFrames = 0;
      let firstReplay: { x: number; y: number; time: number } | null = null;
      let lastReplay: { x: number; y: number; time: number } | null = null;
      let escapeBreaks = 0;
      const phases = new Set<string>();
      driveWithCamera(engine, cam, 60 * 90, () => {
        phases.add(cam.getPhase());
        if (finishedAt < 0 && engine.isSimulationFinished()) {
          finishedAt = engine.getElapsedMs();
          escapeBreaks = spawn.mock.calls.length;
        }
        if (cam.holdsEndScreen()) holdFrames++;
        const view = cam.replayView();
        if (view) {
          playFrames++;
          const b = view.balls[0];
          if (!firstReplay) firstReplay = { x: b.x, y: b.y, time: view.time };
          lastReplay = { x: b.x, y: b.y, time: view.time };
        }
      });
      expect(finishedAt, "the run finished").toBeGreaterThan(0);
      expect([...phases]).toEqual(expect.arrayContaining(["idle", "playing", "done"]));
      // Classic's buffer froze long before its run ended; Accumulation ends the moment the ball is out and
      // holds on for the post-roll first.
      if (mode === "accumulation") expect([...phases]).toContain("postroll");
      expect(cam.getPhase()).toBe("done");
      expect(cam.holdsEndScreen()).toBe(false);
      const first = firstReplay!;
      const last = lastReplay!;
      const span = last.time - first.time;
      expect(span).toBeGreaterThanOrEqual(REPLAY_MIN_MS);
      expect(span).toBeLessThanOrEqual(REPLAY_WINDOW_MS + 1e-6);
      if (mode === "classic") expect(span).toBeGreaterThan(REPLAY_WINDOW_MS - 2 * STEP);
      // Half speed: the window takes twice as long in frames (and the end screen waits for all of them).
      expect(playFrames * 16.666).toBeGreaterThan(replayDurationMs(span) - 60);
      expect(playFrames * 16.666).toBeLessThan(replayDurationMs(span) + 60);
      expect(holdFrames).toBeGreaterThanOrEqual(playFrames);
      // The replay starts with the ball inside the arena and ends with it outside the outer wall.
      const walls = engine.getCircularWalls();
      const outer = Math.max(...walls.map((w) => w.radius));
      expect(Math.hypot(first.x - 400, first.y - 300)).toBeLessThan(outer);
      expect(Math.hypot(last.x - 400, last.y - 300)).toBeGreaterThan(outer);
      // It ends at most the post-roll after the escape (plus a step) – never long after, when the ball is off-screen.
      expect(last.time).toBeLessThanOrEqual(finishedAt + REPLAY_POST_ROLL_MS + STEP);
      if (mode === "classic") expect(spawn.mock.calls.length, "the breaks in the window burst again").toBeGreaterThan(escapeBreaks);
    });
  }

  it("does not replay in modes that do not end with an escape, nor with the replay off", () => {
    const engine = makeEngine("classic", 5, { gapSize: 1, wallCount: 2 });
    const cam = new CinematicCamera();
    driveWithCamera(engine, cam, 60 * 60);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(cam.getPhase()).toBe("idle");
    expect(cam.replay.size).toBe(0);
    const drop = makeEngine("multiply", 5);
    const cam2 = new CinematicCamera();
    cam2.settings = { ...DEFAULT_CAMERA_SETTINGS, replayOnEscape: true };
    driveWithCamera(drop, cam2, 600);
    expect(cam2.replay.size).toBe(0);
    expect(cam2.holdsEndScreen()).toBe(false);
  });

  it("forgets the replay when the run restarts", () => {
    const engine = makeEngine("classic", 5, { gapSize: 1, wallCount: 2 });
    const cam = new CinematicCamera();
    cam.settings = { ...DEFAULT_CAMERA_SETTINGS, replayOnEscape: true };
    driveWithCamera(engine, cam, 60 * 90);
    expect(cam.getPhase()).toBe("done");
    engine.initMode("classic");
    driveWithCamera(engine, cam, 30);
    expect(cam.getPhase()).toBe("idle");
    expect(cam.replay.size).toBeGreaterThan(0);
    expect(cam.replay.startTime()).toBeLessThan(STEP * 2);
  });
});
