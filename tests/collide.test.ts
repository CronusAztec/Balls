import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  ANTI_COLLISION_CHORD,
  COLLIDE_PITCH_BASE_MIDI,
  COLLIDE_PITCH_DEGREES,
  COLLIDE_RANGES,
  COLLIDE_SOFT_LEVEL,
  DEFAULT_COLLIDE_SETTINGS,
  HUE_BUCKETS,
  MAX_SOUNDS_PER_FRAME,
  MAX_SQUASH,
  RING_MAX_BODIES,
  SIZE_SPREAD_RATIO,
  SQUASH_MS,
  buildCollideField,
  collideLevel,
  collidePitch,
  collideSettingFields,
  collideSettingsOf,
  fieldArea,
  placeWithoutOverlap,
  resolveCollideSettings,
  sizeFactor,
  squashAmount,
  squashAt,
  squashScaleAcross,
  squashScaleAlong,
  syncGridCells,
  syncGridPitch,
  type CollideSettings,
} from "@/lib/physics/modes/collide";
import { advanceRing, contactArc, createRingTrack, renormalizeRing, resolveRingContacts, ringKineticEnergy, ringLength, ringMomentum, sortRingOrder, type RingTrack } from "@/lib/physics/ringTrack";
import { MAX_GRID_DIM, SpatialHash, createPairBuffer } from "@/lib/physics/spatialHash";
import { MODE_IDS, type Ball, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { frequencyToMidi } from "@/lib/audio/scales";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator, hitLevel } from "@/lib/audio/toneGenerator";
import { createEngineForSettings, findSimulation, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/* ------------------------------------------------------------------ helpers */

/** Mulberry32, for random test layouts independent of the engine. */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const config: PhysicsConfig = { width: 900, height: 506, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

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

function collideEngine(settings: Partial<CollideSettings> = {}, seed = 7, patch: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...patch }, "collide", { ...modeSettings, collide: settings }, seed);
}

function step(engine: PhysicsEngine, frames: number) {
  for (let i = 0; i < frames; i++) engine.update(1000 / 60, 0);
}

function kineticEnergy(balls: Ball[]) {
  return balls.reduce((sum, b) => sum + 0.5 * b.radius * b.radius * (b.vx * b.vx + b.vy * b.vy), 0);
}

function maxOverlap(balls: Ball[]) {
  let worst = 0;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
      worst = Math.max(worst, balls[i].radius + balls[j].radius - d);
    }
  }
  return worst;
}

function bruteForcePairs(xs: number[], ys: number[], rs: number[], margin: number) {
  const out = new Set<string>();
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const reach = rs[i] + rs[j] + margin;
      if ((xs[j] - xs[i]) ** 2 + (ys[j] - ys[i]) ** 2 < reach * reach) out.add(`${i}-${j}`);
    }
  }
  return out;
}

/** Midi notes of the collision pitch ladder (C major pentatonic from C3). */
const LADDER = new Set(Array.from({ length: COLLIDE_PITCH_DEGREES }, (_, d) => COLLIDE_PITCH_BASE_MIDI + 12 * Math.floor(d / 5) + [0, 2, 4, 7, 9][d % 5]));

/* ------------------------------------------------------------------ spatial hash */

