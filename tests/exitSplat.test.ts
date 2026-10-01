import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_EXIT_SPLAT,
  EXIT_BEHAVIORS,
  EXIT_SPLAT_RANGES,
  MOVING_EXIT_MODES,
  SPLAT_MODES,
  defaultExitSplatFields,
  exitSplatCarryOver,
  exitSplatConfigOf,
  isExitBehavior,
  resolveExitSplatConfig,
  resolveExitSplatFields,
  splatsSolidIn,
  supportsMovingExits,
  supportsSplats,
  type ExitSplatFields,
} from "@/lib/physics/exitSplat";
import {
  EXIT_REACTION_SEC,
  ExitController,
  FLEE_EASE_RAD,
  JUMP_COOLDOWN_SEC,
  MIN_JUMP_RAD,
  MIN_REOPEN_RAD,
  REOPEN_SEC,
  edgeDistance,
  enclosingRing,
  fleeVelocity,
  gapCentre,
  gapHalfWidth,
  inAnyGap,
  pickExitSpot,
  placeGap,
  shrinkWidth,
  wrapPi,
  wrapTwoPi,
} from "@/lib/physics/movingExits";
import { MAX_SPLAT_SOUNDS_PER_STEP, MIN_SPLAT_RADIUS, SPLAT_FADE_MS, SPLAT_LEAK_MS, SPLAT_OFFSET, SplatField, splatRadius } from "@/lib/physics/splats";
import { SPLAT_SAMPLE_RATE, SPLAT_TONE, scheduleSplatTone, splatLevel } from "@/lib/audio/splatTone";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { arenaPhysicsConfig, playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";
import { EXTRA_ARENA_LEVEL } from "@/lib/splitScreen";
import { physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { sectionKeyShown, type PanelShown } from "@/components/simulator/panelKeys";
import { EXIT_BEHAVIOR_KEYS, ExitBehaviorControls, SPLAT_BARRIER_KEYS, SplatBarrierControls, type ExitSplatSectionProps } from "@/components/simulator/sections/ExitSplatSection";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { MODE_IDS, type Ball, type CircularWall, type ModeContext, type ModeId, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { fakeGraph } from "./fakeAudio";

/**
 * --- gerald-exit-splat --- Moving exits and splat barriers of the ring modes: the settings (defaults, URL, validation,
 * the engine keys), the exits' maths and controller (timed and sensed jumps with their reaction and cooldown, an exit
 * out-run in its doorway, fleeing at a limited speed, shrinking shut and re-opening elsewhere), the splat field (placement,
 * solidity, the cap, the fades, the leak), whole runs in the engine (rings held still, one move per sub-step, exact gap
 * passes, splats, Grow's paint, untouched defaults and other modes, determinism with the seed finder) and the splat sound.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 800,
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

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

/** The ring modes (the classic layout and its relatives). */
const RING_MODES: ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"];

/** One sub-step of the controller tests (the engine's 4 per 60 Hz step). */
const SUB = 1 / 240;
const DEG = Math.PI / 180;

function exitSplat(patch: Partial<ExitSplatFields>): Pick<PhysicsConfig, keyof ExitSplatFields> {
  return exitSplatConfigOf({ ...defaultExitSplatFields(), ...patch });
}

function ring(radius: number, start: number, end: number): CircularWall {
  return { radius, gaps: [{ startAngle: start, endAngle: end }] };
}

/** A ball `dist` from the centre (400, 400) at world angle `angle`. */
function ballAt(angle: number, dist: number, radius = 8): Ball {
  return { id: 0, x: 400 + dist * Math.cos(angle), y: 400 + dist * Math.sin(angle), vx: 0, vy: 0, radius, color: "#ff3366", trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

function moveBall(ball: Ball, angle: number, dist: number) {
  ball.x = 400 + dist * Math.cos(angle);
  ball.y = 400 + dist * Math.sin(angle);
}

/** Mulberry32, as the engine seeds its own RNG. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An ExitController over hand-made rings and balls in an 800 × 800 world, driven sub-step by sub-step. */
function rig(walls: CircularWall[], balls: Ball[] = [], seed = 7) {
  const rotations = walls.map(() => 0);
  const broken = new Set<number>();
  const clock = { ms: 0 };
  const ctx = {
    config: { ...config },
    getBalls: () => balls,
    getCircularWalls: () => walls,
    getWallRotations: () => rotations,
    getBrokenWalls: () => broken,
    random: seeded(seed),
    getElapsedMs: () => clock.ms,
  } as unknown as ModeContext;
  const exits = new ExitController();
  /** `n` sub-steps (a fixed step every four, as the engine does). */
  const sub = (n: number, mode: ModeId = "classic") => {
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) exits.beginStep(ctx, mode);
      clock.ms += 1000 * SUB;
      exits.advance(ctx, SUB, () => false);
    }
  };
  return { ctx, exits, rotations, broken, clock, sub, view: exits.getView() };
}

const width = (wall: CircularWall) => wall.gaps[0].endAngle - wall.gaps[0].startAngle;
const centreOf = (wall: CircularWall) => wrapTwoPi(gapCentre(wall.gaps[0]));
const usedFlashes = (r: ReturnType<typeof rig>) => r.view.flashes.filter((f) => f.timeMs > -Infinity);

/* ------------------------------------------------------------------ settings */

describe("exit behaviour and splat barrier settings", () => {
  it("default to the old rings: exits that rotate, no splats – in every mode", () => {
    expect(DEFAULT_EXIT_SPLAT).toEqual({ exitBehavior: "rotate", exitJumpSeconds: 3, exitSense: 20, exitFleeSpeed: 40, splatBarrier: false, splatSize: 1, splatMax: 60 });
    expect(resolveExitSplatFields(null)).toEqual(DEFAULT_EXIT_SPLAT);
    for (const mode of MODE_IDS) {
      const s = defaultSettings(mode);
      expect(exitSplatCarryOver(s), mode).toEqual(DEFAULT_EXIT_SPLAT);
    }
    expect(EXIT_BEHAVIORS).toEqual(["rotate", "jump", "flee", "shrink"]);
    expect(isExitBehavior("flee")).toBe(true);
    expect(isExitBehavior("teleport")).toBe(false);
    expect(isExitBehavior(3)).toBe(false);
    for (const [key, range] of Object.entries(EXIT_SPLAT_RANGES)) {
      const value = DEFAULT_EXIT_SPLAT[key as keyof typeof EXIT_SPLAT_RANGES];
      expect(value >= range.min && value <= range.max, key).toBe(true);
    }
    expect(EXIT_SPLAT_RANGES.exitJumpSeconds).toMatchObject({ min: 1, max: 10 });
    expect(EXIT_SPLAT_RANGES.splatSize).toMatchObject({ min: 0.5, max: 2 });
    expect(EXIT_SPLAT_RANGES.splatMax).toMatchObject({ min: 10, max: 300 });
  });

  it("apply where they mean something: moving exits in the one-exit ring modes, splats in the ring modes (solid but in Grow)", () => {
    expect(MOVING_EXIT_MODES).toEqual(["classic", "accumulation", "multiply"]);
    for (const mode of MODE_IDS) {
      expect(supportsMovingExits(mode), mode).toBe(MOVING_EXIT_MODES.includes(mode));
      expect(supportsSplats(mode), mode).toBe(SPLAT_MODES.includes(mode));
      expect(splatsSolidIn(mode), mode).toBe(SPLAT_MODES.includes(mode) && mode !== "grow");
      if (supportsSplats(mode)) expect(RING_MODES, mode).toContain(mode);
    }
    expect(supportsSplats("shatter")).toBe(false);
    expect(supportsSplats("colorMatch")).toBe(false);
    expect(supportsMovingExits(null)).toBe(false);
  });

  it("round-trip through the share link and write nothing at their defaults", () => {
    const plain = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["exit", "exj", "exs", "exf", "splat", "sps", "spm"]) expect(plain.has(key), key).toBe(false);
    const s = { ...defaultSettings("classic"), exitBehavior: "flee" as const, exitJumpSeconds: 2.5, exitSense: 35, exitFleeSpeed: 90, splatBarrier: true, splatSize: 1.25, splatMax: 40 };
    const params = settingsToSearchParams(s);
    expect(Object.fromEntries(["exit", "exj", "exs", "exf", "splat", "sps", "spm"].map((k) => [k, params.get(k)]))).toEqual({ exit: "flee", exj: "2.5", exs: "35", exf: "90", splat: "1", sps: "1.25", spm: "40" });
    const back = settingsFromSearchParams(params);
    expect(exitSplatCarryOver(back)).toEqual(exitSplatCarryOver(s));
    // Turned off again, the link says so only when it differs from the default (off): nothing.
    expect(settingsToSearchParams({ ...s, splatBarrier: false }).has("splat")).toBe(false);
  });

  it("fall back on unknown values, lift numbers onto their minimum and keep them past the sliders (uncapped)", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&exit=teleport&exj=abc&exs=-5&exf=1000&splat=yes&sps=0.1&spm=12.6"));
    expect(exitSplatCarryOver(s)).toEqual({ exitBehavior: "rotate", exitJumpSeconds: 3, exitSense: 0, exitFleeSpeed: 1000, splatBarrier: false, splatSize: 0.5, splatMax: 13 });
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&splat=0&spm=5000&exj=60")).splatMax).toBe(5000);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&exj=60")).exitJumpSeconds).toBe(60);
    // The engine stands at most the memory-safety ceiling of splats at once.
    expect(resolveExitSplatConfig({ splatMax: 1e9 }).splatMax).toBe(MEMORY_CEILINGS.splatMax);
    expect(resolveExitSplatConfig({ exitSense: 90, exitFleeSpeed: 180 })).toMatchObject({ senseRad: Math.PI / 2, fleeRadPerSec: Math.PI });
    // Presets and project files go through the same validation.
    const preset = presetToSettings({ mode: "classic", exitBehavior: "nope" as never, splatBarrier: "yes" as never, splatMax: 7, splatSize: Number.NaN, exitSense: 45 });
    expect(exitSplatCarryOver(preset)).toEqual({ ...DEFAULT_EXIT_SPLAT, splatMax: 10, exitSense: 45 });
  });

  it("carry over to the next mode and into every engine the page builds (the bot's, the arenas')", () => {
    const s = { ...defaultSettings("classic"), exitBehavior: "shrink" as const, exitJumpSeconds: 4, splatBarrier: true, splatMax: 25 };
    const carried = exitSplatCarryOver(s);
    expect(Object.keys(carried).sort()).toEqual(["exitBehavior", "exitFleeSpeed", "exitJumpSeconds", "exitSense", "splatBarrier", "splatMax", "splatSize"]);
    expect(physicsConfigOfSettings(s)).toMatchObject(exitSplatConfigOf(s));
    expect(arenaPhysicsConfig(s)).toMatchObject(exitSplatConfigOf(s));
    expect(exitSplatConfigOf(s)).toEqual(carried);
  });

  it("are read by the engines of the modes they apply to only (a value past its slider elsewhere engages nothing)", () => {
    const exitKeys = ["exitJumpSeconds", "exitSense", "exitFleeSpeed"];
    const splatKeys = ["splatSize", "splatMax"];
    for (const mode of MODE_IDS) {
      const keys = engineSettingKeys(mode);
      for (const key of exitKeys) expect(keys.includes(key), `${mode} ${key}`).toBe(supportsMovingExits(mode));
      for (const key of splatKeys) expect(keys.includes(key), `${mode} ${key}`).toBe(supportsSplats(mode));
    }
  });
});

