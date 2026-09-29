import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { TimelineLiveStore } from "@/components/simulator/timelineLive";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import {
  MAX_KEYFRAMES,
  TIMELINE_KEYS,
  TIMELINE_KEY_CODES,
  TimelineRuntime,
  addKeyframe,
  automatedKeys,
  compileTimeline,
  engineTimelineOf,
  formatTimelineValue,
  interpolateTrack,
  parseKeyframes,
  removeKeyframe,
  resizeGaps,
  resolveKeyframes,
  resolveTimelineSettings,
  sanitizeKeyframe,
  serializeKeyframes,
  snapKeyframeTime,
  timelineCarryOver,
  timelineKeyForLabel,
  timelineKeyOf,
  timelineKeyShown,
  timelinePosition,
  timelineSpan,
  timelineValueAt,
  timelineValuesAt,
  updateKeyframe,
  type Keyframe,
  type TimelineKey,
} from "@/lib/simulation/timeline";

/**
 * Timeline keyframes (lib/simulation/timeline.ts): the interpolation (linear, holding before the first and after the
 * last keyframe), the validation and the compact URL form, presets, and the engine side – the keyframes apply at every
 * fixed step on the simulation clock (so the frame rate never matters and the seed finder replays a run exactly), never
 * override the page's own values for good, and resize the gaps in place.
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

const kf = (key: TimelineKey, time: number, value: number): Keyframe => ({ key, time, value });

/** Gravity 0 → 1500 over the first 4 s, ball size 8 → 20 px over 3 s, a gust of wind from 1 s to 3 s. */
const SCRIPT: Keyframe[] = [kf("gravity", 0, 0), kf("gravity", 4, 1500), kf("ballRadius", 0, 8), kf("ballRadius", 3, 20), kf("windX", 1, 0), kf("windX", 2, 0.3), kf("windX", 3, 0)];

function trace(engine: PhysicsEngine, frames: number, frameMs = 1000 / 60) {
  const out: number[][] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(frameMs, 0);
    if (i % 30 === 0) out.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000), Math.round(b.radius * 1000)]));
  }
  return out;
}