describe("SpatialHash", () => {
  it("finds exactly the overlapping pairs a brute-force check finds, each pair once", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = rng(seed);
      const n = 150 + Math.floor(random() * 250);
      const xs: number[] = [];
      const ys: number[] = [];
      const rs: number[] = [];
      for (let i = 0; i < n; i++) {
        xs.push(400 * random());
        ys.push(300 * random());
        rs.push(2 + 10 * random() ** 2);
      }
      const maxR = Math.max(...rs);
      const margin = 1;
      const hash = new SpatialHash();
      hash.build(xs, ys, n, 2 * maxR + margin, 0, 0, 400, 300);
      const buffer = createPairBuffer(4);
      const count = hash.collectContacts(xs, ys, rs, margin, buffer);
      const found = new Set<string>();
      for (let p = 0; p < count; p++) {
        const i = buffer.pairs[2 * p];
        const j = buffer.pairs[2 * p + 1];
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        expect(found.has(key)).toBe(false);
        found.add(key);
      }
      expect(found).toEqual(bruteForcePairs(xs, ys, rs, margin));
      // The buffer grew from its tiny start without losing pairs.
      expect(buffer.pairs.length).toBeGreaterThanOrEqual(2 * count);
    }
  });

  it("visits every pair in the same or adjacent cells once, and no pair further apart", () => {
    const random = rng(9);
    const n = 200;
    const xs = Array.from({ length: n }, () => 100 * random());
    const ys = Array.from({ length: n }, () => 100 * random());
    const cell = 10;
    const hash = new SpatialHash();
    hash.build(xs, ys, n, cell, 0, 0, 100, 100);
    const seen = new Set<string>();
    hash.forEachNearbyPair((i, j) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    });
    const cellOf = (v: number) => Math.min(9, Math.floor(v / cell));
    let expected = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const near = Math.abs(cellOf(xs[i]) - cellOf(xs[j])) <= 1 && Math.abs(cellOf(ys[i]) - cellOf(ys[j])) <= 1;
        if (near) expected++;
        expect(seen.has(`${i}-${j}`)).toBe(near);
      }
    }
    expect(seen.size).toBe(expected);
  });

  it("clamps points outside the bounds into the border cells and caps the grid size", () => {
    const hash = new SpatialHash();
    // Two touching discs far outside the bounds on the same side are still found.
    const xs = [-500, -497, 50];
    const ys = [20, 20, 50];
    const rs = [2, 2, 2];
    hash.build(xs, ys, 3, 10, 0, 0, 100, 100);
    const buffer = createPairBuffer();
    expect(hash.collectContacts(xs, ys, rs, 0, buffer)).toBe(1);
    expect([buffer.pairs[0], buffer.pairs[1]].sort()).toEqual([0, 1]);
    expect(hash.cellCount(0, 2)).toBe(2);
    // A cell size far too small for the bounds is enlarged to keep the grid at most MAX_GRID_DIM wide.
    hash.build(xs, ys, 3, 1e-6, 0, 0, 100, 100);
    expect(hash.getGridSize().cols).toBeLessThanOrEqual(MAX_GRID_DIM);
    expect(hash.getGridSize().rows).toBeLessThanOrEqual(MAX_GRID_DIM);
    // NaN coordinates land in a valid cell instead of breaking the build.
    hash.build([Number.NaN, 5], [5, 5], 2, 10, 0, 0, 100, 100);
    expect(hash.size).toBe(2);
    expect(hash.cellCount(0, 0)).toBe(2);
  });
});

/* ------------------------------------------------------------------ ring track (1-D collisions) */

function ringOf(bodies: { s: number; v: number; r: number }[], radius = 100): RingTrack {
  const track = createRingTrack(bodies.length, radius);
  bodies.forEach((b, i) => {
    track.s[i] = b.s;
    track.v[i] = b.v;
    track.r[i] = b.r;
    track.invMass[i] = 1 / (b.r * b.r);
  });
  sortRingOrder(track);
  return track;
}

