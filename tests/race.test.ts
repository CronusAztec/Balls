import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  COUNTDOWN_MS,
  CUP_MS,
  DEFAULT_RACE_SETTINGS,
  MAX_RACE_MS,
  PODIUM_MS,
  RACE_MS_PER_SCREEN,
  RACE_RANGES,
  RACE_SEPARATION_REL,
  RaceMode,
  currentCallout,
  defaultRaceFields,
  dnfGraceMs,
  favouredRacer,
  raceMotion,
  raceSettingsOf,
  raceTimeLimitMs,
  racerNote,
  readRaceParams,
  resolveRaceFields,
  resolveRaceSettings,
  sanitizeCupTitle,
  writeRaceParams,
  type RaceSettings,
} from "@/lib/physics/modes/race";
import {
  FEATURE_ROW_KIND,
  FINAL_STRIP_BEFORE,
  FINAL_ZONE_BEFORE,
  MAX_RACERS,
  MIN_ROW_GAP,
  RACE_FEATURES,
  RACE_ROW_KINDS,
  RACER_REFERENCE_FIELD,
  buildRaceField,
  buildRaceTrack,
  dominantRowKind,
  firstRowFrom,
  pickRowKind,
  racerRadius,
  resolveRaceTrackSettings,
  rowKindWeights,
  setSpinnerAngles,
  type RaceTrack,
} from "@/lib/physics/raceTrack";
import { F1_POINTS, LeaderClock, pointsForPlace, rankRacers } from "@/lib/physics/raceStandings";
import { RaceCupStore, addRaceToCup, emptyCup, parseCup, racePoints, rankCup } from "@/lib/raceCup";
import { RACE_COLORS, raceRoster } from "@/lib/raceRoster";
import { DEFAULT_RACE_LABELS, cupRunKey, exportRaceOptions, podiumRest, raceResultOf, runKey, writeRaceDataset, type CanvasRaceOptions } from "@/components/simulator/raceRenderer";
import { raceArpeggioLength, raceArpeggioNotes } from "@/lib/audio/raceTones";
import { segmentEndpoints, type SegmentObstacle } from "@/lib/physics/obstacles";
import { createEngineForSettings, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { RACER_CEILING } from "@/lib/uncap";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";

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

/** A seeded generator for the pure track tests (mulberry32, like the engine). */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function raceEngine(race: Partial<RaceSettings>, seed: number, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "race", { ...modeSettings, race }, seed);
}

/** Runs a race to its end (or `limitMs`), collecting every sound event. */
function runRace(engine: PhysicsEngine, limitMs = 300000, frameMs = 1000 / 60) {
  const sounds: SoundEvent[] = [];
  let t = 0;
  while (!engine.isSimulationFinished() && t < limitMs) {
    engine.update(frameMs, 0);
    sounds.push(...engine.consumeSoundEvents());
    t += frameMs;
  }
  return { sounds, timeMs: t };
}

/** A track as plain numbers (for determinism checks). */
function trackSignature(track: RaceTrack) {
  return {
    rows: track.rows.map((r) => [r.kind, r.lap, r.top.toFixed(6), r.bottom.toFixed(6), r.obstacles.map((o) => [o.role, o.shape.x.toFixed(6), o.shape.y.toFixed(6)]), r.pads.map((p) => [p.x0.toFixed(6), p.x1.toFixed(6)]), r.zone ? r.zone.y.toFixed(6) : null]),
    grid: track.gridOrder.join(","),
    finish: track.finishY.toFixed(6),
  };
}

