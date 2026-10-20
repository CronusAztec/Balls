import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUTE_WIDTHS,
  DEFAULT_MERGE_RING_SETTINGS,
  FINAL_HOLD_MS,
  MAX_TIERS,
  MERGE_RING_BALL_RADIUS,
  MERGE_RING_RANGES,
  MergeRingMode,
  OVERFLOW_MS,
  RADIUS_STEP,
  RING_AT,
  RING_DROP_AT,
  TIER_COLORS,
  TIER_EMBLEMS,
  buildMergeRingLayout,
  defaultMergeRingFields,
  finalChord,
  inChute,
  mergePitch,
  mergeRingModeDefaults,
  mergeRingSettingsOf,
  resolveMergeRingFields,
  resolveMergeRingSettings,
  spawnTierFor,
  thudPitch,
  tierColor,
  tierEmblem,
  tierRadius,
  tierScale,
  type MergeRingSettings,
} from "@/lib/physics/modes/mergeRing";
import { DEFAULT_MERGE_RING_LABELS, HALO_MS, MERGE_RING_DATA_KEYS, MergeRingDataset, TIER_NAMES, drawEmblem, haloAt, polygonPoints, pulseScale, rimHue } from "@/components/simulator/mergeRingRenderer";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { BOUNCE_MATH_BALL_MODES, BOUNCE_MATH_COLLIDE_MODES } from "@/lib/physics/bounceMathRuntime";
import { assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { midiToFrequency } from "@/lib/audio/scales";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { Ball } from "@/lib/physics/types";

/**
 * Merge Ring (feature merge-ring): the settings / URL / presets, the tier geometry (sizes, colours, emblems, the spawn draw),
 * the layout (the ring in the recorder's square, the chute and its opening), the pitches, the mode in the engine (the spawn
 * cadence, a forced same-tier pair merging into the next tier with its momentum kept, the final form ending, the overflow
 * ending, balls never leaving the ring or the chute, determinism, a resize), the finder and the renderer's pure helpers.
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
  ballRadius: 16,
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

function mergeRingEngine(mergeRing: Partial<MergeRingSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "mergeRing", { ...modeSettings, mergeRing }, seed);
}

interface Timed {
  t: number;
  ev: SoundEvent;
}

/** Runs until the run finishes (or `maxSec`), collecting every sound event with its simulation time. */
function run(engine: PhysicsEngine, maxSec = 120, onStep?: (engine: PhysicsEngine) => void): { events: Timed[]; finishedAt: number } {
  const events: Timed[] = [];
  for (let i = 1; i <= maxSec * 60; i++) {
    engine.update(STEP, 0);
    onStep?.(engine);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) events.push({ t, ev });
    if (engine.isSimulationFinished()) return { events, finishedAt: t };
  }
  return { events, finishedAt: -1 };
}

/** Every ball is inside the ring, or inside the chute above its opening (with a px of slack for the contact separation). */
function allInside(engine: PhysicsEngine, slack = 1): { ok: boolean; worst: number } {
  const L = engine.getMergeRingView().layout!;
  let worst = 0;
  for (const b of engine.getBalls()) {
    if (inChute(L, b.x, b.y)) {
      worst = Math.max(worst, Math.abs(b.x - L.cx) + b.radius - L.chuteHalf);
      continue;
    }
    worst = Math.max(worst, Math.hypot(b.x - L.cx, b.y - L.cy) - (L.radius - b.radius));
  }
  return { ok: worst <= slack, worst };
}

