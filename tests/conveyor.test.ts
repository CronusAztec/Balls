import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOWL_CAPACITY,
  CONVEYOR_ARENAS,
  CONVEYOR_RANGES,
  CV_ESCAPED,
  CV_FREE,
  CV_FROZEN,
  CV_GONE,
  DEFAULT_CONVEYOR_SETTINGS,
  FINAL_HOLD_MS,
  FREEZE_SEC,
  HUM_FREQUENCY,
  KIND_PEG,
  KIND_WALL,
  MAX_NOTES_PER_STEP,
  MIN_RADIUS,
  SIZE_SPREAD,
  conveyorBallColor,
  conveyorBallCount,
  conveyorBallScale,
  conveyorBowlHalfWidth,
  conveyorDropMs,
  conveyorHitFrequency,
  conveyorLoadMs,
  conveyorMaxScale,
  conveyorNominalRunSec,
  conveyorPassPitch,
  conveyorPegPitch,
  conveyorRideSec,
  conveyorRingRadii,
  conveyorRingWalls,
  conveyorSettingsOf,
  buildConveyorLayout,
  defaultConveyorFields,
  resolveConveyorFields,
  resolveConveyorSettings,
  ringTurnBy,
  steerFlight,
  steerToGap,
  STEER_DT,
  PATIENCE_SEC,
  PATIENCE_SPREAD_SEC,
  type ConveyorSettings,
  type GapSteer,
} from "@/lib/physics/modes/conveyor";
import { RESPAWN_MAX_BALLS, RESPAWN_MODES, RESPAWN_RANGES, RESPAWN_SPREAD, respawnApplies, respawnConfigOf, respawnDue, respawnSchedule, resolveRespawnEvery } from "@/lib/physics/respawn";
import { CLICK_TONE, DEFAULT_HUM_FREQUENCY, HUM_TONE, MAX_HUM_SEC, MIN_HUM_SEC, conveyorLevel, humLength, scheduleConveyorClick, scheduleConveyorHum } from "@/lib/audio/conveyorTones";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { CONVEYOR_DATA_KEYS, ConveyorDataset, DEFAULT_CONVEYOR_LABELS, conveyorBanner, conveyorCounter } from "@/components/simulator/conveyorRenderer";
import { PhysicsEngine } from "@/lib/physics/engine";
import { fakeGraph } from "./fakeAudio";

/**
 * Conveyor Belt and timed respawns (feature gerald-conveyor): the settings / URL / presets and the registration, the layout
 * of every arena, the schedule on the simulation clock (load and drop times, at any frame rate), the counters (loaded,
 * escaped and carried away; overflow; landed), freezing (the pile in the bowl, the rings' freedom, frozen balls as
 * obstacles), the director's steering, determinism, resizes, the end and the finder, the sounds (the belt's hum and click,
 * their synthesis and dispatch) and the respawn timer of Classic and Multiply.
 */

/** The 16:9 world every desktop frame runs (lib/simulation/world.ts). */
const config: PhysicsConfig = {
  width: 800,
  height: 450,
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

function conveyorEngine(conveyor: Partial<ConveyorSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "conveyor", { ...modeSettings, conveyor }, seed);
}

interface Timed {
  t: number;
  step: number;
  ev: SoundEvent;
}