/* ------------------------------------------------------------------ the exits' maths */

describe("moving exits: the maths", () => {
  it("wraps angles and writes a gap across 0 as one span", () => {
    expect(wrapPi((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapPi(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapPi(0.5)).toBe(0.5);
    expect(wrapTwoPi(-0.5)).toBeCloseTo(2 * Math.PI - 0.5, 12);
    expect(wrapTwoPi(2 * Math.PI)).toBe(0);
    expect(wrapTwoPi(7)).toBeCloseTo(7 - 2 * Math.PI, 12);
    const gap = { startAngle: 0, endAngle: 0 };
    placeGap(gap, 0.1, 0.4);
    expect(gap.startAngle).toBeCloseTo(2 * Math.PI - 0.1, 12);
    expect(gap.endAngle).toBeCloseTo(2 * Math.PI + 0.3, 12);
    expect(wrapTwoPi(gapCentre(gap))).toBeCloseTo(0.1, 12);
    expect(gapHalfWidth(gap)).toBeCloseTo(0.2, 12);
    for (const [angle, inside] of [[0, true], [0.25, true], [0.35, false], [2 * Math.PI - 0.05, true], [2 * Math.PI - 0.15, false], [Math.PI, false]] as const) expect(inAnyGap(angle, [gap]), String(angle)).toBe(inside);
    expect(inAnyGap(3, [gap, { startAngle: 2.9, endAngle: 3.1 }])).toBe(true);
    placeGap(gap, 1, -1);
    expect(gap.endAngle - gap.startAngle).toBe(0);
  });

  it("measures how far an angle lies outside an exit, across ±π too", () => {
    expect(edgeDistance(0.5, 0.1, 0.2)).toBeCloseTo(0.2, 12);
    expect(edgeDistance(0.2, 0.1, 0.2)).toBe(0);
    expect(edgeDistance(Math.PI - 0.1, -Math.PI + 0.1, 0.05)).toBeCloseTo(0.15, 12);
  });

  it("flees away from the ball at full speed, easing to a stop on the far side of the ring", () => {
    expect(fleeVelocity(0.3, 2)).toBe(2);
    expect(fleeVelocity(-0.3, 2)).toBe(-2);
    expect(fleeVelocity(0, 2)).toBe(2);
    expect(fleeVelocity(Math.PI - FLEE_EASE_RAD / 2, 2)).toBeCloseTo(1, 12);
    expect(fleeVelocity(-(Math.PI - 0.1), 2)).toBeCloseTo(-2 * (0.1 / FLEE_EASE_RAD), 12);
    expect(fleeVelocity(Math.PI, 2)).toBe(0);
  });

  it("shrinks an exit ever faster until it is shut", () => {
    expect(shrinkWidth(0.6, 0)).toBe(0.6);
    expect(shrinkWidth(0.6, 0.5)).toBeCloseTo(0.525, 12);
    expect(shrinkWidth(0.6, 1)).toBe(0);
    expect(shrinkWidth(0.6, -1)).toBe(0.6);
    expect(shrinkWidth(0.6, 2)).toBe(0);
    let prev = Infinity;
    let prevDrop = 0;
    for (let i = 0; i <= 20; i++) {
      const w = shrinkWidth(0.6, i / 20);
      expect(w).toBeLessThanOrEqual(prev);
      if (i > 0) {
        expect(prev - w).toBeGreaterThanOrEqual(prevDrop - 1e-12); // it closes faster and faster
        prevDrop = prev - w;
      }
      prev = w;
    }
  });

  it("picks a new spot far enough away and clear of the balls it dodges – the best drawn one when none is", () => {
    const seq = (values: number[]) => {
      let i = 0;
      return () => values[i++ % values.length];
    };
    // Too close to where it was, then half a turn away.
    expect(pickExitSpot(seq([0, 0.5]), 0, 0.2, [], 0, 0, MIN_JUMP_RAD)).toBeCloseTo(Math.PI, 12);
    // Half a turn would land on the ball (at π): a quarter turn keeps its distance.
    expect(pickExitSpot(seq([0.5, 0.25]), 0, 0.2, [Math.PI], 1, 0.3, MIN_JUMP_RAD)).toBeCloseTo(Math.PI / 2, 12);
    // Nothing qualifies: the drawn spot that came closest (the furthest move).
    expect(pickExitSpot(seq([0.01, 0.03, 0.02]), 0, 0.2, [], 0, 0, MIN_JUMP_RAD, 3)).toBeCloseTo(0.03 * 2 * Math.PI, 12);
    // Seeded: the same draws, the same spots.
    const a = seeded(99);
    const b = seeded(99);
    for (let i = 0; i < 20; i++) expect(pickExitSpot(a, i, 0.2, [i + 1], 1, 0.4, MIN_JUMP_RAD)).toBe(pickExitSpot(b, i, 0.2, [i + 1], 1, 0.4, MIN_JUMP_RAD));
  });

  it("finds the innermost intact ring around a point", () => {
    const walls = [ring(100, 0, 0.5), ring(200, 0, 0.5), ring(300, 0, 0.5)];
    expect(enclosingRing(walls, new Set(), 50)).toBe(0);
    expect(enclosingRing(walls, new Set([1]), 150)).toBe(2);
    expect(enclosingRing(walls, new Set(), 250)).toBe(2);
    expect(enclosingRing(walls, new Set(), 350)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ the controller */

describe("moving exits: jump", () => {
  it("teleports every exit on its timer – at least a sixth of a turn, as wide as it was, with a flash at both spots", () => {
    const walls = [ring(200, 0, 0.6), ring(300, 1, 1.5)];
    const r = rig(walls);
    r.exits.configure(exitSplat({ exitBehavior: "jump", exitJumpSeconds: 3 }));
    expect(r.exits.beginStep(r.ctx, "classic")).toBe(true);
    r.sub(719); // 2.996 s
    expect(walls[0].gaps[0]).toEqual({ startAngle: 0, endAngle: 0.6 });
    expect(r.view.alert[0]).toBeGreaterThan(0.9); // it flickers before it goes
    expect(r.view.moves).toBe(0);
    r.sub(3);
    expect(r.view.moves).toBe(1);
    expect(width(walls[0])).toBeCloseTo(0.6, 12);
    const landed = centreOf(walls[0]);
    expect(Math.abs(wrapPi(landed - 0.3))).toBeGreaterThanOrEqual(MIN_JUMP_RAD);
    const flashes = usedFlashes(r);
    expect(flashes.map((f) => [f.wall, f.appear])).toEqual([[0, false], [0, true]]);
    expect(flashes[0].angle).toBeCloseTo(0.3, 12);
    expect(flashes[1].angle).toBeCloseTo(landed, 12);
    expect(r.view.alert[0]).toBe(0);
    // The outer ring's first jump comes later (the timers are spread over the rings, so they never all jump at once).
    expect(walls[1].gaps[0]).toEqual({ startAngle: 1, endAngle: 1.5 });
    r.sub(940 - 722);
    expect(walls[1].gaps[0]).toEqual({ startAngle: 1, endAngle: 1.5 });
    r.sub(6);
    expect(r.view.moves).toBe(2);
    expect(width(walls[1])).toBeCloseTo(0.5, 12);
    // Then every exitJumpSeconds.
    r.sub(1446 - 946);
    expect(r.view.moves).toBe(3);
    expect(width(walls[0])).toBeCloseTo(0.6, 12);
  });

  it("is seeded: the same seed jumps to the same spots, another seed elsewhere", () => {
    const landings = (seed: number) => {
      const walls = [ring(200, 0, 0.6), ring(300, 1, 1.5)];
      const r = rig(walls, [], seed);
      r.exits.configure(exitSplat({ exitBehavior: "jump", exitJumpSeconds: 1 }));
      r.sub(240 * 6);
      return walls.map((w) => w.gaps[0].startAngle);
    };
    expect(landings(5)).toEqual(landings(5));
    expect(landings(5)).not.toEqual(landings(6));
  });

  it("reacts to a ball within its sense: flickers for the reaction time, then jumps clear of it – and not again during the cooldown", () => {
    const walls = [ring(200, 0, 0.6)]; // the exit spans 0 … 0.6, centred on 0.3
    const ball = ballAt(-0.3, 150); // 0.3 rad from the exit's edge: inside a 20° sense
    const r = rig(walls, [ball]);
    r.exits.configure(exitSplat({ exitBehavior: "jump", exitJumpSeconds: 10, exitSense: 20 }));
    r.sub(1);
    expect(r.view.alert[0]).toBeGreaterThan(0);
    const reaction = Math.round(EXIT_REACTION_SEC / SUB);
    r.sub(reaction - 3);
    expect(r.view.moves).toBe(0);
    expect(walls[0].gaps[0]).toEqual({ startAngle: 0, endAngle: 0.6 });
    r.sub(4);
    expect(r.view.moves).toBe(1);
    const centre = centreOf(walls[0]);
    expect(edgeDistance(-0.3, centre, 0.3)).toBeGreaterThanOrEqual(20 * DEG - 1e-9); // it landed outside the ball's reach
    // The ball runs after it: nothing during the cooldown, then the reaction, then another jump.
    moveBall(ball, centre - 0.3 - 0.1, 150);
    r.sub(Math.round((JUMP_COOLDOWN_SEC - 0.1) / SUB));
    expect(r.view.moves).toBe(1);
    r.sub(Math.round((0.1 + EXIT_REACTION_SEC + 0.05) / SUB));
    expect(r.view.moves).toBe(2);
  });

  it("is out-run by a ball in its doorway: it lets the ball through, and jumps once the doorway is clear", () => {
    const walls = [ring(200, 0, 0.6)];
    const ball = ballAt(0.3, 195); // in the doorway (its edge reaches the wall line)
    const r = rig(walls, [ball]);
    r.exits.configure(exitSplat({ exitBehavior: "jump", exitJumpSeconds: 1, exitSense: 20 }));
    r.sub(600); // 2.5 s: the timer and many reactions ran out
    expect(r.view.moves).toBe(0);
    expect(walls[0].gaps[0]).toEqual({ startAngle: 0, endAngle: 0.6 });
    moveBall(ball, Math.PI, 50); // back near the centre (too near to alarm it)
    r.sub(1);
    expect(r.view.moves).toBe(1);
  });

  it("never reacts with a sense of 0, and leaves a broken ring's exit where it is", () => {
    const walls = [ring(200, 0, 0.6), ring(300, 1, 1.5)];
    const ball = ballAt(-0.1, 150);
    const r = rig(walls, [ball]);
    r.exits.configure(exitSplat({ exitBehavior: "jump", exitJumpSeconds: 5, exitSense: 0 }));
    r.broken.add(1);
    r.sub(240 * 4);
    expect(r.view.moves).toBe(0);
    r.sub(240 * 2);
    expect(r.view.moves).toBe(1); // ring 0 on its timer
    expect(walls[1].gaps[0]).toEqual({ startAngle: 1, endAngle: 1.5 });
  });

  it("moves only in a ring mode with one exit a ring, and only with a behaviour other than rotate", () => {
    const r = rig([ring(200, 0, 0.6)]);
    for (const behavior of EXIT_BEHAVIORS) {
      r.exits.configure(exitSplat({ exitBehavior: behavior }));
      for (const mode of MODE_IDS) expect(r.exits.beginStep(r.ctx, mode), `${behavior} ${mode}`).toBe(behavior !== "rotate" && MOVING_EXIT_MODES.includes(mode));
    }
    expect(r.view.live).toBe(false);
    const none = rig([]);
    none.exits.configure(exitSplat({ exitBehavior: "jump" }));
    expect(none.exits.beginStep(none.ctx, "classic")).toBe(false);
  });
});

describe("moving exits: flee", () => {
  const TOP = 40 * DEG;

  it("runs away from the ball at its top speed at most, and stops once the ball is out of its sense", () => {
    const walls = [ring(200, 0, 0.6)];
    const ball = ballAt(0, 150); // touching the exit's start edge: it runs the positive way
    const r = rig(walls, [ball]);
    r.exits.configure(exitSplat({ exitBehavior: "flee", exitSense: 20, exitFleeSpeed: 40 }));
    let prev = centreOf(walls[0]);
    let fastest = 0;
    for (let i = 0; i < 480; i++) {
      r.sub(1);
      const c = centreOf(walls[0]);
      fastest = Math.max(fastest, Math.abs(wrapPi(c - prev)));
      prev = c;
      if (i === 20) expect(r.view.fleeing[0]).toBeGreaterThan(0.5);
    }
    expect(fastest).toBeLessThanOrEqual(TOP * SUB + 1e-12);
    expect(fastest).toBeGreaterThan(0.9 * TOP * SUB);
    expect(wrapPi(centreOf(walls[0]) - 0.3)).toBeGreaterThan(0);
    const gapToBall = edgeDistance(0, centreOf(walls[0]), 0.3);
    expect(gapToBall).toBeGreaterThanOrEqual(20 * DEG - 1e-6);
    expect(gapToBall).toBeLessThan(20 * DEG + 0.1);
    expect(width(walls[0])).toBeCloseTo(0.6, 12);
    const parked = centreOf(walls[0]);
    r.sub(120);
    expect(Math.abs(wrapPi(centreOf(walls[0]) - parked))).toBeLessThan(1e-3);
    expect(r.view.moves).toBe(0); // fleeing is no jump
  });

  it("runs the other way from a ball on its other side", () => {
    const walls = [ring(200, 0, 0.6)];
    const r = rig(walls, [ballAt(0.6, 150)]);
    r.exits.configure(exitSplat({ exitBehavior: "flee", exitSense: 20, exitFleeSpeed: 40 }));
    r.sub(240);
    expect(wrapPi(centreOf(walls[0]) - 0.3)).toBeLessThan(-0.1);
    expect(r.view.fleeing[0]).toBeLessThanOrEqual(0);
  });

  it("is caught by a ball in its doorway (it stops), and ignores a ball near the centre", () => {
    const walls = [ring(200, 0, 0.6)];
    const ball = ballAt(0.3, 195);
    const r = rig(walls, [ball]);
    r.exits.configure(exitSplat({ exitBehavior: "flee", exitSense: 45, exitFleeSpeed: 180 }));
    r.sub(240);
    expect(walls[0].gaps[0]).toEqual({ startAngle: 0, endAngle: 0.6 });
    moveBall(ball, 0.3, 40);
    r.sub(240);
    expect(walls[0].gaps[0]).toEqual({ startAngle: 0, endAngle: 0.6 });
    moveBall(ball, 0.3, 150);
    r.sub(240);
    expect(centreOf(walls[0])).not.toBeCloseTo(0.3, 3);
  });
});

describe("moving exits: shrink", () => {
  it("narrows over the exit timer until it shuts, re-opens at least a quarter turn away and starts over", () => {
    const walls = [ring(200, 0, 0.6)];
    const r = rig(walls);
    r.exits.configure(exitSplat({ exitBehavior: "shrink", exitJumpSeconds: 2 }));
    let prev = width(walls[0]);
    for (let i = 0; i < 240; i++) {
      r.sub(1);
      expect(width(walls[0])).toBeLessThanOrEqual(prev + 1e-12);
      prev = width(walls[0]);
    }
    expect(width(walls[0])).toBeCloseTo(shrinkWidth(0.6, 0.5), 9);
    expect(centreOf(walls[0])).toBeCloseTo(0.3, 12);
    expect(r.view.closing[0]).toBeCloseTo(0.125, 6);
    r.sub(242);
    expect(r.view.moves).toBe(1);
    expect(width(walls[0])).toBeLessThan(0.02); // shut (and just starting to open)
    const reopened = centreOf(walls[0]);
    expect(Math.abs(wrapPi(reopened - 0.3))).toBeGreaterThanOrEqual(MIN_REOPEN_RAD);
    const flashes = usedFlashes(r);
    expect(flashes.map((f) => f.appear)).toEqual([false, true]);
    r.sub(Math.round(REOPEN_SEC / SUB) + 1);
    expect(width(walls[0])).toBeCloseTo(0.6, 2);
    expect(r.view.closing[0]).toBeLessThan(0.02);
    expect(centreOf(walls[0])).toBeCloseTo(reopened, 12);
    r.sub(480);
    expect(r.view.moves).toBe(2);
  });

  it("follows the engine's resizes and opens every exit again when the behaviour changes", () => {
    const walls = [ring(200, 0, 0.6)];
    const r = rig(walls);
    r.exits.configure(exitSplat({ exitBehavior: "shrink", exitJumpSeconds: 2 }));
    r.sub(240);
    placeGap(walls[0].gaps[0], gapCentre(walls[0].gaps[0]), 0.8); // a bigger gap size (or a smaller ball) mid-run
    r.sub(1);
    expect(width(walls[0])).toBeCloseTo(shrinkWidth(0.8, 241 / 480), 9);
    r.exits.configure(exitSplat({ exitBehavior: "rotate" }));
    expect(width(walls[0])).toBeCloseTo(0.8, 12);
    expect(centreOf(walls[0])).toBeCloseTo(0.3, 12);
  });
});

/* ------------------------------------------------------------------ the splat field */

describe("splat barrier: the field", () => {
  const walls = () => [ring(200, 0, 0.6)];

  function field(patch: Partial<ExitSplatFields> = {}, mode: ModeId = "classic") {
    const f = new SplatField();
    f.configure({ width: 800, height: 800, ...exitSplat({ splatBarrier: true, ...patch }) });
    f.beginStep(mode);
    return f;
  }

  it("lands a splat on the inside of the wall at the hit, in the ball's colour, turning with its ring – never in an exit", () => {
    const f = field({ splatSize: 1.5 });
    const events: SoundEvent[] = [];
    const ws = walls();
    const s = f.add(0, 2, 200, 0.5, 8, "#ff3366", 0.5, 1000, ws[0].gaps, events)!;
    expect(s).not.toBeNull();
    expect(s.radius).toBe(12);
    expect(s.offset).toBeCloseTo(SPLAT_OFFSET * 12, 12);
    expect(s.angle).toBeCloseTo(1.5, 12); // relative to its ring (turned by 0.5)
    expect(Math.hypot(s.x - 400, s.y - 400)).toBeCloseTo(200 + SPLAT_OFFSET * 12, 9);
    expect(Math.atan2(s.y - 400, s.x - 400)).toBeCloseTo(2, 9);
    expect([s.color, s.solid, s.serial, s.bornMs, s.fadeMs]).toEqual(["#ff3366", true, 1, 1000, -1]);
    expect(events).toEqual([{ type: "hit", wallIndex: 0, splat: true, melody: false, level: 0.5 }]);
    // In the exit (world 0.8 = 0.3 on the ring): no splat, no sound.
    expect(f.add(0, 0.8, 200, 0.5, 8, "#ff3366", 0.5, 1000, ws[0].gaps, events)).toBeNull();
    expect(events).toHaveLength(1);
    expect([f.created, f.active]).toEqual([1, 1]);
    // It follows its ring: turned a quarter, placed for the sub-step.
    expect(f.prepare(ws, [0.5 + Math.PI / 2], 400, 400)).toBe(true);
    expect(wrapPi(Math.atan2(s.y - 400, s.x - 400) - (2 + Math.PI / 2))).toBeCloseTo(0, 9);
  });

  it("sizes splats with the ball (never below a minimum) and keeps the sounds of a busy step in budget", () => {
    expect(splatRadius(1, 8)).toBe(8);
    expect(splatRadius(2, 8)).toBe(16);
    expect(splatRadius(0.5, 1)).toBe(MIN_SPLAT_RADIUS);
    const f = field();
    const events: SoundEvent[] = [];
    for (let i = 0; i < 5; i++) f.add(0, 1 + i * 0.3, 200, 0, 8, "#fff", 3, 0, [], events);
    expect(events).toHaveLength(MAX_SPLAT_SOUNDS_PER_STEP);
    expect(events[0].level).toBe(1); // loud hits clamp to 1
    f.beginStep("classic");
    f.add(0, 4, 200, 0, 8, "#fff", 0.01, 0, [], events);
    expect(events.at(-1)!.level).toBe(0.25); // soft ones are still heard
  });

  it("is solid: a ball inside the ring bounces off a splat, one outside the ring passes it", () => {
    const f = field();
    const ws = walls();
    f.add(0, Math.PI, 200, 0, 8, "#fff", 1, 0, ws[0].gaps, []);
    expect(f.prepare(ws, [0], 400, 400)).toBe(true);
    const inside = ballAt(Math.PI, 186); // overlapping the splat from inside, heading out
    inside.vx = -300;
    const ring0 = f.collide(inside, SUB, 400, 400, 1, 40, 500);
    expect(ring0).toBe(0);
    expect(inside.vx).toBeGreaterThan(0); // rebounded towards the centre
    expect(f.hits).toBe(1);
    expect(f.splats[0].hitMs).toBe(500);
    const outside = ballAt(Math.PI, 214);
    outside.vx = 300;
    expect(f.collide(outside, SUB, 400, 400, 1, 40, 600)).toBe(-1);
    expect(outside.vx).toBe(300);
    expect(f.hits).toBe(1);
  });

  it("fades the oldest past Most Splats, and the faded ones are gone after the fade", () => {
    const f = field({ splatMax: 10 });
    for (let i = 0; i < 15; i++) f.add(0, 1 + i * 0.3, 200, 0, 8, "#fff", 1, 100 * i, [], []);
    expect([f.created, f.active, f.splats.length, f.max]).toEqual([15, 10, 15, 10]);
    expect(f.splats.filter((s) => s.fadeMs >= 0).map((s) => s.serial)).toEqual([1, 2, 3, 4, 5]);
    f.endStep(walls(), new Set(), 1400 + SPLAT_FADE_MS);
    expect(f.splats.map((s) => s.serial)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("drops a splat an exit moves over or whose ring breaks, and leaks the oldest when the barrier holds every ball off the wall", () => {
    const f = field();
    const ws = walls();
    for (const angle of [1.5, 3, 4.5]) f.add(0, angle, 200, 0, 8, "#fff", 1, 0, ws[0].gaps, []);
    placeGap(ws[0].gaps[0], 1.5, 0.6); // the exit jumped onto the first splat
    f.endStep(ws, new Set(), 10);
    expect(f.splats.map((s) => s.fadeMs >= 0)).toEqual([true, false, false]);
    expect(f.active).toBe(2);
    // No new splat for SPLAT_LEAK_MS: the oldest standing one falls (and the next one after another wait).
    f.endStep(ws, new Set(), SPLAT_LEAK_MS - 1);
    expect(f.active).toBe(2);
    f.endStep(ws, new Set(), SPLAT_LEAK_MS);
    expect(f.active).toBe(1);
    expect(f.splats.filter((s) => s.fadeMs < 0).map((s) => s.serial)).toEqual([3]);
    // The ring breaks: everything on it falls.
    f.endStep(ws, new Set([0]), SPLAT_LEAK_MS + 10);
    expect(f.active).toBe(0);
    f.endStep(ws, new Set([0]), SPLAT_LEAK_MS + 10 + SPLAT_FADE_MS);
    expect(f.splats).toHaveLength(0);
  });

  it("paints only in Grow, stays out of the other modes and goes when switched off", () => {
    const grow = field({}, "grow");
    const s = grow.add(0, 1, 200, 0, 8, "#fff", 1, 0, [], [])!;
    expect(s.solid).toBe(false);
    expect(grow.prepare(walls(), [0], 400, 400)).toBe(false);
    const shatter = new SplatField();
    shatter.configure({ width: 800, height: 800, ...exitSplat({ splatBarrier: true }) });
    expect(shatter.beginStep("shatter")).toBe(false);
    expect(shatter.add(0, 1, 200, 0, 8, "#fff", 1, 0, [], [])).toBeNull();
    const off = field({ splatBarrier: false });
    expect(off.beginStep("classic")).toBe(false);
    const on = field();
    on.add(0, 1, 200, 0, 8, "#fff", 1, 0, [], []);
    on.configure({ width: 800, height: 800, ...exitSplat({ splatBarrier: false }) });
    expect([on.splats.length, on.created, on.active]).toEqual([0, 0, 0]);
  });

  it("scales the splats with a new canvas size, like the rings", () => {
    const f = field();
    const s = f.add(0, 1, 200, 0, 8, "#fff", 1, 0, [], [])!;
    f.configure({ width: 1600, height: 1600, ...exitSplat({ splatBarrier: true }) });
    expect([s.radius, s.offset]).toEqual([16, SPLAT_OFFSET * 16]);
  });
});

/* ------------------------------------------------------------------ whole runs */

describe("moving exits and splats in the engine", () => {
  afterEach(() => vi.restoreAllMocks());

  const quiet: ModeSettings = { ...modeSettings, cinematicEnabled: false };

  function trace(engine: PhysicsEngine, frames: number, every = 20) {
    const out: number[][] = [];
    for (let i = 0; i < frames; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (i % every === 0) {
        out.push([
          ...engine.getBalls().flatMap((b) => [b.x, b.y, b.vx, b.vy]),
          ...engine.getCircularWalls().flatMap((w) => w.gaps.flatMap((g) => [g.startAngle, g.endAngle])),
          ...engine.getWallRotations(),
          engine.getSplats().created,
          engine.getExitView().moves,
        ]);
      }
    }
    return out;
  }

  it("hold the rings still and move the exits by themselves", () => {
    const turning = createEngineForSettings(config, "classic", quiet, 21);
    const jumping = createEngineForSettings({ ...config, ...exitSplat({ exitBehavior: "jump", exitJumpSeconds: 1 }) }, "classic", quiet, 21);
    const widths = jumping.getCircularWalls().map(width);
    for (let i = 0; i < 180; i++) {
      turning.update(1000 / 60, 0);
      jumping.update(1000 / 60, 0);
    }
    expect(turning.getWallRotations().some((r) => r !== 0)).toBe(true);
    expect(jumping.getWallRotations().every((r) => r === 0)).toBe(true);
    expect(jumping.getExitView()).toMatchObject({ behavior: "jump", live: true });
    expect(jumping.getExitView().moves).toBeGreaterThan(0);
    jumping.getCircularWalls().forEach((w, i) => expect(width(w)).toBeCloseTo(widths[i], 12));
  });

  it("move the exits once per sub-step, before the balls (the splats are placed in the same sub-step)", () => {
    const advance = vi.spyOn(ExitController.prototype, "advance");
    const prepare = vi.spyOn(SplatField.prototype, "prepare");
    const engine = createEngineForSettings({ ...config, ...exitSplat({ exitBehavior: "flee", splatBarrier: true }) }, "classic", quiet, 3);
    for (let i = 0; i < 60; i++) engine.update(1000 / 60, 0);
    expect(advance.mock.calls.length).toBeGreaterThanOrEqual(4 * 60);
    expect(prepare.mock.calls.length).toBe(advance.mock.calls.length);
    expect(advance.mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[0]);
  });

  it("let a ball out only through where its exit is at that moment", () => {
    for (const behavior of ["jump", "flee", "shrink"] as const) {
      const engine = createEngineForSettings({ ...config, ...exitSplat({ exitBehavior: behavior, exitJumpSeconds: 1, exitSense: 30 }) }, "classic", quiet, 7);
      const seen = new Set<number>();
      for (let i = 0; i < 60 * 60 && seen.size < 3 && !engine.isSimulationFinished(); i++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        for (const w of engine.getBrokenWalls()) {
          if (seen.has(w)) continue;
          seen.add(w);
          // A broken ring's exit stays where the ball went through it; the ball is a frame past it at most.
          const wall = engine.getCircularWalls()[w];
          const b = engine.getBalls()[0];
          const off = edgeDistance(Math.atan2(b.y - 400, b.x - 400), gapCentre(wall.gaps[0]) + engine.getWallRotations()[w], gapHalfWidth(wall.gaps[0]));
          expect(off, `${behavior} ring ${w}`).toBeLessThan(0.05);
        }
      }
      expect(seen.size, behavior).toBeGreaterThanOrEqual(2);
    }
  });

  it("can be out-run: a ball that reaches the doorway within the reaction time gets out, a slower one finds the exit gone", () => {
    const shoot = (dist: number) => {
      const engine = createEngineForSettings({ ...config, gravity: 0, ...exitSplat({ exitBehavior: "jump", exitJumpSeconds: 10, exitSense: 20 }) }, "classic", quiet, 3);
      const wall = engine.getCircularWalls()[0];
      const theta = gapCentre(wall.gaps[0]) + engine.getWallRotations()[0];
      const ball = engine.getBalls()[0];
      ball.x = 400 + dist * Math.cos(theta);
      ball.y = 400 + dist * Math.sin(theta);
      ball.vx = 400 * Math.cos(theta);
      ball.vy = 400 * Math.sin(theta);
      for (let i = 0; i < 18; i++) engine.update(1000 / 60, 0);
      return { broken: engine.getBrokenWalls().has(0), moves: engine.getExitView().moves, radius: wall.radius };
    };
    const near = shoot(140);
    expect(near.radius).toBeGreaterThan(155);
    expect(near).toMatchObject({ broken: true, moves: 0 });
    expect(shoot(60)).toMatchObject({ broken: false, moves: 1 });
  });

  it("leave solid splats on the inside of the rings, at most Most Splats of them standing", () => {
    const engine = createEngineForSettings({ ...config, ...exitSplat({ splatBarrier: true, splatMax: 10, splatSize: 1.5 }) }, "classic", quiet, 1);
    const splatEvents: SoundEvent[] = [];
    for (let i = 0; i < 20 * 60; i++) {
      engine.update(1000 / 60, 0);
      for (const ev of engine.consumeSoundEvents()) if (ev.splat) splatEvents.push(ev);
      expect(engine.getSplats().active).toBeLessThanOrEqual(10);
    }
    const field = engine.getSplats();
    expect(field.created).toBeGreaterThan(10);
    expect(field.hits).toBeGreaterThan(0); // the ball bounced off its own splats
    expect(splatEvents.length).toBeGreaterThan(0);
    expect(splatEvents.length).toBeLessThanOrEqual(field.created);
    for (const ev of splatEvents) {
      expect(ev).toMatchObject({ type: "hit", splat: true, melody: false });
      expect(ev.level).toBeGreaterThanOrEqual(0.25);
      expect(ev.level).toBeLessThanOrEqual(1);
    }
    const walls = engine.getCircularWalls();
    const rotations = engine.getWallRotations();
    for (const s of field.splats.filter((x) => x.fadeMs < 0)) {
      const wall = walls[s.wall];
      expect(inAnyGap(s.angle, wall.gaps)).toBe(false);
      expect(s.radius).toBe(12);
      expect(Math.hypot(s.x - 400, s.y - 400)).toBeCloseTo(wall.radius + s.offset, 6);
      expect(Math.abs(wrapPi(Math.atan2(s.y - 400, s.x - 400) - (s.angle + rotations[s.wall])))).toBeLessThan(1e-9);
      expect(s.color).toBe("#ffffff");
    }
  });

  it("drop a ring's splats when it breaks", () => {
    const engine = createEngineForSettings({ ...config, ...exitSplat({ splatBarrier: true, splatSize: 1.5 }) }, "classic", quiet, 2);
    let brokeAt = -1;
    for (let i = 0; i < 30 * 60 && brokeAt < 0; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (engine.getBrokenWalls().has(0)) brokeAt = engine.getElapsedMs();
    }
    expect(brokeAt).toBeGreaterThan(0);
    expect(engine.getSplats().splats.filter((s) => s.wall === 0).every((s) => s.fadeMs >= 0)).toBe(true);
    while (engine.getElapsedMs() < brokeAt + SPLAT_FADE_MS + 20) engine.update(1000 / 60, 0);
    expect(engine.getSplats().splats.some((s) => s.wall === 0)).toBe(false);
  });

  it("only paint Grow's ring, the size of the Ball Size", () => {
    const engine = createEngineForSettings({ ...config, ...exitSplat({ splatBarrier: true, splatSize: 1.5 }) }, "grow", quiet, 5);
    for (let i = 0; i < 10 * 60; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
    }
    const field = engine.getSplats();
    expect(field.created).toBeGreaterThan(0);
    expect(field.splats.every((s) => !s.solid && s.radius === 12)).toBe(true);
    expect(field.hits).toBe(0);
  });

  it("leave every run untouched at their defaults, and the modes they do not apply to with any value", () => {
    for (const mode of RING_MODES) {
      const plain = trace(createEngineForSettings(config, mode, modeSettings, 99), 240);
      expect(trace(createEngineForSettings({ ...config, ...exitSplat({}) }, mode, modeSettings, 99), 240), mode).toEqual(plain);
      const elsewhere = { ...(supportsMovingExits(mode) ? {} : { exitBehavior: "jump" as const, exitJumpSeconds: 1 }), ...(supportsSplats(mode) ? {} : { splatBarrier: true }) };
      if (Object.keys(elsewhere).length > 0) expect(trace(createEngineForSettings({ ...config, ...exitSplat(elsewhere) }, mode, modeSettings, 99), 240), `${mode} ${JSON.stringify(elsewhere)}`).toEqual(plain);
    }
  });

  it("replay exactly for a seed – the seed finder's engine, a second one and the page's (set after the mode starts)", () => {
    for (const [mode, patch] of [
      ["classic", { exitBehavior: "jump", splatBarrier: true }],
      ["accumulation", { exitBehavior: "shrink", exitJumpSeconds: 1.5, splatBarrier: true, splatSize: 2 }],
      ["multiply", { exitBehavior: "flee", exitSense: 60, splatBarrier: true, splatMax: 40 }],
      ["lines", { splatBarrier: true }],
    ] as [ModeId, Partial<ExitSplatFields>][]) {
      const cfg = { ...config, ...exitSplat(patch) };
      const a = trace(createEngineForSettings(cfg, mode, modeSettings, 4242), 480);
      expect(trace(createEngineForSettings(cfg, mode, modeSettings, 4242), 480), mode).toEqual(a);
      const page = new PhysicsEngine({ ...config });
      page.setSeed(4242);
      page.initMode(mode);
      page.setConfig(exitSplat(patch));
      expect(trace(page, 480), `${mode} page`).toEqual(a);
      // And it changes the run.
      expect(trace(createEngineForSettings(config, mode, modeSettings, 4242), 480), mode).not.toEqual(a);
    }
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: { ...config, ...exitSplat({ exitBehavior: "jump", splatBarrier: true }) }, mode: "classic", modeSettings };
    expect(simulateSeed(77, request, 30_000)).toBe(simulateSeed(77, request, 30_000));
  });

  it("start every run afresh: no moves, no flashes, no splats", () => {
    const engine = createEngineForSettings({ ...config, ...exitSplat({ exitBehavior: "jump", exitJumpSeconds: 1, splatBarrier: true }) }, "classic", quiet, 8);
    for (let i = 0; i < 240; i++) engine.update(1000 / 60, 0);
    expect(engine.getExitView().moves).toBeGreaterThan(0);
    expect(engine.getSplats().created).toBeGreaterThan(0);
    engine.initMode("classic");
    expect(engine.getExitView().moves).toBe(0);
    expect(engine.getExitView().flashes.every((f) => f.timeMs === -Infinity)).toBe(true);
    expect([engine.getSplats().created, engine.getSplats().splats.length]).toEqual([0, 0]);
  });
});

/* ------------------------------------------------------------------ the splat sound */

describe("splat sound", () => {
  afterEach(() => vi.unstubAllGlobals());

  function recordingCtx() {
    const log: string[] = [];
    const param = (name: string, value = 0) => ({
      value,
      setValueAtTime: (v: number, t: number) => void log.push(`${name} set ${v} @${t.toFixed(3)}`),
      linearRampToValueAtTime: (v: number, t: number) => void log.push(`${name} lin ${+v.toFixed(4)} @${t.toFixed(3)}`),
      exponentialRampToValueAtTime: (v: number, t: number) => void log.push(`${name} exp ${v} @${t.toFixed(3)}`),
    });
    const links: string[] = [];
    let n = 0;
    const node = (kind: string) => {
      const id = `${kind}${n++}`;
      return { id, connect: (to: { id?: string }) => void links.push(`${id}>${to.id ?? "out"}`) };
    };
    const ctx = {
      createBufferSource: () => ({ ...node("src"), buffer: null as unknown, start: (...args: number[]) => void log.push(`src start ${args.map((a) => a.toFixed(4)).join(" ")}`), stop: (t: number) => void log.push(`src stop @${t.toFixed(3)}`) }),
      createBiquadFilter: () => ({ ...node("lp"), type: "", Q: param("q"), frequency: param("lp") }),
      createGain: () => {
        const g = node("g");
        return { ...g, gain: param(g.id) };
      },
      createOscillator: () => ({ ...node("osc"), type: "", frequency: param("blop"), start: (t: number) => void log.push(`osc start @${t.toFixed(3)}`), stop: (t: number) => void log.push(`osc stop @${t.toFixed(3)}`) }),
    };
    return { ctx, log, links };
  }

  it("is a wet noise burst through a falling low-pass with a gliding blop under it", () => {
    const { ctx, log, links } = recordingCtx();
    const out = { id: "out" };
    scheduleSplatTone(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 2, { duration: 1 } as AudioBuffer, 0.5, 0.05);
    const t = SPLAT_TONE;
    expect(log).toEqual([
      `lp set ${t.bandFrom} @2.000`,
      `lp exp ${t.bandTo} @${(2 + t.duration).toFixed(3)}`,
      "g2 set 0 @2.000",
      `g2 lin ${t.gain * 0.5} @${(2 + t.attack).toFixed(3)}`,
      `g2 exp 0.001 @${(2 + t.duration).toFixed(3)}`,
      `src start 2.0000 0.0500 ${(t.duration + 0.02).toFixed(4)}`,
      `src stop @${(2 + t.duration + 0.02).toFixed(3)}`,
      `blop set ${t.blopFrom} @2.000`,
      `blop exp ${t.blopTo} @${(2 + t.blopTime).toFixed(3)}`,
      "g4 set 0 @2.000",
      `g4 lin ${t.blopGain * 0.5} @${(2 + t.attack).toFixed(3)}`,
      `g4 exp 0.001 @${(2 + t.blopTime).toFixed(3)}`,
      "osc start @2.000",
      `osc stop @${(2 + t.blopTime + 0.02).toFixed(3)}`,
    ]);
    expect(links).toEqual(["src0>lp1", "lp1>g2", "g2>out", "osc3>g4", "g4>out"]);
  });

  it("reads the noise from a different spot each time, always inside the buffer", () => {
    const froms = new Set<number>();
    for (const offset of [0, 0.3, 5, -1, 1e6]) {
      const { ctx, log } = recordingCtx();
      scheduleSplatTone(ctx as unknown as BaseAudioContext, {} as AudioNode, 0, { duration: 1 } as AudioBuffer, 1, offset);
      const [from, length] = log.find((l) => l.startsWith("src start"))!.split(" ").slice(3).map(Number); // "src start <time> <from> <length>"
      expect(from, String(offset)).toBeGreaterThanOrEqual(0);
      expect(from + length, String(offset)).toBeLessThanOrEqual(1 + 1e-9);
      froms.add(from);
    }
    expect(froms.size).toBeGreaterThan(3);
    expect(splatLevel(undefined)).toBe(0.6);
    expect(splatLevel(Number.NaN)).toBe(0.6);
    expect(splatLevel(3)).toBe(1);
    expect(splatLevel(-1)).toBe(0);
    expect(splatLevel(0.3)).toBe(0.3);
  });

  async function startedTone() {
    const graph = fakeGraph();
    const filters: { type: string }[] = [];
    const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });
    (graph.ctx as unknown as Record<string, unknown>).createBiquadFilter = () => {
      const f = { type: "", Q: param(), frequency: param(), connect: () => undefined, disconnect: () => undefined };
      filters.push(f);
      return f;
    };
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const tone = new ToneGenerator();
    await tone.start();
    return { graph, filters, tone };
  }

  it("plays through the ToneGenerator: the noise and the blop, or the hit sample an octave down in sample mode", async () => {
    const { graph, filters, tone } = await startedTone();
    graph.ctx.currentTime = 1;
    const sourcesBefore = graph.sources.length;
    const filtersBefore = filters.length;
    tone.playSplat(0.8);
    expect(graph.sources.length).toBe(sourcesBefore + 1);
    expect(graph.sources.at(-1)!.startArgs[0]).toBe(1);
    expect(graph.oscillators.at(-1)).toEqual({ type: "sine", frequency: SPLAT_TONE.blopFrom, startAt: 1 });
    expect(filters.slice(filtersBefore).map((f) => f.type)).toEqual(["lowpass"]);
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    const oscillators = graph.oscillators.length;
    tone.playSplat(1);
    expect(graph.sources.at(-1)!.playbackRate).toBe(SPLAT_SAMPLE_RATE);
    expect(graph.oscillators).toHaveLength(oscillators);
  });

  it("is what the fast export and the other arenas play for a splat event – not a bounce", async () => {
    const { tone } = await startedTone();
    const splat = vi.spyOn(tone, "playSplat");
    const hit = vi.spyOn(tone, "playWallHit");
    playSoundEvent(tone, { type: "hit", wallIndex: 2, splat: true, melody: false, level: 0.7 }, () => undefined);
    expect(splat.mock.calls).toEqual([[0.7]]);
    expect(hit).not.toHaveBeenCalled();
    playSoundEvent(tone, { type: "hit", wallIndex: 2 }, () => undefined);
    expect(hit).toHaveBeenCalledTimes(1);
    const calls: string[] = [];
    const sink = {
      playWallHit: () => calls.push("hit"),
      playGapPass: () => calls.push("gap"),
      playInteraction: () => calls.push("int"),
      playMultiplier: () => calls.push("mult"),
      playBumper: () => calls.push("bumper"),
      playStringBattle: () => calls.push("sb"),
      playRaceArpeggio: () => calls.push("race"),
      playPew: () => calls.push("pew"),
      playThud: () => calls.push("thud"),
      playSwoosh: () => calls.push("swoosh"),
      playBeatDrop: () => calls.push("bd"),
    } as ArenaSoundSink;
    playArenaSound(sink, { type: "hit", wallIndex: 0, splat: true, melody: false, level: 0.5 }); // a sink without splats: silent
    expect(calls).toEqual([]);
    sink.playSplat = (level) => calls.push(`splat ${level}`);
    playArenaSound(sink, { type: "hit", wallIndex: 0, splat: true, melody: false, level: 0.5 });
    expect(calls).toEqual([`splat ${0.5 * EXTRA_ARENA_LEVEL}`]);
  });
});

/* ------------------------------------------------------------------ the panel */

describe("exit behaviour and splat barrier in the panel", () => {
  const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };

  it("are offered by the command palette in the modes they apply to only", () => {
    for (const mode of MODE_IDS) {
      for (const key of EXIT_BEHAVIOR_KEYS) expect(sectionKeyShown(key, { ...PANEL, mode }, false), `${mode} ${key}`).toBe(supportsMovingExits(mode));
      for (const key of SPLAT_BARRIER_KEYS) expect(sectionKeyShown(key, { ...PANEL, mode }, false), `${mode} ${key}`).toBe(supportsSplats(mode));
    }
  });

  it("are named in English, Polish and Spanish (each its own words)", () => {
    const keys = ["exitBehavior", "exitBehaviorTip", "exitRotate", "exitJump", "exitFlee", "exitShrink", "exitRotateDesc", "exitJumpDesc", "exitFleeDesc", "exitShrinkDesc", "exitHoldNote", "exitJumpSeconds", "exitJumpSecondsTip", "exitSense", "exitSenseTip", "exitSenseOff", "exitFleeSpeed", "exitFleeSpeedTip", "splatBarrier", "splatBarrierTip", "splatSize", "splatSizeTip", "splatMax", "splatMaxTip", "splatGrowNote"];
    for (const key of [...EXIT_BEHAVIOR_KEYS, ...SPLAT_BARRIER_KEYS]) expect(keys).toContain(key);
    const english = en.Controls as Record<string, unknown>;
    for (const [lang, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const controls = catalog.Controls as Record<string, unknown>;
      for (const key of keys) {
        expect(typeof controls[key], `${lang} ${key}`).toBe("string");
        expect((controls[key] as string).trim().length, `${lang} ${key}`).toBeGreaterThan(0);
        if (lang !== "en" && key.endsWith("Tip")) expect(controls[key], `${lang} ${key}`).not.toBe(english[key]);
      }
    }
    // The modes' descriptions say what they can do with it (Polish inflects the barrier's name: its stem).
    const splatWord = { en: "Splat Barrier", pl: "z plam", es: "Barrera de manchas" };
    for (const [lang, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const modes = (catalog as unknown as { Modes: Record<string, { description: string }> }).Modes;
      const controls = catalog.Controls as Record<string, string>;
      for (const mode of SPLAT_MODES) {
        const description = modes[mode].description;
        expect(description, `${lang} ${mode}`).toContain(splatWord[lang]);
        if (supportsMovingExits(mode)) expect(description, `${lang} ${mode}`).toContain(`(${controls.exitBehavior})`);
        else expect(description, `${lang} ${mode}`).not.toContain(controls.exitBehavior);
      }
    }
  });
});

describe("the Exit behaviour and Splat barrier blocks", () => {
  /** A translator over the Controls namespace (plain ICU formatting, like next-intl's); a missing key throws. */
  function translator(messages: Record<string, unknown>, locale: string): Translate {
    const controls = messages.Controls as Record<string, string>;
    const t = ((key: string, values?: Record<string, unknown>) => {
      const text = controls[key];
      if (text === undefined) throw new Error(`missing ${locale} Controls.${key}`);
      return String(new IntlMessageFormat(text, locale).format(values as Record<string, string>));
    }) as unknown as Translate;
    (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in controls;
    return t;
  }

  function render(block: (props: ExitSplatSectionProps) => React.ReactNode, patch: Partial<SimulatorSettings> = {}, query = "", messages: Record<string, unknown> = en, locale = "en") {
    const t = translator(messages, locale);
    const settings = { ...defaultSettings(patch.mode ?? "classic"), ...patch };
    const q = query.toLowerCase();
    const matches = (key: string) => (t as unknown as { has: (k: string) => boolean }).has(key) && (key.toLowerCase().includes(q) || t(key).toLowerCase().includes(q));
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(block, { t, search: query, matches, settings, update: () => {} })));
    return { html, t };
  }

  const slider = (t: Translate, key: string) => `aria-label="${t(key)}"`;

  it("Exit behaviour: the four behaviours, the chosen one pressed, and the sliders it uses", () => {
    const { html: rotate, t } = render(ExitBehaviorControls);
    expect((rotate.match(/data-exit="/g) ?? []).length).toBe(4);
    expect(rotate).toContain('data-exit="rotate" aria-pressed="true"');
    expect(rotate).toContain('data-exit="jump" aria-pressed="false"');
    expect(rotate).toContain(t("exitRotateDesc"));
    for (const key of ["exitJumpSeconds", "exitSense", "exitFleeSpeed"]) expect(rotate).not.toContain(slider(t, key));
    const shown: Record<string, string[]> = { jump: ["exitJumpSeconds", "exitSense"], flee: ["exitSense", "exitFleeSpeed"], shrink: ["exitJumpSeconds"] };
    for (const [behavior, keys] of Object.entries(shown)) {
      const { html } = render(ExitBehaviorControls, { exitBehavior: behavior as ExitSplatFields["exitBehavior"] });
      expect(html, behavior).toContain(`data-exit="${behavior}" aria-pressed="true"`);
      expect(html, behavior).toContain(t("exitHoldNote"));
      for (const key of ["exitJumpSeconds", "exitSense", "exitFleeSpeed"]) expect(html.includes(slider(t, key)), `${behavior} ${key}`).toBe(keys.includes(key));
    }
    expect(render(ExitBehaviorControls, { exitBehavior: "jump", exitSense: 0 }).html).toContain(t("exitSenseOff"));
    // Only in the modes it applies to – but the search box finds it anywhere.
    expect(render(ExitBehaviorControls, { mode: "lines" }).html).toBe("");
    expect(render(ExitBehaviorControls, { mode: "box" }).html).toBe("");
    const found = render(ExitBehaviorControls, { mode: "lines" }, t("exitSense")).html;
    expect(found).toContain(slider(t, "exitSense"));
    expect(found).not.toContain("data-exit=");
  });

  it("Splat barrier: a switch, its sliders while it is on, and Grow's note", () => {
    const { html: off, t } = render(SplatBarrierControls);
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain(slider(t, "splatSize"));
    const on = render(SplatBarrierControls, { splatBarrier: true }).html;
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain(slider(t, "splatSize"));
    expect(on).toContain(slider(t, "splatMax"));
    expect(on).not.toContain(t("splatGrowNote"));
    expect(render(SplatBarrierControls, { mode: "grow", splatBarrier: true }).html).toContain(t("splatGrowNote"));
    for (const mode of ["shatter", "colorMatch", "box"] as const) expect(render(SplatBarrierControls, { mode }).html, mode).toBe("");
    expect(render(SplatBarrierControls, { mode: "shatter" }, t("splatMax")).html).toContain(slider(t, "splatMax"));
  });

  it("render in Polish and Spanish with their own words", () => {
    for (const [locale, messages] of [["pl", pl], ["es", es]] as const) {
      for (const exitBehavior of EXIT_BEHAVIORS) {
        const { html, t } = render(ExitBehaviorControls, { exitBehavior }, "", messages as Record<string, unknown>, locale);
        expect(html, `${locale} ${exitBehavior}`).toContain(t("exitBehavior"));
        expect(t("exitBehavior")).not.toBe((en.Controls as Record<string, string>).exitBehavior);
      }
      const { html, t } = render(SplatBarrierControls, { mode: "grow", splatBarrier: true }, "", messages as Record<string, unknown>, locale);
      expect(html, locale).toContain(t("splatGrowNote"));
      expect(t("splatBarrier")).not.toBe((en.Controls as Record<string, string>).splatBarrier);
    }
  });
});