function pageEngine(keyframes: readonly Keyframe[] | undefined, seed: number, mode: "classic" | "shatter" | "multiply" | "drop" = "classic", base: PhysicsConfig = config) {
  const engine = new PhysicsEngine({ ...base, ...(keyframes ? { timeline: keyframes } : {}) });
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

describe("interpolation", () => {
  it("is linear between two keyframes and holds before the first and after the last", () => {
    const times = [2, 6];
    const values = [100, 500];
    expect(interpolateTrack(times, values, 0)).toBe(100);
    expect(interpolateTrack(times, values, 2)).toBe(100);
    expect(interpolateTrack(times, values, 3)).toBe(200);
    expect(interpolateTrack(times, values, 4)).toBe(300);
    expect(interpolateTrack(times, values, 6)).toBe(500);
    expect(interpolateTrack(times, values, 60)).toBe(500);
    expect(interpolateTrack(times, values, NaN)).toBe(100);
    expect(interpolateTrack([], [], 1)).toBeNaN();
  });

  it("walks a track of many keyframes, going up and down", () => {
    const times = [0, 1, 2, 4, 8];
    const values = [0, 10, 0, 40, 40];
    expect(interpolateTrack(times, values, 0.5)).toBe(5);
    expect(interpolateTrack(times, values, 1.5)).toBe(5);
    expect(interpolateTrack(times, values, 3)).toBe(20);
    expect(interpolateTrack(times, values, 5)).toBe(40);
  });

  it("holds a single keyframe everywhere, and a setting without keyframes has no value", () => {
    const list = [kf("ballSpeed", 5, 600)];
    expect(timelineValueAt(list, "ballSpeed", 0)).toBe(600);
    expect(timelineValueAt(list, "ballSpeed", 99)).toBe(600);
    expect(timelineValueAt(list, "gravity", 1)).toBeNull();
  });

  it("sorts unsorted keyframes by time, keeps one per time (the later one) and evaluates every setting at once", () => {
    const list = [kf("gravity", 4, 1500), kf("gravity", 0, 0), kf("gravity", 0, 100), kf("ballRadius", 3, 20)];
    const [gravity, radius] = compileTimeline(list);
    expect(gravity).toEqual({ key: "gravity", times: [0, 4], values: [100, 1500] });
    expect(radius).toEqual({ key: "ballRadius", times: [3], values: [20] });
    expect(timelineValuesAt(list, 2)).toEqual({ gravity: 800, ballRadius: 20 });
    expect(automatedKeys(list)).toEqual(["gravity", "ballRadius"]);
    expect(compileTimeline([])).toEqual([]);
    expect(compileTimeline(null)).toEqual([]);
  });
});

describe("validation", () => {
  it("clamps a keyframe into its setting's range and snaps value and time to their steps", () => {
    expect(sanitizeKeyframe({ key: "gravity", time: 1.234, value: 1234 }, RANGES)).toEqual({ key: "gravity", time: 1.2, value: 1250 });
    expect(sanitizeKeyframe({ key: "gravity", time: -3, value: 99999 }, RANGES)).toEqual({ key: "gravity", time: 0, value: 2000 });
    expect(sanitizeKeyframe({ key: "gapSize", time: 500, value: 0.337 }, RANGES)).toEqual({ key: "gapSize", time: 120, value: 0.35 });
    expect(sanitizeKeyframe({ key: "windX", time: "2.5", value: "-0.254" }, RANGES)).toEqual({ key: "windX", time: 2.5, value: -0.25 });
    expect(sanitizeKeyframe({ key: "airDrag", time: 1, value: 0.0123 }, RANGES)).toEqual({ key: "airDrag", time: 1, value: 0.012 });
    expect(snapKeyframeTime(12.3456)).toBe(12.3);
    expect(snapKeyframeTime(NaN)).toBe(0);
  });

  it("drops unknown settings and missing numbers, and understands the other names of a setting", () => {
    expect(sanitizeKeyframe({ key: "wallCount", time: 1, value: 3 }, RANGES)).toBeNull();
    expect(sanitizeKeyframe({ key: "gravity", time: "", value: 3 }, RANGES)).toBeNull();
    expect(sanitizeKeyframe({ key: "gravity", time: 1 }, RANGES)).toBeNull();
    expect(sanitizeKeyframe({ key: "gravity", time: 1, value: Infinity }, RANGES)).toBeNull();
    expect(sanitizeKeyframe(null, RANGES)).toBeNull();
    expect(sanitizeKeyframe({ key: "ballSize", time: 1, value: 12 }, RANGES)?.key).toBe("ballRadius");
    expect(sanitizeKeyframe({ key: "wallRotationSpeed", time: 1, value: 2 }, RANGES)?.key).toBe("rotationSpeed");
    expect(sanitizeKeyframe({ key: "wallGap", time: 1, value: 0.5 }, RANGES)?.key).toBe("gapSize");
    expect(timelineKeyOf("g")).toBe("gravity");
    expect(timelineKeyOf("obb")).toBe("bumperBoost");
    expect(timelineKeyOf("constructor")).toBeNull();
    expect(timelineKeyOf("")).toBeNull();
  });

  it("keeps one keyframe per setting and time, at most MAX_KEYFRAMES, in time order", () => {
    const list = resolveKeyframes([kf("ballSpeed", 3, 500), kf("gravity", 3, 600), kf("gravity", 1, 200), kf("gravity", 3, 900), { junk: true }], RANGES);
    expect(list).toEqual([kf("gravity", 1, 200), kf("gravity", 3, 900), kf("ballSpeed", 3, 500)]);
    const many = Array.from({ length: MAX_KEYFRAMES + 10 }, (_, i) => kf("gravity", i, 100));
    expect(resolveKeyframes(many, RANGES)).toHaveLength(MAX_KEYFRAMES);
    expect(resolveKeyframes("nope", RANGES)).toEqual([]);
    expect(resolveTimelineSettings(undefined, RANGES)).toEqual({ keyframes: [] });
  });

  it("adds, updates and removes keyframes the way the panel does", () => {
    let list = addKeyframe([], kf("gravity", 2, 600), RANGES);
    list = addKeyframe(list, kf("gravity", 0, 300), RANGES);
    expect(list).toEqual([kf("gravity", 0, 300), kf("gravity", 2, 600)]);
    // A keyframe at a time the setting already has replaces it.
    list = addKeyframe(list, kf("gravity", 2, 800), RANGES);
    expect(list).toEqual([kf("gravity", 0, 300), kf("gravity", 2, 800)]);
    // An edit is validated and re-sorted; moved onto another keyframe of its setting, it replaces that one.
    expect(updateKeyframe(list, 1, { value: 1234 }, RANGES)).toEqual([kf("gravity", 0, 300), kf("gravity", 2, 1250)]);
    expect(updateKeyframe(list, 1, { time: -1 }, RANGES)).toEqual([kf("gravity", 0, 800)]);
    expect(updateKeyframe(list, 0, { time: 5 }, RANGES)).toEqual([kf("gravity", 2, 800), kf("gravity", 5, 300)]);
    expect(removeKeyframe(list, 0)).toEqual([kf("gravity", 2, 800)]);
  });

  it("types every automatable setting as a numeric setting with a slider range", () => {
    const s = defaultSettings("classic");
    for (const key of TIMELINE_KEYS) {
      expect(typeof s[key]).toBe("number");
      expect(RANGES[key].max).toBeGreaterThan(RANGES[key].min);
    }
  });
});

describe("URL form and presets", () => {
  it("serialises compactly, grouped per setting, and round-trips exactly", () => {
    const list = resolveKeyframes(SCRIPT, RANGES);
    const text = serializeKeyframes(list);
    expect(text).toBe("g_0_0_4_1500*r_0_8_3_20*wx_1_0_2_0.3_3_0");
    expect(encodeURIComponent(text)).toBe(text.replace(/\*/g, "*")); // nothing to escape (URLSearchParams keeps "*", "_", "." and "-")
    expect(new URLSearchParams({ kf: text }).toString()).toBe(`kf=${text}`);
    expect(parseKeyframes(text, RANGES)).toEqual(list);
    const negative = resolveKeyframes([kf("windY", 0.5, -0.12), kf("airDrag", 2, 0.004), kf("bumperBoost", 1, 1.35)], RANGES);
    expect(serializeKeyframes(negative)).toBe("drag_2_0.004*wy_0.5_-0.12*obb_1_1.35");
    expect(parseKeyframes(serializeKeyframes(negative), RANGES)).toEqual(negative);
  });

  it("skips garbage and accepts setting names and aliases instead of codes", () => {
    expect(parseKeyframes("zz_1_2*g_1*g_x_5_2_600_3", RANGES)).toEqual([kf("gravity", 2, 600)]);
    expect(parseKeyframes("gravity_0_100*ballSize_1_12", RANGES)).toEqual([kf("gravity", 0, 100), kf("ballRadius", 1, 12)]);
    expect(parseKeyframes("", RANGES)).toEqual([]);
    expect(parseKeyframes(null, RANGES)).toEqual([]);
  });

  it("uses the settings' own URL keys as the setting codes", () => {
    for (const key of TIMELINE_KEYS) {
      const s = defaultSettings("classic");
      const range = RANGES[key];
      (s as unknown as Record<string, number>)[key] = s[key] === range.max ? range.min : range.max;
      expect(settingsToSearchParams(s).has(TIMELINE_KEY_CODES[key])).toBe(true);
    }
  });

  it("travels in the settings URL (kf) only when there are keyframes, and is validated on the way back in", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), keyframes: resolveKeyframes(SCRIPT, RANGES) };
    const params = settingsToSearchParams(s);
    expect(params.get("kf")).toBe("g_0_0_4_1500*r_0_8_3_20*wx_1_0_2_0.3_3_0");
    // The automation is not written into the settings: gravity and size stay at their defaults in the link.
    expect(params.has("g")).toBe(false);
    expect(params.has("r")).toBe(false);
    expect(settingsFromSearchParams(params).keyframes).toEqual(s.keyframes);
    expect(settingsToSearchParams(defaultSettings("classic")).has("kf")).toBe(false);
    expect(defaultSettings("shatter").keyframes).toEqual([]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&kf=g_0_99999_200_-5*nope_1_1")).keyframes).toEqual([kf("gravity", 0, 2000), kf("gravity", 120, 0)]);
  });

  it("is validated in presets and carried over a mode change", () => {
    const loaded = presetToSettings({ mode: "classic", keyframes: [{ key: "gravity", time: 1, value: 700 }, { key: "bogus", time: 1, value: 1 }, "x"] as unknown as Keyframe[] });
    expect(loaded.keyframes).toEqual([kf("gravity", 1, 700)]);
    expect(presetToSettings({ mode: "classic" }).keyframes).toEqual([]);
    const carried = timelineCarryOver({ keyframes: loaded.keyframes });
    expect(carried.keyframes).toEqual(loaded.keyframes);
    expect(carried.keyframes).not.toBe(loaded.keyframes);
  });
});