/** Runs until the run finishes (or `maxSec`), collecting every sound event with its simulation time and step. */
function run(engine: PhysicsEngine, maxSec = 150, onStep?: (engine: PhysicsEngine) => void, frameMs = STEP): { events: Timed[]; finishedAt: number } {
  const events: Timed[] = [];
  let step = 0;
  while (engine.getElapsedMs() < maxSec * 1000) {
    engine.update(frameMs, 0);
    step++;
    onStep?.(engine);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) events.push({ t, step, ev });
    if (engine.isSimulationFinished()) return { events, finishedAt: t };
  }
  return { events, finishedAt: -1 };
}

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultConveyorFields()).toEqual({ cvInterval: 3, cvMaxBalls: 8, cvArena: "rings", cvFreeze: false, cvVariety: 0.5, respawnEvery: 0 });
    for (const key of Object.keys(CONVEYOR_RANGES) as (keyof typeof CONVEYOR_RANGES)[]) expect(RANGES[key]).toEqual(CONVEYOR_RANGES[key]);
    expect(RANGES.respawnEvery).toEqual(RESPAWN_RANGES.respawnEvery);
    expect(CONVEYOR_RANGES.cvInterval).toMatchObject({ min: 0.5, max: 10 });
    expect(CONVEYOR_RANGES.cvMaxBalls).toMatchObject({ min: 1, max: 200 });
    expect(RESPAWN_RANGES.respawnEvery).toMatchObject({ min: 0, max: 10 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveConveyorFields(d)).toEqual(defaultConveyorFields());
      const params = settingsToSearchParams(d);
      for (const key of ["cvi", "cvn", "cva", "cvf", "cvv", "rse"]) expect(params.has(key)).toBe(false);
    }
  });

  it("resolve validates every value (no maximum) and drops bad ones", () => {
    expect(resolveConveyorSettings({ interval: 0.1, maxBalls: 4.6, variety: 0.333 })).toMatchObject({ interval: 0.5, maxBalls: 5, variety: 0.35 });
    expect(resolveConveyorSettings({ interval: 25, maxBalls: 500, variety: 1.5 })).toMatchObject({ interval: 25, maxBalls: 500, variety: 1.5 }); // --- uncap-all --- (no maximum)
    expect(resolveConveyorSettings({ interval: 1.234 }).interval).toBe(1.2);
    const junk = { interval: "soon", maxBalls: null, arena: "moon", freeze: "yes", variety: "lots", scale: "klingon", rootNote: "x" } as unknown as Partial<ConveyorSettings>;
    expect(resolveConveyorSettings(junk)).toEqual(DEFAULT_CONVEYOR_SETTINGS);
    expect(resolveConveyorSettings({ rootNote: 14 }).rootNote).toBe(2);
    for (const arena of CONVEYOR_ARENAS) expect(resolveConveyorSettings({ arena }).arena).toBe(arena);
    expect(conveyorSettingsOf({ ...defaultConveyorFields(), cvArena: "pegs", scale: "minor", rootNote: 3 })).toMatchObject({ arena: "pegs", scale: "minor", rootNote: 3 });
    expect(resolveRespawnEvery(3)).toBe(3);
    expect(resolveRespawnEvery("4.5")).toBe(4.5);
    expect(resolveRespawnEvery(-2)).toBe(0);
    expect(resolveRespawnEvery("never")).toBe(0);
    expect(resolveRespawnEvery(Number.POSITIVE_INFINITY)).toBe(0);
    expect(resolveRespawnEvery(60)).toBe(60); // (uncapped)
  });

  it("round-trips through cvi / cvn / cva / cvf / cvv / rse and presets; rse never touches the Rotation Speed's rs", () => {
    const s = { ...defaultSettings("conveyor"), cvInterval: 1.5, cvMaxBalls: 40, cvArena: "bowl" as const, cvFreeze: true, cvVariety: 0.8 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("conveyor");
    expect(params.get("cvi")).toBe("1.5");
    expect(params.get("cvn")).toBe("40");
    expect(params.get("cva")).toBe("bowl");
    expect(params.get("cvf")).toBe("1");
    expect(params.get("cvv")).toBe("0.8");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("conveyor");
    expect(resolveConveyorFields(back)).toEqual({ cvInterval: 1.5, cvMaxBalls: 40, cvArena: "bowl", cvFreeze: true, cvVariety: 0.8, respawnEvery: 0 });
    // Past the sliders: kept (no maximum).
    const big = settingsFromSearchParams(settingsToSearchParams({ ...defaultSettings("conveyor"), cvMaxBalls: 500, cvInterval: 30 }));
    expect(big.cvMaxBalls).toBe(500);
    expect(big.cvInterval).toBe(30);
    // Bad values fall back (or onto the minimum).
    const bad = settingsFromSearchParams(new URLSearchParams("mode=conveyor&cvi=abc&cvn=0&cva=moon&cvf=7&cvv=-1"));
    expect(resolveConveyorFields(bad)).toEqual({ ...defaultConveyorFields(), cvMaxBalls: 1, cvVariety: 0 });
    // The respawn timer: its own key, next to the Rotation Speed's.
    const classic = { ...defaultSettings("classic"), respawnEvery: 3 };
    const cp = settingsToSearchParams(classic);
    expect(cp.get("rse")).toBe("3");
    const both = settingsFromSearchParams(new URLSearchParams("mode=classic&rs=2&rse=4.5"));
    expect(both.rotationSpeed).toBe(2);
    expect(both.respawnEvery).toBe(4.5);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&rse=-3")).respawnEvery).toBe(0);
    expect(settingsFromSearchParams(new URLSearchParams("mode=multiply&rse=25")).respawnEvery).toBe(25);
    // Presets go through the same resolver.
    const preset = presetToSettings({ mode: "conveyor", cvMaxBalls: 0, cvArena: "moon", cvFreeze: "no", cvInterval: 99, respawnEvery: -1 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveConveyorFields(preset)).toEqual({ ...defaultConveyorFields(), cvMaxBalls: 1, cvInterval: 99 });
  });

  it("the mode is registered: an escape card right before Power Layers; its settings (and the respawn timer) reach the engine", () => {
    expect(MODE_IDS).toContain("conveyor");
    expect(MODE_CATEGORIES.conveyor).toBe("escape");
    expect(MODE_CARD_ORDER.indexOf("conveyor")).toBe(MODE_CARD_ORDER.indexOf("powerLayers") - 1);
    expect(modesInCategory("escape")).toContain("conveyor");
    expect(runNeverFinishes("conveyor", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("conveyor", {})).toBeNull();
    for (const key of Object.keys(CONVEYOR_RANGES)) expect(engineSettingKeys("conveyor")).toContain(key);
    for (const mode of RESPAWN_MODES) expect(engineSettingKeys(mode)).toContain("respawnEvery");
    expect(RESPAWN_MODES).toEqual(["classic", "multiply"]);
    for (const mode of ["accumulation", "shatter", "conveyor", "drop"] as const) expect(engineSettingKeys(mode)).not.toContain("respawnEvery");
    // The bot's and the finder's view of the page.
    const page = { ...defaultSettings("conveyor"), cvArena: "pegs" as const, cvMaxBalls: 12 };
    expect(modeSettingsOfSettings(page).conveyor).toMatchObject({ arena: "pegs", maxBalls: 12 });
    expect(physicsConfigOfSettings({ ...defaultSettings("classic"), respawnEvery: 2.5 }).respawnEvery).toBe(2.5);
    expect("respawnEvery" in physicsConfigOfSettings(defaultSettings("classic"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ pure helpers */

describe("the schedule, the sizes and the colours", () => {
  it("ball k comes out at k × the interval and drops a ride later; the count keeps a memory-safe ceiling", () => {
    expect([0, 1, 2, 5].map((k) => conveyorLoadMs(k, 3))).toEqual([0, 3000, 6000, 15000]);
    expect(conveyorDropMs(2, 1.5, 1.1)).toBeCloseTo(4100, 9);
    expect(conveyorRideSec({ beltStartX: 100, dropX: 400, beltSpeed: 150 })).toBe(2);
    expect(conveyorRideSec({ beltStartX: 100, dropX: 400, beltSpeed: 0 })).toBe(0);
    expect(conveyorBallCount({ maxBalls: 8 })).toBe(8);
    expect(conveyorBallCount({ maxBalls: 0 })).toBe(1);
    expect(conveyorBallCount({ maxBalls: 10_000_000 })).toBeLessThanOrEqual(2000);
    // The panel's estimate: the last drop, a typical tail and the hold – the default lands near half a minute.
    const nominal = conveyorNominalRunSec(DEFAULT_CONVEYOR_SETTINGS);
    expect(nominal).toBeGreaterThan(28);
    expect(nominal).toBeLessThan(33);
    expect(conveyorNominalRunSec({ maxBalls: 16 })).toBeCloseTo(nominal + 8 * 3, 6);
  });

  it("Gerald is always the first ball at the Ball Size and the Ball Colour; the others vary with the variety", () => {
    expect(conveyorBallScale(0, 0.99, 1, 8)).toBe(1);
    expect(conveyorBallScale(3, 0.5, 1, 8)).toBe(1);
    expect(conveyorBallScale(3, 1, 1, 20)).toBeCloseTo(1 + SIZE_SPREAD, 9);
    expect(conveyorBallScale(3, 0, 1, 20)).toBeCloseTo(1 - SIZE_SPREAD, 9);
    expect(conveyorBallScale(3, 0, 1, 8) * 8).toBeCloseTo(MIN_RADIUS, 9);
    expect(conveyorBallScale(3, 0, 0, 8)).toBe(1);
    expect(conveyorBallScale(3, 0, 5, 8) * 8).toBeCloseTo(MIN_RADIUS, 9);
    expect(conveyorMaxScale(0.5)).toBeCloseTo(1 + 0.5 * SIZE_SPREAD, 9);
    expect(conveyorBallColor(0, 0, 0.3, 1, "#123456")).toBe("#123456");
    expect(conveyorBallColor(4, 0.9, 0.3, 0.5, "#123456")).toBe("#123456");
    expect(conveyorBallColor(4, 0.1, 0.3, 0.5, "#123456")).not.toBe("#123456");
    expect(conveyorBallColor(4, 0.1, 0.3, 0, "#123456")).toBe("#123456");
  });

  it("the sounds' pitches: bigger balls lower, the pegs a keyboard left to right, the passes climbing ring by ring", () => {
    expect(conveyorHitFrequency(8)).toBeGreaterThan(conveyorHitFrequency(12));
    expect(conveyorHitFrequency(1)).toBe(1760);
    expect(conveyorHitFrequency(1000)).toBe(110);
    const pegs = [1, 2, 3, 4, 5, 6].map((slot) => conveyorPegPitch(slot, "major", 0));
    for (let i = 1; i < pegs.length; i++) expect(pegs[i]).toBeGreaterThan(pegs[i - 1]);
    expect(pegs[0]).toBeCloseTo(261.63, 1);
    const passes = [0, 1, 2, 3].map((ring) => conveyorPassPitch(ring, "chromatic", 0));
    for (let i = 1; i < passes.length; i++) expect(passes[i]).toBeGreaterThan(passes[i - 1]);
    expect(passes[0]).toBeCloseTo(523.25, 1);
  });
});

/* ------------------------------------------------------------------ the layout */

describe("the layout", () => {
  it("a portrait field in the recorder's square: the belt along the top, the hatch on the left, the drop point in the middle", () => {
    for (const [w, h] of [
      [800, 450],
      [450, 450],
      [450, 800],
    ]) {
      for (const arena of CONVEYOR_ARENAS) {
        const L = buildConveyorLayout(w, h, arena, 8, conveyorMaxScale(0.5), 7);
        expect(L.fieldWidth).toBeLessThanOrEqual(Math.min(w, h) + 1e-6);
        expect(L.left).toBeGreaterThanOrEqual(0);
        expect(L.right).toBeLessThanOrEqual(w);
        expect(L.beltY).toBeLessThan(L.top + 0.1 * L.fieldHeight);
        expect(L.beltStartX).toBeGreaterThan(L.left);
        expect(L.dropX).toBeCloseTo(w / 2, 9);
        expect(conveyorRideSec(L)).toBeGreaterThan(0.5);
        expect(conveyorRideSec(L)).toBeLessThan(1.5);
        expect(L.kinds[0]).toBe(KIND_WALL);
        expect(L.kinds[1]).toBe(KIND_WALL);
        expect(L.kinds.length).toBe(L.obstacles.length);
        if (arena === "pegs") expect(L.bottomBeltY).toBe(-1);
        else {
          expect(L.bottomBeltY).toBeGreaterThan(L.top + 0.9 * L.fieldHeight);
          expect(L.exitX).toBeGreaterThan(L.right);
        }
      }
    }
  });

  it("rings: as many as fit for the biggest ball, centred on the canvas, gaps wide enough to pass", () => {
    expect(conveyorRingRadii(200, 60, 7, 8).length).toBeLessThanOrEqual(7);
    expect(conveyorRingRadii(200, 60, 3, 8)).toEqual([60, 130, 200]);
    expect(conveyorRingRadii(200, 60, 1, 8)).toEqual([200]);
    const radii = conveyorRingRadii(200, 60, 7, 8);
    for (let i = 1; i < radii.length; i++) expect(radii[i] - radii[i - 1]).toBeGreaterThanOrEqual(2.3 * 8 + 3 - 1e-9);
    const walls = conveyorRingWalls(radii, 0.4, 11);
    expect(walls.map((w) => w.radius)).toEqual(radii);
    for (const wall of walls) {
      expect(wall.gaps).toHaveLength(1);
      const span = wall.gaps[0].endAngle - wall.gaps[0].startAngle;
      expect(span).toBeGreaterThanOrEqual(0.4 * 1.5 - 1e-9);
      expect(span * wall.radius).toBeGreaterThan(2 * 11);
    }
    const L = buildConveyorLayout(800, 450, "rings", 8, conveyorMaxScale(0.5), 7);
    expect(L.ringRadii.length).toBeGreaterThanOrEqual(2);
    expect(L.ringRadii.at(-1)!).toBeLessThan(L.cy - L.ceilingY);
    expect(L.bowl).toBeNull();
    // The engine gets the rings (centred on the canvas, where the engine centres its walls).
    const engine = conveyorEngine();
    expect(engine.getCircularWalls().map((w) => w.radius)).toEqual(engine.getConveyorView().layout!.ringRadii);
  });

  it("bowl: sized by the balls, not the frame – the same bowl in every world shape, its rim at most a few depths below the belt", () => {
    const halves = [
      [800, 450],
      [450, 450],
      [450, 800],
      [450, 900],
    ].map(([w, h]) => {
      const L = buildConveyorLayout(w, h, "bowl", 8, conveyorMaxScale(0.5), 7);
      const b = L.bowl!;
      expect(b.rimY).toBeLessThan(b.arcTopY + 1e-9);
      expect(b.bottomY).toBeGreaterThan(b.arcTopY);
      expect(b.bottomY).toBeLessThan(L.bottomBeltY);
      expect(b.rimY - L.ceilingY).toBeLessThanOrEqual(2.2 * 1.3 * b.halfWidth + 1e-6);
      expect(L.kinds.filter((k) => k !== KIND_WALL).length).toBeGreaterThan(10);
      return b.halfWidth;
    });
    for (const h of halves) expect(h).toBeCloseTo(halves[0], 9);
    expect(conveyorBowlHalfWidth(16, 1, 1000, 16)).toBeCloseTo(2 * conveyorBowlHalfWidth(8, 1, 1000, 8), 9);
    expect(conveyorBowlHalfWidth(8, 2, 1000, 16)).toBeGreaterThan(conveyorBowlHalfWidth(8, 1, 1000, 8));
    // Never wider than the field allows.
    expect(conveyorBowlHalfWidth(40, 1, 300, 40)).toBeLessThanOrEqual(0.26 * 300 + 3 * 40 + 4);
    expect(BOWL_CAPACITY).toBeGreaterThan(10);
  });

  it("pegs: staggered rows with a peg under the drop point, each a note slot, over the bins and a floor", () => {
    const L = buildConveyorLayout(800, 450, "pegs", 8, conveyorMaxScale(0.5), 7);
    expect(L.pegRows).toBeGreaterThanOrEqual(3);
    const pegs = L.obstacles.filter((_, i) => L.kinds[i] === KIND_PEG);
    expect(pegs.length).toBeGreaterThan(10);
    const top = Math.min(...pegs.map((o) => (o as { y: number }).y));
    expect(pegs.some((o) => Math.abs((o as { x: number }).x - L.dropX) < 1e-6 && (o as { y: number }).y === top)).toBe(true);
    for (let i = 0; i < L.obstacles.length; i++) if (L.kinds[i] === KIND_PEG) expect(L.slots[i]).toBeGreaterThan(0);
    expect(L.binEdges.length).toBeGreaterThanOrEqual(2);
    expect(L.binTop).toBeGreaterThan(top);
    expect(L.floorY).toBeGreaterThan(L.binTop);
  });
});

/* ------------------------------------------------------------------ the director */

describe("the director's steering (rings)", () => {
  const base = { radius: 120, innerRadius: 0, ballRadius: 8, omega: 0, speed: 400, gravity: 0, gapHalf: 0.1 };
  const reach = 120 - 8 - 2;
  /** Where (and how far from the gap's middle) the flight at `aim` comes back to the ring. */
  const landing = (p: GapSteer, aim: number) => {
    const land = { t: 0, phi: 0 };
    const inner = p.innerRadius > 0 ? p.innerRadius + p.ballRadius + 1 : 0;
    const ok = steerFlight(p, aim, p.radius - p.ballRadius - 2, inner, STEER_DT, land);
    const miss = Math.atan2(Math.sin(p.gapMid + ringTurnBy(p, land.t) - land.phi), Math.cos(p.gapMid + ringTurnBy(p, land.t) - land.phi));
    return { ok, ...land, miss };
  };

  it("the flight model moves a ball the way the engine does: gravity, then the cruising boost, then the move", () => {
    const land = { t: 0, phi: 0 };
    // Straight across the core with nothing pulling: a chord at the ball's speed.
    expect(steerFlight({ ...base, bx: 0, by: reach, gapMid: 0 }, -Math.PI / 2, reach, 0, STEER_DT, land)).toBe(true);
    expect(land.phi).toBeCloseTo(-Math.PI / 2, 6);
    expect(land.t).toBeCloseTo((2 * reach) / 400, 2);
    // Gravity bends it: the same throw lands later and lower (more to the right of the top) when it is thrown up and over.
    const bent = { t: 0, phi: 0 };
    expect(steerFlight({ ...base, bx: 0, by: reach, gapMid: 0, gravity: 400 }, -Math.PI / 2 + 0.3, reach, 0, STEER_DT, bent)).toBe(true);
    const straight = { t: 0, phi: 0 };
    steerFlight({ ...base, bx: 0, by: reach, gapMid: 0 }, -Math.PI / 2 + 0.3, reach, 0, STEER_DT, straight);
    expect(bent.t).not.toBeCloseTo(straight.t, 3);
    // A graze along the wall and a flight into the ring inside are no landings.
    expect(steerFlight({ ...base, bx: 0, by: reach, gapMid: 0 }, 0, reach, 0, STEER_DT, land)).toBe(false);
    expect(steerFlight({ ...base, bx: 0, by: reach, gapMid: 0, innerRadius: 80 }, -Math.PI / 2, reach, 89, STEER_DT, land)).toBe(false);
    // The rings turn once a step: nothing before the next step, then a step's worth at a time.
    expect(ringTurnBy({ omega: 2 }, 0.5)).toBe(1);
    expect(ringTurnBy({ omega: 1, stepSec: 1 / 60, nextTurnSec: 0.01 }, 0.005)).toBe(0);
    expect(ringTurnBy({ omega: 1, stepSec: 1 / 60, nextTurnSec: 0.01 }, 0.01)).toBeCloseTo(1 / 60, 9);
    expect(ringTurnBy({ omega: 1, stepSec: 1 / 60, nextTurnSec: 0.01 }, 0.03)).toBeCloseTo(2 / 60, 9);
  });

  it("aims the rebound so the flight comes back exactly where the gap's middle will be", () => {
    for (const p of [
      { ...base, bx: 0, by: reach, gapMid: -Math.PI / 2 },
      { ...base, bx: 0, by: reach, gapMid: 0 },
      { ...base, bx: 0, by: reach, gapMid: 0, omega: 1 },
      { ...base, bx: 0, by: reach, gapMid: 0, gravity: 400, cruise: 400 },
      { ...base, bx: reach * Math.cos(2.5), by: reach * Math.sin(2.5), gapMid: -1, omega: -2.4, gravity: 400, cruise: 400, stepSec: 1 / 60, nextTurnSec: 0.004 },
    ] as GapSteer[]) {
      const aim = steerToGap(p);
      expect(aim).not.toBeNull();
      const l = landing(p, aim!);
      expect(l.ok).toBe(true);
      expect(Math.abs(l.miss)).toBeLessThan(0.01);
      // It leaves the wall inward.
      expect(Math.cos(aim!) * p.bx + Math.sin(aim!) * p.by).toBeLessThan(0);
    }
    const still = steerToGap({ ...base, bx: 0, by: reach, gapMid: 0 })!;
    expect(steerToGap({ ...base, bx: 0, by: reach, gapMid: 0, omega: 1 })!).not.toBeCloseTo(still, 3);
    expect(steerToGap({ ...base, bx: 0, by: reach, gapMid: 0, gravity: 400 })!).not.toBeCloseTo(still, 3);
  });

  it("when the ring inside is in the way, hops along the ring toward the gap; nothing to steer, no aim", () => {
    const p: GapSteer = { ...base, innerRadius: 80, bx: 0, by: reach, gapMid: -Math.PI / 2 };
    const aim = steerToGap(p)!;
    expect(aim).not.toBeNull();
    const l = landing(p, aim);
    expect(l.ok).toBe(true);
    // Closer to the gap than where it started (half a turn away), clear of the ring inside.
    expect(Math.abs(l.miss)).toBeLessThan(Math.PI - 0.5);
    expect(steerToGap({ ...base, bx: 0, by: 0, gapMid: 0 })).toBeNull();
    expect(steerToGap({ ...base, bx: 0, by: reach, gapMid: 0, speed: 0 })).toBeNull();
  });
});

/* ------------------------------------------------------------------ runs */

describe("a run", () => {
  it("rings: every ball is loaded on schedule, works its way out ring by ring, escapes and is carried away", () => {
    const engine = conveyorEngine({}, 11);
    const v = engine.getConveyorView();
    const { events, finishedAt } = run(engine);
    expect(finishedAt).toBeGreaterThan(0);
    const L = v.layout!;
    const ride = conveyorRideSec(L);
    expect(v.dropTimes).toHaveLength(8);
    v.dropTimes.forEach((ms, k) => {
      expect(ms).toBeGreaterThanOrEqual(conveyorDropMs(k, 3, ride) - 0.5);
      expect(ms).toBeLessThanOrEqual(conveyorDropMs(k, 3, ride) + STEP / 4 + 0.5);
    });
    expect(v).toMatchObject({ max: 8, released: 8, loaded: 8, escaped: 8, carried: 8, overflow: 0, landed: 0, frozen: 0, timedOut: false, allDone: true, finished: true });
    // Every ball passed every ring once on its way out (the last pass is the escape).
    expect(v.passes).toBe(8 * L.ringRadii.length);
    for (let k = 0; k < 8; k++) expect(v.slotState[k]).toBe(CV_GONE);
    expect(engine.getBalls()).toHaveLength(0);
    // The rings never break.
    expect(engine.getBrokenWalls().size).toBe(0);
    // The sounds: a hum and a click per ball, a wall-break sound per escape, never more notes a step than the budget.
    const hums = events.filter((e) => e.ev.conveyor === "hum");
    const clicks = events.filter((e) => e.ev.conveyor === "click");
    expect(hums).toHaveLength(8);
    expect(clicks).toHaveLength(8);
    expect(v.hums).toBe(8);
    expect(v.clicks).toBe(8);
    for (const e of [...hums, ...clicks]) expect(e.ev.melody).toBe(false);
    for (const e of hums) expect(e.ev.frequency).toBe(HUM_FREQUENCY);
    expect(hums.slice(0, 7).every((e) => e.ev.cvSec === Math.min(ride, 3))).toBe(true);
    expect(hums[7].ev.cvSec).toBeCloseTo(ride, 9);
    // (The first one comes out at init, with the first step's events; ball k in the step that ends at k × the interval.)
    hums.forEach((e, k) => expect(e.t * 1000).toBeCloseTo(conveyorLoadMs(k, 3) + (k === 0 ? STEP : 0), 6));
    expect(events.filter((e) => e.ev.type === "gap")).toHaveLength(8);
    const perStep = new Map<number, number>();
    for (const e of events) if (e.ev.type === "hit" && !e.ev.conveyor && e.ev.frequency !== undefined) perStep.set(e.step, (perStep.get(e.step) ?? 0) + 1);
    expect(Math.max(...perStep.values())).toBeLessThanOrEqual(MAX_NOTES_PER_STEP + 8);
    // The counter and the banner.
    expect(conveyorCounter(v, DEFAULT_CONVEYOR_LABELS)).toBe("Loaded 8 / Escaped 8");
    expect(conveyorBanner(v, DEFAULT_CONVEYOR_LABELS)).toEqual({ title: "ALL OUT!", sub: "Loaded 8 / Escaped 8" });
  });

  it("the director gets every ball out, even through narrow gaps on fast rings – after a patience that differs from ball to ball", () => {
    const engine = conveyorEngine({}, 1, { ...config, gapSize: 0.1, rotationSpeed: 3 });
    const v = engine.getConveyorView();
    const launched = new Map<number, number>();
    const escaped = new Map<number, number>();
    const { finishedAt } = run(engine, 120, (e) => {
      for (let k = 0; k < v.released; k++) {
        if (v.slotState[k] === CV_FREE && !launched.has(k)) launched.set(k, e.getElapsedMs());
        if (v.slotState[k] >= CV_ESCAPED && v.slotState[k] <= CV_GONE && launched.has(k) && !escaped.has(k)) escaped.set(k, e.getElapsedMs());
      }
    });
    expect(finishedAt).toBeGreaterThan(0);
    expect(v).toMatchObject({ escaped: 8, carried: 8, timedOut: false });
    const times = [...escaped].map(([k, at]) => (at - launched.get(k)!) / 1000);
    expect(times).toHaveLength(8);
    for (const t of times) expect(t).toBeLessThan(PATIENCE_SEC + PATIENCE_SPREAD_SEC + 8);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(1.5);
  });

  it("in a tall frame too: the escaped balls fall past the outer ring onto the bottom belt, and no peg corner at a wall holds a ball", () => {
    const tall: PhysicsConfig = { ...config, width: 450, height: 900 };
    const rings = conveyorEngine({}, 2, tall);
    run(rings);
    expect(rings.getConveyorView()).toMatchObject({ escaped: 8, carried: 8, timedOut: false });
    const L = rings.getConveyorView().layout!;
    expect(L.ringRadii.at(-1)! + 2.6 * L.maxBallRadius).toBeLessThanOrEqual(L.fieldWidth / 2);
    for (const seed of [1, 2, 3]) {
      const pegs = conveyorEngine({ arena: "pegs", variety: 1 }, seed, tall);
      run(pegs);
      expect(pegs.getConveyorView(), `seed ${seed}`).toMatchObject({ landed: 8, timedOut: false });
    }
  });

  it("nothing sounds before the run's first step: the first ball waits at the hatch, its hum starts with the run", () => {
    const engine = conveyorEngine({}, 4);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getConveyorView().hums).toBe(0);
    expect(engine.consumeSoundEvents()).toEqual([]);
    engine.update(STEP, 0);
    const events = engine.consumeSoundEvents();
    expect(events.filter((ev) => ev.conveyor === "hum")).toHaveLength(1);
    expect(engine.getConveyorView().hums).toBe(1);
    // A restart (the page's R) waits again.
    engine.initMode("conveyor");
    expect(engine.consumeSoundEvents().filter((ev) => ev.conveyor)).toEqual([]);
  });

  it("the schedule runs on the simulation clock: the same drops at any frame rate", () => {
    const drops: string[] = [];
    for (const frame of [STEP, STEP / 3, 7, 50]) {
      const engine = conveyorEngine({ arena: "pegs", interval: 1.2, maxBalls: 5 }, 3);
      run(engine, 8, undefined, frame);
      const v = engine.getConveyorView();
      expect(v.dropTimes).toHaveLength(5);
      const ride = conveyorRideSec(v.layout!);
      v.dropTimes.forEach((ms, k) => expect(Math.abs(ms - conveyorDropMs(k, 1.2, ride))).toBeLessThanOrEqual(STEP / 4 + 0.5));
      drops.push(v.dropTimes.join(","));
    }
    expect(new Set(drops).size).toBe(1);
  });

  it("bowl: the pile settles; past its capacity the balls spill over, count as overflow and ride the bottom belt out", () => {
    const engine = conveyorEngine({ arena: "bowl", interval: 0.5, maxBalls: 50 }, 2);
    const v = engine.getConveyorView();
    let firstOverflow = -1;
    const { finishedAt } = run(engine, 120, () => {
      if (firstOverflow < 0 && v.overflow > 0) firstOverflow = v.loaded;
    });
    expect(finishedAt).toBeGreaterThan(0);
    expect(v.loaded).toBe(50);
    expect(v.overflow).toBeGreaterThan(0);
    expect(firstOverflow).toBeGreaterThan(BOWL_CAPACITY);
    expect(v.carried).toBe(v.overflow);
    expect(engine.getBalls()).toHaveLength(50 - v.carried);
    // What stayed is in the bowl, at rest.
    const b = v.layout!.bowl!;
    for (const ball of engine.getBalls()) {
      expect(Math.abs(ball.x - b.cx)).toBeLessThan(b.halfWidth + 1);
      expect(ball.y).toBeLessThan(b.bottomY + 1);
      expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(40);
    }
    expect(conveyorBanner(v, DEFAULT_CONVEYOR_LABELS).title).toBe("SETTLED!");
    expect(conveyorCounter(v, DEFAULT_CONVEYOR_LABELS)).toBe(`Loaded 50 / Overflow ${v.overflow}`);
    // The default bowl run holds every ball.
    const small = conveyorEngine({ arena: "bowl" }, 2);
    run(small);
    expect(small.getConveyorView()).toMatchObject({ loaded: 8, overflow: 0, carried: 0 });
  });

  it("pegs: every ball bounces through the field, playing the pegs' notes, and lands in the bins", () => {
    const engine = conveyorEngine({ arena: "pegs" }, 5);
    const v = engine.getConveyorView();
    const { events, finishedAt } = run(engine);
    expect(finishedAt).toBeGreaterThan(0);
    expect(v).toMatchObject({ loaded: 8, landed: 8, overflow: 0, escaped: 0 });
    for (const ball of engine.getBalls()) expect(ball.y).toBeGreaterThan(v.layout!.binTop);
    const pegPitches = new Set<number>();
    const L = v.layout!;
    for (let i = 0; i < L.obstacles.length; i++) if (L.kinds[i] === KIND_PEG) pegPitches.add(conveyorPegPitch(L.slots[i], "chromatic", 0));
    expect(events.filter((e) => e.ev.frequency !== undefined && pegPitches.has(e.ev.frequency)).length).toBeGreaterThan(8);
    expect(conveyorBanner(v, DEFAULT_CONVEYOR_LABELS)).toEqual({ title: "LANDED!", sub: "Loaded 8 / Landed 8" });
  });
});

/* ------------------------------------------------------------------ freezing */

describe("freeze on landing", () => {
  it("bowl: a ball that comes to rest freezes in place and stays an obstacle the next ones pile onto", () => {
    const engine = conveyorEngine({ arena: "bowl", freeze: true, interval: 1, maxBalls: 14 }, 3);
    const v = engine.getConveyorView();
    const pinned = new Map<number, { x: number; y: number }>();
    let moved = 0;
    run(engine, 120, (e) => {
      for (const ball of e.getBalls()) {
        const at = pinned.get(ball.id);
        if (at) {
          if (Math.hypot(ball.x - at.x, ball.y - at.y) > 1e-6) moved++;
        }
      }
      // (Freshly frozen balls start their watch here.)
      const balls = e.getBalls();
      for (let k = 0; k < v.released; k++) {
        if (v.slotState[k] !== CV_FROZEN) continue;
        const ball = balls.find((b) => b.color !== undefined && !pinned.has(b.id) && b.vx === 0 && b.vy === 0 && (b.gravityScale ?? 1) === 0);
        if (ball) pinned.set(ball.id, { x: ball.x, y: ball.y });
      }
    });
    expect(v.frozen).toBeGreaterThan(8);
    expect(v.frozen).toBe(v.loaded - v.carried);
    expect(v.frozenBalls).toHaveLength(v.frozen);
    expect(moved).toBe(0);
    // The frozen balls are where their obstacles are, and no two overlap (each was an obstacle to the next).
    const balls = engine.getBalls();
    for (const o of v.frozenBalls) expect(balls.some((b) => Math.hypot(b.x - o.x, b.y - o.y) < 1e-6)).toBe(true);
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) expect(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y)).toBeGreaterThan(0.75 * (balls[i].radius + balls[j].radius));
    }
    expect(conveyorBanner(v, DEFAULT_CONVEYOR_LABELS).sub).toContain(`${v.frozen} frozen`);
  });

  it("rings: a ball's freedom lasts FREEZE_SEC, then it freezes where it is – the others bounce off it", () => {
    const engine = conveyorEngine({ freeze: true }, 4);
    const v = engine.getConveyorView();
    const launched = new Map<number, number>();
    const frozenAt = new Map<number, number>();
    const where = new Map<number, { x: number; y: number }>();
    run(engine, 120, (e) => {
      for (let k = 0; k < v.released; k++) {
        if (v.slotState[k] === CV_FREE && !launched.has(k)) launched.set(k, e.getElapsedMs());
        if (v.slotState[k] === CV_FROZEN && !frozenAt.has(k)) frozenAt.set(k, e.getElapsedMs());
      }
    });
    expect(v.frozen + v.escaped).toBe(8);
    expect(v.frozen).toBeGreaterThan(0);
    for (const [k, at] of frozenAt) {
      expect(at - launched.get(k)!).toBeGreaterThanOrEqual(FREEZE_SEC * 1000 - STEP);
      expect(at - launched.get(k)!).toBeLessThanOrEqual(FREEZE_SEC * 1000 + 2 * STEP);
    }
    // Frozen balls stay put through the rest of the run.
    for (const ball of engine.getBalls()) where.set(ball.id, { x: ball.x, y: ball.y });
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    for (const ball of engine.getBalls()) {
      const at = where.get(ball.id)!;
      expect(Math.hypot(ball.x - at.x, ball.y - at.y)).toBeLessThan(1e-6);
    }
  });
});

/* ------------------------------------------------------------------ determinism, resizes, the end, the finder */

describe("determinism and the end of the run", () => {
  it("a seed replays exactly; other seeds play differently", () => {
    const key = (r: ReturnType<typeof run>) => r.events.map((e) => `${e.t.toFixed(4)}:${e.ev.type}:${e.ev.frequency ?? ""}:${e.ev.conveyor ?? ""}`).join("|");
    const a = run(conveyorEngine({}, 42));
    const b = run(conveyorEngine({}, 42));
    expect(a.finishedAt).toBe(b.finishedAt);
    expect(key(a)).toBe(key(b));
    const others = new Set<string>();
    for (let seed = 1; seed <= 4; seed++) others.add(key(run(conveyorEngine({}, seed))));
    expect(others.size).toBe(4);
  });

  it("a resize before the first step plays the run an init at that size plays (the finder's engine); a mid-run one keeps the balls in the field", () => {
    for (const arena of CONVEYOR_ARENAS) {
      const direct = conveyorEngine({ arena, maxBalls: 4, interval: 1 }, 17, { ...config, width: 450, height: 800 });
      const resized = conveyorEngine({ arena, maxBalls: 4, interval: 1 }, 17);
      resized.setConfig({ width: 450, height: 800 });
      const a = run(direct);
      const b = run(resized);
      expect(b.finishedAt).toBe(a.finishedAt);
      expect(resized.getConveyorProgress()).toEqual(direct.getConveyorProgress());
    }
    const mid = conveyorEngine({ arena: "pegs", maxBalls: 4, interval: 1 }, 17);
    for (let i = 0; i < 100; i++) mid.update(STEP, 0);
    mid.setConfig({ width: 450, height: 800 });
    const L = mid.getConveyorView().layout!;
    expect(L.width).toBe(450);
    for (const ball of mid.getBalls()) {
      expect(ball.x).toBeGreaterThanOrEqual(L.left - 1e-6);
      expect(ball.x).toBeLessThanOrEqual(L.right + 1e-6);
    }
    expect(run(mid).finishedAt).toBeGreaterThan(0);
    expect(mid.getConveyorView().landed).toBe(4);
  });

  it("the final banner shows once the last ball is out; the run finishes FINAL_HOLD_MS later", () => {
    const engine = conveyorEngine({ maxBalls: 3, interval: 1 }, 9);
    const v = engine.getConveyorView();
    let lastCarried = -1;
    let flaggedAt = -1;
    const { finishedAt } = run(engine, 90, (e) => {
      if (v.carried === 3 && lastCarried < 0) lastCarried = e.getElapsedMs();
      if (v.allDone && flaggedAt < 0) flaggedAt = e.getElapsedMs();
    });
    expect(flaggedAt).toBe(lastCarried);
    expect(v.doneAtMs).toBeCloseTo(flaggedAt, 6);
    expect(finishedAt * 1000).toBeCloseTo(v.finishedMs, 6);
    expect(v.finishedMs - v.doneAtMs).toBeGreaterThanOrEqual(FINAL_HOLD_MS - 1e-6);
    expect(v.finishedMs - v.doneAtMs).toBeLessThan(FINAL_HOLD_MS + STEP);
    // A restart starts over: nothing loaded, the first ball on the belt.
    engine.initMode("conveyor");
    expect(engine.getConveyorProgress()).toMatchObject({ released: 1, loaded: 0, escaped: 0, carried: 0, allDone: false, finished: false });
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.isSimulationFinished()).toBe(false);
  });

  it("the run length moves with the seed around the nominal length, so the finder lands 30 s", async () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 200, maxSimTimeSec: 90, physicsConfig: config, mode: "conveyor", modeSettings: { ...modeSettings, conveyor: {} } };
    const nominal = conveyorNominalRunSec(DEFAULT_CONVEYOR_SETTINGS);
    const lengths = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const ms = simulateSeed(seed, request, 90_000);
      expect(ms / 1000).toBeGreaterThan(nominal - 5);
      expect(ms / 1000).toBeLessThan(nominal + 8);
      lengths.add(Math.round(ms));
    }
    expect(lengths.size).toBeGreaterThan(4);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.found).toBe(true);
    expect(Math.abs(result.duration - 30)).toBeLessThanOrEqual(0.5);
    const replay = run(conveyorEngine({}, result.seed));
    expect(Math.abs(replay.finishedAt - result.duration)).toBeLessThan(0.02);
  }, 60_000);
});