describe("ring track (1-D collisions on a circle)", () => {
  it("measures the contact distance along the track so the drawn discs just touch", () => {
    const R = 100;
    const arc = contactArc(6, 9, R);
    expect(2 * R * Math.sin(arc / (2 * R))).toBeCloseTo(15, 9);
    expect(arc).toBeGreaterThan(15);
    // Discs too big for the track are capped at half a circumference; no track falls back to the sum of radii.
    expect(contactArc(150, 150, R)).toBeCloseTo(Math.PI * R, 9);
    expect(contactArc(3, 4, 0)).toBe(7);
  });

  it("swaps the velocities of two equal bodies in an elastic head-on collision", () => {
    const track = ringOf([
      { s: 10, v: 100, r: 5 },
      { s: 19, v: -50, r: 5 },
    ]);
    const hits: number[] = [];
    const impacts = resolveRingContacts(track, 1, 4, (_a, _b, speed) => hits.push(speed));
    expect(impacts).toBe(1);
    expect(hits[0]).toBeCloseTo(150, 9);
    expect(track.v[0]).toBeCloseTo(-50, 9);
    expect(track.v[1]).toBeCloseTo(100, 9);
    // The overlap is pushed apart to exactly touching.
    expect(track.s[1] - track.s[0]).toBeCloseTo(contactArc(5, 5, 100), 9);
  });

  it("conserves momentum for unequal masses, and kinetic energy only when elastic", () => {
    for (const e of [1, 0.8]) {
      const track = ringOf([
        { s: 0, v: 200, r: 8 },
        { s: 11, v: -30, r: 4 },
      ]);
      const p0 = ringMomentum(track);
      const k0 = ringKineticEnergy(track);
      resolveRingContacts(track, e);
      expect(ringMomentum(track)).toBeCloseTo(p0, 6);
      const m1 = 64;
      const m2 = 16;
      const mu = (m1 * m2) / (m1 + m2);
      // Energy lost in a 1-D collision: ½ μ (1 − e²) v_rel².
      expect(k0 - ringKineticEnergy(track)).toBeCloseTo(0.5 * mu * (1 - e * e) * 230 * 230, 3);
    }
  });

  it("lets the last and the first body collide across the seam of the track", () => {
    const R = 50;
    const L = 2 * Math.PI * R;
    const track = ringOf([
      { s: 2, v: -80, r: 4 },
      { s: 100, v: 0, r: 4 },
      { s: L - 4, v: 80, r: 4 },
    ], R);
    const impacts = resolveRingContacts(track, 1);
    expect(impacts).toBe(1);
    const first = track.order[0];
    const last = track.order[2];
    expect(track.v[first]).toBeCloseTo(80, 9);
    expect(track.v[last]).toBeCloseTo(-80, 9);
    expect(track.s[first] + L - track.s[last]).toBeCloseTo(contactArc(4, 4, R), 9);
  });

  it("passes the momentum down a Newton's cradle of equal touching bodies", () => {
    const R = 200;
    const gap = contactArc(5, 5, R);
    const bodies = [{ s: 0, v: 120, r: 5 }];
    for (let i = 1; i <= 4; i++) bodies.push({ s: 0.01 + i * gap, v: 0, r: 5 });
    const track = ringOf(bodies, R);
    for (let k = 0; k < 400; k++) {
      advanceRing(track, 1 / 240, 0);
      resolveRingContacts(track, 1, 8);
    }
    // The striker stops, the far end flies off with (almost) all the momentum.
    expect(Math.abs(track.v[0])).toBeLessThan(5);
    expect(track.v[4]).toBeGreaterThan(110);
    expect(ringMomentum(track)).toBeCloseTo(120 * 25, 3);
  });

  it("keeps the ring order and never lets neighbours overlap over a long random run", () => {
    const random = rng(3);
    const R = 120;
    const L = 2 * Math.PI * R;
    const n = 30;
    const bodies = Array.from({ length: n }, (_, i) => ({ s: (i * L) / n, v: (random() - 0.5) * 800, r: 2 + 3 * random() }));
    const track = ringOf(bodies, R);
    const e0 = ringKineticEnergy(track);
    for (let k = 0; k < 4 * 60 * 20; k++) {
      advanceRing(track, 1 / 240, 0);
      resolveRingContacts(track, 1, 4);
      if (k % 60 === 0) renormalizeRing(track);
    }
    for (let k = 0; k < n; k++) {
      const a = track.order[k];
      const b = track.order[(k + 1) % n];
      const wrap = k === n - 1 ? L : 0;
      expect(track.s[b] + wrap - track.s[a]).toBeGreaterThanOrEqual(contactArc(track.r[a], track.r[b], R) - 1e-6);
    }
    expect(track.s[track.order[0]]).toBeGreaterThanOrEqual(0);
    expect(track.s[track.order[0]]).toBeLessThan(L);
    expect(ringKineticEnergy(track)).toBeCloseTo(e0, 0);
  });

  it("accelerates the bodies by the tangential component of gravity and wraps independent bodies", () => {
    const R = 100;
    const track = ringOf([
      { s: 0, v: 0, r: 3 }, // angle 0: the side of the circle, gravity along the track
      { s: (Math.PI / 2) * R, v: 0, r: 3 }, // angle 90°: the bottom, gravity across the track
    ], R);
    advanceRing(track, 0.01, 500);
    expect(track.v[0]).toBeCloseTo(5, 9);
    expect(track.v[1]).toBeCloseTo(0, 9);
    track.s[0] = ringLength(track) + 3;
    track.s[1] = -2;
    renormalizeRing(track, true);
    expect(track.s[0]).toBeCloseTo(3, 9);
    expect(track.s[1]).toBeCloseTo(ringLength(track) - 2, 9);
  });
});

/* ------------------------------------------------------------------ pure helpers */

