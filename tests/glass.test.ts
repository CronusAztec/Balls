import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  BOUNCE_MAX,
  BOUNCE_MIN,
  CELEBRATION_MS,
  DEFAULT_GLASS_SETTINGS,
  GLASS_RANGES,
  HIT_SPEED,
  HOME_CHORD,
  MAX_PANE_HP,
  MAX_SHARDS_PER_PANE,
  MAX_STAGE_ROWS,
  MIN_SHARDS_PER_PANE,
  PITCH_BASE_MIDI,
  SHAFT_ASPECT,
  TEMPO_SPREAD,
  buildGlassField,
  buildGlassLevel,
  cameraTarget,
  glassGravity,
  glassPitch,
  glassSettingFields,
  glassSettingsOf,
  hopSpeed,
  makeCrack,
  resolveGlassSettings,
  shardCount,
  solidSpan,
  stageAt,
  stageHoleChance,
  stageHp,
  stageMoveChance,
  stageRows,
  type GlassLevel,
  type GlassSettings,
} from "@/lib/physics/modes/glass";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { modeWallBreakSound, WALL_BREAK_SOUNDS, normalizeWallBreakSound } from "@/lib/audio/songs";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Glass Smash (lib/physics/modes/glass.ts): the settings (URL, presets, ranges), the stage progression, the level
 * generation and its determinism, the cracks and the shatter state, the sound events, the camera and the stages, the
 * HOME finish, a resize mid-run, the finder and the mode's default wall-break clip.
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

/** A seeded Mulberry32, like the engine's. */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function glassEngine(settings: Partial<GlassSettings> = {}, seed = 7, extra: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...extra }, "glass", { ...modeSettings, glass: settings }, seed);
}

/** Steps the engine until `done()` or `maxSec`, collecting the sound events; returns the simulated seconds. */
function runUntil(engine: PhysicsEngine, done: () => boolean, maxSec = 180, events: SoundEvent[] = []) {
  let t = 0;
  while (t < maxSec && !done()) {
    engine.update(1000 / 60, 0);
    t += 1 / 60;
    events.push(...engine.consumeSoundEvents());
  }
  return t;
}

/** Fingerprint of a level: every number that shapes it. */
function levelPrint(level: GlassLevel) {
  return {
    tempo: level.tempo,
    start: [level.startX, level.startY, level.startVx],
    home: { ...level.home },
    stages: level.stages.map((s) => ({ ...s })),
    panes: level.panes.map((p) => [p.kind, p.x, p.y, p.halfWidth, p.thickness, p.holeX, p.holeHalf, p.moveAmp, p.movePeriod, p.movePhase, p.maxHp, p.pitch]),
  };
}