/* ------------------------------------------------------------------ the canvas data */

describe("the canvas data", () => {
  it("mirrors the counters, the drops and the end as data-cv-* values", () => {
    const engine = conveyorEngine({ maxBalls: 2, interval: 1 }, 6);
    const v = engine.getConveyorView();
    const data = new Map<string, string>();
    const dataset = new ConveyorDataset();
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    dataset.write(v, (k, value) => data.set(k, value));
    expect([...data.keys()].sort()).toEqual([...CONVEYOR_DATA_KEYS].sort());
    expect(data.get("cvArena")).toBe("rings");
    expect(data.get("cvMax")).toBe("2");
    expect(data.get("cvReleased")).toBe("1");
    expect(data.get("cvOnBelt")).toBe("1");
    expect(data.get("cvLoaded")).toBe("0");
    run(engine);
    dataset.write(v, (k, value) => data.set(k, value));
    expect(data.get("cvLoaded")).toBe("2");
    expect(data.get("cvEscaped")).toBe("2");
    expect(data.get("cvCarried")).toBe("2");
    expect(data.get("cvDrops")).toBe(v.dropTimes.join(","));
    expect(data.get("cvFinished")).toBe("1");
    expect(data.get("cvRings")).toBe(String(v.layout!.ringRadii.length));
  });
});