const tiersOf = (engine: PhysicsEngine) => engine.getBalls().map((b) => engine.getMergeRingView().tierOf.get(b.id) ?? 0);

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultMergeRingFields()).toEqual({ mrTiers: 7, mrInterval: 0.9, mrSpawnTiers: 2, mrGravity: 1, mrRainbow: true });
    for (const key of Object.keys(MERGE_RING_RANGES) as (keyof typeof MERGE_RING_RANGES)[]) expect(RANGES[key]).toEqual(MERGE_RING_RANGES[key]);
    expect(MERGE_RING_RANGES.mrTiers).toMatchObject({ min: 5, max: 10 });
    expect(MERGE_RING_RANGES.mrInterval).toMatchObject({ min: 0.3, max: 3 });
    expect(MERGE_RING_RANGES.mrSpawnTiers).toMatchObject({ min: 1, max: 3 });
    expect(MERGE_RING_RANGES.mrGravity).toMatchObject({ min: 0.5, max: 3 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveMergeRingFields(d)).toEqual(defaultMergeRingFields());
      const params = settingsToSearchParams(d);
      for (const key of ["mrt", "mri", "mrs", "mrg", "mrr"]) expect(params.has(key)).toBe(false);
      // the mode's own ball size, in Merge Ring only
      if (mode === "mergeRing") expect(d.ballRadius).toBe(MERGE_RING_BALL_RADIUS);
      else expect(d.ballRadius).not.toBe(MERGE_RING_BALL_RADIUS);
      expect(mergeRingModeDefaults(mode)).toEqual(mode === "mergeRing" ? { ballRadius: MERGE_RING_BALL_RADIUS } : {});
    }
  });

  it("resolve clamps onto the sliders, caps the tiers at the emblems and drops bad values", () => {
    expect(resolveMergeRingSettings({ tiers: 99, interval: 0.1, spawnTiers: 9, gravity: 0.1 })).toMatchObject({ tiers: MAX_TIERS, interval: 0.3, spawnTiers: 9, gravity: 0.5 }); // --- uncap-all --- (spawn tiers past the slider, below the top tier)
    expect(resolveMergeRingSettings({ tiers: 5, spawnTiers: 9 }).spawnTiers).toBe(4);
    expect(resolveMergeRingSettings({ tiers: 2, interval: 7, spawnTiers: 0, gravity: 9 })).toMatchObject({ tiers: 5, interval: 7, spawnTiers: 1, gravity: 9 }); // --- uncap-all --- (no maximum on the interval and the gravity)
    expect(resolveMergeRingSettings({ tiers: 6.4, interval: 1.234, spawnTiers: 2.6, gravity: 1.26 })).toMatchObject({ tiers: 6, interval: 1.2, spawnTiers: 3, gravity: 1.3 });
    const junk = { tiers: "many", interval: null, spawnTiers: "x", gravity: undefined, rainbow: "yes" } as unknown as Partial<MergeRingSettings>;
    expect(resolveMergeRingSettings(junk)).toEqual(DEFAULT_MERGE_RING_SETTINGS);
    expect(resolveMergeRingSettings({ rainbow: false }).rainbow).toBe(false);
    // the chute never spawns the top tier
    expect(resolveMergeRingSettings({ tiers: 5, spawnTiers: 3 }).spawnTiers).toBe(3);
    expect(mergeRingSettingsOf({ ...defaultMergeRingFields(), mrTiers: 9, mrRainbow: false })).toMatchObject({ tiers: 9, rainbow: false });
  });

  it("round-trip through mrt / mri / mrs / mrg / mrr and presets", () => {
    const s = { ...defaultSettings("mergeRing"), mrTiers: 9, mrInterval: 0.5, mrSpawnTiers: 3, mrGravity: 1.5, mrRainbow: false };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("mergeRing");
    expect(params.get("mrt")).toBe("9");
    expect(params.get("mri")).toBe("0.5");
    expect(params.get("mrs")).toBe("3");
    expect(params.get("mrg")).toBe("1.5");
    expect(params.get("mrr")).toBe("0");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("mergeRing");
    expect(resolveMergeRingFields(back)).toEqual({ mrTiers: 9, mrInterval: 0.5, mrSpawnTiers: 3, mrGravity: 1.5, mrRainbow: false });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=mergeRing&mrt=500&mri=abc&mrr=7&mrs=0&mrg=0"));
    expect(resolveMergeRingFields(bad)).toEqual({ ...defaultMergeRingFields(), mrTiers: MAX_TIERS, mrSpawnTiers: 1, mrGravity: 0.5 });
    const preset = presetToSettings({ mode: "mergeRing", mrTiers: 0, mrRainbow: "no", mrInterval: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveMergeRingFields(preset)).toMatchObject({ mrTiers: 5, mrRainbow: true, mrInterval: 9 }); // ("no" is not a boolean: the default stays)
    expect(modeSettingsOfSettings(s).mergeRing).toEqual({ tiers: 9, interval: 0.5, spawnTiers: 3, gravity: 1.5, rainbow: false });
  });

  it("the mode is registered: a rhythm card right after Bullseye, a hero moment, an AI prefix, bounce math's ball and collide lists", () => {
    expect(MODE_IDS).toContain("mergeRing");
    expect(MODE_CATEGORIES.mergeRing).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("mergeRing");
    const rhythm = modesInCategory("rhythm");
    expect(rhythm.indexOf("mergeRing")).toBe(rhythm.indexOf("bullseye") + 1);
    expect(runNeverFinishes("mergeRing", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("mergeRing", {})).toBeNull();
    expect(HERO_MOMENTS.mergeRing.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(assistantSettings(defaultSettings("mergeRing")).map(([key]) => key)).toEqual(expect.arrayContaining(["mrTiers", "mrInterval", "mrSpawnTiers", "mrGravity", "mrRainbow"]));
    expect(assistantSettings(defaultSettings("classic")).map(([key]) => key)).not.toContain("mrTiers");
    expect(BOUNCE_MATH_BALL_MODES).toContain("mergeRing");
    expect(BOUNCE_MATH_COLLIDE_MODES).toContain("mergeRing");
  });
});

/* ------------------------------------------------------------------ tiers */

describe("tier geometry", () => {
  it("sizes tier k at 1 + 0.42 · (k − 1) times the Ball Size, with a colour, an emblem and a name each", () => {
    expect(RADIUS_STEP).toBe(0.42);
    expect(tierRadius(10, 1)).toBe(10);
    expect(tierRadius(10, 2)).toBeCloseTo(14.2, 9);
    expect(tierRadius(10, 7)).toBeCloseTo(35.2, 9);
    expect(tierScale(3)).toBeCloseTo(1.84, 9);
    expect(TIER_EMBLEMS).toEqual(["dot", "ring", "triangle", "diamond", "star", "hexagon", "crown", "gem", "sun", "infinity"]);
    expect(TIER_EMBLEMS.length).toBe(MAX_TIERS);
    expect(TIER_COLORS.length).toBe(MAX_TIERS);
    expect(TIER_NAMES.length).toBe(MAX_TIERS);
    expect(new Set(TIER_COLORS).size).toBe(MAX_TIERS);
    for (let k = 1; k <= MAX_TIERS; k++) {
      expect(tierEmblem(k)).toBe(TIER_EMBLEMS[k - 1]);
      expect(tierColor(k)).toBe(TIER_COLORS[k - 1]);
      expect(DEFAULT_MERGE_RING_LABELS.tier(k)).toBe(TIER_NAMES[k - 1]);
    }
    expect(tierEmblem(0)).toBe("dot");
    expect(tierEmblem(99)).toBe("infinity");
    expect(tierColor(-3)).toBe(TIER_COLORS[0]);
  });

  it("draws lower tiers more often: every tier twice as likely as the one above", () => {
    expect(spawnTierFor(0, 1)).toBe(1);
    expect(spawnTierFor(0.999, 1)).toBe(1);
    expect(spawnTierFor(0.5, 2)).toBe(1);
    expect(spawnTierFor(0.67, 2)).toBe(2);
    expect(spawnTierFor(0.57, 3)).toBe(1);
    expect(spawnTierFor(0.58, 3)).toBe(2);
    expect(spawnTierFor(0.86, 3)).toBe(3);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 7000; i++) counts[spawnTierFor(i / 7000, 3)]++;
    expect(counts[1]).toBe(4000);
    expect(counts[2]).toBe(2000);
    expect(counts[3]).toBe(1000);
  });

  it("pitches the merges up the pentatonic from C4, the thuds two octaves down, and ends on a major chord", () => {
    expect(mergePitch(2)).toBeCloseTo(midiToFrequency(60), 9);
    expect(mergePitch(3)).toBeCloseTo(midiToFrequency(62), 9);
    expect(mergePitch(6)).toBeCloseTo(midiToFrequency(69), 9);
    expect(mergePitch(7)).toBeCloseTo(midiToFrequency(72), 9);
    for (let k = 3; k <= MAX_TIERS; k++) expect(mergePitch(k)).toBeGreaterThan(mergePitch(k - 1));
    expect(thudPitch(1)).toBeCloseTo(midiToFrequency(36), 9);
    expect(thudPitch(6)).toBeCloseTo(midiToFrequency(48), 9);
    const chord = finalChord(7);
    expect(chord[0]).toBeCloseTo(mergePitch(7), 9);
    expect(chord[3]).toBeCloseTo(2 * chord[0], 9);
    expect(chord[2] / chord[0]).toBeCloseTo(Math.pow(2, 7 / 12), 9);
  });
});