describe("the panel and the bar", () => {
  it("maps the panel's sliders to the settings they show and formats values like them", () => {
    expect(timelineKeyForLabel("ballSize")).toBe("ballRadius");
    expect(timelineKeyForLabel("breathingWalls")).toBe("breathingAmplitude");
    expect(timelineKeyForLabel("gravity")).toBe("gravity");
    expect(timelineKeyForLabel("captionStart")).toBeNull();
    expect(formatTimelineValue("gravity", 842.4)).toBe("842");
    expect(formatTimelineValue("ballRadius", 12.25)).toBe("12.3px");
    expect(formatTimelineValue("ballRadius", 12)).toBe("12px");
    expect(formatTimelineValue("windX", 0.25)).toBe("+0.25");
    expect(formatTimelineValue("wallBounciness", 0.85)).toBe("85%");
    expect(formatTimelineValue("bumperBoost", 1.3)).toBe("×1.30");
  });

  it("offers the gap, rotation and bumper settings only where the panel shows them", () => {
    expect(timelineKeyShown("gapSize", "classic", true)).toBe(true);
    expect(timelineKeyShown("gapSize", "shatter", true)).toBe(false);
    expect(timelineKeyShown("rotationSpeed", "pendulum", false)).toBe(false);
    expect(timelineKeyShown("bumperBoost", "classic", false)).toBe(false);
    expect(timelineKeyShown("gravity", "drop", false)).toBe(true);
  });

  it("spans the clip, or up to a later keyframe, and places the playhead on it", () => {
    expect(timelineSpan([kf("gravity", 10, 1)], 30)).toBe(30);
    expect(timelineSpan([kf("gravity", 45, 1)], 30)).toBe(45);
    expect(timelinePosition(15, 30)).toBe(0.5);
    expect(timelinePosition(90, 30)).toBe(1);
    expect(timelinePosition(-1, 30)).toBe(0);
  });

  it("leaves the rotation speed to the rotation switch", () => {
    const keyframes = [kf("rotationSpeed", 0, 1), kf("rotationSpeed", 5, 4), kf("gravity", 0, 300)];
    expect(engineTimelineOf({ keyframes, rotationEnabled: true })).toEqual(keyframes);
    expect(engineTimelineOf({ keyframes, rotationEnabled: false })).toEqual([kf("gravity", 0, 300)]);
  });
});