describe("Glass Smash settings", () => {
  it("resolve to the defaults and clamp every value to a whole number in its range", () => {
    expect(resolveGlassSettings(undefined)).toEqual(DEFAULT_GLASS_SETTINGS);
    expect(resolveGlassSettings({ rows: 99, hp: 0, stages: 4.6, moving: "yes" as unknown as boolean, holes: false })).toEqual({ rows: 30, hp: 1, stages: 5, moving: DEFAULT_GLASS_SETTINGS.moving, holes: false });
    expect(resolveGlassSettings({ rows: Number.NaN })).toEqual(DEFAULT_GLASS_SETTINGS);
    expect(RANGES.glassRows).toEqual(GLASS_RANGES.glassRows);
    expect([GLASS_RANGES.glassRows.min, GLASS_RANGES.glassRows.max, GLASS_RANGES.glassHp.min, GLASS_RANGES.glassHp.max, GLASS_RANGES.glassStages.min, GLASS_RANGES.glassStages.max]).toEqual([3, 30, 1, 5, 1, 10]);
    expect(glassSettingsOf(glassSettingFields(DEFAULT_GLASS_SETTINGS))).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it("are part of the settings object, the URL (glr, glhp, gls, glm, glh) and presets", () => {
    const d = defaultSettings("glass");
    expect(glassSettingsOf(d)).toEqual(DEFAULT_GLASS_SETTINGS);
    // The other modes keep their defaults: the glass fields are simply there.
    expect(glassSettingsOf(defaultSettings("classic"))).toEqual(DEFAULT_GLASS_SETTINGS);
    const s: SimulatorSettings = { ...d, glassRows: 12, glassHp: 4, glassStages: 7, glassMoving: false, glassHoles: false };
    const params = settingsToSearchParams(s);
    expect(params.get("glr")).toBe("12");
    expect(params.get("glhp")).toBe("4");
    expect(params.get("gls")).toBe("7");
    expect(params.get("glm")).toBe("0");
    expect(params.get("glh")).toBe("0");
    expect(glassSettingsOf(settingsFromSearchParams(params))).toEqual({ rows: 12, hp: 4, stages: 7, moving: false, holes: false });
    // Defaults stay out of the link.
    const plain = settingsToSearchParams(d);
    for (const key of ["glr", "glhp", "gls", "glm", "glh"]) expect(plain.has(key)).toBe(false);
    // Out-of-range values from a link or a preset are clamped.
    expect(glassSettingsOf(settingsFromSearchParams(new URLSearchParams("mode=glass&glr=500&glhp=-3&gls=2.4")))).toEqual({ ...DEFAULT_GLASS_SETTINGS, rows: 30, hp: 1, stages: 2 });
    const preset = presetToSettings({ mode: "glass", glassRows: 1, glassHp: 9, glassStages: 0, glassHoles: "no" } as unknown as Partial<SimulatorSettings>);
    expect(glassSettingsOf(preset)).toEqual({ ...DEFAULT_GLASS_SETTINGS, rows: 3, hp: 5, stages: 1 });
  });
});

describe("Glass Smash progression", () => {
  it("adds panes every stage, thickens the glass every other stage and brings holes and sliding panes in later", () => {
    expect([0, 1, 2, 3, 9].map((s) => stageRows(6, s))).toEqual([6, 8, 10, 12, 24]);
    expect(stageRows(30, 5)).toBe(MAX_STAGE_ROWS);
    expect([0, 1, 2, 3, 4, 5, 9].map((s) => stageHp(2, s))).toEqual([2, 2, 3, 3, 4, 4, 4]);
    expect(stageHp(5, 9)).toBe(MAX_PANE_HP);
    const on = { ...DEFAULT_GLASS_SETTINGS, holes: true, moving: true };
    expect([0, 1, 4].map((s) => stageHoleChance(on, s))).toEqual([0, 0.3, 0.45]);
    expect([0, 1, 2, 5].map((s) => stageMoveChance(on, s))).toEqual([0, 0, 0.3, 0.4]);
    expect(stageHoleChance({ ...on, holes: false }, 5)).toBe(0);
    expect(stageMoveChance({ ...on, moving: false }, 5)).toBe(0);
  });

  it("pitches a hit by row as a major-scale degree from C4, a stage two degrees higher, within two octaves", () => {
    const midi = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440));
    expect(midi(glassPitch(0, 0))).toBe(PITCH_BASE_MIDI);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => midi(glassPitch(0, r)) - PITCH_BASE_MIDI)).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(glassPitch(1, 0)).toBeCloseTo(glassPitch(0, 2), 9);
    for (let s = 0; s < 10; s++) {
      for (let r = 0; r < 30; r++) {
        const m = midi(glassPitch(s, r));
        expect(m).toBeGreaterThanOrEqual(PITCH_BASE_MIDI);
        expect(m).toBeLessThanOrEqual(PITCH_BASE_MIDI + 24);
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(m % 12);
      }
    }
    expect(HOME_CHORD.map(midi)).toEqual([72, 76, 79, 84]);
  });

  it("breaks a pane into 8–20 shards", () => {
    for (const w of [0, 0.3, 0.62, 1]) {
      for (const hp of [1, 3, MAX_PANE_HP]) {
        for (const u of [0, 0.5, 0.999]) {
          const n = shardCount(w, hp, u);
          expect(n).toBeGreaterThanOrEqual(MIN_SHARDS_PER_PANE);
          expect(n).toBeLessThanOrEqual(MAX_SHARDS_PER_PANE);
        }
      }
    }
    expect(shardCount(1, MAX_PANE_HP, 0.999)).toBe(MAX_SHARDS_PER_PANE);
  });
});