describe("Collision Playground helpers", () => {
  it("spreads the sizes log-uniformly up to 1/3× … 3× at full spread", () => {
    expect(sizeFactor(0.3, 0)).toBe(1);
    expect(sizeFactor(0.5, 1)).toBeCloseTo(1, 12);
    expect(sizeFactor(0, 1)).toBeCloseTo(1 / SIZE_SPREAD_RATIO, 12);
    expect(sizeFactor(1, 1)).toBeCloseTo(SIZE_SPREAD_RATIO, 12);
    expect(sizeFactor(1, 0.5)).toBeCloseTo(Math.sqrt(SIZE_SPREAD_RATIO), 12);
  });

  it("pitches a collision by the size on a pentatonic ladder: bigger is lower", () => {
    const top = frequencyToMidi(collidePitch(2, 2, 18));
    const bottom = frequencyToMidi(collidePitch(18, 2, 18));
    expect(Math.round(bottom)).toBe(COLLIDE_PITCH_BASE_MIDI);
    expect(Math.round(top)).toBe(Math.max(...LADDER));
    let previous = Infinity;
    for (let r = 2; r <= 18; r += 0.25) {
      const midi = frequencyToMidi(collidePitch(r, 2, 18));
      expect(LADDER.has(Math.round(midi))).toBe(true);
      expect(midi).toBeLessThanOrEqual(previous + 1e-9);
      previous = midi;
    }
    // All orbs the same size: every collision plays the middle degree.
    expect(LADDER.has(Math.round(frequencyToMidi(collidePitch(5, 5, 5))))).toBe(true);
    expect(collidePitch(5, 5, 5)).toBe(collidePitch(9, 9, 9));
  });

  it("keeps the notes soft and scales them by the impact", () => {
    expect(collideLevel(0, 400)).toBeCloseTo(0.2 * COLLIDE_SOFT_LEVEL, 12);
    expect(collideLevel(10_000, 400)).toBe(COLLIDE_SOFT_LEVEL);
    expect(collideLevel(300, 400)).toBeGreaterThan(collideLevel(100, 400));
    expect(COLLIDE_SOFT_LEVEL).toBeLessThan(1);
  });

  it("squashes an orb along the contact normal and lets it spring back within 120 ms", () => {
    expect(squashAmount(0, 400)).toBe(0);
    expect(squashAmount(10_000, 400)).toBe(MAX_SQUASH);
    const a = squashAmount(400, 400);
    expect(squashAt(a, 0)).toBeCloseTo(a, 12);
    expect(squashAt(a, SQUASH_MS / 2)).toBeCloseTo(a / 4, 12);
    expect(squashAt(a, SQUASH_MS)).toBe(0);
    expect(squashAt(a, Number.NaN)).toBe(0);
    expect(squashScaleAlong(0.3)).toBeCloseTo(0.7, 12);
    expect(squashScaleAcross(0.3)).toBeCloseTo(1.15, 12);
  });

  it("lays the container out in the centred square the recorder crops to", () => {
    const circle = buildCollideField(900, 506, "circle");
    expect(circle.cx).toBe(450);
    expect(circle.cy).toBe(253);
    expect(circle.side).toBe(506);
    expect(circle.radius).toBeLessThan(253);
    expect(fieldArea(circle)).toBeCloseTo(Math.PI * circle.radius ** 2, 9);
    const box = buildCollideField(1080, 1920, "box");
    expect(box.right - box.left).toBeCloseTo(box.bottom - box.top, 9);
    expect(box.right - box.left).toBeLessThan(1080);
    expect(fieldArea(box)).toBeCloseTo((box.right - box.left) ** 2, 6);
  });

  it("finds a start grid for any count that fits inside the container", () => {
    for (const kind of ["circle", "box"] as const) {
      const field = buildCollideField(800, 600, kind);
      for (const count of [10, 77, 300, 2000]) {
        const pitch = syncGridPitch(field, count);
        const cells: number[] = [];
        expect(syncGridCells(field, pitch, count, cells)).toBe(count);
        for (let k = 0; k < count; k++) {
          const x = cells[2 * k];
          const y = cells[2 * k + 1];
          if (kind === "circle") expect(Math.hypot(Math.abs(x - field.cx) + pitch / 2, Math.abs(y - field.cy) + pitch / 2)).toBeLessThanOrEqual(field.radius + 1e-6);
          else {
            expect(x - pitch / 2).toBeGreaterThanOrEqual(field.left - 1e-6);
            expect(y + pitch / 2).toBeLessThanOrEqual(field.bottom + 1e-6);
          }
        }
        // Rows fill from the top.
        expect(cells[1]).toBeLessThanOrEqual(cells[2 * count - 1]);
      }
    }
  });

  it("places random discs without overlap inside the container", () => {
    const field = buildCollideField(800, 600, "circle");
    const random = rng(11);
    const n = 400;
    const radii = Array.from({ length: n }, () => 3 + 5 * random()).sort((a, b) => b - a);
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    placeWithoutOverlap(field, radii, n, xs, ys, random);
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(xs[i] - field.cx, ys[i] - field.cy)).toBeLessThanOrEqual(field.radius - radii[i] + 1e-9);
      for (let j = i + 1; j < n; j++) expect(Math.hypot(xs[i] - xs[j], ys[i] - ys[j])).toBeGreaterThanOrEqual(radii[i] + radii[j] - 1e-9);
    }
  });
});

/* ------------------------------------------------------------------ the mode in the engine */