describe("race settings", () => {
  it("fills in the defaults and clamps every value", () => {
    expect(resolveRaceSettings(null)).toEqual(DEFAULT_RACE_SETTINGS);
    const r = resolveRaceSettings({ racers: 40, trackLength: 1.4, laps: 9, winner: 99, shape: "hexagon" as never, feature: "lava" as never, camera: "drone" as never, cup: "yes" as never });
    // --- uncap-all --- no maximum (--- review fix (uncap-all) --- 40 racers race as typed: the per-racer state and the roster
    // are sized for the grid at init; the grid stops at its memory-safety ceiling only)
    expect(r.racers).toBe(40);
    expect(MAX_RACERS).toBeLessThan(40);
    expect(resolveRaceSettings({ racers: 1e6 }).racers).toBe(RACER_CEILING);
    expect(r.trackLength).toBe(RACE_RANGES.rcTrackLength.min);
    expect(r.laps).toBe(9);
    expect(r.winner).toBe(99); // a staged winner past the grid stages nobody (favouredRacer)
    expect(r.shape).toBe("square");
    expect(r.feature).toBe("mixed");
    expect(r.camera).toBe("leader");
    expect(r.cup).toBe(false);
    expect(resolveRaceSettings({ racers: 1, winner: -7, trackLength: 7.6 })).toMatchObject({ racers: 2, winner: -1, trackLength: 8 });
  });

  it("names the favourite only when it is on the grid", () => {
    expect(favouredRacer({ winner: 3, racers: 8 })).toBe(3);
    expect(favouredRacer({ winner: 8, racers: 8 })).toBe(-1);
    expect(favouredRacer({ winner: -1, racers: 8 })).toBe(-1);
  });

  it("round-trips through the URL and leaves the defaults out of it", () => {
    const s = { ...defaultSettings("race"), rcRacers: 12, rcShape: "circle" as const, rcTrackLength: 5, rcLaps: 2, rcFeature: "turbo" as const, rcCamera: "pack" as const, rcCup: true, rcCupTitle: "Neon Cup", rcWinner: 3, rcStandings: false, rcMiniMap: false };
    const params = settingsToSearchParams(s);
    for (const key of ["rcn", "rcs", "rcl", "rclp", "rcf", "rccam", "rccup", "rcct", "rcw", "rcst", "rcmm"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    expect(raceSettingsOf(back)).toEqual(raceSettingsOf(s));
    expect(back.rcCupTitle).toBe("Neon Cup");
    expect(back.rcStandings).toBe(false);
    expect(back.rcMiniMap).toBe(false);
    const plain = settingsToSearchParams(defaultSettings("race"));
    for (const key of ["rcn", "rcs", "rcl", "rclp", "rcf", "rccam", "rccup", "rcct", "rcw", "rcst", "rcmm"]) expect(plain.has(key), key).toBe(false);
  });

  it("falls back on bad URL values and cleans the cup title", () => {
    const fields = defaultRaceFields();
    readRaceParams(new URLSearchParams("rcn=abc&rcl=99&rclp=0&rcs=blob&rcf=nope&rccam=x&rccup=2&rcct=%20A%0A%20cup\u0000%20&rcw=-9"), fields);
    expect(fields).toMatchObject({ rcRacers: DEFAULT_RACE_SETTINGS.racers, rcTrackLength: 99 /* --- uncap-all --- kept */, rcLaps: 1, rcShape: "square", rcFeature: "mixed", rcCamera: "leader", rcCup: false, rcCupTitle: "A cup", rcWinner: -1 });
    expect(sanitizeCupTitle("x".repeat(80))).toHaveLength(32);
    expect(sanitizeCupTitle(42)).toBe("");
    const params = new URLSearchParams();
    writeRaceParams({ ...fields, rcCupTitle: "Swap & Win" }, defaultRaceFields(), params);
    expect(params.get("rcct")).toBe("Swap & Win");
  });

  it("validates presets", () => {
    const loaded = presetToSettings({ mode: "race", rcRacers: 99, rcShape: "blob", rcLaps: -3, rcCup: "on", rcCupTitle: 7, rcStandings: "no" } as never);
    expect(loaded).toMatchObject({ rcRacers: 99, rcShape: "square", rcLaps: 1, rcCup: false, rcCupTitle: "", rcStandings: true }); // --- uncap-all --- (rcRacers 99 kept)
    expect(resolveRaceFields({})).toEqual(defaultRaceFields());
  });
});

describe("race track generator", () => {
  it("builds the same track from the same numbers, and another from other numbers", () => {
    const a = buildRaceTrack(800, 600, {}, 8, rng(7));
    const b = buildRaceTrack(800, 600, {}, 8, rng(7));
    const c = buildRaceTrack(800, 600, {}, 8, rng(8));
    expect(trackSignature(a)).toEqual(trackSignature(b));
    expect(trackSignature(a)).not.toEqual(trackSignature(c));
  });

  it("spaces its rows and keeps every obstacle inside the corridor, passable", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const feature = RACE_FEATURES[seed % RACE_FEATURES.length];
      const track = buildRaceTrack(800, 600, { feature, racers: 16, laps: 1 + (seed % 3), trackLength: 3 + (seed % 9) }, 8, rng(seed));
      const S = track.field.size;
      const r = track.racerRadius;
      for (let k = 1; k < track.rows.length; k++) {
        const gap = track.rows[k].top - track.rows[k - 1].bottom;
        // Rows never overlap; outside the final sector they keep MIN_ROW_GAP of open track between them.
        expect(gap, `seed ${seed} row ${k}`).toBeGreaterThan(0);
        if (!track.rows[k].final && !track.rows[k - 1].final) expect(gap).toBeGreaterThanOrEqual(MIN_ROW_GAP * S - 1e-6);
      }
      const ends = { x1: 0, y1: 0, x2: 0, y2: 0 };
      for (const row of track.rows) {
        expect(row.top).toBeGreaterThan(track.yStart);
        expect(row.bottom).toBeLessThan(track.finishY);
        for (const o of row.obstacles) {
          const s = o.shape;
          if (s.kind === "circle") {
            expect(s.x - s.radius).toBeGreaterThanOrEqual(track.left - 1e-6);
            expect(s.x + s.radius).toBeLessThanOrEqual(track.right + 1e-6);
            // A peg or bumper never leaves a gap to a wall a racer could wedge into.
            const gapLeft = s.x - s.radius - track.left;
            const gapRight = track.right - s.x - s.radius;
            expect(Math.min(gapLeft, gapRight)).toBeGreaterThanOrEqual(2 * r);
            expect(s.y - s.radius).toBeGreaterThanOrEqual(row.top - 1e-6);
            expect(s.y + s.radius).toBeLessThanOrEqual(row.bottom + 1e-6);
          } else if (o.role === "spinner") {
            // Whatever its angle, a spinner stays inside its row and leaves racers a way past it.
            expect(s.x - s.halfLength - s.thickness).toBeGreaterThanOrEqual(track.left + 2 * r);
            expect(s.x + s.halfLength + s.thickness).toBeLessThanOrEqual(track.right - 2 * r);
            expect(s.y - s.halfLength - s.thickness / 2).toBeGreaterThanOrEqual(row.top - 1e-6);
            expect(s.y + s.halfLength + s.thickness / 2).toBeLessThanOrEqual(row.bottom + 1e-6);
          } else {
            segmentEndpoints(s, ends);
            for (const x of [ends.x1, ends.x2]) {
              expect(x).toBeGreaterThanOrEqual(track.left - 1e-6);
              expect(x).toBeLessThanOrEqual(track.right + 1e-6);
            }
          }
        }
        // The openings of funnels and gates let a racer through with room to spare.
        if (row.kind === "funnel" || row.kind === "gate") {
          const lows: number[] = [];
          for (const o of row.obstacles) {
            segmentEndpoints(o.shape as SegmentObstacle, ends);
            lows.push(ends.y1 > ends.y2 ? ends.x1 : ends.x2);
          }
          lows.sort((x, y) => x - y);
          const t = (row.obstacles[0].shape as SegmentObstacle).thickness;
          for (let j = 0; j + 1 < lows.length; j += 2) expect(lows[j + 1] - lows[j] - t).toBeGreaterThanOrEqual(2.2 * r);
        }
      }
    }
  });

  it("ends every lap with a swap zone and a turbo strip, and repeats the lap's rows lap after lap", () => {
    const track = buildRaceTrack(800, 600, { laps: 3, trackLength: 6 }, 8, rng(3));
    const S = track.field.size;
    expect(track.rows.length).toBe(3 * track.rowsPerLap);
    expect(track.finishY - track.yStart).toBeCloseTo(3 * 6 * S, 6);
    for (let lap = 0; lap < 3; lap++) {
      const rows = track.rows.slice(lap * track.rowsPerLap, (lap + 1) * track.rowsPerLap);
      const lapEnd = track.yStart + (lap + 1) * track.lapLength;
      const zone = rows[rows.length - 2];
      const strip = rows[rows.length - 1];
      expect(zone.kind).toBe("swap");
      expect(zone.zone?.final).toBe(true);
      expect(zone.top).toBeCloseTo(lapEnd - FINAL_ZONE_BEFORE * S, 6);
      expect(strip.kind).toBe("turbo");
      expect(strip.pads[0]).toMatchObject({ final: true, x0: track.left, x1: track.right });
      expect(strip.top).toBeCloseTo(lapEnd - FINAL_STRIP_BEFORE * S, 6);
      rows.forEach((row, k) => {
        const first = track.rows[k];
        expect(row.kind).toBe(first.kind);
        expect(row.lap).toBe(lap);
        expect(row.top - first.top).toBeCloseTo(lap * track.lapLength, 6);
      });
    }
    // Each lap's copy has its own state.
    expect(track.zones[0]).not.toBe(track.zones[track.zones.length / 3]);
  });

  it("features the chosen obstacle in about half of the rows, and mixes everything otherwise", () => {
    for (const feature of RACE_FEATURES) {
      if (feature === "mixed") continue;
      let featured = 0;
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const track = buildRaceTrack(800, 600, { feature, trackLength: 12 }, 8, rng(seed));
        featured += track.kindCounts[FEATURE_ROW_KIND[feature]];
        total += track.rowsPerLap - 2;
        expect(dominantRowKind(track)).toBe(FEATURE_ROW_KIND[feature]);
      }
      expect(featured / total, feature).toBeGreaterThan(0.4);
    }
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) for (const row of buildRaceTrack(800, 600, {}, 8, rng(seed)).rows) kinds.add(row.kind);
    expect(kinds.size).toBe(RACE_ROW_KINDS.length);
  });

  it("picks row kinds by weight and damps a repeat", () => {
    const w = rowKindWeights("mixed", "pegs");
    expect(w.pegs).toBeLessThan(rowKindWeights("mixed", null).pegs);
    expect(rowKindWeights("turbo", "turbo").turbo).toBeGreaterThan(rowKindWeights("mixed", null).turbo);
    expect(pickRowKind("mixed", null, 0)).toBe(RACE_ROW_KINDS[0]);
    expect(pickRowKind("mixed", null, 0.99999)).toBe(RACE_ROW_KINDS[RACE_ROW_KINDS.length - 1]);
  });

  it("lays a start grid of distinct slots above the gate and shuffles the racers into it", () => {
    const track = buildRaceTrack(800, 600, { racers: 16 }, 8, rng(5));
    expect([...track.gridOrder].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const r = track.racerRadius;
    for (let i = 0; i < 16; i++) {
      expect(track.startY[i]).toBeLessThan(track.yStart - r);
      expect(track.startY[i]).toBeGreaterThan(track.ceilingY + r);
      expect(track.startX[i]).toBeGreaterThan(track.left + r);
      expect(track.startX[i]).toBeLessThan(track.right - r);
      for (let j = 0; j < i; j++) expect(Math.hypot(track.startX[i] - track.startX[j], track.startY[i] - track.startY[j])).toBeGreaterThan(2 * r);
    }
  });

  it("scales with the field: the same numbers give the same track, only bigger", () => {
    const small = buildRaceTrack(800, 600, {}, 8, rng(11));
    const big = buildRaceTrack(1080, 1920, {}, 8, rng(11));
    const k = big.field.size / small.field.size;
    expect(big.rows.length).toBe(small.rows.length);
    expect(big.racerRadius / small.racerRadius).toBeCloseTo(k, 6);
    small.rows.forEach((row, i) => expect((big.rows[i].top - big.field.top) / (row.top - small.field.top)).toBeCloseTo(k, 6));
    expect(racerRadius(8, RACER_REFERENCE_FIELD)).toBe(8);
    expect(racerRadius(30, 400)).toBeCloseTo(0.028 * 400, 6);
    expect(buildRaceField(800, 600).size).toBeLessThan(600);
  });

  it("finds the rows around a y and turns the spinners analytically", () => {
    const track = buildRaceTrack(800, 600, { feature: "spinners" }, 8, rng(2));
    const row = track.rows[3];
    expect(firstRowFrom(track.rows, (row.top + row.bottom) / 2)).toBe(3);
    expect(firstRowFrom(track.rows, track.finishY + 1)).toBe(track.rows.length);
    const spinner = track.spinners[0];
    setSpinnerAngles(track, 2);
    const a = (spinner.shape as SegmentObstacle).angle;
    setSpinnerAngles(track, 2 + (2 * Math.PI) / Math.abs(spinner.omega));
    expect((spinner.shape as SegmentObstacle).angle).toBeCloseTo(a, 6);
  });

  it("resolves its track settings", () => {
    // --- uncap-all --- no maximum but the memory-safety ones: 100 screens as typed, the racers at most RACER_CEILING
    expect(resolveRaceTrackSettings({ racers: 0, trackLength: 100, laps: 2.4, feature: "x" as never })).toEqual({ racers: 2, trackLength: 100, laps: 2, feature: "mixed" });
    expect(resolveRaceTrackSettings({ racers: 40, trackLength: 1.4, laps: 9 })).toEqual({ racers: 40, trackLength: 3, laps: 9, feature: "mixed" });
    expect(resolveRaceTrackSettings({ racers: 5000 }).racers).toBe(RACER_CEILING);
  });
});