describe("Glass Smash level generation", () => {
  it("fits a portrait shaft into the centred square the recorder crops to", () => {
    for (const [w, h] of [
      [800, 600],
      [600, 900],
      [1080, 1920],
    ]) {
      const f = buildGlassField(w, h);
      const side = Math.min(w, h);
      expect(f.height).toBeLessThanOrEqual(side);
      expect(f.width / f.height).toBeCloseTo(SHAFT_ASPECT, 9);
      expect(f.left).toBeGreaterThanOrEqual((w - side) / 2);
      expect(f.right).toBeLessThanOrEqual((w + side) / 2);
      expect(f.top).toBeGreaterThanOrEqual((h - side) / 2);
      expect(f.bottom).toBeLessThanOrEqual((h + side) / 2);
      expect(f.cx).toBeCloseTo(w / 2, 9);
    }
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const a = buildGlassLevel(800, 600, { stages: 6 }, 8, rng(42));
    const b = buildGlassLevel(800, 600, { stages: 6 }, 8, rng(42));
    const c = buildGlassLevel(800, 600, { stages: 6 }, 8, rng(43));
    expect(levelPrint(a)).toEqual(levelPrint(b));
    expect(levelPrint(a)).not.toEqual(levelPrint(c));
    expect(Math.abs(a.tempo - 1)).toBeLessThanOrEqual(TEMPO_SPREAD / 2);
  });

  it("stacks the stages with their panes inside the shaft, and HOME below the last one", () => {
    for (const settings of [DEFAULT_GLASS_SETTINGS, { rows: 30, hp: 5, stages: 10, moving: true, holes: true }, { rows: 3, hp: 1, stages: 1, moving: false, holes: false }]) {
      for (const radius of [4, 8, 30]) {
        const level = buildGlassLevel(800, 600, settings, radius, rng(5));
        const f = level.field;
        expect(level.stages).toHaveLength(settings.stages);
        expect(level.stages[0].top).toBe(f.top);
        let paneCount = 0;
        level.stages.forEach((st, s) => {
          expect(st.rows).toBe(stageRows(settings.rows, s));
          expect(st.hp).toBe(stageHp(settings.hp, s));
          if (s > 0) expect(st.top).toBe(level.stages[s - 1].bottom);
          expect(st.bounceHeight).toBeGreaterThanOrEqual(BOUNCE_MIN * f.height * (1 - TEMPO_SPREAD / 2) ** 2 - 1e-9);
          expect(st.bounceHeight).toBeLessThanOrEqual(BOUNCE_MAX * f.height * (1 + TEMPO_SPREAD / 2) ** 2 + 1e-9);
          // The ball fits between two panes.
          expect(st.spacing).toBeGreaterThan(2 * radius + level.panes[st.firstPane].thickness);
          paneCount += st.rows;
        });
        expect(level.panes).toHaveLength(paneCount);
        for (const pane of level.panes) {
          const st = level.stages[pane.stage];
          expect(pane.y).toBeGreaterThan(st.top);
          expect(pane.y).toBeLessThan(st.bottom);
          expect(pane.hp).toBe(st.hp);
          expect(pane.baseX - pane.halfWidth - pane.moveAmp).toBeGreaterThanOrEqual(f.left - 1e-9);
          expect(pane.baseX + pane.halfWidth + pane.moveAmp).toBeLessThanOrEqual(f.right + 1e-9);
          if (pane.row === 0) expect(pane.kind).toBe("plain");
          if (pane.kind === "hole") {
            // A hole the ball fits through, away from the walls.
            expect(2 * pane.holeHalf).toBeGreaterThanOrEqual(2 * radius + pane.thickness);
            expect(pane.x + pane.holeX - pane.holeHalf).toBeGreaterThan(f.left);
            expect(pane.x + pane.holeX + pane.holeHalf).toBeLessThan(f.right);
            expect(pane.segments).toHaveLength(2);
          } else expect(pane.segments).toHaveLength(1);
          if (pane.kind === "hole") expect(pane.stage).toBeGreaterThanOrEqual(settings.holes ? 1 : 99);
          if (pane.kind === "moving") expect(pane.stage).toBeGreaterThanOrEqual(settings.moving ? 2 : 99);
        }
        const last = level.stages[level.stages.length - 1];
        expect(level.home.top).toBe(last.bottom);
        expect(level.home.groundY).toBeGreaterThan(last.bottom);
        expect(level.home.doorX - level.home.doorWidth / 2).toBeGreaterThanOrEqual(f.left);
        expect(level.home.doorX + level.home.doorWidth / 2).toBeLessThanOrEqual(f.right);
        expect(level.home.doorHeight).toBeGreaterThan(2 * radius);
        expect(stageAt(level, f.top + 1)).toBe(0);
        expect(stageAt(level, level.home.groundY)).toBe(settings.stages);
      }
    }
  });

  it("brings holes and sliding panes into the later stages when they are on", () => {
    const level = buildGlassLevel(800, 600, { rows: 20, stages: 6, holes: true, moving: true }, 8, rng(3));
    const kinds = (stage: number) => level.panes.filter((p) => p.stage === stage).map((p) => p.kind);
    expect(kinds(0).every((k) => k === "plain")).toBe(true);
    expect(kinds(1)).toContain("hole");
    expect(kinds(1)).not.toContain("moving");
    expect(kinds(3)).toContain("moving");
    const off = buildGlassLevel(800, 600, { rows: 20, stages: 6, holes: false, moving: false }, 8, rng(3));
    expect(off.panes.every((p) => p.kind === "plain")).toBe(true);
  });
});