describe("CollideMode in the engine", () => {
  it("is registered as a mode of the rhythm family", () => {
    expect(MODE_IDS).toContain("collide");
    expect(MODE_CARD_ORDER).toContain("collide");
    expect(MODE_CATEGORIES.collide).toBe("rhythm");
  });

  it("starts 300 varied orbs inside the circle, without rings, overlaps or engine pair collisions", () => {
    const engine = collideEngine();
    expect(engine.isCollideMode()).toBe(true);
    expect(engine.getCircularWalls()).toEqual([]);
    expect(engine.getCurrentMode()?.ballsPassThrough).toBe(true);
    const balls = engine.getBalls();
    const view = engine.getCollideView();
    expect(balls).toHaveLength(DEFAULT_COLLIDE_SETTINGS.count);
    expect(view.count).toBe(300);
    const f = view.field!;
    for (const b of balls) expect(Math.hypot(b.x - f.cx, b.y - f.cy)).toBeLessThanOrEqual(f.radius - b.radius + 1e-9);
    expect(maxOverlap(balls)).toBeLessThanOrEqual(1e-9);
    const radii = balls.map((b) => b.radius);
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(2);
    // The orbs cover about 30 % of the container at the default Ball Size.
    const covered = balls.reduce((s, b) => s + Math.PI * b.radius * b.radius, 0) / fieldArea(f);
    expect(covered).toBeGreaterThan(0.25);
    expect(covered).toBeLessThan(0.35);
    // Every orb is in exactly one colour bucket.
    expect(view.bucketStart[HUE_BUCKETS]).toBe(300);
    expect(new Set(view.bucketOrder).size).toBe(300);
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const run = (seed: number) => {
      const engine = collideEngine({ count: 200, gravity: 0.5 }, seed);
      step(engine, 240);
      return engine.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]);
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it("collides the orbs elastically: a gas at restitution 1 keeps its energy, a softer one loses it", () => {
    const elastic = collideEngine({ gravity: 0, restitution: 1 });
    const e0 = kineticEnergy(elastic.getBalls());
    step(elastic, 600);
    expect(elastic.getCollideView().collisions).toBeGreaterThan(1000);
    expect(kineticEnergy(elastic.getBalls()) / e0).toBeCloseTo(1, 6);
    const soft = collideEngine({ gravity: 0, restitution: 0.8 });
    const s0 = kineticEnergy(soft.getBalls());
    step(soft, 600);
    expect(kineticEnergy(soft.getBalls()) / s0).toBeLessThan(0.5);
  });

  it("keeps a heavy pile from sinking: orbs stay inside and barely overlap under full gravity", () => {
    for (const container of ["circle", "box"] as const) {
      const engine = collideEngine({ gravity: 1, restitution: 0.8, container });
      step(engine, 900);
      const balls = engine.getBalls();
      const f = engine.getCollideView().field!;
      for (const b of balls) {
        if (container === "circle") expect(Math.hypot(b.x - f.cx, b.y - f.cy)).toBeLessThanOrEqual(f.radius - b.radius + 1e-6);
        else {
          expect(b.x - b.radius).toBeGreaterThanOrEqual(f.left - 1e-6);
          expect(b.y + b.radius).toBeLessThanOrEqual(f.bottom + 1e-6);
        }
      }
      expect(maxOverlap(balls)).toBeLessThan(3);
      // They have settled at the bottom.
      const meanY = balls.reduce((s, b) => s + b.y, 0) / balls.length;
      expect(meanY).toBeGreaterThan(f.cy + 0.2 * f.radius);
    }
  });

  it("plays at most 12 soft notes per frame of one step, pitched on the ladder, the most energetic kept", () => {
    const engine = collideEngine({ count: 2000 });
    let steps = 0;
    let notes = 0;
    for (let i = 0; i < 180; i++) {
      engine.update(1000 / 60, 0);
      const events = engine.consumeSoundEvents();
      expect(events.length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
      for (const ev of events) {
        expect(ev.type).toBe("hit");
        expect(LADDER.has(Math.round(frequencyToMidi(ev.frequency!)))).toBe(true);
        expect(ev.level).toBeGreaterThan(0);
        expect(ev.level).toBeLessThanOrEqual(COLLIDE_SOFT_LEVEL);
      }
      if (events.length === MAX_SOUNDS_PER_FRAME) steps++;
      notes += events.length;
    }
    // Two thousand orbs collide far more often than 12 times a step: the budget is full almost every step.
    expect(steps).toBeGreaterThan(150);
    expect(engine.getCollideView().notes).toBe(notes);
    expect(engine.getCollideView().collisions).toBeGreaterThan(notes);
  });

  it("caps the notes per rendered frame, not per step: 8 steps in one frame (8× playback) still play at most 12", () => {
    // The default playground, as a frame at 8× runs it: eight 60 Hz steps, then one consumeSoundEvents().
    const fast = collideEngine();
    step(fast, 8);
    const batch = fast.consumeSoundEvents();
    const hits = batch.filter((e: SoundEvent) => e.level !== undefined);
    expect(hits).toHaveLength(MAX_SOUNDS_PER_FRAME);
    expect(batch).toHaveLength(hits.length);
    expect(fast.getCollideView().notes).toBe(MAX_SOUNDS_PER_FRAME);
    // The same run consumed after every step (1×) plays far more over those eight steps…
    const slow = collideEngine();
    const perStep: SoundEvent[] = [];
    for (let i = 0; i < 8; i++) {
      step(slow, 1);
      const events = slow.consumeSoundEvents();
      expect(events.length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
      perStep.push(...events);
    }
    expect(perStep.length).toBeGreaterThan(2 * MAX_SOUNDS_PER_FRAME);
    // …and the 8× frame's notes are the strongest of them: every one was also played at 1×.
    const key = (e: SoundEvent) => `${e.frequency}|${e.level}`;
    const pool = new Map<string, number>();
    for (const e of perStep) pool.set(key(e), (pool.get(key(e)) ?? 0) + 1);
    for (const e of hits) {
      const left = pool.get(key(e)) ?? 0;
      expect(left).toBeGreaterThan(0);
      pool.set(key(e), left - 1);
    }
    // The budget is sound only: both runs are still bit for bit the same physics.
    expect(fast.getBalls().map((b) => [b.x, b.y, b.vx, b.vy])).toEqual(slow.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]));
    expect(fast.getCollideView().collisions).toBe(slow.getCollideView().collisions);
    // A frame that ran no step plays nothing; the next frame starts a fresh budget.
    expect(fast.consumeSoundEvents()).toEqual([]);
    step(fast, 8);
    expect(fast.consumeSoundEvents().filter((e: SoundEvent) => e.level !== undefined).length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
    // Even 2000 orbs over 60 steps in one batch stay within the budget.
    const crowd = collideEngine({ count: 2000 });
    step(crowd, 60);
    expect(crowd.consumeSoundEvents().length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
  });

  it("pitches the note of a collision by the smaller orb", () => {
    // Two orbs of very different sizes, flying at each other in the middle of a big empty container.
    const engine = collideEngine({ count: 10, gravity: 0, sizeSpread: 1 }, 3, { width: 4000, height: 4000 });
    const balls = engine.getBalls();
    const range = engine.collideMode.getRadiusRange();
    const big = balls.find((b) => b.radius === range.max)!;
    const small = balls.find((b) => b.radius === range.min)!;
    for (const b of balls) {
      b.vx = 0;
      b.vy = 0;
      b.x = 100 + 20 * b.id;
      b.y = 100;
    }
    big.x = 2000;
    big.y = 2000;
    small.x = 2000 + big.radius + small.radius + 20;
    small.y = 2000;
    small.vx = -600;
    step(engine, 30);
    const hits = engine.consumeSoundEvents().filter((e: SoundEvent) => e.level !== undefined);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].frequency).toBeCloseTo(collidePitch(range.min, range.min, range.max), 9);
    // Momentum went into the big orb, which is heavier (mass ∝ area).
    expect(big.vx).toBeLessThan(0);
    expect(Math.abs(big.vx)).toBeLessThan(600);
  });

  it("records squash-and-stretch impacts that fade within 120 ms", () => {
    const engine = collideEngine({ squishy: true, gravity: 0 });
    step(engine, 30);
    const view = engine.getCollideView();
    const recent = Array.from(view.impactTick).filter((t) => (view.tick - t) * view.tickMs < SQUASH_MS);
    expect(recent.length).toBeGreaterThan(0);
    let squashing = 0;
    for (let k = 0; k < view.count; k++) {
      const s = squashAt(view.impactAmount[k], (view.tick - view.impactTick[k]) * view.tickMs);
      expect(s).toBeLessThanOrEqual(MAX_SQUASH);
      if (s > 0) {
        squashing++;
        expect(Math.hypot(view.impactNx[k], view.impactNy[k])).toBeCloseTo(1, 5);
      }
    }
    expect(squashing).toBeGreaterThan(0);
  });

  it("starts a sync run from a grid at the same instant: from rest under gravity, together without it", () => {
    const engine = collideEngine({ syncStart: true, sizeSpread: 0, container: "box", gravity: 0.5 });
    const balls = engine.getBalls();
    expect(balls).toHaveLength(300);
    expect(balls.every((b) => b.vx === 0 && b.vy === 0)).toBe(true);
    expect(maxOverlap(balls)).toBeLessThanOrEqual(1e-9);
    const rows = new Set(balls.map((b) => b.y.toFixed(6)));
    const cols = new Set(balls.map((b) => b.x.toFixed(6)));
    expect(rows.size * cols.size).toBeGreaterThanOrEqual(300);
    // A row falls as one: after a moment every orb of the top row is at the same height.
    step(engine, 20);
    const top = Math.min(...balls.map((b) => b.y));
    const topRow = balls.filter((b) => Math.abs(b.y - top) < 1e-6);
    expect(topRow.length).toBeGreaterThan(5);
    const floating = collideEngine({ syncStart: true, gravity: 0 });
    const vys = new Set(floating.getBalls().map((b) => b.vy));
    expect(vys.size).toBe(1);
    expect([...vys][0]).toBeGreaterThan(0);
  });

  it("switches to anti-collision at the chosen second: an accented chord, a colour change, and the orbs pass through", () => {
    const engine = collideEngine({ antiCollisionAt: 2, gravity: 1 });
    step(engine, 119);
    expect(engine.getCollideView().antiActive).toBe(false);
    engine.consumeSoundEvents();
    const colorBefore = engine.getBalls()[0].color;
    step(engine, 1);
    const view = engine.getCollideView();
    expect(view.antiActive).toBe(true);
    const events = engine.consumeSoundEvents();
    expect(events.some((e) => e.accent && e.chord?.length === ANTI_COLLISION_CHORD.length)).toBe(true);
    expect(engine.getBalls()[0].color).not.toBe(colorBefore);
    const collisions = view.collisions;
    step(engine, 240);
    expect(view.collisions).toBe(collisions);
    // Without collisions the orbs fall through each other into the bottom of the container.
    expect(maxOverlap(engine.getBalls())).toBeGreaterThan(5);
    expect(engine.getCollideProgress().anti).toBe(true);
  });

  it("puts lollipops on a ring: at most 36 bodies on the track, colliding in one dimension", () => {
    const engine = collideEngine({ ring: true });
    const view = engine.getCollideView();
    const balls = engine.getBalls();
    expect(balls).toHaveLength(RING_MAX_BODIES);
    expect(view.count).toBe(RING_MAX_BODIES);
    const f = view.field!;
    const track = engine.collideMode.getRingTrack()!;
    expect(track.n).toBe(RING_MAX_BODIES);
    step(engine, 300);
    for (const b of balls) expect(Math.hypot(b.x - f.cx, b.y - f.cy)).toBeCloseTo(view.ringRadius, 6);
    expect(view.collisions).toBeGreaterThan(10);
    // Neighbours never sink into each other (a crowded chain may keep a hair of overlap after a sub-step's passes).
    for (let k = 0; k < track.n; k++) {
      const a = track.order[k];
      const b = track.order[(k + 1) % track.n];
      const wrap = k === track.n - 1 ? ringLength(track) : 0;
      expect(track.s[b] + wrap - track.s[a]).toBeGreaterThanOrEqual(contactArc(track.r[a], track.r[b], track.radius) - 0.05);
    }
    // Small counts put exactly that many lollipops on the ring; the anti-collision switch works there too.
    const few = collideEngine({ ring: true, count: 12, antiCollisionAt: 1 });
    expect(few.getBalls()).toHaveLength(12);
    step(few, 90);
    expect(few.getCollideView().antiActive).toBe(true);
  });

  it("follows live changes of the ball speed, the ball size and the canvas size", () => {
    const engine = collideEngine({ gravity: 0 });
    step(engine, 10);
    const e0 = kineticEnergy(engine.getBalls());
    engine.setConfig({ ballSpeed: 800 });
    step(engine, 1);
    expect(kineticEnergy(engine.getBalls()) / e0).toBeCloseTo(4, 1);
    const r0 = engine.getBalls().map((b) => b.radius);
    engine.setConfig({ ballRadius: 10 });
    step(engine, 1);
    const r1 = engine.getBalls().map((b) => b.radius);
    expect(r1[0] / r0[0]).toBeCloseTo(1.25, 6);
    // Ball Size 30 would cover the container many times over: the fill is capped.
    engine.setConfig({ ballRadius: 30 });
    step(engine, 1);
    const f = engine.getCollideView().field!;
    const covered = engine.getBalls().reduce((s, b) => s + Math.PI * b.radius * b.radius, 0) / fieldArea(f);
    expect(covered).toBeLessThanOrEqual(0.6 + 1e-9);
    // A resize maps the orbs isotropically onto the new container and keeps them inside.
    engine.setConfig({ ballRadius: 8, width: 600, height: 1000 });
    const g = engine.getCollideView().field!;
    expect(g.side).toBe(600);
    for (const b of engine.getBalls()) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      expect(Math.hypot(b.x - g.cx, b.y - g.cy)).toBeLessThanOrEqual(g.radius - b.radius + 1e-6);
    }
    step(engine, 60);
    expect(maxOverlap(engine.getBalls())).toBeLessThan(1.5);
  });

  it("never finishes: the finder says so instead of searching, and still builds the mode", async () => {
    expect(runNeverFinishes("collide", { drop: {}, box: {} })).toBe(true);
    const engine = createEngineForSettings(config, "collide", { ...modeSettings, collide: { count: 50, ring: false } }, 1);
    expect(engine.getBalls()).toHaveLength(50);
    step(engine, 60);
    expect(engine.isSimulationFinished()).toBe(false);
    const result = await findSimulation(
      { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, physicsConfig: config, mode: "collide", modeSettings: { ...modeSettings, collide: {} } },
      () => undefined,
    );
    expect(result).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
  });
});