describe("race standings and points", () => {
  it("ranks by progress with a hysteresis, finishers first and DNFs last", () => {
    const order = [0, 1, 2, 3];
    const progress = [100, 104, 90, 50];
    const place = [0, 0, 0, 0];
    const passes: [number, number, number][] = [];
    rankRacers(order, 4, progress, place, 8, (a, b, i) => passes.push([a, b, i]));
    expect(order).toEqual([0, 1, 2, 3]); // 4 px ahead is not a pass yet
    progress[1] = 112;
    rankRacers(order, 4, progress, place, 8, (a, b, i) => passes.push([a, b, i]));
    expect(order).toEqual([1, 0, 2, 3]);
    expect(passes).toEqual([[1, 0, 0]]);
    progress[3] = 200;
    passes.length = 0;
    rankRacers(order, 4, progress, place, 8, (a, b, i) => passes.push([a, b, i]));
    expect(order[0]).toBe(3);
    expect(passes.length).toBe(3);
    place[2] = 1; // racer 2 won (it crossed first even though its progress reads less here)
    place[0] = -1;
    rankRacers(order, 4, progress, place, 8);
    expect(order[0]).toBe(2);
    expect(order[3]).toBe(0);
    const broken = [5, 5];
    rankRacers(broken, 3, [1, 2, 3], [0, 0, 0], 0);
    expect(broken.sort()).toEqual([0, 1, 2]);
  });

  it("times the gaps from when the front passed", () => {
    const clock = new LeaderClock(100);
    clock.reset(1000, 0);
    // The front moves at 100 px/s.
    for (let t = 100; t <= 5000; t += 100) clock.advance(t / 10, t);
    expect(clock.getFront()).toBeCloseTo(500, 6);
    expect(clock.gapMs(500, 5000)).toBe(0);
    expect(clock.gapMs(300, 5000)).toBeCloseTo(2000, 3);
    expect(clock.gapMs(123, 5000)).toBeCloseTo(3770, 3);
    expect(clock.timeAt(600)).toBeNaN();
  });

  it("scores F1 points", () => {
    expect(F1_POINTS.reduce((a, b) => a + b, 0)).toBe(101);
    expect(pointsForPlace(1)).toBe(25);
    expect(pointsForPlace(10)).toBe(1);
    expect(pointsForPlace(11)).toBe(0);
    expect(pointsForPlace(-1)).toBe(0);
    expect(pointsForPlace(0)).toBe(0);
  });

  it("adds a race to the cup once per run and starts a new cup for another grid", () => {
    const one = addRaceToCup(null, { racers: 4, order: [2, 0, 3] }, "a:1");
    expect(one).toMatchObject({ racers: 4, races: 1, points: [18, 0, 25, 15] });
    expect(addRaceToCup(one, { racers: 4, order: [2, 0, 3] }, "a:1")).toBe(one);
    const two = addRaceToCup(one, { racers: 4, order: [0, 2, 1, 3] }, "a:2");
    expect(two.points).toEqual([43, 15, 43, 27]);
    expect(two.places[0]).toEqual([1, 1, 0, 0]);
    expect(rankCup(two)).toEqual([0, 2, 3, 1]); // 0 and 2 tie on points; 0 wins on countback? both have one win and one second: racer number decides
    const three = addRaceToCup(two, { racers: 4, order: [2, 1, 0, 3] }, "a:3");
    expect(rankCup(three)[0]).toBe(2); // two wins beat one
    expect(racePoints({ racers: 4, order: [2, 1] }, 1)).toBe(18);
    expect(racePoints({ racers: 4, order: [2, 1] }, 3)).toBe(0);
    const fresh = addRaceToCup(three, { racers: 6, order: [5] }, "a:4");
    expect(fresh).toMatchObject({ racers: 6, races: 1 });
    expect(fresh.points[5]).toBe(25);
    expect(emptyCup(3).places).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    // A race nobody finished is not a race of the cup: nothing scored, nothing counted.
    expect(addRaceToCup(three, { racers: 4, order: [] }, "a:5")).toBe(three);
    expect(addRaceToCup(null, { racers: 4, order: [] }, "a:6")).toEqual(emptyCup(4));
  });

  it("lists the standings under the podium from the first racer the podium steps do not show", () => {
    const order = [4, 1, 0, 2, 3, 5, 6, 7];
    expect(podiumRest({ order, finishOrder: [4, 1, 0, 2, 3] })).toEqual({ firstPlace: 4, racers: [2, 3, 5, 6, 7] });
    // One finisher and seven DNFs: the list starts right after the winner, so no DNF is left out.
    expect(podiumRest({ order, finishOrder: [4] })).toEqual({ firstPlace: 2, racers: [1, 0, 2, 3, 5, 6, 7] });
    expect(podiumRest({ order, finishOrder: [] })).toEqual({ firstPlace: 1, racers: order });
    expect(podiumRest({ order: [1, 0], finishOrder: [1, 0] })).toEqual({ firstPlace: 3, racers: [] });
    const sixteen = Array.from({ length: 16 }, (_, i) => i);
    expect(podiumRest({ order: sixteen, finishOrder: sixteen })).toEqual({ firstPlace: 4, racers: sixteen.slice(3, 11) });
  });

  it("scores a fast export's race under the page's run key, so a race the page already scored is not counted twice", () => {
    const race = { racers: 4, trackLength: RACE_RANGES.rcTrackLength.min, laps: 1 };
    // The page's engine starts its race more than once before the first visible run (constructor, settings effects).
    const page = raceEngine(race, 11);
    page.initRace();
    page.initRace();
    runRace(page);
    const pageView = page.getRaceView();
    expect(pageView.runSerial).toBeGreaterThan(1);
    const prefix = "page";
    const pageKey = runKey(prefix, pageView);
    const stored = addRaceToCup(null, raceResultOf(pageView), pageKey);
    expect(stored.races).toBe(1);
    // The export replays the same seed on a fresh engine, whose run serial starts again at 1.
    const fresh = raceEngine(race, 11);
    runRace(fresh);
    const exportView = fresh.getRaceView();
    expect(exportView.runSerial).toBe(1);
    expect(raceResultOf(exportView)).toEqual(raceResultOf(pageView));
    const options: CanvasRaceOptions = { names: [], colors: [], emoji: [], showStandings: true, showMiniMap: true, cupEnabled: true, cup: stored, cupTitle: "Cup", runKeyPrefix: prefix, labels: DEFAULT_RACE_LABELS };
    // Without the page's key the export would add the race a second time (the bug: races 2, points doubled).
    expect(cupRunKey(options, exportView)).toBe(`${prefix}:1`);
    expect(addRaceToCup(stored, raceResultOf(exportView), cupRunKey(options, exportView)).races).toBe(2);
    // With it the export draws the stored cup as it is.
    const exported = exportRaceOptions(options, pageKey)!;
    expect(exported).not.toBe(options);
    expect(exported).toMatchObject({ runKey: pageKey, cup: stored, runKeyPrefix: prefix });
    expect(cupRunKey(exported, exportView)).toBe(pageKey);
    expect(addRaceToCup(stored, raceResultOf(exportView), cupRunKey(exported, exportView))).toBe(stored);
    // A race the page has not scored yet is added once, under the key the page will score it under.
    const shown = addRaceToCup(null, raceResultOf(exportView), cupRunKey(exported, exportView));
    expect(shown).toMatchObject({ races: 1, lastRun: pageKey, points: stored.points });
    // Outside the race (no key) or without race options the page's options go through unchanged.
    expect(exportRaceOptions(options, undefined)).toBe(options);
    expect(exportRaceOptions(null, pageKey)).toBeNull();
    expect(exportRaceOptions(undefined, pageKey)).toBeUndefined();
  });

  it("reads back only valid cups", () => {
    const cup = addRaceToCup(null, { racers: 3, order: [1, 0, 2] }, "k");
    expect(parseCup(JSON.stringify(cup))).toEqual(cup);
    expect(parseCup("{nope")).toBeNull();
    expect(parseCup({ ...cup, version: 99 })).toBeNull();
    expect(parseCup({ ...cup, points: [1, 2] })).toBeNull();
    expect(parseCup({ ...cup, places: [[0, 0, 0], [0, -1, 0], [0, 0, 0]] })).toBeNull();
    expect(parseCup(null)).toBeNull();
  });

  it("keeps the page's cup in a store without storage", () => {
    const store = new RaceCupStore();
    let heard = 0;
    const off = store.subscribe(() => heard++);
    expect(store.get()).toBeNull();
    store.addRace({ racers: 2, order: [] }, "p:0");
    expect(store.get()).toBeNull();
    expect(heard).toBe(0);
    store.addRace({ racers: 2, order: [1, 0] }, "p:1");
    store.addRace({ racers: 2, order: [1, 0] }, "p:1");
    store.addRace({ racers: 2, order: [] }, "p:2");
    expect(store.get()).toMatchObject({ races: 1, points: [18, 25] });
    expect(heard).toBe(1);
    store.reset();
    expect(store.get()).toBeNull();
    off();
  });
});