describe("Glass Smash cracks", () => {
  const level = buildGlassLevel(800, 600, { rows: 10, stages: 3, holes: true }, 8, rng(11));
  const plain = level.panes[0];
  const holed = level.panes.find((p) => p.kind === "hole")!;

  it("grow from the impact point inside the glass, deterministic for the random numbers", () => {
    const a = makeCrack(plain, 12, true, 0.5, 100, rng(9));
    const b = makeCrack(plain, 12, true, 0.5, 100, rng(9));
    const c = makeCrack(plain, 12, true, 0.5, 100, rng(10));
    expect([...a.segs.slice(0, 5 * a.count)]).toEqual([...b.segs.slice(0, 5 * b.count)]);
    expect([...a.segs.slice(0, 5 * a.count)]).not.toEqual([...c.segs.slice(0, 5 * c.count)]);
    expect(a.count).toBeGreaterThanOrEqual(3);
    expect(a.atMs).toBe(100);
    expect(a.x).toBeCloseTo(12, 9);
    expect(a.y).toBeLessThan(0); // on the top face
    const half = plain.thickness / 2;
    let longest = 0;
    for (let i = 0; i < a.count; i++) {
      const o = 5 * i;
      for (const y of [a.segs[o + 1], a.segs[o + 3]]) expect(Math.abs(y)).toBeLessThanOrEqual(half + 1e-4);
      for (const x of [a.segs[o], a.segs[o + 2]]) expect(Math.abs(x)).toBeLessThanOrEqual(plain.halfWidth + 1e-4);
      longest = Math.max(longest, a.segs[o + 4]);
    }
    expect(a.length).toBeCloseTo(longest, 4);
    // From the underside the crack starts on the bottom face.
    expect(makeCrack(plain, 0, false, 0.2, 0, rng(1)).y).toBeGreaterThan(0);
  });

  it("get longer as the pane takes more damage", () => {
    let early = 0;
    let late = 0;
    for (let seed = 1; seed <= 40; seed++) {
      early += makeCrack(plain, 0, true, 0.1, 0, rng(seed)).length;
      late += makeCrack(plain, 0, true, 1, 0, rng(seed)).length;
    }
    expect(late).toBeGreaterThan(1.5 * early);
  });

  it("never run across a hole", () => {
    const leftOfHole = holed.holeX - holed.holeHalf - 4;
    const [lo, hi] = solidSpan(holed, leftOfHole);
    expect(hi).toBeCloseTo(holed.holeX - holed.holeHalf, 9);
    for (let seed = 1; seed <= 20; seed++) {
      const crack = makeCrack(holed, leftOfHole, true, 1, 0, rng(seed));
      for (let i = 0; i < crack.count; i++) {
        const o = 5 * i;
        for (const x of [crack.segs[o], crack.segs[o + 2]]) {
          expect(x).toBeGreaterThanOrEqual(lo - 1e-4);
          expect(x).toBeLessThanOrEqual(hi + 1e-4);
        }
      }
    }
  });
});

