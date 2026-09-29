import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  CONTACT_LOG_CAPACITY,
  DEFAULT_WALL_WOBBLE,
  MAX_WOBBLE_STRENGTH,
  WOBBLE_DECAY_SEC,
  WOBBLE_FRACTION,
  WOBBLE_HALF_WIDTH,
  WOBBLE_HITS_PER_WALL,
  WOBBLE_KNEE,
  WOBBLE_MAX_AGE_SEC,
  WOBBLE_MAX_PX,
  WOBBLE_MERGE_MS,
  WOBBLE_MERGE_RAD,
  WOBBLE_MODES,
  WOBBLE_SAMPLES,
  WOBBLE_STEP,
  WOBBLE_WAVE_SPEED,
  WallContactLog,
  WobbleField,
  resolveWallWobble,
  sampleAt,
  saturateWobble,
  wallWobbleOffered,
  wobbleAmplitudePx,
  wobbleBound,
  wobbleBump,
  wobbleDisplacement,
  wobbleEnvelope,
  wobbleStrength,
  wrapAngle,
} from "@/lib/physics/wobble";
import type { ModeId, PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Wobbly walls (lib/physics/wobble.ts, feature jdm-illusions): the displacement wave of a hit – it starts as a bulge of
 * exactly the hit's strength at the contact point, travels both ways round the wall and decays within |s|·e^(−t/τ) –,
 * the field that samples many hits at 64 angles, the engine's contact log (recorded for every ring hit, render-only:
 * the physics never read it) and the setting.
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

/** Largest |displacement| over a fine sweep of angles `age` seconds after a hit of `strength` at angle 0. */
function peak(age: number, strength = 1): { value: number; at: number } {
  let value = 0;
  let at = 0;
  for (let k = 0; k < 2000; k++) {
    const phi = -Math.PI + (2 * Math.PI * k) / 2000;
    const d = Math.abs(wobbleDisplacement(phi, 0, age, strength));
    if (d > value) {
      value = d;
      at = phi;
    }
  }
  return { value, at };
}