describe("race roster, notes and tunes", () => {
  it("takes the Teams roster first and the racer palette after it", () => {
    const roster = raceRoster([{ name: "Rockets", color: "#123456", emoji: "🚀" }, { name: "", color: "nope", emoji: "" }], ["Red", "Blue", "Green"]);
    expect(roster.names.slice(0, 3)).toEqual(["Rockets", "Blue", "Green"]);
    expect(roster.colors[0]).toBe("#123456");
    expect(roster.colors[1]).toBe(RACE_COLORS[1]);
    expect(roster.emoji.slice(0, 2)).toEqual(["🚀", ""]);
    expect(roster.names[15]).toBe("#16");
    expect(new Set(RACE_COLORS).size).toBe(16);
  });

  it("gives every racer its own note and plays rising tunes", () => {
    const notes = Array.from({ length: 16 }, (_, i) => racerNote(i));
    expect(new Set(notes).size).toBe(16);
    for (let i = 1; i < 16; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    expect(notes[0]).toBeCloseTo(261.63, 1);
    const chime = raceArpeggioNotes("chime", 440);
    expect(chime[0].frequency).toBe(440);
    for (let i = 1; i < chime.length; i++) {
      expect(chime[i].frequency).toBeGreaterThan(chime[i - 1].frequency);
      expect(chime[i].offset).toBeGreaterThan(chime[i - 1].offset);
    }
    const fanfare = raceArpeggioNotes("fanfare");
    const last = fanfare.filter((n) => n.offset === fanfare[fanfare.length - 1].offset);
    expect(last.length).toBeGreaterThanOrEqual(3); // the held chord
    expect(raceArpeggioLength("fanfare")).toBeGreaterThan(raceArpeggioLength("chime"));
  });
});

describe("race mode in the engine", () => {
  it("holds the grid for the countdown, beeps 3-2-1 and GO, then drops the racers", () => {
    const engine = raceEngine({}, 21);
    const view = engine.getRaceView();
    const start = engine.getBalls().map((b) => [b.x, b.y]);
    const sounds: SoundEvent[] = [];
    for (let t = 0; t < COUNTDOWN_MS - 20; t += 1000 / 60) {
      engine.update(1000 / 60, 0);
      sounds.push(...engine.consumeSoundEvents());
    }
    expect(view.phase).toBe("countdown");
    expect(engine.getBalls().map((b) => [b.x, b.y])).toEqual(start);
    expect(sounds.filter((s) => s.frequency === 440)).toHaveLength(3);
    for (let k = 0; k < 30; k++) {
      engine.update(1000 / 60, 0);
      sounds.push(...engine.consumeSoundEvents());
    }
    expect(view.phase).toBe("racing");
    expect(sounds.some((s) => s.frequency === 880 && s.accent)).toBe(true);
    expect(engine.getBalls().every((b, i) => b.y > start[i][1])).toBe(true);
  });

  it("runs a whole race: everybody placed, a podium, the notes, the chimes and the fanfare", () => {
    const engine = raceEngine({ racers: 8 }, 5);
    const view = engine.getRaceView();
    const phases = new Set<string>();
    const sounds: SoundEvent[] = [];
    let t = 0;
    while (!engine.isSimulationFinished() && t < 300000) {
      engine.update(1000 / 60, 0);
      sounds.push(...engine.consumeSoundEvents());
      phases.add(view.phase);
      t += 1000 / 60;
    }
    expect(engine.isSimulationFinished()).toBe(true);
    expect([...phases]).toEqual(["countdown", "racing", "podium", "done"]);
    const placed = Array.from(view.place.subarray(0, 8));
    expect(placed.every((p) => p !== 0)).toBe(true);
    expect(view.finishOrder.length).toBe(placed.filter((p) => p > 0).length);
    expect(view.finishOrder[0]).toBe(view.winner);
    for (let k = 1; k < view.finishOrder.length; k++) expect(view.finishMs[view.finishOrder[k]]).toBeGreaterThanOrEqual(view.finishMs[view.finishOrder[k - 1]]);
    expect(view.order.slice(0, view.finishOrder.length)).toEqual(view.finishOrder);
    // The run ends PODIUM_MS after the last racer home (or the DNF cut).
    expect(t).toBeGreaterThanOrEqual(view.completeAtMs + PODIUM_MS - 1);
    expect(t).toBeLessThan(view.completeAtMs + PODIUM_MS + 40);
    // Obstacle notes are the racers' notes; passes chime; the winner's fanfare plays once.
    const notes = new Set(Array.from({ length: 8 }, (_, i) => racerNote(i)));
    const hits = sounds.filter((s) => s.type === "hit" && !s.race && !s.bumper && !s.chord && s.frequency !== 440 && s.frequency !== 880);
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.every((s) => notes.has(s.frequency!) || notes.has(s.frequency! / 2))).toBe(true);
    expect(sounds.filter((s) => s.race === "fanfare")).toHaveLength(1);
    expect(sounds.filter((s) => s.race === "chime").length).toBeGreaterThan(2);
    expect(view.passes).toBeGreaterThan(5);
    expect(view.calloutCount).toBeGreaterThan(2);
    expect(view.hits).toBeGreaterThan(20);
  });

  it("is deterministic for a seed, whatever the frame size", () => {
    const a = raceEngine({ racers: 10, feature: "swaps" }, 99);
    const b = raceEngine({ racers: 10, feature: "swaps" }, 99);
    const c = raceEngine({ racers: 10, feature: "swaps" }, 99);
    runRace(a);
    runRace(b);
    runRace(c, 300000, 1000 / 30); // two fixed steps a frame
    const sig = (e: PhysicsEngine) => {
      const v = e.getRaceView();
      return { order: [...v.finishOrder], times: Array.from(v.finishMs.subarray(0, 10)), swaps: v.swaps, boosts: v.boosts, passes: v.passes, pos: e.getBalls().map((ball) => [ball.x, ball.y]) };
    };
    expect(sig(a)).toEqual(sig(b));
    expect(sig(a).order).toEqual(sig(c).order);
    expect(sig(a).times).toEqual(sig(c).times);
    expect(sig(raceEngine({ racers: 10, feature: "swaps" }, 100)).pos).not.toEqual(sig(a).pos);
  });

  it("swaps two racers' places at a swap zone", () => {
    const engine = raceEngine({ racers: 8, feature: "swaps" }, 13);
    const view = engine.getRaceView();
    let checked = 0;
    for (let t = 0; t < 120000 && checked === 0 && !engine.isSimulationFinished(); t += 1000 / 60) {
      const before = engine.getBalls().map((b) => ({ x: b.x, y: b.y }));
      const swaps = view.swaps;
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (view.swaps === swaps) continue;
      const zone = view.track!.zones.find((z) => z.atMs === view.timeMs)!;
      expect(zone.used).toBe(true);
      const [a, b] = [zone.a, zone.b];
      const balls = engine.getBalls();
      // Each of the two ended the step where the other one was (give or take one step of motion).
      const reach = 0.05 * view.track!.field.size;
      expect(Math.hypot(balls[a].x - before[b].x, balls[a].y - before[b].y)).toBeLessThan(reach);
      expect(Math.hypot(balls[b].x - before[a].x, balls[b].y - before[a].y)).toBeLessThan(reach);
      expect(view.swapAtMs[a]).toBe(view.timeMs);
      expect(currentCallout(view, view.timeMs)?.kind).toBe("swap");
      checked++;
    }
    expect(checked).toBe(1);
  });

  it("boosts each racer once per turbo pad", () => {
    const engine = raceEngine({ racers: 12, feature: "turbo" }, 4);
    runRace(engine);
    const view = engine.getRaceView();
    let used = 0;
    for (const pad of view.track!.pads) for (let i = 0; i < 12; i++) if (pad.used & (1 << i)) used++;
    expect(view.boosts).toBeGreaterThan(10);
    expect(view.boosts).toBe(used);
  });

  it("follows the leader with the camera and keeps it in view", () => {
    const engine = raceEngine({ racers: 8 }, 8);
    const view = engine.getRaceView();
    let lastCam = view.cameraY;
    let outOfView = 0;
    let frames = 0;
    for (let t = 0; t < 60000 && view.phase !== "podium"; t += 1000 / 60) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (view.phase !== "racing" || view.timeMs < COUNTDOWN_MS + 1500) continue;
      const leader = view.order.find((i) => view.place[i] === 0);
      if (leader === undefined) continue;
      const f = view.track!.field;
      const y = engine.getBalls()[leader].y - view.cameraY;
      frames++;
      if (y < f.top || y > f.bottom) outOfView++;
      lastCam = view.cameraY;
    }
    expect(lastCam).toBeGreaterThan(view.track!.field.size * 3);
    expect(outOfView / frames).toBeLessThan(0.02);
  });

  it("frames the pack with the pack camera", () => {
    const leader = raceEngine({ racers: 8, camera: "leader" }, 9);
    const pack = raceEngine({ racers: 8, camera: "pack" }, 9);
    for (let k = 0; k < 900; k++) {
      leader.update(1000 / 60, 0);
      pack.update(1000 / 60, 0);
    }
    // Same race (the camera never touches the physics), a different view.
    expect(pack.getBalls().map((b) => b.y)).toEqual(leader.getBalls().map((b) => b.y));
    expect(pack.getRaceView().cameraY).not.toBeCloseTo(leader.getRaceView().cameraY, 0);
  });

  it("adds the cup table to the run when the cup is on", () => {
    const engine = raceEngine({ racers: 4, trackLength: 3, cup: true }, 2);
    const view = engine.getRaceView();
    const { timeMs } = runRace(engine);
    expect(view.cupAtMs).toBeGreaterThan(view.completeAtMs);
    expect(timeMs).toBeGreaterThanOrEqual(view.completeAtMs + PODIUM_MS + CUP_MS - 1);
  });

  it("stages the favourite's win at swap zones and turbo pads", () => {
    for (const race of [{ racers: 8, winner: 2 }, { racers: 16, winner: 11 }, { racers: 6, winner: 0, laps: 2, trackLength: 4 }]) {
      for (let seed = 1; seed <= 8; seed++) {
        const engine = raceEngine(race, seed * 7);
        runRace(engine);
        expect(engine.getRaceView().winner, `${JSON.stringify(race)} seed ${seed * 7}`).toBe(race.winner);
      }
    }
    // Without the rig the same seeds have other winners too.
    const winners = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const engine = raceEngine({ racers: 8 }, seed * 7);
      runRace(engine);
      winners.add(engine.getRaceView().winner);
    }
    expect(winners.size).toBeGreaterThan(2);
  });

  // --- review fix (modes-rhythm) ---
  it("a staged favourite keeps the faster speed through a swap: a turbo-boosted favourite swapped from behind still wins", () => {
    const cases: [Partial<PhysicsConfig>, Partial<RaceSettings>, number][] = [
      // The review's three: the first one lost before (the rival took the favourite's turbo speed at the final zone).
      [{ width: 450, height: 800, ballSpeed: 800, ballRadius: 4 }, { racers: 2, trackLength: 8, laps: 1, feature: "turbo", winner: 0 }, 986772],
      [{ width: 720, height: 1280, ballSpeed: 400, ballRadius: 4 }, { racers: 3, trackLength: 5, laps: 2, feature: "turbo", winner: 0 }, 182374],
      [{ width: 800, height: 600, ballSpeed: 200, ballRadius: 8 }, { racers: 7, trackLength: 4, laps: 2, feature: "turbo", winner: 3 }, 791399],
      // Staged races that also lost to a swapped rival before the fix.
      [{ width: 720, height: 1280, ballSpeed: 800, ballRadius: 4 }, { racers: 3, trackLength: 3, laps: 1, feature: "turbo", winner: 2 }, 48545],
      [{ width: 800, height: 600, ballSpeed: 400, ballRadius: 4 }, { racers: 2, trackLength: 5, laps: 1, feature: "turbo", winner: 0 }, 292838],
      [{ width: 720, height: 1280, ballSpeed: 400, ballRadius: 8 }, { racers: 3, trackLength: 3, laps: 1, feature: "turbo", winner: 0 }, 347050],
      [{ width: 540, height: 960, ballSpeed: 400, ballRadius: 4 }, { racers: 2, trackLength: 7, laps: 1, feature: "turbo", winner: 1 }, 136859],
      [{ width: 540, height: 960, ballSpeed: 800, ballRadius: 4 }, { racers: 3, trackLength: 6, laps: 1, feature: "turbo", winner: 2 }, 842105],
    ];
    for (const [cfg, race, seed] of cases) {
      const engine = raceEngine(race, seed, cfg);
      runRace(engine);
      const view = engine.getRaceView();
      expect(view.winner, `${JSON.stringify({ cfg, race })} seed ${seed}`).toBe(race.winner);
      expect(view.finishOrder[0]).toBe(race.winner);
    }
  });

  it("a seed runs the same race on a canvas twice the size, and after a 2× resize before the start or mid-race", () => {
    // The layout, the racers and the push-out gap (RACE_SEPARATION_REL) all scale with the field; other sizes can still
    // round differently, which is why the page drops a found seed on a resize (seedSurvivesResize).
    const run = (width: number, height: number, seed: number, resize?: { atStep: number; width: number; height: number }) => {
      const engine = raceEngine({}, seed, { width, height });
      let step = 0;
      while (step < 18000 && !engine.isSimulationFinished()) {
        if (resize && step === resize.atStep) engine.setConfig({ width: resize.width, height: resize.height });
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        step++;
      }
      const view = engine.getRaceView();
      return { winner: view.winner, finishOrder: view.finishOrder.slice(0, 8), steps: step };
    };
    for (const seed of [1, 2, 3]) {
      const ref = run(450, 800, seed);
      expect(ref.winner).toBeGreaterThanOrEqual(0);
      expect(run(900, 1600, seed), `seed ${seed} at 900×1600`).toEqual(ref);
      expect(run(450, 800, seed, { atStep: 0, width: 900, height: 1600 }), `seed ${seed} resized before the start`).toEqual(ref);
      expect(run(450, 800, seed, { atStep: 400, width: 900, height: 1600 }), `seed ${seed} resized mid-race`).toEqual(ref);
    }
    expect(RACE_SEPARATION_REL * 400).toBeCloseTo(0.01, 12); // the old fixed 0.01 px on the reference field
  });

  it("frees stuck racers, gives the stragglers a grace period and ends every race", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = raceEngine({ racers: 16, feature: "gates" }, seed);
      const { timeMs } = runRace(engine);
      const view = engine.getRaceView();
      expect(engine.isSimulationFinished()).toBe(true);
      const winnerMs = view.finishMs[view.winner];
      expect(timeMs).toBeLessThan(COUNTDOWN_MS + winnerMs + dnfGraceMs(winnerMs) + PODIUM_MS + 100);
      const dnf = Array.from(view.place.subarray(0, 16)).filter((p) => p < 0).length;
      expect(dnf).toBeLessThanOrEqual(3);
    }
    expect(dnfGraceMs(10000)).toBe(12000);
    expect(dnfGraceMs(60000)).toBe(30000);
  });

  it("scales the time limit with the track, the Ball Speed and the Gravity – and only ever lengthens it during a run", () => {
    expect(raceTimeLimitMs(8, 400, 300)).toBe(MAX_RACE_MS);
    expect(raceTimeLimitMs(100, 400, 300)).toBe(100 * RACE_MS_PER_SCREEN);
    expect(raceTimeLimitMs(100, 200, 300)).toBe(200 * RACE_MS_PER_SCREEN);
    expect(raceTimeLimitMs(100, 400, 150)).toBe(200 * RACE_MS_PER_SCREEN);
    expect(raceTimeLimitMs(3, 50, 0)).toBeCloseTo((3 * RACE_MS_PER_SCREEN) / (0.25 * 0.3), 6);
    expect(raceTimeLimitMs(100, 800, 2000)).toBe(MAX_RACE_MS);
    expect(raceTimeLimitMs(Number.NaN, 400, 300)).toBe(MAX_RACE_MS);
    const engine = raceEngine({ trackLength: 20, laps: 5 }, 1);
    const view = engine.getRaceView();
    expect(view.timeLimitMs).toBe(100 * RACE_MS_PER_SCREEN);
    engine.setConfig({ ballSpeed: 200 });
    engine.update(1000 / 60, 0);
    expect(view.timeLimitMs).toBe(200 * RACE_MS_PER_SCREEN);
    engine.setConfig({ ballSpeed: 800 });
    engine.update(1000 / 60, 0);
    expect(view.timeLimitMs).toBe(200 * RACE_MS_PER_SCREEN);
    // A new run takes the limit of its own tempo (Ball Speed 800: twice as fast, half the limit).
    engine.initRace();
    expect(view.timeLimitMs).toBe(50 * RACE_MS_PER_SCREEN);
    engine.setConfig({ ballSpeed: 400 });
    engine.initRace();
    expect(view.timeLimitMs).toBe(100 * RACE_MS_PER_SCREEN);
    const data: Record<string, string> = {};
    writeRaceDataset(view, (key, value) => (data[key] = value));
    expect(data.raceTimeLimit).toBe(String((100 * RACE_MS_PER_SCREEN) / 1000));
  });

  it("finishes the longest tracks: a winner (the favourite when staged), a podium and a fanfare – never cut off by the limit", () => {
    // 20 screens × 5 laps took over four minutes – past the old fixed 240 s limit, which ended these seeds with nobody home.
    for (const race of [{ trackLength: 20, laps: 5 }, { trackLength: 20, laps: 5, winner: 2 }, { trackLength: 20, laps: 5, racers: 2 }] as Partial<RaceSettings>[]) {
      for (const seed of [1, 2, 3]) {
        const label = `${JSON.stringify(race)} seed ${seed}`;
        const engine = raceEngine(race, seed, { width: 790, height: 444 });
        const view = engine.getRaceView();
        const { sounds } = runRace(engine, 2_000_000);
        expect(engine.isSimulationFinished(), label).toBe(true);
        expect(view.winner, label).toBeGreaterThanOrEqual(0);
        if (race.winner !== undefined) expect(view.winner, label).toBe(race.winner);
        expect(view.finishOrder[0], label).toBe(view.winner);
        expect(view.finishOrder.length, label).toBeGreaterThanOrEqual(Math.min(3, view.racers));
        expect(view.completeAtMs - view.goAtMs, label).toBeLessThan(view.timeLimitMs);
        expect(sounds.filter((e) => e.race === "fanfare"), label).toHaveLength(1);
        expect(raceResultOf(view).order.length, label).toBeGreaterThan(0);
      }
    }
  });

  it("places everybody still racing when the time limit comes before anybody finishes: the favourite first, then by the standings", () => {
    for (const race of [{ trackLength: 20, laps: 5 }, { trackLength: 20, laps: 5, winner: 5 }] as Partial<RaceSettings>[]) {
      const engine = raceEngine(race, 2);
      const view = engine.getRaceView();
      // Squeeze the limit to 20 s (the track needs minutes), so the backstop is what ends the race.
      Object.defineProperty(view, "timeLimitMs", { configurable: true, get: () => 20000, set: () => {} });
      const { sounds } = runRace(engine);
      const label = JSON.stringify(race);
      expect(engine.isSimulationFinished(), label).toBe(true);
      expect(view.completeAtMs - view.goAtMs, label).toBeGreaterThanOrEqual(20000);
      expect(view.completeAtMs - view.goAtMs, label).toBeLessThan(20000 + 20);
      expect(view.finishOrder, label).toHaveLength(8);
      expect(new Set(view.finishOrder).size, label).toBe(8);
      expect(Array.from(view.place.subarray(0, 8)).every((p) => p > 0), label).toBe(true);
      expect(view.order.slice(0, 8), label).toEqual(view.finishOrder);
      expect(view.winner, label).toBe(view.finishOrder[0]);
      if (race.winner !== undefined) expect(view.winner, label).toBe(race.winner);
      expect(sounds.filter((e) => e.race === "fanfare"), label).toHaveLength(1);
      expect(currentCallout(view, view.completeAtMs)?.kind, label).toBe("winner");
      expect(podiumRest(view).firstPlace, label).toBe(4);
    }
  });

  it("scales gravity and top speed with the Gravity and Ball Speed settings", () => {
    const base = raceMotion(300, 400, 500);
    const fast = raceMotion(300, 800, 500);
    const heavy = raceMotion(900, 400, 500);
    expect(fast.g / base.g).toBeCloseTo(4, 6);
    expect(fast.vmax / base.vmax).toBeCloseTo(2, 6);
    expect(heavy.vmax / base.vmax).toBeCloseTo(3, 6);
    const quick = raceEngine({ racers: 6 }, 3, { ballSpeed: 800 });
    const slow = raceEngine({ racers: 6 }, 3);
    expect(runRace(quick).timeMs).toBeLessThan(runRace(slow).timeMs);
  });

  it("re-lays the track for a new canvas size before the start and rescales it after", () => {
    const engine = raceEngine({ racers: 8 }, 31);
    const fresh = createEngineForSettings({ ...config, width: 1080, height: 1920 }, "race", { ...modeSettings, race: { racers: 8 } }, 31);
    engine.setConfig({ width: 1080, height: 1920 });
    expect(trackSignature(engine.getRaceView().track!)).toEqual(trackSignature(fresh.getRaceView().track!));
    for (let k = 0; k < 400; k++) engine.update(1000 / 60, 0);
    engine.setConfig({ width: 700, height: 700 });
    const view = engine.getRaceView();
    const track = view.track!;
    for (const ball of engine.getBalls()) {
      expect(ball.x).toBeGreaterThanOrEqual(track.left + ball.radius - 1);
      expect(ball.x).toBeLessThanOrEqual(track.right - ball.radius + 1);
    }
    runRace(engine);
    expect(engine.isSimulationFinished()).toBe(true);
  });

  it("follows live camera and shape changes and takes the track settings on the next start", () => {
    const mode = new RaceMode();
    mode.setSettings({ camera: "pack", shape: "circle", racers: 12 });
    expect(mode.getView().settings).toMatchObject({ camera: "pack", shape: "circle" });
    expect(mode.getSettings().racers).toBe(12);
    const engine = raceEngine({ racers: 5 }, 1);
    expect(engine.getRaceView().racers).toBe(5);
    engine.setRaceSettings({ racers: 9 });
    expect(engine.getRaceView().racers).toBe(5);
    engine.initRace();
    expect(engine.getRaceView().racers).toBe(9);
    expect(engine.getBalls()).toHaveLength(9);
    expect(engine.getRaceView().runSerial).toBeGreaterThan(1);
  });
});

describe("race and the seed finder", () => {
  it("builds the race for a seed, times it and never calls it endless or fixed", () => {
    const engine = createEngineForSettings(config, "race", { ...modeSettings, race: { racers: 6 } }, 5);
    expect(engine.isRaceMode()).toBe(true);
    expect(engine.getBalls()).toHaveLength(6);
    expect(runNeverFinishes("race", modeSettings)).toBe(false);
    expect(fixedRunDurationSec("race", modeSettings)).toBeNull();
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 90, physicsConfig: config, mode: "race", modeSettings: { ...modeSettings, race: { racers: 6 } } };
    const durations = [1, 2, 3, 4].map((seed) => simulateSeed(seed, request, 90000));
    for (const d of durations) {
      expect(d).toBeGreaterThan(15000);
      expect(d).toBeLessThan(90000);
    }
    expect(new Set(durations.map((d) => Math.round(d))).size).toBeGreaterThan(2);
    // A found seed replays exactly in a fresh engine.
    const again = createEngineForSettings(config, "race", { ...modeSettings, race: { racers: 6 } }, 1);
    expect(runRace(again).timeMs).toBeCloseTo(durations[0], 6);
  });
});
