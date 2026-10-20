import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BALL_FIT,
  BALL_HUES,
  CLEAR_HOLD_MS,
  DEFAULT_SPIRAL_GLASS_SETTINGS,
  HUE_DEG_PER_SEC,
  HUE_START,
  MAX_SPIRAL_BALLS,
  MAX_TURNS,
  MULTIPLY_COOLDOWN_MS,
  OUTER_AT,
  SPIRAL_GLASS_BALL_RADIUS,
  SPIRAL_GLASS_RANGES,
  SpiralGlassMode,
  TAIL_TURNS,
  TILES_PER_TURN,
  TIMEOUT_MS,
  ballColorAt,
  ballHueAt,
  bandInner,
  bandOf,
  bandOuter,
  buildSpiralGlassLayout,
  chipPitch,
  clearChord,
  defaultSpiralGlassFields,
  inTail,
  lineHue,
  linePoint,
  outerBoundary,
  pointOf,
  polarOf,
  resolveSpiralGlassFields,
  resolveSpiralGlassSettings,
  spawnPoint,
  spiralGlassModeDefaults,
  spiralGlassSettingsOf,
  tileIndex,
  tileOf,
  wrapPhi,
  type SpiralGlassSettings,
} from "@/lib/physics/modes/spiralGlass";
import { DEFAULT_SPIRAL_GLASS_LABELS, SPIRAL_GLASS_DATA_KEYS, SpiralGlassDataset, SpiralGlassLayer, clearedSeconds, flashAt, glassLeft, popAt, shardFill, tileFill } from "@/components/simulator/spiralGlassRenderer";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { BOUNCE_MATH_BREAK_MODES, BOUNCE_MATH_COLLIDE_MODES } from "@/lib/physics/bounceMathRuntime";
import { assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { MODE_WALL_BREAK_SOUNDS, modeWallBreakSound } from "@/lib/audio/songs";
import { midiToFrequency } from "@/lib/audio/scales";
import type { PhysicsEngine } from "@/lib/physics/engine";

/**
 * Spiral Glass (feature spiral-glass): the settings / URL / presets, the spiral geometry (polar frames, bands, tiles, the
 * outer wall, the mouth), the colours and pitches, the mode in the engine (balls never inside intact glass nor outside the
 * outer wall, chips taking hit points and throwing shards, the outer band eroding before the inner ones, the multiply on a
 * lap past the entrance with the cap and the cooldown, the cleared ending with its chord and hold, the timeout, determinism,
 * a resize), the finder and the renderer's pure helpers.
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
  ballRadius: 11,
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
const TWO_PI = Math.PI * 2;

function spiralEngine(spiralGlass: Partial<SpiralGlassSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "spiralGlass", { ...modeSettings, spiralGlass }, seed);
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

/** The worst violation over the balls: outside the outer wall, or a ball's inner edge inside a tile that still has glass (px). */
function worstPlacement(engine: PhysicsEngine): number {
  const v = engine.getSpiralGlassView();
  const L = v.layout!;
  let worst = 0;
  for (const b of engine.getBalls()) {
    const { rho, phi } = polarOf(L, b.x, b.y);
    worst = Math.max(worst, rho + b.radius - outerBoundary(L, phi));
    const inner = rho - b.radius + 1.5;
    const c = bandOf(L, inner, phi);
    if (c >= 0 && c < L.turns && v.hp[tileIndex(c, tileOf(phi))] > 0) worst = Math.max(worst, bandOuter(L, c, phi) - inner);
  }
  return worst;
}

/** Tiles still standing per band, outermost band first. */
function bandsLeft(engine: PhysicsEngine): number[] {
  const v = engine.getSpiralGlassView();
  const out: number[] = [];
  for (let c = v.layout!.turns - 1; c >= 0; c--) {
    let n = 0;
    for (let i = 0; i < TILES_PER_TURN; i++) if (v.hp[tileIndex(c, i)] > 0) n++;
    out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultSpiralGlassFields()).toEqual({ sgTurns: 6, sgGlassHp: 2, sgSpeed: 0.8, sgMaxBalls: 40, sgRainbow: true, sgChipEvery: 0.25 });
    for (const key of Object.keys(SPIRAL_GLASS_RANGES) as (keyof typeof SPIRAL_GLASS_RANGES)[]) expect(RANGES[key]).toEqual(SPIRAL_GLASS_RANGES[key]);
    expect(SPIRAL_GLASS_RANGES.sgTurns).toMatchObject({ min: 3, max: 10 });
    expect(SPIRAL_GLASS_RANGES.sgGlassHp).toMatchObject({ min: 1, max: 5 });
    expect(SPIRAL_GLASS_RANGES.sgSpeed).toMatchObject({ min: 0.3, max: 2 });
    expect(SPIRAL_GLASS_RANGES.sgMaxBalls).toMatchObject({ min: 1, max: 100 });
    expect(SPIRAL_GLASS_RANGES.sgChipEvery).toMatchObject({ min: 0.1, max: 1 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveSpiralGlassFields(d)).toEqual(defaultSpiralGlassFields());
      const params = settingsToSearchParams(d);
      for (const key of ["sgt", "sgh", "sgv", "sgm", "sgr", "sgc"]) expect(params.has(key)).toBe(false);
      if (mode === "spiralGlass") expect(d.ballRadius).toBe(SPIRAL_GLASS_BALL_RADIUS);
      expect(spiralGlassModeDefaults(mode)).toEqual(mode === "spiralGlass" ? { ballRadius: SPIRAL_GLASS_BALL_RADIUS } : {});
    }
  });

  it("resolve clamps onto the sliders, caps the turns and the balls at their ceilings and drops bad values", () => {
    expect(resolveSpiralGlassSettings({ turns: 99, glassHp: 0, speed: 0.01, maxBalls: 9999, chipEvery: 0 })).toMatchObject({ turns: MAX_TURNS, glassHp: 1, speed: 0.3, maxBalls: MAX_SPIRAL_BALLS, chipEvery: 0.1 });
    expect(resolveSpiralGlassSettings({ turns: 1, glassHp: 9, speed: 7, maxBalls: 0, chipEvery: 3 })).toMatchObject({ turns: 3, glassHp: 9, speed: 7, maxBalls: 1, chipEvery: 3 }); // --- uncap-all --- (no maximum on the hit points, the speed and the chip time)
    expect(resolveSpiralGlassSettings({ turns: 6.4, glassHp: 2.6, speed: 1.234, maxBalls: 12.2, chipEvery: 0.333 })).toMatchObject({ turns: 6, glassHp: 3, speed: 1.2, maxBalls: 12, chipEvery: 0.35 });
    const junk = { turns: "many", glassHp: null, speed: "x", maxBalls: undefined, rainbow: "yes", chipEvery: NaN } as unknown as Partial<SpiralGlassSettings>;
    expect(resolveSpiralGlassSettings(junk)).toEqual(DEFAULT_SPIRAL_GLASS_SETTINGS);
    expect(resolveSpiralGlassSettings(null)).toEqual(DEFAULT_SPIRAL_GLASS_SETTINGS);
    expect(resolveSpiralGlassSettings({ rainbow: false }).rainbow).toBe(false);
    expect(spiralGlassSettingsOf({ ...defaultSpiralGlassFields(), sgTurns: 9, sgRainbow: false })).toMatchObject({ turns: 9, rainbow: false });
  });

  it("round-trip through sgt / sgh / sgv / sgm / sgr / sgc and presets", () => {
    const s = { ...defaultSettings("spiralGlass"), sgTurns: 8, sgGlassHp: 3, sgSpeed: 1.2, sgMaxBalls: 25, sgRainbow: false, sgChipEvery: 0.5 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("spiralGlass");
    expect(params.get("sgt")).toBe("8");
    expect(params.get("sgh")).toBe("3");
    expect(params.get("sgv")).toBe("1.2");
    expect(params.get("sgm")).toBe("25");
    expect(params.get("sgr")).toBe("0");
    expect(params.get("sgc")).toBe("0.5");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("spiralGlass");
    expect(resolveSpiralGlassFields(back)).toEqual({ sgTurns: 8, sgGlassHp: 3, sgSpeed: 1.2, sgMaxBalls: 25, sgRainbow: false, sgChipEvery: 0.5 });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=spiralGlass&sgt=500&sgh=abc&sgr=7&sgm=0&sgv=0&sgc=-1"));
    expect(resolveSpiralGlassFields(bad)).toEqual({ ...defaultSpiralGlassFields(), sgTurns: MAX_TURNS, sgMaxBalls: 1, sgSpeed: 0.3, sgChipEvery: 0.1 });
    const preset = presetToSettings({ mode: "spiralGlass", sgTurns: 0, sgRainbow: "no", sgSpeed: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveSpiralGlassFields(preset)).toMatchObject({ sgTurns: 3, sgRainbow: true, sgSpeed: 9 }); // ("no" is not a boolean: the default stays)
    expect(modeSettingsOfSettings(s).spiralGlass).toEqual({ turns: 8, glassHp: 3, speed: 1.2, maxBalls: 25, rainbow: false, chipEvery: 0.5 });
  });

  it("the mode is registered: a rhythm card right after Merge Ring, a hero moment, an AI prefix, the glass clip, bounce math's break list", () => {
    expect(MODE_IDS).toContain("spiralGlass");
    expect(MODE_CATEGORIES.spiralGlass).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("spiralGlass");
    const rhythm = modesInCategory("rhythm");
    expect(rhythm.indexOf("spiralGlass")).toBe(rhythm.indexOf("mergeRing") + 1);
    expect(runNeverFinishes("spiralGlass", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("spiralGlass", {})).toBeNull();
    expect(HERO_MOMENTS.spiralGlass.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(assistantSettings(defaultSettings("spiralGlass")).map(([key]) => key)).toEqual(expect.arrayContaining(["sgTurns", "sgGlassHp", "sgSpeed", "sgMaxBalls", "sgRainbow", "sgChipEvery"]));
    expect(assistantSettings(defaultSettings("classic")).map(([key]) => key)).not.toContain("sgTurns");
    expect(MODE_WALL_BREAK_SOUNDS.spiralGlass).toBe("glass");
    expect(modeWallBreakSound("spiralGlass", null)).toMatch(/\/wallBreak\/glass\.wav$/);
    expect(modeWallBreakSound("spiralGlass", "custom")).toBe("custom");
    expect(BOUNCE_MATH_BREAK_MODES).toContain("spiralGlass");
    expect(BOUNCE_MATH_COLLIDE_MODES).not.toContain("spiralGlass");
  });
});

/* ------------------------------------------------------------------ geometry */

describe("the spiral geometry", () => {
  it("lays the spiral out in the recorder's square: the pitch divides the outer radius over the turns and the tail, the ball fits the channel", () => {
    for (const [w, h] of [
      [800, 600],
      [540, 960],
      [1080, 1920],
    ]) {
      const L = buildSpiralGlassLayout(w, h, 6, 11);
      const side = Math.min(w, h);
      expect(L.side).toBe(side);
      expect(L.cx).toBe(w / 2);
      expect(L.cy).toBeCloseTo(h / 2 + 0.02 * side, 9);
      expect(L.outerRadius).toBeCloseTo(OUTER_AT * side, 9);
      expect(L.pitch).toBeCloseTo((OUTER_AT * side) / (6 + TAIL_TURNS), 9);
      expect(L.turns).toBe(6);
      expect(L.ballRadius).toBe(11);
      expect(L.mouthPhi).toBeCloseTo(TWO_PI * (1 - TAIL_TURNS), 9);
      expect(L.spawnPhi).toBeGreaterThan(L.mouthPhi);
      // the spiral stays inside the square
      expect(L.cy + L.outerRadius).toBeLessThanOrEqual(L.top + side);
      expect(L.cy - L.outerRadius).toBeGreaterThanOrEqual(L.top);
      // the line: rho = pitch · t, turning counter-clockwise outward, its end at the mouth on the outer radius
      expect(linePoint(L, 0)).toEqual({ x: L.cx, y: L.cy });
      const end = linePoint(L, 6 + TAIL_TURNS);
      expect(Math.hypot(end.x - L.cx, end.y - L.cy)).toBeCloseTo(L.outerRadius, 6);
      expect(polarOf(L, end.x, end.y).phi).toBeCloseTo(L.mouthPhi, 6);
    }
    // a huge ball is cut down to the channel
    const big = buildSpiralGlassLayout(600, 600, 10, 500);
    expect(big.ballRadius).toBeCloseTo(BALL_FIT * big.pitch, 9);
    expect(big.requestedRadius).toBe(500);
    expect(buildSpiralGlassLayout(10, 10, 3, 1).side).toBe(60);
  });

  it("maps a point to its band and tile and back, the walls spiralling inward clockwise", () => {
    const L = buildSpiralGlassLayout(1000, 1000, 6, 10);
    const p = L.pitch;
    expect(wrapPhi(-0.5)).toBeCloseTo(TWO_PI - 0.5, 12);
    expect(wrapPhi(TWO_PI + 0.25)).toBeCloseTo(0.25, 12);
    // straight down is phi 0; clockwise on screen (down → left → up → right) is increasing phi
    expect(polarOf(L, L.cx, L.cy + 100)).toMatchObject({ rho: 100, phi: 0 });
    expect(polarOf(L, L.cx - 100, L.cy).phi).toBeCloseTo(Math.PI / 2, 9);
    expect(polarOf(L, L.cx, L.cy - 100).phi).toBeCloseTo(Math.PI, 9);
    expect(polarOf(L, L.cx + 100, L.cy).phi).toBeCloseTo(1.5 * Math.PI, 9);
    for (const [rho, phi] of [
      [0.5 * p, 0],
      [3.3 * p, 1],
      [5.9 * p, 4],
    ]) {
      const q = pointOf(L, rho, phi);
      const back = polarOf(L, q.x, q.y);
      expect(back.rho).toBeCloseTo(rho, 6);
      expect(back.phi).toBeCloseTo(phi, 9);
    }
    // on the entrance ray the walls sit on whole pitches: band c between pitch c and c + 1
    expect(bandOf(L, 2.5 * p, 0)).toBe(2);
    expect(bandInner(L, 2, 0)).toBeCloseTo(2 * p, 9);
    expect(bandOuter(L, 2, 0)).toBeCloseTo(3 * p, 9);
    // a quarter turn clockwise every wall has moved a quarter pitch inward
    expect(bandOuter(L, 2, Math.PI / 2)).toBeCloseTo(2.75 * p, 9);
    expect(bandOf(L, 2.8 * p, Math.PI / 2)).toBe(3);
    expect(bandInner(L, 0, 1)).toBe(0);
    // the walls on the line: every point of the line lies on a band boundary
    for (const t of [1, 2.5, 4.25, 5.9]) {
      const q = linePoint(L, t);
      const { rho, phi } = polarOf(L, q.x, q.y);
      expect(Math.abs(rho / p + phi / TWO_PI - Math.round(rho / p + phi / TWO_PI))).toBeLessThan(1e-6);
    }
    // tiles: 36 a turn, 10° each
    expect(tileOf(0)).toBe(0);
    expect(tileOf(TWO_PI / 36 - 1e-9)).toBe(0);
    expect(tileOf(TWO_PI / 36)).toBe(1);
    expect(tileOf(TWO_PI - 1e-9)).toBe(35);
    expect(tileOf(-0.01)).toBe(35);
    expect(tileIndex(5, 7)).toBe(5 * TILES_PER_TURN + 7);
    // the tail: the ramp's outer wall a pitch further out, from the mouth round to the entrance
    expect(inTail(L, L.mouthPhi - 0.01)).toBe(false);
    expect(inTail(L, L.mouthPhi + 0.01)).toBe(true);
    expect(inTail(L, TWO_PI - 0.01)).toBe(true);
    expect(outerBoundary(L, 0)).toBeCloseTo(6 * p, 9);
    expect(outerBoundary(L, L.mouthPhi - 1e-6)).toBeCloseTo(p * (6 - (1 - TAIL_TURNS)), 3);
    expect(outerBoundary(L, L.mouthPhi + 1e-6)).toBeCloseTo(p * (7 - (1 - TAIL_TURNS)), 3);
    expect(outerBoundary(L, L.mouthPhi + 1e-6)).toBeCloseTo(L.outerRadius, 3);
    expect(outerBoundary(L, TWO_PI - 1e-6)).toBeCloseTo(6 * p, 3);
    // the spawn point: in the ramp (band 6), the jitter moving it across the ramp
    const at = spawnPoint(L, 0);
    expect(at.phi).toBeCloseTo(L.spawnPhi, 12);
    expect(bandOf(L, at.rho, at.phi)).toBe(6);
    expect(spawnPoint(L, 1).rho).toBeGreaterThan(at.rho);
    expect(spawnPoint(L, -1).rho).toBeLessThan(at.rho);
    for (const j of [-1, 1]) {
      const q = spawnPoint(L, j);
      expect(q.rho - L.ballRadius).toBeGreaterThan(bandInner(L, 6, q.phi));
      expect(q.rho + L.ballRadius).toBeLessThan(bandOuter(L, 6, q.phi));
    }
  });

  it("colours the balls round a ring of hues, cycles the line's hue slowly, and pitches the chips up the pentatonic inward", () => {
    expect(new Set(BALL_HUES).size).toBe(BALL_HUES.length);
    expect(ballHueAt(0)).toBe(BALL_HUES[0]);
    expect(ballHueAt(BALL_HUES.length)).toBe(BALL_HUES[0]);
    expect(ballHueAt(-1)).toBe(BALL_HUES[BALL_HUES.length - 1]);
    expect(ballColorAt(1)).toBe(`hsl(${BALL_HUES[1]}, 85%, 60%)`);
    expect(lineHue(0)).toBe(HUE_START);
    expect(lineHue(1000)).toBeCloseTo((HUE_START + HUE_DEG_PER_SEC) % 360, 9);
    expect(lineHue(30_000)).toBeCloseTo(HUE_START, 6);
    expect(chipPitch(5, 6)).toBeCloseTo(midiToFrequency(60), 9);
    expect(chipPitch(4, 6)).toBeCloseTo(midiToFrequency(62), 9);
    expect(chipPitch(0, 6)).toBeCloseTo(midiToFrequency(72), 9);
    for (let c = 4; c >= 0; c--) expect(chipPitch(c, 6)).toBeGreaterThan(chipPitch(c + 1, 6));
    const chord = clearChord(6);
    expect(chord[0]).toBeCloseTo(chipPitch(0, 6), 9);
    expect(chord[3]).toBeCloseTo(2 * chord[0], 9);
    expect(chord[2] / chord[0]).toBeCloseTo(Math.pow(2, 7 / 12), 9);
  });
});

/* ------------------------------------------------------------------ the mode in the engine */

describe("the mode in the engine", () => {
  it("starts with one ball in the ramp, every tile standing, and bores the outer band open from the entrance clockwise", () => {
    const engine = spiralEngine({}, 3);
    expect(engine.getCurrentModeName()).toBe("spiralGlass");
    const v = engine.getSpiralGlassView();
    const L = v.layout!;
    expect(v.tilesTotal).toBe(6 * TILES_PER_TURN);
    expect(v.tilesLeft).toBe(v.tilesTotal);
    expect(v.hpTotal).toBe(2 * v.tilesTotal);
    expect(v.count).toBe(1);
    expect(engine.getBalls().length).toBe(1);
    const first = engine.getBalls()[0];
    expect(first.gravityScale).toBe(0);
    expect(first.radius).toBe(L.ballRadius);
    expect(first.color).toBe(ballColorAt(0));
    expect(bandOf(L, ...(({ rho, phi }) => [rho, phi] as const)(polarOf(L, first.x, first.y)))).toBe(6);
    let worst = 0;
    const { events } = run(engine, 12, (e) => {
      worst = Math.max(worst, worstPlacement(e));
    });
    expect(worst).toBeLessThanOrEqual(1);
    expect(v.chips).toBeGreaterThan(10);
    expect(v.hpLeft).toBe(v.hpTotal - v.chips);
    // the outer band goes first, its tiles from the entrance on; the inner bands stand
    const left = bandsLeft(engine);
    expect(left[0]).toBeLessThan(TILES_PER_TURN - 5);
    for (let c = 1; c < 6; c++) expect(left[c]).toBeGreaterThanOrEqual(TILES_PER_TURN - 1);
    const outer = 5;
    let firstStanding = -1;
    for (let i = 0; i < TILES_PER_TURN; i++) if (v.hp[tileIndex(outer, i)] > 0 && firstStanding < 0) firstStanding = i;
    expect(firstStanding).toBeGreaterThan(3);
    for (let i = 0; i < firstStanding; i++) expect(v.hp[tileIndex(outer, i)]).toBe(0);
    // chips play notes of the outer band's pitch, shatters the wall-break sound, and shards fly
    const notes = events.filter(({ ev }) => ev.type === "hit" && !ev.chord);
    expect(notes.length).toBeGreaterThan(5);
    for (const { ev } of notes) expect(Math.abs((ev.frequency ?? 0) - chipPitch(outer, 6))).toBeLessThan(1e-6);
    expect(events.filter(({ ev }) => ev.type === "gap").length).toBeGreaterThan(3);
    expect(v.shatters).toBe(v.tilesTotal - v.tilesLeft);
    expect(v.shardCount).toBeGreaterThan(0);
    expect(v.count).toBe(1);
  });

  it("a ball sunk into the glass is pushed back onto its outer wall, and the chip after chipEvery seconds takes a hit point and throws shards", () => {
    const engine = spiralEngine({ chipEvery: 0.2 }, 5);
    const v = engine.getSpiralGlassView();
    const L = v.layout!;
    run(engine, 12);
    // Where the outer band is bored open, put the ball deep inside band 4: it is pushed out onto band 4's outer wall and grinds that tile.
    const outer = 5;
    let phi = -1;
    for (let i = 3; i < TILES_PER_TURN; i++) if (v.hp[tileIndex(outer, i)] === 0 && v.hp[tileIndex(outer, i - 1)] === 0 && v.hp[tileIndex(outer, i - 2)] === 0) phi = ((i - 0.5) * TWO_PI) / TILES_PER_TURN;
    expect(phi).toBeGreaterThan(0);
    const ball = engine.getBalls()[0];
    const q = pointOf(L, bandInner(L, 4, phi) + 0.5 * L.pitch, phi);
    ball.x = q.x;
    ball.y = q.y;
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    const after = polarOf(L, ball.x, ball.y);
    expect(after.rho - L.ballRadius).toBeGreaterThanOrEqual(bandOuter(L, 4, after.phi) - 1);
    expect(worstPlacement(engine)).toBeLessThanOrEqual(1);
    const tile = tileIndex(4, tileOf(after.phi));
    const hpBefore = v.hp[tile] + v.hp[tile + 1];
    const chipsBefore = v.chips;
    v.shardCount = 0;
    const { events } = run(engine, 0.3);
    expect(v.chips).toBeGreaterThan(chipsBefore);
    expect(v.hp[tile] + v.hp[tile + 1]).toBeLessThan(hpBefore);
    expect(v.shardCount).toBeGreaterThan(0);
    expect(events.some(({ ev }) => ev.type === "hit" && Math.abs((ev.frequency ?? 0) - chipPitch(4, 6)) < 1e-6)).toBe(true);
    // a ball dropped into several intact bands at once climbs out of all of them, onto the outer wall if need be
    const deep = pointOf(L, 0.5 * L.pitch, Math.PI);
    ball.x = deep.x;
    ball.y = deep.y;
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    expect(worstPlacement(engine)).toBeLessThanOrEqual(1);
  });

  it("erodes the bands from the outside in through a default run and ends with GLASS CLEARED, its chord, confetti and the hold", () => {
    const engine = spiralEngine({}, 1);
    const v = engine.getSpiralGlassView();
    let worst = 0;
    let confetti = false;
    const firstGone: number[] = [-1, -1, -1, -1, -1, -1];
    const { events, finishedAt } = run(engine, 240, (e) => {
      worst = Math.max(worst, worstPlacement(e));
      const left = bandsLeft(e);
      for (let c = 0; c < 6; c++) if (left[c] === 0 && firstGone[c] < 0) firstGone[c] = e.getElapsedMs();
      if (e.getParticles().some((p) => p.type === "confetti")) confetti = true;
    });
    expect(worst).toBeLessThanOrEqual(1);
    expect(finishedAt).toBeGreaterThan(30);
    expect(finishedAt).toBeLessThan(240);
    expect(v.clearedMs).toBeGreaterThanOrEqual(0);
    expect(v.timeoutMs).toBe(-1);
    expect(v.tilesLeft).toBe(0);
    expect(v.hpLeft).toBe(0);
    expect(v.finished).toBe(true);
    expect(v.finishedMs - v.clearedMs).toBeGreaterThanOrEqual(CLEAR_HOLD_MS - STEP);
    expect(v.finishedMs - v.clearedMs).toBeLessThan(CLEAR_HOLD_MS + STEP);
    expect(finishedAt * 1000).toBeCloseTo(v.finishedMs, 6);
    // outside in: every band is gone before the one inside it
    for (let c = 0; c < 5; c++) {
      expect(firstGone[c]).toBeGreaterThan(0);
      expect(firstGone[c]).toBeLessThan(firstGone[c + 1]);
    }
    // the multiply: the count climbed to the cap and the balls with it, with the cooldown between counts
    expect(v.count).toBeGreaterThanOrEqual(15);
    expect(engine.getBalls().length).toBe(Math.min(40, v.spawned));
    expect(engine.getBalls().length).toBeLessThanOrEqual(40);
    const multiplies = events.filter(({ ev }) => ev.type === "multiplier");
    expect(multiplies.length).toBe(v.count - 1);
    for (let i = 1; i < multiplies.length; i++) expect(multiplies[i].t - multiplies[i - 1].t).toBeGreaterThanOrEqual(MULTIPLY_COOLDOWN_MS / 1000 - 0.02);
    for (const { ev } of multiplies) expect(ev.multiplier).toBeGreaterThan(1);
    // the chord (accented, the innermost band's note at its root), confetti, no more counts after the clear
    const chord = events.find(({ ev }) => ev.type === "hit" && ev.chord && ev.accent);
    expect(chord).toBeTruthy();
    expect(chord!.ev.frequency).toBeCloseTo(chipPitch(0, 6), 6);
    expect(chord!.ev.chord).toEqual(clearChord(6));
    expect(Math.abs(chord!.t * 1000 - v.clearedMs)).toBeLessThan(2 * STEP);
    expect(confetti).toBe(true);
    expect(multiplies.at(-1)!.t * 1000).toBeLessThanOrEqual(v.clearedMs + 1e-6);
    // every ball wears a hue of the ring, the colours spread
    for (const b of engine.getBalls()) expect(b.color).toBe(ballColorAt(v.hueOf.get(b.id)!));
    expect(new Set(engine.getBalls().map((b) => b.color)).size).toBeGreaterThan(5);
    expect(engine.getSpiralGlassProgress()).toMatchObject({ cleared: true, timeout: false, finished: true, tilesLeft: 0, tilesTotal: 216 });
    const data: Record<string, string> = {};
    new SpiralGlassDataset().write(v, (k, val) => {
      data[k] = val;
    });
    expect(Object.keys(data).sort()).toEqual([...SPIRAL_GLASS_DATA_KEYS].sort());
    expect(data.spiralFinished).toBe("1");
    expect(data.spiralCleared).toBe("1");
    expect(data.spiralTiles).toBe("0");
    expect(data.spiralCount).toBe(String(v.count));
  }, 60_000);

  it("multiplies on a lap past the entrance: a ball placed a step before the entrance ray counts and queues a new ball, the ramp's end never does, the cap holds", () => {
    const engine = spiralEngine({ maxBalls: 3 }, 2);
    const v = engine.getSpiralGlassView();
    const L = v.layout!;
    const ball = engine.getBalls()[0];
    const st = () => engine.spiralGlassMode.stateOf(ball.id)!;
    // the ramp's end: the first crossing (from the spawn angle round to 2π) is not a lap
    expect(st().crossed).toBe(0);
    run(engine, 3);
    expect(st().crossed).toBe(1);
    expect(v.count).toBe(1);
    // pretend the ball has been round once more: a step before the ray, its travel one lap short of the next multiple of 2π
    const inner = engine.spiralGlassMode as unknown as { state: Map<number, { travel: number; phi: number; rho: number }> };
    const raw = inner.state.get(ball.id)!;
    const phi = TWO_PI - 0.02;
    raw.phi = phi;
    raw.travel = 2 * TWO_PI - 0.02;
    const q = pointOf(L, raw.rho, phi);
    ball.x = q.x;
    ball.y = q.y;
    const { events } = run(engine, 0.5);
    expect(st().crossed).toBe(2);
    expect(v.count).toBe(2);
    expect(events.filter(({ ev }) => ev.type === "multiplier").length).toBe(1);
    expect(events.find(({ ev }) => ev.type === "multiplier")!.ev.multiplier).toBe(2);
    expect(Array.from(v.popMs).filter((ms) => ms >= 0).length).toBe(1);
    expect(v.popCount[0]).toBe(2);
    // the new ball came in at the mouth
    expect(engine.getBalls().length).toBe(2);
    const second = engine.getBalls()[1];
    expect(second.color).toBe(ballColorAt(1));
    expect(bandOf(L, ...(({ rho, phi: p }) => [rho, p] as const)(polarOf(L, second.x, second.y)))).toBeGreaterThanOrEqual(5);
    // the cap: two more laps (the cooldown apart) count on the badge but only one more ball comes in
    for (let k = 0; k < 2; k++) {
      run(engine, 3);
      const r = inner.state.get(ball.id)!;
      r.phi = phi;
      r.travel = (3 + k) * TWO_PI - 0.02;
      const p = pointOf(L, r.rho, phi);
      ball.x = p.x;
      ball.y = p.y;
      run(engine, 0.5);
    }
    expect(v.count).toBe(4);
    expect(engine.getBalls().length).toBe(3);
    // the cooldown: a lap right after a count is not counted
    const r = inner.state.get(ball.id)!;
    r.phi = phi;
    r.travel = 5 * TWO_PI - 0.02;
    const p = pointOf(L, r.rho, phi);
    ball.x = p.x;
    ball.y = p.y;
    run(engine, 0.2);
    expect(v.count).toBe(4);
  });

  it("holds every ball inside the outer wall and out of intact glass with a crowd, and the queue keeps balls off each other", () => {
    const engine = spiralEngine({ maxBalls: 60, speed: 1.5 }, 9);
    const v = engine.getSpiralGlassView();
    let worst = 0;
    let maxBalls = 0;
    run(engine, 70, (e) => {
      worst = Math.max(worst, worstPlacement(e));
      maxBalls = Math.max(maxBalls, e.getBalls().length);
      for (const b of e.getBalls()) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        expect(v.hueOf.has(b.id)).toBe(true);
      }
    });
    expect(worst).toBeLessThanOrEqual(1);
    expect(maxBalls).toBeGreaterThan(10);
    expect(maxBalls).toBeLessThanOrEqual(60);
    expect(v.chips).toBeGreaterThan(50);
    const mode = new SpiralGlassMode();
    expect(mode.ballsMayRest).toBe(true);
    expect(mode.ballsPassThrough).toBe(true);
    expect(mode.shouldSkipWallCollision()).toBe(true);
    expect(mode.onGapPass()).toBe(true);
  });

  it("TIMEOUT: a run that cannot clear the glass in ten minutes ends there", () => {
    // One slow ball, five hit points, a chip a second: 1080 hit points at one a second never clear in ten minutes.
    const engine = spiralEngine({ maxBalls: 1, glassHp: 5, chipEvery: 1, speed: 0.3 }, 4);
    const v = engine.getSpiralGlassView();
    const { finishedAt } = run(engine, 700);
    expect(v.timeoutMs).toBeGreaterThanOrEqual(TIMEOUT_MS - STEP);
    expect(v.timeoutMs).toBeLessThan(TIMEOUT_MS + 2 * STEP);
    expect(v.clearedMs).toBe(-1);
    expect(v.finished).toBe(true);
    expect(v.finishedMs).toBe(v.timeoutMs);
    expect(finishedAt * 1000).toBeCloseTo(v.timeoutMs, 6);
    expect(v.tilesLeft).toBeGreaterThan(0);
    expect(engine.getBalls().length).toBe(1);
    expect(v.count).toBeGreaterThan(1);
    expect(engine.getSpiralGlassProgress()).toMatchObject({ cleared: false, timeout: true, finished: true });
  }, 60_000);

  it("replays exactly for a seed and differs between seeds", () => {
    const snapshot = (e: PhysicsEngine) => e.getBalls().map((b) => [b.id, Math.round(b.x * 1000), Math.round(b.y * 1000)]);
    const a = spiralEngine({ speed: 1.2 }, 11);
    const b = spiralEngine({ speed: 1.2 }, 11);
    const c = spiralEngine({ speed: 1.2 }, 12);
    const ra = run(a, 25);
    const rb = run(b, 25);
    const rc = run(c, 25);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.getSpiralGlassView().chips).toBe(b.getSpiralGlassView().chips);
    expect(Array.from(a.getSpiralGlassView().hp)).toEqual(Array.from(b.getSpiralGlassView().hp));
    expect(ra.events.map(({ t, ev }) => [t, ev.type, ev.frequency])).toEqual(rb.events.map(({ t, ev }) => [t, ev.type, ev.frequency]));
    expect(snapshot(a)).not.toEqual(snapshot(c));
    expect(ra.events.length).toBeGreaterThan(0);
    expect(rc.events.length).toBeGreaterThan(0);
    // a restart replays the same run on the same engine
    a.initMode("spiralGlass");
    run(a, 25);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("a canvas resize mid-run rebuilds the spiral and keeps every ball at its polar place, the tiles kept", () => {
    const engine = spiralEngine({}, 6);
    run(engine, 20);
    const v = engine.getSpiralGlassView();
    const L0 = v.layout!;
    const before = engine.getBalls().map((b) => {
      const { rho, phi } = polarOf(L0, b.x, b.y);
      return { id: b.id, u: rho / L0.pitch, phi };
    });
    const hp = Array.from(v.hp);
    engine.setConfig({ width: 540, height: 960 });
    const L = v.layout!;
    expect(L.width).toBe(540);
    expect(L.outerRadius).toBeCloseTo(OUTER_AT * 540, 9);
    expect(Array.from(v.hp)).toEqual(hp);
    expect(engine.getBalls().length).toBe(before.length);
    for (const b of engine.getBalls()) {
      const was = before.find((x) => x.id === b.id)!;
      const { rho, phi } = polarOf(L, b.x, b.y);
      expect(rho / L.pitch).toBeCloseTo(was.u, 6);
      expect(phi).toBeCloseTo(was.phi, 6);
      expect(b.radius).toBe(L.ballRadius);
    }
    expect(worstPlacement(engine)).toBeLessThanOrEqual(1);
    run(engine, 5, (e) => expect(worstPlacement(e)).toBeLessThanOrEqual(1));
    // a live Ball Size change refits the balls (cut down to the channel)
    engine.setConfig({ ballRadius: 400 });
    engine.update(STEP, 0);
    expect(v.layout!.ballRadius).toBeCloseTo(BALL_FIT * v.layout!.pitch, 9);
    for (const b of engine.getBalls()) expect(b.radius).toBeCloseTo(v.layout!.ballRadius, 9);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("the finder", () => {
  it("builds the mode from ModeSettings.spiralGlass and the seed moves the run length, so a found seed keeps its promise", async () => {
    const built = createEngineForSettings(config, "spiralGlass", { ...modeSettings, spiralGlass: { turns: 4, glassHp: 1, speed: 1.5, maxBalls: 20, rainbow: false, chipEvery: 0.2 } }, 1);
    expect(built.getSpiralGlassSettings()).toEqual({ turns: 4, glassHp: 1, speed: 1.5, maxBalls: 20, rainbow: false, chipEvery: 0.2 });
    expect(built.getSpiralGlassView().tilesTotal).toBe(4 * TILES_PER_TURN);
    const sg = { turns: 4, glassHp: 1, speed: 1.5, maxBalls: 20, chipEvery: 0.2 };
    const request: FinderRequest = { targetDurationSec: 40, toleranceSec: 6, maxSeeds: 40, maxSimTimeSec: 120, physicsConfig: config, mode: "spiralGlass", modeSettings: { ...modeSettings, spiralGlass: sg } };
    const lengths = new Set<number>();
    let hit = -1;
    let hitMs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ms = simulateSeed(seed, request, 120_000);
      expect(ms).toBeGreaterThan(0);
      lengths.add(Math.round(ms / 100));
      if (hit < 0 && Math.abs(ms / 1000 - 40) <= 6) {
        hit = seed;
        hitMs = ms;
      }
    }
    expect(lengths.size).toBeGreaterThan(2);
    if (hit > 0) {
      const replay = run(spiralEngine(sg, hit));
      expect(Math.abs(replay.finishedAt * 1000 - hitMs)).toBeLessThan(20);
    }
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    if (result.found) {
      expect(Math.abs(result.duration - 40)).toBeLessThanOrEqual(6);
      const found = run(spiralEngine(sg, result.seed));
      expect(Math.abs(found.finishedAt - result.duration)).toBeLessThan(0.02);
    }
  }, 120_000);
});

/* ------------------------------------------------------------------ the renderer's pure helpers */

describe("the renderer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tints the glass after the hue, fades it with the hit points, grows the pops, flashes the clear and reads the glass left", () => {
    expect(tileFill(120, 2, 2)).toBe("hsla(120, 18%, 74%, 0.360)");
    expect(tileFill(120, 1, 2)).toBe("hsla(120, 18%, 74%, 0.260)");
    expect(tileFill(0, 1, 1, 0)).toBe("hsla(0, 0%, 74%, 0.360)");
    expect(shardFill(-1, 1)).toBe("rgba(255, 255, 255, 1.000)");
    expect(shardFill(200, 0.25)).toBe("hsla(200, 80%, 72%, 0.400)");
    expect(popAt(-1)).toBeNull();
    expect(popAt(600)).toBeNull();
    expect(popAt(0)).toEqual({ scale: 1.2, alpha: 0.9 });
    expect(popAt(300)!.scale).toBeGreaterThan(1.2);
    expect(flashAt(-1)).toBe(0);
    expect(flashAt(0)).toBe(1);
    expect(flashAt(350)).toBeCloseTo(0.5, 9);
    expect(flashAt(700)).toBe(0);
    expect(glassLeft({ hpLeft: 50, hpTotal: 200 })).toBe(0.25);
    expect(glassLeft({ hpLeft: 0, hpTotal: 0 })).toBe(0);
    expect(clearedSeconds({ clearedMs: 61_250 })).toBe("61.3");
    expect(DEFAULT_SPIRAL_GLASS_LABELS.tiles(12, 216)).toBe("TILES 12/216");
    expect(DEFAULT_SPIRAL_GLASS_LABELS.count(7)).toBe("x7");
    expect(DEFAULT_SPIRAL_GLASS_LABELS.clearedSub(40, "98.2")).toContain("40");
    expect(DEFAULT_SPIRAL_GLASS_LABELS.timeoutSub(9)).toContain("9");
  });

  it("draws the world, the effects and the overlay with the canvas calls and nothing else", () => {
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
    const engine = spiralEngine({}, 3);
    run(engine, 4);
    const v = engine.getSpiralGlassView();
    const layer = new SpiralGlassLayer();
    const opts = { wallAlpha: () => "#fff", wallThickness: 2, showWallGlow: true };
    for (const rainbow of [true, false]) {
      v.settings.rainbow = rainbow;
      calls.length = 0;
      layer.drawWorld(ctx, v, opts);
      expect(calls[0]).toBe("save(0)");
      expect(calls.at(-1)).toBe("restore(0)");
      expect(calls.filter((c) => c === "fill(0)").length).toBeGreaterThanOrEqual(v.tilesLeft);
      expect(calls.filter((c) => c === "stroke(0)").length).toBeGreaterThanOrEqual(1);
    }
    calls.length = 0;
    layer.drawEffects(ctx, v, DEFAULT_SPIRAL_GLASS_LABELS);
    expect(calls[0]).toBe("save(0)");
    expect(calls.at(-1)).toBe("restore(0)");
    expect(calls.filter((c) => c === "fillText(3)").length).toBeGreaterThanOrEqual(1);
    calls.length = 0;
    layer.drawOverlay(ctx, v, DEFAULT_SPIRAL_GLASS_LABELS, 52);
    expect(calls[0]).toBe("save(0)");
    expect(calls.at(-1)).toBe("restore(0)");
    expect(calls.filter((c) => c === "fillText(3)").length).toBe(4);
    // nothing drawn without a layout
    calls.length = 0;
    layer.drawWorld(ctx, { ...v, layout: null }, opts);
    layer.drawEffects(ctx, { ...v, layout: null }, DEFAULT_SPIRAL_GLASS_LABELS);
    layer.drawOverlay(ctx, { ...v, layout: null }, DEFAULT_SPIRAL_GLASS_LABELS);
    expect(calls.length).toBe(0);
  });

  it("the dataset writes every key, in order", () => {
    const engine = spiralEngine({}, 3);
    run(engine, 2);
    const v = engine.getSpiralGlassView();
    const writes: [string, string][] = [];
    new SpiralGlassDataset().write(v, (k, val) => writes.push([k, val]));
    expect(writes.map(([k]) => k)).toEqual(SPIRAL_GLASS_DATA_KEYS);
    expect(writes.find(([k]) => k === "spiralTilesTotal")![1]).toBe("216");
    expect(writes.find(([k]) => k === "spiralCount")![1]).toBe("1");
    expect(writes.find(([k]) => k === "spiralFinishedMs")![1]).toBe("-1");
  });
});