describe("the engine", () => {
  it("applies the keyframes at every step from the simulation clock", () => {
    const engine = pageEngine(SCRIPT, 11);
    expect(engine.config.gravity).toBe(0);
    expect(engine.config.ballRadius).toBe(8);
    for (let i = 0; i < 120; i++) engine.update(1000 / 60, 0); // 2 s
    // The last step started at 2 s − 1/60 s: the values of that instant.
    const t = (engine.getElapsedMs() - 1000 / 60) / 1000;
    expect(engine.config.gravity).toBeCloseTo((1500 * t) / 4, 6);
    expect(engine.config.ballRadius).toBeCloseTo(8 + (12 * t) / 3, 6);
    expect(engine.getPhysicsExtras().windX).toBeCloseTo(0.3 * (t - 1), 6);
    for (const ball of engine.getBalls()) expect(ball.radius).toBeCloseTo(engine.config.ballRadius, 6);
    for (let i = 0; i < 240; i++) engine.update(1000 / 60, 0); // 6 s: past every keyframe, the last values hold
    expect(engine.config.gravity).toBe(1500);
    expect(engine.config.ballRadius).toBe(20);
    expect(engine.getPhysicsExtras().windX).toBe(0);
    expect(engine.isTimelineAutomated("gravity")).toBe(true);
    expect(engine.isTimelineAutomated("ballSpeed")).toBe(false);
  });

  it("starts every run from the values at 0 s: the balls spawn with them", () => {
    const keyframes = [kf("ballRadius", 0, 20), kf("ballRadius", 5, 4), kf("ballSpeed", 0, 700), kf("ballSpeed", 5, 100)];
    const engine = pageEngine(keyframes, 3);
    const [ball] = engine.getBalls();
    expect(ball.radius).toBe(20);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(700, 6);
    for (let i = 0; i < 200; i++) engine.update(1000 / 60, 0);
    expect(engine.config.ballRadius).toBeLessThan(20);
    engine.initMode("classic"); // Restart
    expect(engine.getElapsedMs()).toBe(0);
    expect(engine.config.ballRadius).toBe(20);
    expect(engine.getBalls()[0].radius).toBe(20);
  });

  it("never lets a page patch override an automated setting, and gives it back its own value when the keyframes go", () => {
    const engine = pageEngine([kf("gravity", 0, 1000)], 5);
    expect(engine.config.gravity).toBe(1000);
    engine.setConfig({ gravity: 450, ballSpeed: 500 }); // a slider moved while the timeline drives the gravity
    expect(engine.config.gravity).toBe(1000);
    expect(engine.config.ballSpeed).toBe(500);
    engine.setConfig({ timeline: [kf("gravity", 0, 1000), kf("ballSpeed", 0, 250)] });
    expect(engine.config.ballSpeed).toBe(250);
    engine.setConfig({ timeline: [] });
    expect(engine.config.gravity).toBe(450);
    expect(engine.config.ballSpeed).toBe(500);
    expect(engine.isTimelineAutomated("gravity")).toBe(false);
    // Without keyframes a patch applies as always.
    engine.setConfig({ gravity: 600 });
    expect(engine.config.gravity).toBe(600);
  });

  it("applies new keyframes at once, at the current time (a paused run shows them)", () => {
    const engine = pageEngine(undefined, 9);
    for (let i = 0; i < 180; i++) engine.update(1000 / 60, 0); // 3 s
    engine.setConfig({ timeline: [kf("ballRadius", 0, 8), kf("ballRadius", 6, 20)] });
    expect(engine.config.ballRadius).toBeCloseTo(8 + (12 * engine.getElapsedMs()) / 6000, 6);
    // The same list again changes nothing.
    const before = engine.config;
    engine.setConfig({ timeline: [kf("ballRadius", 0, 8), kf("ballRadius", 6, 20)] });
    expect(engine.config.ballRadius).toBe(before.ballRadius);
  });

  it("plays the same run whatever the frame rate", () => {
    const a = pageEngine(SCRIPT, 4242);
    const b = pageEngine(SCRIPT, 4242);
    // 60 Hz frames against 30 Hz frames (two fixed steps per update): sample at the same simulation times.
    const at60: number[][] = [];
    const at30: number[][] = [];
    for (let i = 0; i < 360; i++) {
      a.update(1000 / 60, 0);
      if (i % 2 === 1) at60.push(a.getBalls().flatMap((ball) => [ball.x, ball.y, ball.radius]));
    }
    for (let i = 0; i < 180; i++) {
      b.update(1000 / 30, 0);
      at30.push(b.getBalls().flatMap((ball) => [ball.x, ball.y, ball.radius]));
    }
    expect(at30).toEqual(at60);
  });

  it("changes the run, and the seed finder replays it exactly – also when the search starts mid-run", () => {
    const seed = 777;
    const page = pageEngine(SCRIPT, seed);
    for (let i = 0; i < 150; i++) page.update(1000 / 60, 0);
    // The page copies its engine's config (the keyframes travel in it) for the finder, finds a seed and starts the run over.
    const found = createEngineForSettings({ ...page.config }, "classic", modeSettings, seed);
    expect(found.config.timeline).toEqual(SCRIPT);
    page.setSeed(seed);
    page.setConfig({ ballRadius: 8 });
    page.initMode("classic");
    const expected = trace(page, 400);
    expect(trace(found, 400)).toEqual(expected);
    expect(trace(pageEngine(undefined, seed), 400)).not.toEqual(expected);
  });

  it("leaves a run without keyframes bit-identical to the plain engine", () => {
    for (const mode of ["classic", "shatter", "multiply", "drop"] as const) {
      const plain = trace(pageEngine(undefined, 99, mode), 300);
      expect(trace(pageEngine([], 99, mode), 300)).toEqual(plain);
      const cleared = pageEngine([kf("gravity", 0, 900)], 99, mode);
      cleared.setConfig({ timeline: [] });
      cleared.initMode(mode);
      expect(trace(cleared, 300)).toEqual(plain);
    }
  });

  it("resizes the gaps in place: broken rings stay broken and the rotation goes on", () => {
    const engine = pageEngine(undefined, 2024);
    let frames = 0;
    while (engine.getBrokenWalls().size === 0 && frames < 60 * 60) {
      engine.update(1000 / 60, 0);
      frames++;
    }
    const broken = [...engine.getBrokenWalls()];
    expect(broken.length).toBeGreaterThan(0);
    const rotations = [...engine.getWallRotations()];
    const starts = engine.getCircularWalls().map((w) => w.gaps[0].startAngle);
    engine.setConfig({ timeline: [kf("gapSize", 0, 0.9)] });
    expect(engine.config.gapSize).toBe(0.9);
    expect([...engine.getBrokenWalls()]).toEqual(broken);
    expect(engine.getWallRotations()).toEqual(rotations);
    engine.getCircularWalls().forEach((wall, i) => {
      expect(wall.gaps[0].startAngle).toBe(starts[i]);
      expect(wall.gaps[0].endAngle - wall.gaps[0].startAngle).toBeCloseTo(0.9, 12);
    });
    engine.update(1000 / 60, 0);
    expect([...engine.getBrokenWalls()]).toEqual(broken);
    // A page patch for the automated gap leaves the rings alone too; removing the keyframes gives the page's gap back, in place.
    engine.setConfig({ gapSize: 0.3 });
    expect([...engine.getBrokenWalls()]).toEqual(broken);
    expect(engine.config.gapSize).toBe(0.9);
    engine.setConfig({ timeline: [] });
    expect(engine.config.gapSize).toBe(0.3);
    expect([...engine.getBrokenWalls()]).toEqual(broken);
    expect(engine.getCircularWalls()[0].gaps[0].endAngle - engine.getCircularWalls()[0].gaps[0].startAngle).toBeCloseTo(0.3, 12);
    // A fresh run builds its rings with the keyframed gap.
    engine.setConfig({ timeline: [kf("gapSize", 0, 0.7), kf("gapSize", 10, 0.2)] });
    engine.initMode("classic");
    for (const wall of engine.getCircularWalls()) expect(wall.gaps[0].endAngle - wall.gaps[0].startAngle).toBeCloseTo(0.7, 12);
  });

  it("resizes only the gaps built from the gap size", () => {
    const walls = [{ radius: 100, gaps: [{ startAngle: 1, endAngle: 1.4 }] }, { radius: 120, gaps: [{ startAngle: 0, endAngle: 0.2 }, { startAngle: 3, endAngle: 3.2 }] }];
    resizeGaps(walls, 0.8, "portal");
    expect(walls[0].gaps[0].endAngle).toBe(1.4);
    resizeGaps(walls, 0.8, "classic");
    expect(walls[0].gaps[0].endAngle).toBeCloseTo(1.8, 12);
    expect(walls[1].gaps[1].endAngle).toBe(3.2);
  });

  it("keeps the rotation, drag and bumper settings on their keyframes too", () => {
    const engine = pageEngine([kf("rotationSpeed", 0, 0.5), kf("rotationSpeed", 2, 3), kf("airDrag", 0, 0.01), kf("bumperBoost", 0, 1.8)], 1);
    for (let i = 0; i < 180; i++) engine.update(1000 / 60, 0);
    expect(engine.config.rotationSpeed).toBe(3);
    expect(engine.getPhysicsExtras().airDrag).toBe(0.01);
    expect(engine.config.bumperBoost).toBe(1.8);
  });
});