describe("GlassMode in the engine", () => {
  it("is registered as a mode of the sound-first family, at the end of its cards", () => {
    expect(MODE_IDS).toContain("glass");
    expect(MODE_CARD_ORDER).toContain("glass");
    expect(MODE_CATEGORIES.glass).toBe("rhythm");
    // The escape family ends with the multipliers board (boris-multipliers); the sound-first family ends with Glass Smash.
    expect(modesInCategory("rhythm").at(-1)).toBe("glass");
    expect(modesInCategory("escape")).not.toContain("glass");
  });

  it("starts one ball at the top of the shaft under the mode's own gravity, with walls and a ground but no rings", () => {
    const engine = glassEngine();
    expect(engine.isGlassMode()).toBe(true);
    expect(engine.getCircularWalls()).toHaveLength(0);
    expect(engine.getObstacles()).toHaveLength(3);
    const balls = engine.getBalls();
    expect(balls).toHaveLength(1);
    const view = engine.getGlassView();
    const level = view.level!;
    expect(balls[0].gravityScale).toBe(0);
    expect(balls[0].x).toBeCloseTo(level.startX, 9);
    expect(balls[0].y).toBeCloseTo(level.startY, 9);
    expect(view.panes).toBe(level.panes.length);
    expect(view.cameraY).toBe(0);
    // It falls: the mode integrates gravity itself.
    for (let i = 0; i < 10; i++) engine.update(1000 / 60, 0);
    expect(engine.getBalls()[0].vy).toBeGreaterThan(0);
    const g = glassGravity(300, level.field.height);
    expect(engine.getBalls()[0].vy).toBeCloseTo((g * 10) / 60, 0);
  });

  it("cracks a pane on every landing and shatters it on the last hit, with notes, an accent and the wall-break sound", () => {
    const engine = glassEngine({ hp: 3, holes: false, moving: false });
    const view = engine.getGlassView();
    const first = view.level!.panes[0];
    const events: SoundEvent[] = [];
    const cracksAtHit: number[] = [];
    runUntil(engine, () => {
      if (first.hits > cracksAtHit.length) cracksAtHit.push(first.cracks.length);
      return first.shattered;
    }, 30, events);
    expect(first.shattered).toBe(true);
    expect(first.hits).toBe(3);
    expect(first.hp).toBe(0);
    expect(first.cracks).toHaveLength(3);
    expect(cracksAtHit).toEqual([1, 2, 3]);
    expect(first.cleared).toBe(true);
    expect(view.shattered).toBe(1);
    // Two plain notes pitched by the row, then the accent and a "gap" (the wall-break clip) on the shatter.
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.slice(0, 3).map((e) => e.frequency)).toEqual([first.pitch, first.pitch, first.pitch]);
    expect(hits.slice(0, 3).map((e) => !!e.accent)).toEqual([false, false, true]);
    expect(events.filter((e) => e.type === "gap")).toHaveLength(1);
    // 8–20 shards are flying.
    expect(view.shardCount).toBeGreaterThanOrEqual(MIN_SHARDS_PER_PANE);
    expect(view.shardCount).toBeLessThanOrEqual(MAX_SHARDS_PER_PANE);
    // The ball crashes on through the gap the pane left.
    const ball = engine.getBalls()[0];
    expect(ball.vy).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) engine.update(1000 / 60, 0);
    expect(engine.getBalls()[0].y).toBeGreaterThan(first.y);
  });

  it("hops back to the stage's hop height after a landing", () => {
    const engine = glassEngine({ hp: 5, holes: false, moving: false });
    const view = engine.getGlassView();
    const first = view.level!.panes[0];
    runUntil(engine, () => first.hits >= 1, 10);
    // The apex of the next hop.
    let top = Infinity;
    runUntil(engine, () => {
      top = Math.min(top, engine.getBalls()[0].y);
      return first.hits >= 2;
    }, 10);
    const ball = engine.getBalls()[0];
    const rest = first.y - first.thickness / 2 - ball.radius;
    const height = view.level!.stages[0].bounceHeight;
    expect(rest - top).toBeGreaterThan(0.85 * height);
    expect(rest - top).toBeLessThan(1.15 * height);
    expect(hopSpeed(glassGravity(300, view.level!.field.height), height)).toBeGreaterThan(40);
  });

  it("counts a slow touch from above as a landing, so the ball can never come to rest on the glass", () => {
    const engine = glassEngine({ hp: 3, holes: false, moving: false });
    const level = engine.getGlassView().level!;
    const first = level.panes[0];
    const ball = engine.getBalls()[0];
    // Set down on the pane far slower than HIT_SPEED: it still cracks the pane and hops back up.
    ball.x = first.x;
    ball.y = first.y - first.thickness / 2 - ball.radius + 0.5;
    ball.vx = 0;
    ball.vy = 1;
    engine.update(1000 / 60, 0);
    expect([first.hits, first.hp, first.cracks.length]).toEqual([1, 2, 1]);
    expect(ball.vy).toBeLessThan(-HIT_SPEED);
    // The full hop, less the gravity of what was left of the step after the landing.
    const g = glassGravity(300, level.field.height);
    const hop = hopSpeed(g, level.stages[0].bounceHeight);
    expect(ball.vy).toBeGreaterThanOrEqual(-hop - 1e-6);
    expect(ball.vy).toBeLessThanOrEqual(-hop + g / 60 + 1e-6);
    // Resting on the rounded end of a hole's glass (the grazed edge the stuck runs sat on) is a landing too.
    const holes = glassEngine({ stages: 3, holes: true, moving: false }, 3);
    const pane = holes.getGlassView().level!.panes.find((p) => p.kind === "hole")!;
    expect(pane).toBeDefined();
    const seg = pane.segments[1];
    const b = holes.getBalls()[0];
    const reach = b.radius + seg.thickness / 2;
    b.x = seg.x - seg.halfLength - 0.6 * reach;
    b.y = seg.y - 0.8 * reach + 0.3;
    b.vx = 0;
    b.vy = 0;
    holes.update(1000 / 60, 0);
    expect(pane.hits).toBe(1);
    expect(b.vy).toBeLessThan(-HIT_SPEED);
    // A slow knock from below is still only a push: the ball drops away without cracking anything.
    const below = glassEngine({ hp: 3, holes: false, moving: false });
    const second = below.getGlassView().level!.panes[1];
    const b2 = below.getBalls()[0];
    b2.x = second.x;
    b2.y = second.y + second.thickness / 2 + b2.radius - 0.5;
    b2.vx = 0;
    b2.vy = -1;
    below.update(1000 / 60, 0);
    expect(second.hits).toBe(0);
    expect(b2.vy).toBeGreaterThan(0);
  });

  it("finishes the runs that used to come to rest on an unbroken pane (regression)", () => {
    // These runs settled on a pane – contacts slower than HIT_SPEED only damped the ball's bounce – and never reached
    // HOME: seed 209979 with the defaults (from ~26 s on a hole pane, 2 of 2 hit points left) and four 10-stage seeds.
    const cases: [Partial<GlassSettings>, number][] = [
      [{}, 209979],
      [{ stages: 10 }, 30],
      [{ stages: 10 }, 41],
      [{ stages: 10 }, 69],
      [{ stages: 10 }, 82],
    ];
    for (const [settings, seed] of cases) {
      const engine = glassEngine(settings, seed);
      runUntil(engine, () => engine.isSimulationFinished(), 180);
      expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
      expect(engine.getGlassView().homeReached, `seed ${seed}`).toBe(true);
    }
    // And with the canvas resized under it mid-run.
    const resized = glassEngine({}, 209979);
    runUntil(resized, () => resized.getElapsedMs() >= 12000, 20);
    resized.setConfig({ width: 1080, height: 1920 });
    runUntil(resized, () => resized.isSimulationFinished(), 180);
    expect(resized.isSimulationFinished()).toBe(true);
  }, 60000);

  it("smashes through every stage, scrolls the camera down and ends at HOME with a chord and a celebration", () => {
    const engine = glassEngine({ rows: 4, hp: 1, stages: 3, holes: false, moving: false }, 21);
    const view = engine.getGlassView();
    const level = view.level!;
    const events: SoundEvent[] = [];
    const stagesSeen: number[] = [];
    let banners = 0;
    let lastBanner = view.bannerAtMs;
    let cameraMax = 0;
    const seconds = runUntil(engine, () => {
      if (stagesSeen[stagesSeen.length - 1] !== view.stage) stagesSeen.push(view.stage);
      if (view.bannerAtMs !== lastBanner) {
        banners++;
        lastBanner = view.bannerAtMs;
      }
      cameraMax = Math.max(cameraMax, view.cameraY);
      return engine.isSimulationFinished();
    }, 120, events);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(seconds).toBeLessThan(120);
    expect(stagesSeen).toEqual([0, 1, 2, 3]);
    expect(banners).toBe(2); // stages 2 and 3 (stage 1 shows from the start)
    // Without holes or sliding panes every pane shatters.
    expect(view.shattered).toBe(level.panes.length);
    expect(view.cleared).toBe(level.panes.length);
    expect(view.hits).toBe(level.panes.reduce((sum, p) => sum + p.maxHp, 0));
    expect(view.homeReached).toBe(true);
    expect(view.timeMs - view.homeAtMs).toBeGreaterThanOrEqual(CELEBRATION_MS - 20);
    // The camera ends on the ground and the ball stands in the doorway.
    expect(cameraMax).toBeGreaterThan(level.home.groundY - level.field.bottom - 5);
    expect(view.cameraY).toBeCloseTo(cameraTarget(level, level.stages.length, 0), 0);
    const ball = engine.getBalls()[0];
    expect(ball.x).toBeCloseTo(level.home.doorX, 6);
    expect(Math.abs(ball.y + ball.radius - level.home.groundY)).toBeLessThan(1);
    const chord = events.find((e) => e.chord && e.chord.length === HOME_CHORD.length);
    expect(chord?.accent).toBe(true);
    // The run holds still once it is over.
    const at = [ball.x, ball.y];
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    expect([engine.getBalls()[0].x, engine.getBalls()[0].y]).toEqual(at);
  });

  it("keeps the ball inside the shaft and in view the whole run, holes and sliding panes included", () => {
    for (const seed of [1, 2, 3]) {
      const engine = glassEngine({ rows: 8, stages: 5, holes: true, moving: true }, seed);
      const view = engine.getGlassView();
      const f = view.level!.field;
      runUntil(engine, () => {
        const ball = engine.getBalls()[0];
        expect(ball.x).toBeGreaterThanOrEqual(f.left + ball.radius - 1e-6);
        expect(ball.x).toBeLessThanOrEqual(f.right - ball.radius + 1e-6);
        expect(ball.y - view.cameraY).toBeGreaterThanOrEqual(f.top);
        expect(ball.y - view.cameraY).toBeLessThanOrEqual(f.bottom);
        return engine.isSimulationFinished();
      }, 200);
      expect(engine.isSimulationFinished()).toBe(true);
      expect(view.cleared).toBe(view.panes);
    }
  });

  it("slides the sliding panes left and right on the simulation clock, inside the shaft", () => {
    const engine = glassEngine({ rows: 20, stages: 5, moving: true, holes: false }, 4);
    const level = engine.getGlassView().level!;
    const moving = level.panes.filter((p) => p.kind === "moving");
    expect(moving.length).toBeGreaterThan(0);
    const before = moving.map((p) => p.x);
    for (let i = 0; i < 40; i++) engine.update(1000 / 60, 0);
    const after = moving.map((p) => p.x);
    expect(after).not.toEqual(before);
    for (const p of moving) {
      expect(p.x - p.halfWidth).toBeGreaterThanOrEqual(level.field.left - 1e-9);
      expect(p.x + p.halfWidth).toBeLessThanOrEqual(level.field.right + 1e-9);
      expect(p.segments[0].x).toBeCloseTo(p.x, 9);
    }
  });

  it("replays a seed exactly: the same cracks, shards, camera and length", () => {
    const run = (seed: number) => {
      const engine = glassEngine({}, seed);
      const view = engine.getGlassView();
      const seconds = runUntil(engine, () => engine.isSimulationFinished(), 120);
      const cracks = view.level!.panes.flatMap((p) => p.cracks.map((c) => [c.x, c.y, c.atMs, c.length, c.count]));
      return { seconds, hits: view.hits, shattered: view.shattered, cracks, camera: view.cameraY, ball: [engine.getBalls()[0].x, engine.getBalls()[0].y] };
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99).seconds).not.toBe(run(100).seconds);
  });

  it("keeps the level in place across a canvas resize mid-run and still reaches HOME", () => {
    const engine = glassEngine({ rows: 5, stages: 2, hp: 2 }, 8);
    const view = engine.getGlassView();
    for (let i = 0; i < 90; i++) engine.update(1000 / 60, 0);
    const level = view.level!;
    const old = { ...level.field };
    const rel = (x: number, y: number, f: typeof old) => [(x - f.cx) / f.height, (y - f.top) / f.height];
    const pane = level.panes[level.panes.length - 1];
    const paneBefore = rel(pane.x, pane.y, old);
    const ballBefore = rel(engine.getBalls()[0].x, engine.getBalls()[0].y, old);
    const cameraBefore = view.cameraY / old.height;
    engine.setConfig({ width: 1200, height: 1500 });
    const next = view.level!.field;
    expect(next.height).not.toBeCloseTo(old.height, 3);
    const paneAfter = rel(pane.x, pane.y, next);
    const ballAfter = rel(engine.getBalls()[0].x, engine.getBalls()[0].y, next);
    paneAfter.forEach((v, i) => expect(v).toBeCloseTo(paneBefore[i], 9));
    ballAfter.forEach((v, i) => expect(v).toBeCloseTo(ballBefore[i], 9));
    expect(view.cameraY / next.height).toBeCloseTo(cameraBefore, 9);
    expect(pane.thickness / next.height).toBeCloseTo(buildGlassLevel(800, 600, { rows: 5, stages: 2, hp: 2 }, 8, rng(1)).panes[level.panes.length - 1].thickness / old.height, 9);
    runUntil(engine, () => engine.isSimulationFinished(), 120);
    expect(engine.isSimulationFinished()).toBe(true);
  });

  it("lays the level out afresh for a resize before the first step: the run is the one an engine of that size plays", () => {
    const resized = glassEngine({ rows: 8, stages: 3 }, 17);
    resized.setConfig({ width: 900, height: 1400 });
    const direct = glassEngine({ rows: 8, stages: 3 }, 17, { width: 900, height: 1400 });
    expect(levelPrint(resized.getGlassView().level!)).toEqual(levelPrint(direct.getGlassView().level!));
    expect([resized.getBalls()[0].x, resized.getBalls()[0].y]).toEqual([direct.getBalls()[0].x, direct.getBalls()[0].y]);
    const a = runUntil(resized, () => resized.isSimulationFinished(), 120);
    const b = runUntil(direct, () => direct.isSimulationFinished(), 120);
    expect(a).toBe(b);
    expect(resized.getGlassView().hits).toBe(direct.getGlassView().hits);
  });

  it("restarts from the settings of the last init only", () => {
    const engine = glassEngine({ rows: 5, stages: 2 }, 3);
    engine.setGlassSettings({ rows: 9 });
    expect(engine.getGlassView().level!.stages[0].rows).toBe(5);
    engine.initMode("glass");
    expect(engine.getGlassView().level!.stages[0].rows).toBe(9);
    expect(engine.getGlassSettings().rows).toBe(9);
  });
});