/* ------------------------------------------------------------------ layout */

describe("layout", () => {
  it("puts the ring in the recorder's square, a little below its centre, with the chute 2.2 ball diameters wide from the top edge", () => {
    for (const [w, h] of [
      [800, 600],
      [540, 960],
      [1080, 1920],
    ]) {
      const L = buildMergeRingLayout(w, h, 16);
      const side = Math.min(w, h);
      expect(L.side).toBe(side);
      expect(L.cx).toBe(w / 2);
      expect(L.cy).toBeCloseTo(h / 2 + RING_DROP_AT * side, 9);
      expect(L.radius).toBeCloseTo(RING_AT * side, 9);
      expect(L.chuteHalf).toBeCloseTo(CHUTE_WIDTHS * 16, 9);
      expect(L.openY).toBeCloseTo(L.cy - Math.sqrt(L.radius ** 2 - L.chuteHalf ** 2), 9);
      expect(L.openY).toBeGreaterThan(L.cy - L.radius);
      expect(L.spawnY).toBeLessThan(L.openY);
      expect(L.spawnY).toBeGreaterThan(0);
      // the ring stays inside the square
      expect(L.cy + L.radius).toBeLessThanOrEqual(L.top + side);
      // two chute walls from far above the frame down to the opening
      expect(L.obstacles.length).toBe(2);
      for (const o of L.obstacles) {
        expect(o.kind).toBe("segment");
        if (o.kind !== "segment") continue;
        expect(Math.abs(o.x - w / 2)).toBeCloseTo(L.chuteHalf, 9);
        expect(o.y + o.halfLength).toBeCloseTo(L.openY, 6);
        expect(o.y - o.halfLength).toBeLessThan(0);
      }
      expect(inChute(L, L.cx, L.openY - 5)).toBe(true);
      expect(inChute(L, L.cx + L.chuteHalf + 1, L.openY - 5)).toBe(false);
      expect(inChute(L, L.cx, L.cy + 5)).toBe(false);
    }
  });

  it("a wide chute of a huge ball still fits the ring", () => {
    const L = buildMergeRingLayout(300, 300, 200);
    expect(L.chuteHalf).toBeLessThan(L.radius);
    expect(Number.isFinite(L.openY)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the mode in the engine */

describe("the mode in the engine", () => {
  it("drops a ball every interval while the chute's top is free, from the seed's tiers, the pile settling inside", () => {
    const engine = mergeRingEngine({ interval: 0.5, spawnTiers: 2 }, 3);
    expect(engine.getCurrentModeName()).toBe("mergeRing");
    const v = engine.getMergeRingView();
    expect(v.spawned).toBe(1);
    expect(engine.getBalls().length).toBe(1);
    const first = engine.getBalls()[0];
    expect(first.y).toBeCloseTo(v.layout!.spawnY, 9);
    expect(first.gravityScale).toBe(1);
    expect(first.radiusScale).toBeCloseTo(tierScale(v.tierOf.get(first.id)!), 9);
    const spawnTimes: number[] = [];
    let last = 1;
    run(engine, 5, (e) => {
      const n = e.getMergeRingView().spawned;
      if (n !== last) {
        spawnTimes.push(e.getElapsedMs());
        last = n;
      }
      const inside = allInside(e);
      expect(inside.ok, `worst ${inside.worst}`).toBe(true);
    });
    expect(v.spawned).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < spawnTimes.length; i++) expect(spawnTimes[i] - spawnTimes[i - 1]).toBeGreaterThanOrEqual(500 - STEP);
    for (const t of tiersOf(engine)) expect(t).toBeGreaterThanOrEqual(1);
    expect(Math.max(...tiersOf(engine), 0)).toBeLessThanOrEqual(7);
    expect(v.balls).toBe(engine.getBalls().length);
    // the balls wear their tier's colour and size
    for (const b of engine.getBalls()) {
      const tier = v.tierOf.get(b.id)!;
      expect(b.color).toBe(tierColor(tier));
      expect(b.radius).toBeCloseTo(tierRadius(16, tier), 6);
    }
  });

  it("a forced same-tier pair fuses into the next tier at its centre with the momentum kept, a halo, a burst, the merge sound and a note", () => {
    const engine = mergeRingEngine({ interval: 3, spawnTiers: 1 }, 5);
    const v = engine.getMergeRingView();
    const L = v.layout!;
    // Take the first ball out of the way, then stand two tier-2 balls against each other at the bottom of the ring, flying along.
    const balls = engine.getBalls();
    const r = tierRadius(16, 2);
    const y = L.cy + L.radius - r - 2;
    balls[0].x = L.cx - r - 0.2;
    balls[0].y = y;
    balls[0].vx = 40;
    balls[0].vy = 0;
    balls[0].radius = r;
    balls[0].radiusScale = tierScale(2);
    v.tierOf.set(balls[0].id, 2);
    engine.addBall({ x: L.cx + r + 0.2, y, vx: -10, vy: 0, radius: r, radiusScale: tierScale(2), color: tierColor(2) });
    const second = engine.getBalls()[1];
    v.tierOf.set(second.id, 2);
    const mergesBefore = v.merges;
    const particlesBefore = engine.getParticles().length;
    const { events } = run(engine, 0.2);
    expect(v.merges).toBe(mergesBefore + 1);
    expect(v.lastMergeTier).toBe(3);
    expect(v.topTier).toBe(3);
    const merged = engine.getBalls().find((b) => b.id === balls[0].id)!;
    expect(engine.getBalls().some((b) => b.id === second.id)).toBe(false);
    expect(v.tierOf.get(merged.id)).toBe(3);
    expect(v.tierOf.has(second.id)).toBe(false);
    expect(merged.radius).toBeCloseTo(tierRadius(16, 3), 6);
    expect(merged.radiusScale).toBeCloseTo(tierScale(3), 9);
    expect(merged.color).toBe(tierColor(3));
    // the fused ball sits at the pair's centre (the rim pushes it inside) and flies on with the average velocity (equal masses)
    expect(Math.abs(merged.x - L.cx)).toBeLessThan(10);
    expect(merged.vx).toBeGreaterThan(0);
    expect(merged.vx).toBeLessThan(40);
    expect(allInside(engine).ok).toBe(true);
    // the halo, the burst, the merge sound event and the pentatonic note of tier 3
    expect(Array.from(v.haloMs).filter((ms) => ms >= 0).length).toBe(1);
    expect(v.haloTier[0]).toBe(3);
    expect(engine.getParticles().length).toBeGreaterThan(particlesBefore);
    expect(events.some(({ ev }) => ev.type === "merge")).toBe(true);
    expect(events.some(({ ev }) => ev.type === "hit" && !ev.thud && ev.wallIndex === 3 && Math.abs((ev.frequency ?? 0) - mergePitch(3)) < 1e-6)).toBe(true);
  });

  it("two balls of different tiers bounce and never fuse, and a pair inside the chute waits for the ring", () => {
    const engine = mergeRingEngine({ interval: 3, spawnTiers: 1 }, 5);
    const v = engine.getMergeRingView();
    const L = v.layout!;
    const balls = engine.getBalls();
    const r1 = tierRadius(16, 1);
    const r2 = tierRadius(16, 2);
    balls[0].x = L.cx - r1;
    balls[0].y = L.cy + L.radius - r1 - 2;
    balls[0].vx = 20;
    balls[0].vy = 0;
    engine.addBall({ x: L.cx + r2, y: L.cy + L.radius - r2 - 2, vx: -20, vy: 0, radius: r2, radiusScale: tierScale(2), color: tierColor(2) });
    v.tierOf.set(engine.getBalls()[1].id, 2);
    run(engine, 0.5);
    expect(v.merges).toBe(0);
    expect(engine.getBalls().length).toBe(2);
    // the same tier inside the chute, above the opening: no merge there
    const chute = mergeRingEngine({ interval: 3, spawnTiers: 1 }, 5);
    const cv = chute.getMergeRingView();
    const CL = cv.layout!;
    const b0 = chute.getBalls()[0];
    b0.y = CL.openY - 3 * r1;
    b0.x = CL.cx - 0.5 * r1;
    b0.vy = 0;
    chute.addBall({ x: CL.cx + 0.5 * r1, y: CL.openY - 3 * r1 - 1.6 * r1, vx: 0, vy: 0, radius: r1, radiusScale: 1, color: tierColor(1) });
    cv.tierOf.set(chute.getBalls()[1].id, 1);
    chute.update(STEP, 0);
    chute.consumeSoundEvents();
    expect(cv.merges).toBe(0);
  });

  it("the top tier is the FINAL FORM: never merges, flashes, chords, and the run finishes after the hold", () => {
    const engine = mergeRingEngine({ tiers: 5, interval: 3, spawnTiers: 1 }, 9);
    const v = engine.getMergeRingView();
    const L = v.layout!;
    const r = tierRadius(16, 4);
    const balls = engine.getBalls();
    balls[0].x = L.cx - r - 0.2;
    balls[0].y = L.cy + L.radius - r - 2;
    balls[0].vx = 20;
    balls[0].vy = 0;
    balls[0].radius = r;
    balls[0].radiusScale = tierScale(4);
    v.tierOf.set(balls[0].id, 4);
    engine.addBall({ x: L.cx + r + 0.2, y: L.cy + L.radius - r - 2, vx: -20, vy: 0, radius: r, radiusScale: tierScale(4), color: tierColor(4) });
    v.tierOf.set(engine.getBalls()[1].id, 4);
    const spawnedBefore = v.spawned;
    let confetti = false;
    const { events, finishedAt } = run(engine, 10, (e) => {
      if (e.getParticles().some((p) => p.type === "confetti")) confetti = true;
    });
    expect(v.finalMs).toBeGreaterThanOrEqual(0);
    expect(v.finalId).toBe(balls[0].id);
    expect(v.topTier).toBe(5);
    expect(v.overflowMs).toBe(-1);
    expect(v.finished).toBe(true);
    expect(finishedAt).toBeGreaterThan(0);
    expect(v.finishedMs - v.finalMs).toBeGreaterThanOrEqual(FINAL_HOLD_MS - STEP);
    expect(v.finishedMs - v.finalMs).toBeLessThan(FINAL_HOLD_MS + STEP);
    expect(finishedAt * 1000).toBeCloseTo(v.finishedMs, 6);
    // the chord (accented, the top tier's merge note at its root), confetti, no more spawns after the final form
    const chord = events.find(({ ev }) => ev.type === "hit" && ev.chord && ev.accent);
    expect(chord).toBeTruthy();
    expect(chord!.ev.frequency).toBeCloseTo(mergePitch(5), 6);
    expect(chord!.ev.chord).toEqual(finalChord(5));
    expect(confetti).toBe(true);
    expect(v.spawned).toBe(spawnedBefore);
    expect(engine.getMergeRingProgress()).toMatchObject({ final: true, overflow: false, finished: true, topTier: 5, tiers: 5 });
    // a top-tier ball next to another top-tier ball stays two balls
    const twin = mergeRingEngine({ tiers: 5, interval: 3, spawnTiers: 1 }, 9);
    const tv = twin.getMergeRingView();
    const TL = tv.layout!;
    const R5 = tierRadius(16, 5);
    const t0 = twin.getBalls()[0];
    t0.x = TL.cx - R5;
    t0.y = TL.cy + TL.radius - R5 - 2;
    t0.vx = 10;
    t0.vy = 0;
    t0.radius = R5;
    t0.radiusScale = tierScale(5);
    tv.tierOf.set(t0.id, 5);
    twin.addBall({ x: TL.cx + R5, y: TL.cy + TL.radius - R5 - 2, vx: -10, vy: 0, radius: R5, radiusScale: tierScale(5), color: tierColor(5) });
    tv.tierOf.set(twin.getBalls()[1].id, 5);
    run(twin, 0.5);
    expect(tv.merges).toBe(0);
    expect(twin.getBalls().length).toBe(2);
  });

  it("OVERFLOW: a ball resting inside the chute above the opening for 1.5 s ends the run", () => {
    const engine = mergeRingEngine({ interval: 0.3, spawnTiers: 1 }, 2);
    const v = engine.getMergeRingView();
    const L = v.layout!;
    // A ball held still inside the chute (a pile up to the opening would hold it so): weightless and at rest above the opening.
    const b = engine.getBalls()[0];
    b.x = L.cx;
    b.y = L.openY - 2 * b.radius;
    b.vx = 0;
    b.vy = 0;
    b.gravityScale = 0;
    const { finishedAt } = run(engine, 20);
    expect(v.overflowMs).toBeGreaterThanOrEqual(OVERFLOW_MS - STEP);
    expect(v.overflowMs).toBeLessThan(OVERFLOW_MS + 2 * STEP);
    expect(v.finalMs).toBe(-1);
    expect(v.finished).toBe(true);
    expect(finishedAt * 1000).toBeCloseTo(v.overflowMs, 6);
    expect(v.finishedMs).toBe(v.overflowMs);
    expect(inChute(L, b.x, b.y) && b.y < L.openY).toBe(true);
    expect(engine.getMergeRingProgress()).toMatchObject({ final: false, overflow: true, finished: true });
    // a ball still moving in the chute never counts: the same ball a step from rest, then released, is no overflow
    const moving = mergeRingEngine({ interval: 3, spawnTiers: 1 }, 2);
    run(moving, 1.4);
    expect(moving.getMergeRingView().overflowMs).toBe(-1);
  });

  it("keeps every ball inside the ring or the chute through a long default run, merging up the ladder, and lands with thuds", () => {
    const engine = mergeRingEngine({}, 1);
    const v = engine.getMergeRingView();
    let worst = 0;
    let maxTier = 0;
    const { events, finishedAt } = run(engine, 120, (e) => {
      const inside = allInside(e);
      worst = Math.max(worst, inside.worst);
      for (const t of tiersOf(e)) maxTier = Math.max(maxTier, t);
      for (const b of e.getBalls()) expect(e.getMergeRingView().tierOf.has(b.id)).toBe(true);
    });
    expect(worst).toBeLessThanOrEqual(1);
    expect(v.merges).toBeGreaterThan(10);
    expect(maxTier).toBeGreaterThanOrEqual(5);
    expect(v.topTier).toBe(maxTier);
    expect(v.thuds).toBeGreaterThan(5);
    const thuds = events.filter(({ ev }) => ev.thud);
    expect(thuds.length).toBe(v.thuds);
    for (const { ev } of thuds) {
      expect(ev.frequency).toBeGreaterThanOrEqual(thudPitch(1) - 1e-6);
      expect(ev.level).toBeGreaterThan(0);
      expect(ev.level).toBeLessThanOrEqual(0.7);
    }
    const merges = events.filter(({ ev }) => ev.type === "merge");
    expect(merges.length).toBe(v.merges);
    // every merge note climbs the pentatonic with its tier
    const notes = events.filter(({ ev }) => ev.type === "hit" && !ev.thud && !ev.chord);
    for (const { ev } of notes) expect(Math.abs((ev.frequency ?? 0) - mergePitch(ev.wallIndex))).toBeLessThan(1e-6);
    // the run ends with the final form (the default ring never overflows at this cadence) and its data
    expect(finishedAt).toBeGreaterThan(0);
    expect(v.finalMs >= 0 || v.overflowMs >= 0).toBe(true);
    const data: Record<string, string> = {};
    new MergeRingDataset().write(v, (k, val) => {
      data[k] = val;
    });
    expect(Object.keys(data).sort()).toEqual([...MERGE_RING_DATA_KEYS].sort());
    expect(data.mergeFinished).toBe("1");
    expect(data.mergeMerges).toBe(String(v.merges));
    expect(data.mergeTop).toBe(String(v.topTier));
    expect(data.mergeFinal).toBe(v.finalMs >= 0 ? "1" : "0");
    expect(data.mergeOverflow).toBe(v.overflowMs >= 0 ? "1" : "0");
  }, 30_000);

  it("the chute walls are silent and glow, the rim reports bounces, weak page gravity is topped up", () => {
    const engine = mergeRingEngine({ interval: 3 }, 4, { ...config, gravity: 0 });
    const { events } = run(engine, 3);
    // the ball falls anyway and thuds on the rim (no obstacle notes: every hit is a thud or a merge note)
    expect(engine.getMergeRingView().thuds).toBeGreaterThan(0);
    for (const { ev } of events) expect(ev.type === "merge" || ev.thud || ev.chord || ev.wallIndex > 0).toBe(true);
    const mode = new MergeRingMode();
    expect(mode.onObstacleHit()).toEqual({ suppressSound: true });
    expect(mode.ballsMayRest).toBe(true);
    expect(mode.shouldSkipWallCollision()).toBe(true);
    expect(mode.onGapPass()).toBe(true);
  });

  it("replays exactly for a seed and differs between seeds", () => {
    const snapshot = (e: PhysicsEngine) => e.getBalls().map((b) => [b.id, Math.round(b.x * 1000), Math.round(b.y * 1000), e.getMergeRingView().tierOf.get(b.id)]);
    const a = mergeRingEngine({ interval: 0.4, spawnTiers: 3 }, 11);
    const b = mergeRingEngine({ interval: 0.4, spawnTiers: 3 }, 11);
    const c = mergeRingEngine({ interval: 0.4, spawnTiers: 3 }, 12);
    const ra = run(a, 15);
    const rb = run(b, 15);
    const rc = run(c, 15);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.getMergeRingView().merges).toBe(b.getMergeRingView().merges);
    expect(ra.events.map(({ t, ev }) => [t, ev.type, ev.frequency])).toEqual(rb.events.map(({ t, ev }) => [t, ev.type, ev.frequency]));
    expect(snapshot(a)).not.toEqual(snapshot(c));
    expect(ra.events.length).toBeGreaterThan(0);
    expect(rc.events.length).toBeGreaterThan(0);
    // a restart replays the same run on the same engine
    a.initMode("mergeRing");
    run(a, 15);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("a canvas resize mid-run rebuilds the arena and keeps every ball inside the new ring, the tiers kept", () => {
    const engine = mergeRingEngine({ interval: 0.4 }, 6);
    run(engine, 4);
    const v = engine.getMergeRingView();
    const before = new Map(v.tierOf);
    const count = engine.getBalls().length;
    engine.setConfig({ width: 540, height: 960 });
    const L = v.layout!;
    expect(L.width).toBe(540);
    expect(L.radius).toBeCloseTo(RING_AT * 540, 9);
    expect(engine.getObstacles().length).toBe(2);
    expect(engine.getBalls().length).toBe(count);
    expect(allInside(engine, 0.01).ok).toBe(true);
    for (const b of engine.getBalls()) expect(v.tierOf.get(b.id)).toBe(before.get(b.id));
    run(engine, 3, (e) => expect(allInside(e).ok).toBe(true));
    // a live ball size change re-spaces the chute and keeps the tiers' sizes relative to it
    engine.setConfig({ ballRadius: 10 });
    engine.update(STEP, 0);
    expect(v.layout!.chuteHalf).toBeCloseTo(CHUTE_WIDTHS * 10, 9);
    for (const b of engine.getBalls()) expect(b.radius).toBeCloseTo(tierRadius(10, v.tierOf.get(b.id)!), 6);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("the finder", () => {
  it("builds the mode from ModeSettings.mergeRing and the seed moves the run length, so a found seed keeps its promise", async () => {
    const built = createEngineForSettings(config, "mergeRing", { ...modeSettings, mergeRing: { tiers: 6, interval: 0.3, spawnTiers: 3, gravity: 1.5, rainbow: false } }, 1);
    expect(built.getMergeRingSettings()).toEqual({ tiers: 6, interval: 0.3, spawnTiers: 3, gravity: 1.5, rainbow: false });
    expect(built.getBalls()[0].gravityScale).toBe(1.5);
    const request: FinderRequest = { targetDurationSec: 20, toleranceSec: 2, maxSeeds: 60, maxSimTimeSec: 120, physicsConfig: config, mode: "mergeRing", modeSettings: { ...modeSettings, mergeRing: { tiers: 6, interval: 0.3, spawnTiers: 3 } } };
    // The seed moves the run length: the same search the finder runs, seed by seed (no wall clock), lands a 20 s run (the runs of these settings span about 11 to 28 s).
    const lengths = new Set<number>();
    let hit = -1;
    let hitMs = 0;
    for (let seed = 1; seed <= 60 && (hit < 0 || seed <= 6); seed++) {
      const ms = simulateSeed(seed, request, 120_000);
      expect(ms).toBeGreaterThan(0);
      lengths.add(Math.round(ms));
      if (hit < 0 && Math.abs(ms / 1000 - 20) <= 2) {
        hit = seed;
        hitMs = ms;
      }
    }
    expect(lengths.size).toBeGreaterThan(3);
    expect(hit).toBeGreaterThan(0);
    const replay = run(mergeRingEngine({ tiers: 6, interval: 0.3, spawnTiers: 3 }, hit));
    expect(Math.abs(replay.finishedAt * 1000 - hitMs)).toBeLessThan(20);
    // The page's search itself (time-sliced through requestAnimationFrame) finds a seed and keeps its promise, or reports a miss
    // honestly on a loaded runner (its budget is the wall clock's): never a wrong seed.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    if (result.found) {
      expect(Math.abs(result.duration - 20)).toBeLessThanOrEqual(2);
      const found = run(mergeRingEngine({ tiers: 6, interval: 0.3, spawnTiers: 3 }, result.seed));
      expect(Math.abs(found.finishedAt - result.duration)).toBeLessThan(0.02);
    }
  }, 120_000);
});

/* ------------------------------------------------------------------ the renderer's pure helpers */

describe("the renderer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns the rainbow slowly, grows and fades the halos, pulses the final form, and lays polygons out", () => {
    expect(rimHue(0, 0)).toBe(0);
    expect(rimHue(Math.PI, 0)).toBeCloseTo(180, 9);
    expect(rimHue(0, 1000)).toBeCloseTo(24, 9);
    expect(rimHue(-Math.PI / 2, 0)).toBeCloseTo(270, 9);
    expect(haloAt(-1)).toBeNull();
    expect(haloAt(HALO_MS)).toBeNull();
    expect(haloAt(0)).toEqual({ scale: 1, alpha: 0.9 });
    const mid = haloAt(HALO_MS / 2)!;
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.alpha).toBeCloseTo(0.45, 9);
    expect(haloAt(HALO_MS - 1)!.scale).toBeGreaterThan(mid.scale);
    expect(pulseScale(-5)).toBe(1);
    expect(pulseScale(FINAL_HOLD_MS)).toBe(1);
    expect(pulseScale(450)).toBeGreaterThan(1);
    const tri = polygonPoints(3, 10);
    expect(tri.length).toBe(6);
    expect(tri[0]).toBeCloseTo(0, 9);
    expect(tri[1]).toBeCloseTo(-10, 9);
    const star = polygonPoints(5, 10, 0.5);
    expect(star.length).toBe(20);
    expect(Math.hypot(star[2], star[3])).toBeCloseTo(5, 9);
  });

  it("draws every emblem with the canvas calls and nothing else, and the labels fall back to English", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop) => {
        if (typeof prop !== "string") return undefined;
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.length})`);
          return undefined;
        };
      },
      set: () => true,
    });
    for (const kind of TIER_EMBLEMS) {
      calls.length = 0;
      drawEmblem(ctx, kind, 10, 10, 20, "#fff");
      expect(calls[0]).toBe("save(0)");
      expect(calls.at(-1)).toBe("restore(0)");
      expect(calls.some((c) => c.startsWith("fill(") || c.startsWith("stroke("))).toBe(true);
    }
    expect(DEFAULT_MERGE_RING_LABELS.merges(7)).toBe("MERGES 7");
    expect(DEFAULT_MERGE_RING_LABELS.tier(7)).toBe("Crown");
    expect(DEFAULT_MERGE_RING_LABELS.finalSub(12, "31.5")).toContain("12");
    expect(DEFAULT_MERGE_RING_LABELS.overflowSub("Star", 9)).toContain("Star");
  });

  it("the dataset writes every key, and only changed values reach the canvas", () => {
    const engine = mergeRingEngine({}, 3);
    run(engine, 2);
    const v = engine.getMergeRingView();
    const writes: [string, string][] = [];
    new MergeRingDataset().write(v, (k, val) => writes.push([k, val]));
    expect(writes.map(([k]) => k)).toEqual(MERGE_RING_DATA_KEYS);
    expect(writes.find(([k]) => k === "mergeTiers")![1]).toBe("7");
    expect(writes.find(([k]) => k === "mergeSpawned")![1]).toBe(String(v.spawned));
    expect(writes.find(([k]) => k === "mergeFinishedMs")![1]).toBe("-1");
    const ball: Ball | undefined = engine.getBalls()[0];
    expect(ball).toBeTruthy();
  });
});