describe("the panel's live store", () => {
  it("follows the keyframes on the simulation clock and tells its listeners only about changes", () => {
    const store = new TimelineLiveStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    const tracks = compileTimeline([kf("gravity", 0, 0), kf("gravity", 4, 1500)]);
    store.publish(tracks, 2);
    expect(store.getValue("gravity")).toBe(750);
    expect(store.getValue("ballSpeed")).toBeNull();
    expect(store.getTime()).toBe(2);
    expect(calls).toBe(1);
    store.publish(tracks, 2);
    expect(calls).toBe(1);
    store.publish(tracks, 5);
    expect(store.getValue("gravity")).toBe(1500);
    expect(calls).toBe(2);
    store.publish([], 5);
    expect(store.getValue("gravity")).toBeNull();
    expect(calls).toBe(3);
    expect(store.now()).toBe(5);
    store.setClock(() => 7.25);
    expect(store.now()).toBe(7.25);
    unsubscribe();
    store.publish(tracks, 1);
    expect(calls).toBe(3);
  });
});

describe("TimelineRuntime", () => {
  it("records the page's values as bases, applies only what changed and releases settings back to their bases", () => {
    const runtime = new TimelineRuntime();
    const cfg: PhysicsConfig = { ...config };
    const first = runtime.prepare({ timeline: [kf("gravity", 0, 100), kf("gapSize", 0, 0.8)] }, cfg);
    expect(first.retimed).toBe(true);
    expect(runtime.baseOf("gravity")).toBe(300);
    expect(runtime.baseOf("gapSize")).toBe(0.4);
    expect(runtime.patchAt(0, cfg)).toEqual({ gravity: 100 });
    expect(runtime.gapAt(0, cfg)).toBe(0.8);
    expect(runtime.patchAt(0, { ...cfg, gravity: 100 })).toBeNull();
    expect(runtime.gapAt(0, { ...cfg, gapSize: 0.8 })).toBeNull();
    const page = runtime.prepare({ gravity: 350, ballColor: "#ff0000" }, cfg);
    expect(page).toEqual({ rest: { ballColor: "#ff0000" }, gap: null, retimed: false });
    expect(runtime.baseOf("gravity")).toBe(350);
    const released = runtime.prepare({ timeline: [] }, cfg);
    expect(released).toEqual({ rest: { timeline: [], gravity: 350 }, gap: 0.4, retimed: true });
    expect(runtime.active).toBe(false);
  });
});