describe("Glass Smash and the finder", () => {
  it("is never endless: every run ends at HOME, so seeds are searched", () => {
    expect(runNeverFinishes("glass", { drop: {}, box: {} })).toBe(false);
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 90, physicsConfig: config, mode: "glass", modeSettings: { ...modeSettings, glass: { rows: 4, stages: 2 } } };
    const a = simulateSeed(5, request, 90000);
    expect(a).toBeLessThan(90000);
    expect(simulateSeed(5, request, 90000)).toBe(a);
    // The same seed in a fresh engine replays to the same length (what the page relies on after a search).
    const engine = createEngineForSettings(config, "glass", request.modeSettings, 5);
    const seconds = runUntil(engine, () => engine.isSimulationFinished(), 90);
    expect(Math.abs(seconds * 1000 - a)).toBeLessThan(1000 / 60 + 1e-6);
  });

  it("spreads the default run lengths around 30 s, so a 30 s clip can be found", () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 90, physicsConfig: config, mode: "glass", modeSettings: { ...modeSettings, glass: {} } };
    const lengths = Array.from({ length: 16 }, (_, i) => simulateSeed(1000 + i, request, 90000) / 1000);
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    expect(min).toBeLessThan(30);
    expect(max).toBeGreaterThan(27);
    expect(max - min).toBeGreaterThan(2);
    expect(new Set(lengths.map((l) => l.toFixed(2))).size).toBeGreaterThan(10);
  });
});

describe("Glass Smash sounds", () => {
  it("uses the glass clip as the wall-break sound unless one was chosen", () => {
    const glass = WALL_BREAK_SOUNDS.find((s) => s.id === "glass")!;
    expect(glass.url).toMatch(/\/wallBreak\/glass\.wav$/);
    expect(modeWallBreakSound("glass", null)).toBe(glass.url);
    expect(modeWallBreakSound("glass", WALL_BREAK_SOUNDS[0].url)).toBe(WALL_BREAK_SOUNDS[0].url);
    expect(modeWallBreakSound("classic", null)).toBeNull();
    expect(normalizeWallBreakSound("/Old/wallBreak/glass.wav")).toBe(glass.url);
  });
});