/* ------------------------------------------------------------------ settings */

describe("Collision Playground settings", () => {
  it("default to 300 orbs in a circle for every mode and stay out of default links", () => {
    for (const mode of MODE_IDS) expect(collideSettingsOf(defaultSettings(mode))).toEqual(DEFAULT_COLLIDE_SETTINGS);
    expect(collideSettingFields(DEFAULT_COLLIDE_SETTINGS)).toEqual({ cpCount: 300, cpSizeSpread: 0.6, cpContainer: "circle", cpGravity: 0.3, cpRestitution: 1, cpSquishy: false, cpSyncStart: false, cpAntiCollisionAt: 0, cpRing: false });
    const params = settingsToSearchParams(defaultSettings("collide"));
    for (const key of ["cpn", "cpsz", "cpc", "cpg", "cpe", "cpsq", "cpsy", "cpac", "cpr"]) expect(params.has(key)).toBe(false);
    expect(RANGES.cpCount).toEqual(COLLIDE_RANGES.cpCount);
    expect(RANGES.cpRestitution).toEqual({ min: 0.7, max: 1, step: 0.01 });
  });

  it("round-trip through the URL keys", () => {
    const s: SimulatorSettings = { ...defaultSettings("collide"), cpCount: 1247, cpSizeSpread: 0.85, cpContainer: "box", cpGravity: 0.65, cpRestitution: 0.93, cpSquishy: true, cpSyncStart: true, cpAntiCollisionAt: 12, cpRing: true };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("collide");
    expect(params.get("cpn")).toBe("1247");
    expect(params.get("cpc")).toBe("box");
    expect(params.get("cpsq")).toBe("1");
    expect(params.get("cpac")).toBe("12");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("clamp URL parameters and presets to their ranges", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams("mode=collide&cpn=99999&cpsz=-1&cpc=hexagon&cpg=7&cpe=0.2&cpac=12.6&cpsq=maybe"));
    expect(fromUrl.cpCount).toBe(99999); // --- uncap-all --- (kept; the playground builds at most its memory-safety ceiling)
    expect(fromUrl.cpSizeSpread).toBe(0);
    expect(fromUrl.cpContainer).toBe("circle");
    expect(fromUrl.cpGravity).toBe(7); // --- uncap-all --- (cpg=7 kept)
    expect(fromUrl.cpRestitution).toBe(0.7);
    expect(fromUrl.cpAntiCollisionAt).toBe(13);
    expect(fromUrl.cpSquishy).toBe(false);
    const preset = presetToSettings({ mode: "collide", cpCount: 3, cpContainer: "box", cpRing: "yes" as unknown as boolean, cpRestitution: Number.NaN });
    expect(preset.cpCount).toBe(10);
    expect(preset.cpContainer).toBe("box");
    expect(preset.cpRing).toBe(false);
    expect(preset.cpRestitution).toBe(1);
    expect(resolveCollideSettings(null)).toEqual(DEFAULT_COLLIDE_SETTINGS);
    expect(resolveCollideSettings({ count: 55.4 }).count).toBe(55);
  });
});