describe("wobble wave", () => {
  it("starts as a bulge of exactly the hit's strength at the contact point", () => {
    expect(wobbleEnvelope(0)).toBe(1);
    expect(wobbleBump(0)).toBe(1);
    expect(wobbleBump(0.6)).toBe(0);
    expect(wobbleBump(2 * Math.PI)).toBe(1);
    expect(wobbleDisplacement(1.2, 1.2, 0, 0.8)).toBeCloseTo(0.8, 12);
    expect(wobbleDisplacement(1.2, 1.2, 0, -0.5)).toBeCloseTo(-0.5, 12);
    expect(wobbleDisplacement(1.2 + Math.PI, 1.2, 0, 1)).toBe(0);
    // Nothing before the hit, nothing once it is dropped.
    expect(wobbleEnvelope(-0.01)).toBe(0);
    expect(wobbleEnvelope(WOBBLE_MAX_AGE_SEC + 0.01)).toBe(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it("decays within |s|·e^(−t/τ) and is gone after a few time constants", () => {
    for (const strength of [0.3, 1, -1.5]) {
      let last = Infinity;
      for (let age = 0; age <= WOBBLE_MAX_AGE_SEC; age += 0.05) {
        const bound = wobbleBound(age, strength);
        expect(bound).toBeCloseTo(Math.abs(strength) * Math.exp(-age / WOBBLE_DECAY_SEC), 12);
        expect(peak(age, strength).value).toBeLessThanOrEqual(bound + 1e-12);
        // The bound itself only ever shrinks.
        expect(bound).toBeLessThan(last + 1e-15);
        last = bound;
      }
      expect(peak(5 * WOBBLE_DECAY_SEC, strength).value).toBeLessThan(0.01 * Math.abs(strength));
    }
    // The envelope rings in and out on its way down (a wobble, not a slow sag).
    const signs = new Set<number>();
    for (let age = 0; age < 1; age += 0.01) signs.add(Math.sign(wobbleEnvelope(age)));
    expect(signs.has(1) && signs.has(-1)).toBe(true);
  });

  it("travels both ways round the wall from the contact point", () => {
    // At first the two bumps overlap (one bulge at the contact point); they have separated once each travelled its half-width.
    expect(peak(0.05).at).toBeCloseTo(0, 2);
    for (const age of [0.3, 0.4, 0.6]) {
      const expected = WOBBLE_WAVE_SPEED * age;
      expect(expected).toBeGreaterThan(WOBBLE_HALF_WIDTH);
      // Once the two bumps have separated the largest displacement sits `c·age` either side of the contact point…
      const p = peak(age);
      expect(Math.abs(Math.abs(p.at) - expected)).toBeLessThan(0.01);
      // …symmetrically.
      expect(wobbleDisplacement(expected, 0, age, 1)).toBeCloseTo(wobbleDisplacement(-expected, 0, age, 1), 12);
    }
  });

  it("scales hits by the approach speed and walls by their radius", () => {
    expect(wobbleStrength(200, 400)).toBe(0.5);
    expect(wobbleStrength(-200, 400)).toBe(0.5);
    expect(wobbleStrength(5000, 400)).toBe(MAX_WOBBLE_STRENGTH);
    expect(wobbleStrength(100, 0)).toBe(0);
    expect(wobbleAmplitudePx(0, 300)).toBe(0);
    expect(wobbleAmplitudePx(1, 100)).toBeCloseTo(WOBBLE_FRACTION * 100, 12);
    expect(wobbleAmplitudePx(1, 5000)).toBe(WOBBLE_MAX_PX);
    expect(wobbleAmplitudePx(0.5, 100)).toBeCloseTo(0.5 * WOBBLE_FRACTION * 100, 12);
  });
});

describe("wobble field", () => {
  it("samples the superposition of a wall's hits at 64 angles", () => {
    const field = new WobbleField();
    const hits = [
      { angle: 0.4, strength: 1, t: 1000 },
      { angle: 2.9, strength: -0.6, t: 1150 },
      { angle: 5.5, strength: 0.8, t: 1300 },
    ];
    for (const h of hits) field.addHit(3, h.angle, h.strength, h.t);
    const out = new Float32Array(WOBBLE_SAMPLES);
    const now = 1420;
    const max = field.sample(3, now, out);
    let expectedMax = 0;
    for (let k = 0; k < WOBBLE_SAMPLES; k++) {
      const phi = k * WOBBLE_STEP;
      const expected = hits.reduce((sum, h) => sum + wobbleDisplacement(phi, h.angle, (now - h.t) / 1000, h.strength), 0);
      expect(out[k]).toBeCloseTo(expected, 5);
      expectedMax = Math.max(expectedMax, Math.abs(expected));
    }
    expect(max).toBeCloseTo(expectedMax, 5);
    // Another wall is untouched; between samples the value is interpolated.
    expect(field.sample(4, now, out)).toBe(0);
    field.sample(3, now, out);
    expect(sampleAt(out, 2 * WOBBLE_STEP)).toBeCloseTo(out[2], 6);
    expect(sampleAt(out, 2.5 * WOBBLE_STEP)).toBeCloseTo((out[2] + out[3]) / 2, 6);
    expect(sampleAt(out, 2 * Math.PI + 2 * WOBBLE_STEP)).toBeCloseTo(out[2], 6);
  });

  it("keeps the newest hits of a wall and goes quiet once they have died away", () => {
    const field = new WobbleField();
    for (let i = 0; i < WOBBLE_HITS_PER_WALL + 5; i++) field.addHit(0, 0.1 * i, 1, 100 * i);
    expect(field.isLive(0, 100 * (WOBBLE_HITS_PER_WALL + 4))).toBe(true);
    expect(field.isLive(0, 100 * (WOBBLE_HITS_PER_WALL + 4) + 1000 * WOBBLE_MAX_AGE_SEC + 1)).toBe(false);
    expect(field.isLive(1, 0)).toBe(false);
    field.reset();
    expect(field.isLive(0, 0)).toBe(false);
  });

  it("merges the contacts of one push into one hit: eight at the same wall, angle and time bulge like one", () => {
    const stacked = new WobbleField();
    const single = new WobbleField();
    for (let i = 0; i < 8; i++) stacked.addHit(2, 1.3, 1, 1000);
    single.addHit(2, 1.3, 1, 1000);
    const a = new Float32Array(WOBBLE_SAMPLES);
    const b = new Float32Array(WOBBLE_SAMPLES);
    for (const now of [1000, 1016, 1100, 1400]) {
      const peakStacked = stacked.sample(2, now, a);
      expect(peakStacked).toBeLessThanOrEqual(1);
      expect(peakStacked).toBe(single.sample(2, now, b));
      expect(Array.from(a)).toEqual(Array.from(b));
    }
    // A ball leaning on the wall – a contact every step, drifting a little – keeps one bulge that follows it: the
    // stronger strength, the newest time and angle.
    const leaning = new WobbleField();
    leaning.addHit(0, 2.0, 0.4, 1000);
    leaning.addHit(0, 2.05, 1.2, 1016);
    leaning.addHit(0, 2.1, 0.3, 1033);
    const expected = new WobbleField();
    expected.addHit(0, 2.1, 1.2, 1033);
    for (const now of [1033, 1080, 1300]) {
      leaning.sample(0, now, a);
      expected.sample(0, now, b);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
    // Contacts further apart in time or round the wall are separate hits whose waves add up.
    const apart = new WobbleField();
    apart.addHit(1, 0.5, 0.3, 1000);
    apart.addHit(1, 0.5 + WOBBLE_MERGE_RAD + 0.1, 0.3, 1000);
    apart.addHit(1, 3.5, 0.3, 1000);
    apart.addHit(1, 3.5, 0.3, 1000 + WOBBLE_MERGE_MS + 10);
    const now = 1100;
    apart.sample(1, now, a);
    for (let k = 0; k < WOBBLE_SAMPLES; k++) {
      const phi = k * WOBBLE_STEP;
      const sum =
        wobbleDisplacement(phi, 0.5, 0.1, 0.3) + wobbleDisplacement(phi, 0.5 + WOBBLE_MERGE_RAD + 0.1, 0.1, 0.3) + wobbleDisplacement(phi, 3.5, 0.1, 0.3) + wobbleDisplacement(phi, 3.5, (now - 1000 - WOBBLE_MERGE_MS - 10) / 1000, 0.3);
      expect(a[k]).toBeCloseTo(saturateWobble(sum), 5);
    }
  });

  it("saturates a wall's summed waves: unchanged up to the knee, never beyond the full amplitude", () => {
    expect(saturateWobble(0)).toBe(0);
    expect(saturateWobble(0.5)).toBe(0.5);
    expect(saturateWobble(-WOBBLE_KNEE)).toBe(-WOBBLE_KNEE);
    let last = 0;
    for (let d = 0; d <= 20; d += 0.01) {
      const v = saturateWobble(d);
      expect(v).toBeLessThanOrEqual(1);
      if (d < 4) expect(v).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(saturateWobble(-d)).toBe(-v);
      last = v;
    }
    // It joins the identity smoothly: the same slope either side of the knee.
    const e = 1e-6;
    expect((saturateWobble(WOBBLE_KNEE + e) - saturateWobble(WOBBLE_KNEE)) / e).toBeCloseTo(1, 4);
    // Twelve distinct hits piling up at one point (each more than the merge window apart) still stay inside it.
    const field = new WobbleField();
    for (let i = 0; i < WOBBLE_HITS_PER_WALL; i++) field.addHit(0, 0.7, MAX_WOBBLE_STRENGTH, 1000 + (WOBBLE_MERGE_MS + 5) * i);
    const out = new Float32Array(WOBBLE_SAMPLES);
    let worst = 0;
    for (let now = 1000; now < 1000 + 12 * (WOBBLE_MERGE_MS + 5) + 500; now += 5) worst = Math.max(worst, field.sample(0, now, out));
    expect(worst).toBeGreaterThan(WOBBLE_KNEE);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("copies the new contacts of a log, starting over with every new run", () => {
    const log = new WallContactLog();
    const field = new WobbleField();
    const out = new Float32Array(WOBBLE_SAMPLES);
    log.record(2, 1, 1, 100);
    log.record(2, 2, 1, 120);
    expect(field.sync(log)).toBe(2);
    expect(field.sync(log)).toBe(0);
    log.record(5, 3, -1, 130);
    expect(field.sync(log)).toBe(1);
    expect(field.sample(5, 140, out)).toBeGreaterThan(0.5);
    // Invalid contacts are ignored.
    log.record(-1, 0, 1, 0);
    log.record(1, NaN, 1, 0);
    log.record(1, 0, 0, 0);
    expect(log.serial).toBe(3);
    // A restart: the old contacts are gone.
    log.clear();
    expect(field.sync(log)).toBe(0);
    expect(field.sample(2, 140, out)).toBe(0);
    // More contacts between two frames than the log holds: only the newest ones arrive.
    for (let i = 0; i < CONTACT_LOG_CAPACITY + 40; i++) log.record(1, 0.01 * i, 1, 200);
    expect(log.oldestSerial()).toBe(log.serial - CONTACT_LOG_CAPACITY);
    expect(field.sync(log)).toBe(CONTACT_LOG_CAPACITY);
  });
});

describe("wobbly walls in the engine", () => {
  it("logs every ring hit of a Classic run – render-only, the same for the same seed", () => {
    const run = (seed: number) => {
      const engine = createEngineForSettings(config, "classic", modeSettings, seed);
      const events: SoundEvent[] = [];
      for (let i = 0; i < 240; i++) {
        engine.update(1000 / 60, 0);
        events.push(...engine.consumeSoundEvents());
      }
      return { engine, events };
    };
    const { engine, events } = run(9);
    const log = engine.getWallContacts();
    const hits = events.filter((e) => e.type === "hit").length;
    const contacts = log.serial - log.runStart;
    expect(contacts).toBeGreaterThan(0);
    // One contact per ring hit (a perfectly grazing hit has no strength and is skipped).
    expect(contacts).toBeLessThanOrEqual(hits);
    expect(contacts).toBeGreaterThanOrEqual(hits - 2);
    for (let s = log.oldestSerial(); s < log.serial; s++) {
      const k = log.indexOf(s);
      expect(log.wall[k]).toBeLessThan(engine.getCircularWalls().length);
      expect(Math.abs(log.strength[k])).toBeGreaterThan(0);
      expect(Math.abs(log.strength[k])).toBeLessThanOrEqual(MAX_WOBBLE_STRENGTH);
      expect(log.timeMs[k]).toBeLessThanOrEqual(engine.getElapsedMs());
    }
    // Deterministic: the same seed logs the same contacts.
    const again = run(9).engine.getWallContacts();
    expect(Array.from(again.angle.slice(0, again.serial))).toEqual(Array.from(log.angle.slice(0, log.serial)));
    // A restart starts a new run of the log.
    const generation = log.generation;
    engine.initMode("classic");
    expect(log.generation).toBe(generation + 1);
    expect(log.oldestSerial()).toBe(log.serial);
  });

  it("never moves a wall further than its full amplitude, even where balls wedge between rings or grow into them", () => {
    // What the canvas does every frame: copy the new contacts, sample every live wall, scale by the wall's amplitude.
    // Shatter in a small arena (a ball wedged between two rings touches both every step), Grow (the ball grows back
    // into its wall) and Multiply (a crowd of balls) once bulged 3–12× the amplitude, far across the next rings.
    const out = new Float32Array(WOBBLE_SAMPLES);
    for (const [mode, width, height, seeds] of [
      ["shatter", 790, 445, [1, 2]],
      ["grow", 800, 600, [1]],
      ["multiply", 800, 600, [2]],
    ] as [ModeId, number, number, number[]][]) {
      let worstPx = 0;
      let worstShare = 0;
      let live = 0;
      for (const seed of seeds) {
        const engine = createEngineForSettings({ ...config, width, height }, mode, modeSettings, seed);
        const field = new WobbleField();
        for (let i = 0; i < 1800 && !engine.isSimulationFinished(); i++) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
          field.sync(engine.getWallContacts());
          const walls = engine.getCircularWalls();
          const now = engine.getElapsedMs();
          for (let w = 0; w < walls.length; w++) {
            if (!field.isLive(w, now)) continue;
            live++;
            const share = field.sample(w, now, out);
            worstShare = Math.max(worstShare, share);
            worstPx = Math.max(worstPx, share * wobbleAmplitudePx(1, walls[w].radius));
          }
        }
      }
      expect(live, mode).toBeGreaterThan(100);
      expect(worstShare, mode).toBeLessThanOrEqual(1);
      expect(worstPx, mode).toBeLessThanOrEqual(WOBBLE_MAX_PX);
    }
  });

  it("the setting: off by default, clamped, offered in the circular modes", () => {
    expect(DEFAULT_WALL_WOBBLE).toBe(0);
    expect(resolveWallWobble(0.4)).toBe(0.4);
    expect(resolveWallWobble("0.25")).toBe(0.25);
    expect(resolveWallWobble(3)).toBe(1);
    expect(resolveWallWobble(-1)).toBe(0);
    expect(resolveWallWobble("x")).toBe(0);
    expect(resolveWallWobble(undefined)).toBe(0);
    expect(WOBBLE_MODES).toContain("classic");
    expect(WOBBLE_MODES).toContain("illusion");
    expect(WOBBLE_MODES).toContain("collide");
    expect(WOBBLE_MODES).not.toContain("drop");
    expect(WOBBLE_MODES).not.toContain("box");
    // The slider shows while a circular wall is in play: the Collision Playground only with its circle container.
    expect(wallWobbleOffered({ mode: "classic" })).toBe(true);
    expect(wallWobbleOffered({ mode: "illusion" })).toBe(true);
    expect(wallWobbleOffered({ mode: "collide", cpContainer: "circle", cpRing: false })).toBe(true);
    expect(wallWobbleOffered({ mode: "collide", cpContainer: "box", cpRing: false })).toBe(false);
    expect(wallWobbleOffered({ mode: "collide", cpContainer: "circle", cpRing: true })).toBe(false);
    expect(wallWobbleOffered({ mode: "drop" })).toBe(false);
    const engine = new PhysicsEngine(config);
    expect(engine.getWallContacts().serial).toBe(0);
  });

  it("logs the Collision Playground's circle container hits as wall 0, pushed outward where the orb hit – never the box's", () => {
    const run = (container: "circle" | "box", ring = false) => {
      const engine = createEngineForSettings(config, "collide", { ...modeSettings, collide: { container, ring } }, 5);
      const log = engine.getWallContacts();
      const angles: number[] = [];
      let misplaced = 0;
      for (let i = 0; i < 300; i++) {
        const before = log.serial;
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        // A contact's angle points from the container's centre at an orb touching the wall in that step.
        const view = engine.getCollideView();
        const f = view.field!;
        for (let s = Math.max(before, log.oldestSerial()); s < log.serial; s++) {
          const k = log.indexOf(s);
          angles.push(log.angle[k]);
          expect(log.wall[k]).toBe(0);
          expect(log.strength[k]).toBeGreaterThan(0);
          expect(log.strength[k]).toBeLessThanOrEqual(MAX_WOBBLE_STRENGTH);
          const near = engine.getBalls().some((b) => {
            const d = Math.hypot(b.x - f.cx, b.y - f.cy);
            const off = Math.abs(wrapAngle(Math.atan2(b.y - f.cy, b.x - f.cx) - log.angle[k]));
            return d + b.radius > f.radius - 0.2 * f.radius && off < 0.5;
          });
          if (!near) misplaced++;
        }
      }
      return { engine, contacts: log.serial - log.runStart, wallHits: engine.getCollideView().wallHits, misplaced, angles };
    };
    const circle = run("circle");
    expect(circle.wallHits).toBeGreaterThan(5);
    // Every real impact of the circle (the ones that sound and squash) is a wobble contact; resting orbs are not.
    expect(circle.contacts).toBe(circle.wallHits);
    expect(circle.misplaced).toBe(0);
    expect(new Set(circle.angles.map((a) => Math.round(a))).size).toBeGreaterThan(2);
    const box = run("box");
    expect(box.wallHits).toBeGreaterThan(5);
    expect(box.contacts).toBe(0);
    expect(run("circle", true).contacts).toBe(0);
  });
});