/* ------------------------------------------------------------------ the respawn timer */

describe("the respawn timer of Classic and Multiply", () => {
  it("the schedule: the k-th respawn at k × the period; nothing while it is off or in another mode", () => {
    expect(respawnSchedule(3, 4)).toEqual([3, 6, 9, 12]);
    expect(respawnSchedule(0, 4)).toEqual([]);
    expect(respawnDue(2999, 3)).toBe(0);
    expect(respawnDue(3000, 3)).toBe(1);
    expect(respawnDue(3000 - 1e-7, 3)).toBe(1);
    expect(respawnDue(17_999, 3)).toBe(5);
    expect(respawnDue(5000, 0)).toBe(0);
    expect(respawnApplies("classic", 3)).toBe(true);
    expect(respawnApplies("multiply", 0.5)).toBe(true);
    expect(respawnApplies("classic", 0)).toBe(false);
    expect(respawnApplies("shatter", 3)).toBe(false);
    expect(respawnApplies("conveyor", 3)).toBe(false);
    expect(respawnApplies(undefined, 3)).toBe(false);
    expect(respawnConfigOf({ respawnEvery: 2 })).toEqual({ respawnEvery: 2 });
    expect(respawnConfigOf({ respawnEvery: -1 })).toEqual({ respawnEvery: 0 });
    expect(RESPAWN_MAX_BALLS).toBeGreaterThanOrEqual(100);
  });

  it("Classic: a new ball drops in from the top every N seconds of the simulation clock, with the belt's click", () => {
    const engine = createEngineForSettings({ ...config, respawnEvery: 3 }, "classic", modeSettings, 5);
    const counts: number[] = [];
    const clicks: number[] = [];
    let before = engine.getBalls().length;
    for (let i = 1; i <= 60 * 20 && !engine.isSimulationFinished(); i++) {
      engine.update(STEP, 0);
      for (const ev of engine.consumeSoundEvents()) if (ev.conveyor === "click") clicks.push(engine.getElapsedMs());
      const n = engine.getBalls().length;
      if (n > before) {
        counts.push(engine.getElapsedMs());
        // The new ball: in the middle, above the centre, falling (within the spread of straight down).
        const ball = engine.getBalls()[n - 1];
        expect(Math.abs(ball.x - config.width / 2)).toBeLessThan(10);
        expect(ball.y).toBeLessThan(config.height / 2);
        expect(Math.abs(Math.atan2(ball.vx, ball.vy))).toBeLessThanOrEqual(RESPAWN_SPREAD + 0.2);
      }
      before = n;
    }
    expect(engine.getRespawnCount()).toBe(6);
    counts.forEach((ms, k) => expect(ms).toBeCloseTo(3000 * (k + 1), -1));
    expect(clicks).toEqual(counts);
  });

  it("off, or in another mode, nothing changes: the run replays exactly as before", () => {
    const trace = (cfg: PhysicsConfig, mode: "classic" | "accumulation") => {
      const engine = createEngineForSettings(cfg, mode, modeSettings, 8);
      const out: string[] = [];
      for (let i = 0; i < 60 * 8; i++) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        if (i % 30 === 0) out.push(engine.getBalls().map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)}`).join(";"));
      }
      return { out: out.join("|"), respawns: engine.getRespawnCount() };
    };
    const without = trace(config, "classic");
    expect(trace({ ...config, respawnEvery: 0 }, "classic")).toEqual(without);
    const acc = trace(config, "accumulation");
    expect(trace({ ...config, respawnEvery: 2 }, "accumulation")).toEqual(acc);
    expect(trace({ ...config, respawnEvery: 2 }, "classic").respawns).toBeGreaterThan(0);
  });

  it("Classic stops respawning once every ring is broken; Multiply keeps respawning; a run holds at most RESPAWN_MAX_BALLS", () => {
    const engine = createEngineForSettings({ ...config, wallCount: 2, gapSize: 0.9, respawnEvery: 1 }, "classic", modeSettings, 4);
    let atBroken = -1;
    for (let i = 0; i < 60 * 60 && !engine.isSimulationFinished(); i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (atBroken < 0 && engine.getBrokenWalls().size >= engine.getCircularWalls().length) atBroken = engine.getRespawnCount();
    }
    expect(atBroken).toBeGreaterThanOrEqual(0);
    expect(engine.getRespawnCount()).toBe(atBroken);
    const multiply = createEngineForSettings({ ...config, respawnEvery: 2 }, "multiply", modeSettings, 5);
    for (let i = 0; i < 60 * 10; i++) multiply.update(STEP, 0);
    expect(multiply.getRespawnCount()).toBe(5);
    // A restart counts from zero.
    multiply.initMode("multiply");
    expect(multiply.getRespawnCount()).toBe(0);
  });

  it("a new period set mid-run (the page's config effect) takes over at once, without a backlog", () => {
    const engine = createEngineForSettings(config, "classic", modeSettings, 5);
    for (let i = 0; i < 60 * 7; i++) engine.update(STEP, 0);
    expect(engine.getRespawnCount()).toBe(0);
    engine.setConfig(respawnConfigOf({ respawnEvery: 1 }));
    engine.update(STEP, 0);
    expect(engine.getRespawnCount()).toBe(1);
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    expect(engine.getRespawnCount()).toBe(2);
    engine.setConfig(respawnConfigOf({ respawnEvery: 0 }));
    for (let i = 0; i < 180; i++) engine.update(STEP, 0);
    expect(engine.getRespawnCount()).toBe(2);
  });
});

/* ------------------------------------------------------------------ the machinery's sound */

interface OscLog {
  type: string;
  frequency: number;
  startAt: number;
  stopAt: number;
}

/** A fake audio graph with filters, logging oscillators, buffer sources, filters and gain values. */
function machineryGraph() {
  const oscillators: OscLog[] = [];
  const sources: { args: number[] }[] = [];
  const filters: { type: string; frequency: number; q: number }[] = [];
  const peaks: number[] = [];
  const param = (onSet?: (v: number) => void) => {
    const p = {
      value: 0,
      setValueAtTime: (v: number) => {
        p.value = v;
        onSet?.(v);
      },
      linearRampToValueAtTime: (v: number) => onSet?.(v),
      exponentialRampToValueAtTime: (v: number) => onSet?.(v),
      cancelScheduledValues: () => undefined,
    };
    return p;
  };
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => ({ ...node(), gain: param((v) => peaks.push(v)) }),
    createBiquadFilter: () => {
      const f = { ...node(), type: "lowpass", frequency: param(), Q: param() };
      queueMicrotask(() => filters.push({ type: f.type, frequency: f.frequency.value, q: f.Q.value }));
      return f;
    },
    createOscillator: () => {
      const log: OscLog = { type: "sine", frequency: 0, startAt: -1, stopAt: -1 };
      const osc = {
        ...node(),
        type: "sine",
        frequency: param(),
        start: (when = 0) => {
          log.type = osc.type;
          log.frequency = osc.frequency.value;
          log.startAt = when;
          oscillators.push(log);
        },
        stop: (when = 0) => {
          log.stopAt = when;
        },
      };
      return osc;
    },
    createBufferSource: () => ({ ...node(), buffer: null as unknown, start: (...args: number[]) => sources.push({ args }), stop: () => undefined }),
  };
  return { ctx, oscillators, sources, filters, peaks };
}

describe("the belt's machinery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the hum: a low filtered sawtooth and its fifth with a slow wobble, as long as it was asked (within bounds)", async () => {
    expect(humLength(2)).toBe(2);
    expect(humLength(0.01)).toBe(MIN_HUM_SEC);
    expect(humLength(99)).toBe(MAX_HUM_SEC);
    expect(humLength(undefined)).toBe(1);
    expect(conveyorLevel(undefined)).toBe(1);
    expect(conveyorLevel(3)).toBe(1);
    expect(conveyorLevel(0.25)).toBe(0.25);
    const g = machineryGraph();
    scheduleConveyorHum(g.ctx as unknown as BaseAudioContext, {} as AudioNode, 55, 2, 1.5, 0.5);
    await Promise.resolve();
    const saws = g.oscillators.filter((o) => o.type === "sawtooth");
    expect(saws.map((o) => o.frequency)).toEqual([55, 82.5]);
    for (const o of g.oscillators) {
      expect(o.startAt).toBe(2);
      expect(o.stopAt).toBeCloseTo(3.52, 9);
    }
    expect(g.oscillators.find((o) => o.type === "sine")!.frequency).toBe(HUM_TONE.wobbleRate);
    expect(g.filters).toEqual([{ type: "lowpass", frequency: HUM_TONE.cutoff, q: HUM_TONE.q }]);
    expect(Math.max(...g.peaks)).toBeCloseTo(HUM_TONE.gain * 0.5, 9);
    // No pitch: the default low A.
    const d = machineryGraph();
    scheduleConveyorHum(d.ctx as unknown as BaseAudioContext, {} as AudioNode, Number.NaN, 0, 1);
    expect(d.oscillators.filter((o) => o.type === "sawtooth")[0].frequency).toBe(DEFAULT_HUM_FREQUENCY);
  });

  it("the click: a band-passed noise tick over a falling sine thunk", async () => {
    const g = machineryGraph();
    const noise = { duration: 1 } as AudioBuffer;
    scheduleConveyorClick(g.ctx as unknown as BaseAudioContext, {} as AudioNode, 4, noise, 1);
    await Promise.resolve();
    expect(g.sources).toHaveLength(1);
    expect(g.sources[0].args[0]).toBe(4);
    expect(g.filters).toEqual([{ type: "bandpass", frequency: CLICK_TONE.band, q: CLICK_TONE.q }]);
    expect(g.oscillators).toHaveLength(1);
    expect(g.oscillators[0]).toMatchObject({ type: "sine", frequency: CLICK_TONE.thunkFrom, startAt: 4 });
    expect(Math.max(...g.peaks)).toBeCloseTo(CLICK_TONE.gain, 9);
  });

  it("the ToneGenerator plays them on the beat grid, never as a melody note; every dispatch routes them there", async () => {
    const graph = fakeGraph();
    (graph.ctx as unknown as Record<string, unknown>).createBiquadFilter = () => ({ type: "lowpass", frequency: { value: 0 }, Q: { value: 0 }, connect: () => undefined, disconnect: () => undefined });
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
    graph.ctx.currentTime = 0.1;
    tone.playConveyor("hum", 1.2, 55, 0.7);
    const saws = graph.oscillators.filter((o) => o.type === "sawtooth");
    expect(saws.map((o) => o.frequency)).toEqual([55, 82.5]);
    expect(saws[0].startAt).toBeCloseTo(0.5, 9);
    const before = graph.sources.length;
    tone.playConveyor("click");
    expect(graph.sources.length).toBe(before + 1);
    expect(graph.oscillators.at(-1)!.frequency).toBe(CLICK_TONE.thunkFrom);
    // The page's sound loop and the fast export: playSoundEvent(); the split-screen arenas: playArenaSound().
    const hum = vi.spyOn(tone, "playConveyor");
    const hit = vi.spyOn(tone, "playWallHit");
    playSoundEvent(tone, { type: "hit", wallIndex: 0, frequency: 55, conveyor: "hum", cvSec: 1.1, level: 0.7, melody: false }, () => undefined);
    playSoundEvent(tone, { type: "hit", wallIndex: 0, conveyor: "click", level: 1, melody: false }, () => undefined);
    playSoundEvent(tone, { type: "hit", wallIndex: 0, frequency: 330 }, () => undefined);
    expect(hum.mock.calls).toEqual([
      ["hum", 1.1, 55, 0.7],
      ["click", undefined, undefined, 1],
    ]);
    expect(hit).toHaveBeenCalledTimes(1);
    const calls: string[] = [];
    const sink = { playConveyor: (kind: string, sec?: number) => calls.push(`${kind} ${sec}`), playWallHit: () => calls.push("hit") } as unknown as ArenaSoundSink;
    playArenaSound(sink, { type: "hit", wallIndex: 0, conveyor: "hum", cvSec: 2 });
    playArenaSound(sink, { type: "hit", wallIndex: 0, frequency: 440 });
    expect(calls).toEqual(["hum 2", "hit"]);
  });
});

/* ------------------------------------------------------------------ the engine's own accessors */

describe("the engine", () => {
  it("isConveyorMode / settings / progress", () => {
    const engine = new PhysicsEngine({ ...config });
    engine.setConveyorSettings({ arena: "bowl", maxBalls: 3 });
    expect(engine.getConveyorSettings()).toMatchObject({ arena: "bowl", maxBalls: 3 });
    engine.initMode("conveyor");
    expect(engine.isConveyorMode()).toBe(true);
    expect(engine.getConveyorProgress()).toMatchObject({ arena: "bowl", max: 3, released: 1 });
    expect(engine.getCircularWalls()).toHaveLength(0);
    expect(engine.getBalls()[0].radius).toBe(8);
    engine.initMode("classic");
    expect(engine.isConveyorMode()).toBe(false);
  });
});