/* ------------------------------------------------------------------ soft notes in the tone generator */

describe("ToneGenerator soft hits", () => {
  const gains: number[] = [];
  const oscillators: number[] = [];
  let setTime = (t: number) => void t;
  beforeEach(async () => {
    gains.length = 0;
    oscillators.length = 0;
    const param = (value = 0) => ({ value, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined });
    const ctx = {
      state: "running",
      currentTime: 0,
      sampleRate: 48000,
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
      createGain: () => ({ gain: { ...param(1), setValueAtTime: (v: number) => void gains.push(v) }, connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect: () => undefined, disconnect: () => undefined }),
      createMediaStreamDestination: () => ({ stream: {}, connect: () => undefined }),
      createOscillator: () => {
        const osc = { type: "sine", frequency: param(0), connect: () => undefined, disconnect: () => undefined, onended: null, start: () => void (osc.frequency.value !== 1 && oscillators.push(osc.frequency.value)), stop: () => undefined };
        return osc;
      },
      createBufferSource: () => ({ buffer: null, playbackRate: param(1), connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined }),
      createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
    };
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return ctx; } });
    setTime = (t) => void (ctx.currentTime = t);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("scales a hit's gain by its level and leaves normal hits untouched", async () => {
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings(DEFAULT_MUSIC_SETTINGS);
    const heard = (g: number) => gains.some((v) => Math.abs(v - g) < 1e-9);
    tone.playWallHit(0, 440);
    expect(heard(0.25)).toBe(true);
    gains.length = 0;
    setTime(1); // a later frame (hits of one frame on one pitch share their loudness: toneGenerator.test.ts)
    tone.playWallHit(0, 440, false, undefined, 0.3);
    expect(heard(0.25 * 0.3)).toBe(true);
    expect(heard(0.25)).toBe(false);
    expect(oscillators).toEqual([440, 440]);
    expect(hitLevel(undefined)).toBe(1);
    expect(hitLevel(2)).toBe(1);
    expect(hitLevel(-1)).toBe(0);
    expect(hitLevel(Number.NaN)).toBe(1);
  });
});
