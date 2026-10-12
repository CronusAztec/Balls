import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { createEngineForSettings, findSimulation, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  PENTOMINO_SET,
  PF_LADDER_WRAP,
  TETROMINO_SET,
  beatSlot,
  dropOrder,
  fixedOrientations,
  linesClearedAt,
  occupiedCells,
  orientationCount,
  pentominoWays,
  planPerfectClear,
  planPerfectFit,
  puzzleAt,
  rectsDoneAt,
  searchTilings,
  simulateDrops,
  tetrisChunks,
  tileBox,
  type PerfectFitPlanInput,
  type Placement,
} from "@/lib/simulation/polyominoPlan";
import {
  DEFAULT_PERFECT_FIT_FIELDS,
  PF_PRESET_IDS,
  PF_RANGES,
  parseBoxes,
  parseSections,
  perfectFitPresetPatch,
  perfectFitSettingsOf,
  perfectFitVariantPatch,
  resolvePerfectFitFields,
  resolvePerfectFitSettings,
  type PerfectFitSettings,
} from "@/lib/physics/perfectFit";
import { PF_FINDER_TRIES, findPerfectFitRun, perfectFitPlanOf } from "@/lib/simulation/perfectFitFinder";
import { pfLadderHz } from "@/lib/physics/modes/perfectFit";
import { PERFECT_FIT_DATA_KEYS, PERFECT_FIT_ENGLISH, PerfectFitLayer, writePerfectFitDataset } from "@/components/simulator/perfectFitRenderer";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { loopPlayOptions } from "@/lib/audio/loopEvents";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { fakeCanvas } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- perfect-fit --- Perfect Fit (lib/simulation/polyominoPlan.ts, lib/physics/perfectFit.ts, lib/physics/modes/perfectFit.ts):
 * the planner's promises – the 63 orientations, exact covers, real vertical drops, 3 × 20 refused, the Tetris chunks' clears,
 * a seed's plan replayed – then the timeline, the run in the engine (rectangles and lines per loop, an empty box at every seam,
 * the frame rate), the sounds through a real ToneGenerator, the finder, the settings and the renderer.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;
const BOXES = [
  { w: 10, h: 6 },
  { w: 12, h: 5 },
  { w: 15, h: 4 },
];

function input(patch: Partial<PerfectFitPlanInput> = {}): PerfectFitPlanInput {
  return { variant: "pento", boxes: BOXES, pieceSec: 0.55, sections: [4, 4, 4, 4, 12], wellW: 10, wellH: 16, hold: true, beatSec: 0, seed: 5, ...patch };
}

function pfEngine(patch: Partial<PerfectFitSettings> = {}, seed = 7, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "perfectFit", { ...base, perfectFit: patch }, seed);
}

/** Steps `engine` `frames` times by `frameMs`, collecting every sound event. */
function run(engine: PhysicsEngine, frames: number, frameMs = STEP): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(frameMs, 0);
    out.push(...engine.consumeSoundEvents());
  }
  return out;
}

/** Every cell of a tiling once: the cells of `pieces` cover the w × h box exactly. */
function coverCount(pieces: readonly Placement[], w: number, h: number): Int32Array {
  const grid = new Int32Array(w * h);
  for (const p of pieces) for (let k = 0; k < p.cells.length; k += 2) grid[p.cells[k + 1] * w + p.cells[k]]++;
  return grid;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Perfect Fit: the planner", () => {
  it("1. gives the 12 pentominoes 63 fixed orientations (and the 7 one-sided tetrominoes 19)", () => {
    expect(PENTOMINO_SET.pieces.map((p) => p.name).join("")).toBe("FILNPTUVWXYZ");
    expect(orientationCount(PENTOMINO_SET)).toBe(63);
    // the classic counts per piece: F 8, I 2, L 8, N 8, P 8, T 4, U 4, V 4, W 4, X 1, Y 8, Z 4
    expect(PENTOMINO_SET.orientations.map((o) => o.length)).toEqual([8, 2, 8, 8, 8, 4, 4, 4, 4, 1, 8, 4]);
    expect(orientationCount(TETROMINO_SET)).toBe(19);
    expect(TETROMINO_SET.orientations.map((o) => o.length)).toEqual([2, 1, 4, 2, 2, 4, 4]);
    // every orientation has five cells, normalised to the origin, and none repeats
    for (const list of PENTOMINO_SET.orientations) {
      const keys = new Set(list.map((o) => o.key));
      expect(keys.size).toBe(list.length);
      for (const o of list) {
        expect(o.cells).toHaveLength(5);
        expect(Math.min(...o.cells.map((c) => c[0]))).toBe(0);
        expect(Math.min(...o.cells.map((c) => c[1]))).toBe(0);
      }
    }
    expect(fixedOrientations([[0, 0], [1, 0], [0, 1], [1, 1]], true)).toHaveLength(1);
  });

  it("2. plans the 10 × 6 box as an exact cover: every cell once, every piece once", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const tiling = tileBox(PENTOMINO_SET, 10, 6, seed);
      expect(tiling.status).toBe("ok");
      expect(tiling.pieces).toHaveLength(12);
      expect([...coverCount(tiling.pieces, 10, 6)].every((n) => n === 1)).toBe(true);
      expect(new Set(tiling.pieces.map((p) => p.piece)).size).toBe(12);
    }
    // the other classic boxes too, either way round
    for (const [w, h] of [[12, 5], [15, 4], [6, 10], [5, 12], [4, 15]]) {
      const tiling = tileBox(PENTOMINO_SET, w, h, 4);
      expect(tiling.status, `${w}x${h}`).toBe("ok");
      expect([...coverCount(tiling.pieces, w, h)].every((n) => n === 1), `${w}x${h}`).toBe(true);
    }
    // a box of another area is refused at once
    expect(tileBox(PENTOMINO_SET, 8, 8, 1).status).toBe("size");
    expect(tileBox(PENTOMINO_SET, 30, 2, 1).status).toBe("none");
  });

  it("3. drops every piece straight down onto exactly its target (simulated drops), rectangles and Tetris chunks alike", () => {
    for (const seed of [1, 7, 42]) {
      for (const box of BOXES) {
        const tiling = tileBox(PENTOMINO_SET, box.w, box.h, seed);
        expect(simulateDrops(tiling.pieces, box.w, box.h), `${box.w}x${box.h} seed ${seed}`).toEqual(new Array(12).fill(0));
      }
    }
    // an order that is not a drop order is caught: the last piece first lands on top of the box (blocked) or above it
    const tiling = tileBox(PENTOMINO_SET, 10, 6, 1);
    const reversed = [...tiling.pieces].reverse();
    expect(simulateDrops(reversed, 10, 6).some((d) => d !== 0)).toBe(true);
    for (const [w, lines] of [[10, 4], [10, 12], [20, 4], [20, 24], [7, 4], [6, 2]]) {
      const chunk = planPerfectClear(w, lines, 11)!;
      expect(chunk, `${w}x${lines}`).not.toBeNull();
      expect(simulateDrops(chunk.pieces, w, lines).every((d) => d === 0), `${w}x${lines}`).toBe(true);
      expect(dropOrder(chunk.pieces, w, lines)).not.toBeNull();
    }
  });

  it("4. returns no droppable solution for 3 × 20: both of its tilings (8 with their mirror images) need a piece under an overhang", () => {
    const tiling = tileBox(PENTOMINO_SET, 20, 3, 1);
    expect(tiling.status).toBe("none");
    expect(tiling.pieces).toHaveLength(0);
    // the plain exact cover finds the 8 tilings; not one has a drop order
    const all: Placement[][] = [];
    const stats = searchTilings(PENTOMINO_SET, 20, 3, 1, (pieces) => {
      all.push(pieces);
      return false;
    });
    expect(stats.exhausted).toBe(false);
    expect(all).toHaveLength(8);
    for (const pieces of all) {
      expect([...coverCount(pieces, 20, 3)].every((n) => n === 1)).toBe(true);
      expect(dropOrder(pieces, 20, 3)).toBeNull();
    }
    // the plan shows the box with its words and moves on
    const plan = planPerfectFit(input({ boxes: [{ w: 10, h: 6 }, { w: 20, h: 3 }] }));
    expect(plan.puzzles.map((p) => p.status)).toEqual(["ok", "none"]);
    expect(plan.rects).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(pentominoWays(20, 3)).toBe(2);
    expect([pentominoWays(10, 6), pentominoWays(6, 10), pentominoWays(12, 5), pentominoWays(4, 15), pentominoWays(7, 7)]).toEqual([2339, 2339, 1010, 368, null]);
  }, 20_000);

  it("5. clears exactly 4 rows with each Tetris chunk (a vertical I last, no row full before it) and 12 with the held finale", () => {
    expect(tetrisChunks([4, 4, 4, 4, 12], true).map((c) => c.lines)).toEqual([4, 4, 4, 4, 12]);
    expect(tetrisChunks([4, 4, 4, 4, 12], false).map((c) => c.lines)).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(tetrisChunks([8, 2], true).map((c) => c.lines)).toEqual([4, 4, 2]);
    const plan = planPerfectFit(input({ variant: "tetris", pieceSec: 0.3, seed: 9 }));
    expect(plan.puzzles.map((p) => p.lines)).toEqual([4, 4, 4, 4, 12]);
    expect(plan.puzzles.map((p) => p.pieces.length)).toEqual([10, 10, 10, 10, 30]);
    expect(plan.pieceCount).toBe(70);
    expect(plan.lines).toBe(28);
    for (const p of plan.puzzles) {
      // the chunk fills its rows exactly: w × lines cells, every row complete at the end
      const rows = new Int32Array(p.lines);
      for (const piece of p.pieces) for (let k = 1; k < piece.cells.length; k += 2) rows[piece.cells[k]]++;
      expect([...rows]).toEqual(new Array(p.lines).fill(10));
      if (p.lines === 4) {
        const last = p.pieces[p.pieces.length - 1];
        expect(last.name).toBe("I");
        expect(last.maxY - last.minY).toBe(3);
        // before the I lands, no row is full
        const before = new Int32Array(4);
        for (const piece of p.pieces.slice(0, -1)) for (let k = 1; k < piece.cells.length; k += 2) before[piece.cells[k]]++;
        expect(Math.max(...before)).toBe(9);
      }
    }
    expect(plan.puzzles.map((p) => p.final)).toEqual([false, false, false, false, true]);
    // a section that no tetromino tiling fills is left out
    const odd = planPerfectFit(input({ variant: "tetris", wellW: 5, sections: [4, 3, 2] }));
    expect(odd.puzzles.map((p) => p.lines)).toEqual([4]);
    expect(odd.skipped).toBe(2);
  });

  it("6. gives the same plan for the same seed (and another tiling for another seed)", () => {
    const a = planPerfectFit(input({ seed: 77 }));
    const b = planPerfectFit(input({ seed: 77 }));
    const key = (plan: typeof a) => plan.puzzles.map((p) => p.pieces.map((piece) => `${piece.name}:${Array.from(piece.cells).join(",")}@${piece.tLand.toFixed(6)}`).join("|")).join("#");
    expect(key(a)).toBe(key(b));
    expect(Array.from(a.puzzles[0].scatter)).toEqual(Array.from(b.puzzles[0].scatter));
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((seed) => key(planPerfectFit(input({ seed })))));
    expect(seeds.size).toBeGreaterThan(3);
    const t1 = planPerfectFit(input({ variant: "tetris", seed: 3 }));
    const t2 = planPerfectFit(input({ variant: "tetris", seed: 3 }));
    expect(key(t1)).toBe(key(t2));
  });
});

describe("Perfect Fit: the timeline", () => {
  it("times the rectangles like the reel: a piece every 0.55 s, a 1.45 s completion, 3 boxes in about 24.2 s", () => {
    const plan = planPerfectFit(input());
    expect(plan.rects).toBe(3);
    expect(plan.loopSec).toBeCloseTo(3 * (12 * 0.55 + 1.45), 9);
    const first = plan.puzzles[0];
    expect(first.pieces.map((p) => p.tLand)).toEqual(Array.from({ length: 12 }, (_, k) => expect.closeTo((k + 1) * 0.55, 9)));
    expect(first.tDone).toBeCloseTo(6.6, 9);
    expect(first.tEnd).toBeCloseTo(8.05, 9);
    for (const p of first.pieces) {
      expect(p.tLift).toBeGreaterThanOrEqual(0);
      expect(p.tLand - p.tLift).toBeCloseTo(0.52, 9);
    }
    // the ladder: a degree up per piece from the lift, wrapping after 13, the last one marked
    const lifts = plan.events.filter((e) => e.kind === "lift" && e.puzzle === 0);
    expect(lifts.map((e) => e.degree)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(lifts.map((e) => e.last)).toEqual([...new Array(11).fill(false), true]);
    expect(pfLadderHz(0)).toBeCloseTo(523.25, 1);
    expect(pfLadderHz(5)).toBeCloseTo(1046.5, 1);
    expect(PF_LADDER_WRAP).toBe(13);
    // the counters over time and an empty box at the loop's start and end
    expect(rectsDoneAt(plan, 6.59)).toBe(0);
    expect(rectsDoneAt(plan, 6.61)).toBe(1);
    expect(rectsDoneAt(plan, plan.loopSec - 0.01)).toBe(3);
    expect(occupiedCells(plan, 0)).toBe(0);
    expect(occupiedCells(plan, 6.6)).toBe(60);
    expect(occupiedCells(plan, plan.loopSec - 1e-3)).toBe(0);
    expect(occupiedCells(plan, plan.loopSec + 0.56)).toBe(5);
    expect(puzzleAt(plan, plan.loopSec + 9).index).toBe(1);
  });

  it("times the perfect clears faster section by section, and leaves the well empty at the loop point", () => {
    const plan = planPerfectFit(input({ variant: "tetris", pieceSec: 0.3, seed: 2 }));
    const slots = plan.puzzles.map((p) => p.slot);
    for (let i = 1; i < slots.length; i++) expect(slots[i]).toBeLessThan(slots[i - 1]);
    const clears = plan.events.filter((e) => e.kind === "clear" || e.kind === "final").map((e) => e.t);
    expect(clears).toHaveLength(5);
    for (let i = 1; i < clears.length; i++) expect(clears[i] - clears[i - 1]).toBeGreaterThan(1.5);
    expect(plan.loopSec).toBeGreaterThan(17);
    expect(plan.loopSec).toBeLessThan(20);
    // the counter reads 0, 4, 8, 12, 16, then 28, and 0 again once the finale's flash is over
    expect(clears.map((t) => linesClearedAt(plan, t + 1e-6))).toEqual([4, 8, 12, 16, 28]);
    expect(linesClearedAt(plan, 0.1)).toBe(0);
    expect(linesClearedAt(plan, plan.loopSec - 0.01)).toBe(0);
    expect(occupiedCells(plan, plan.loopSec - 0.01)).toBe(0);
    // a hard cut follows every clear but the last
    expect(plan.events.filter((e) => e.kind === "cut")).toHaveLength(4);
  });

  it("puts every landing on the beat with the beat on: slots of a power of two of beats, a loop of whole bars", () => {
    expect(beatSlot(0.55, 0.5)).toBeCloseTo(0.5, 9);
    expect(beatSlot(0.15, 0.5)).toBeCloseTo(0.125, 9);
    expect(beatSlot(1.6, 0.5)).toBeCloseTo(2, 9);
    for (const variant of ["pento", "tetris"] as const) {
      const plan = planPerfectFit(input({ variant, beatSec: 0.5, pieceSec: variant === "tetris" ? 0.3 : 0.55 }));
      expect(plan.beatSec).toBe(0.5);
      expect((plan.loopSec / 2) % 1).toBeCloseTo(0, 9); // whole bars of 4 × 0.5 s
      for (const p of plan.puzzles) {
        const grid = Math.min(0.5, p.slot);
        for (const piece of p.pieces) {
          const off = piece.tLand / grid - Math.round(piece.tLand / grid);
          expect(Math.abs(off), `${variant} ${piece.tLand}`).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe("Perfect Fit: the run", () => {
  it("registers the mode in the rhythm family after Beat Machines, never finishing, with the 'none' ring layout and its anchor", () => {
    expect(MODE_CATEGORIES.perfectFit).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("perfectFit")).toBe(MODE_CARD_ORDER.indexOf("beatMachine") + 1);
    expect(runNeverFinishes("perfectFit", { drop: {}, box: {} })).toBe(true);
    const engine = pfEngine();
    expect(engine.isPerfectFitMode()).toBe(true);
    expect(engine.getCircularWalls()).toHaveLength(0);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getBalls()[0]).toMatchObject({ x: 400, y: 300 });
    run(engine, 120);
    expect(engine.getBalls()[0]).toMatchObject({ x: 400, y: 300, vx: 0, vy: 0 });
    expect(engine.getCycleSeconds()).toBeCloseTo(engine.getPerfectFitView().plan.loopSec, 9);
  });

  it("builds 3 rectangles a loop and 28 lines a loop, with an empty box at every seam", () => {
    const pento = pfEngine({}, 3);
    const loop = pento.getPerfectFitView().plan.loopSec;
    run(pento, Math.ceil((2 * loop * 1000) / STEP) + 5);
    const v = pento.getPerfectFitView();
    expect(v.rects).toBe(6);
    expect(v.rectsMax).toBe(3);
    expect(v.seams).toBe(2);
    expect(v.seamsEmpty).toBe(2);
    expect(v.landed).toBe(72);
    expect(pento.getLoopSeams()).toMatchObject({ count: 2 });
    const tetris = pfEngine({ variant: "tetris", pieceSec: 0.3 }, 3);
    const tloop = tetris.getPerfectFitView().plan.loopSec;
    run(tetris, Math.ceil((tloop * 1000) / STEP) + 5);
    const tv = tetris.getPerfectFitView();
    expect(tv.linesMax).toBe(28);
    expect(tv.linesTotal).toBe(28);
    expect(tv.clears).toBe(5);
    expect(tv.landed).toBe(70);
    expect(tv.seamsEmpty).toBe(1);
  });

  it("replays the same run at 30, 60 and 120 frames a second (the plan is a function of the simulation clock)", () => {
    const counts = [30, 60, 120].map((fps) => {
      const engine = pfEngine({}, 11);
      const frames = 20 * fps;
      const events = run(engine, frames, 1000 / fps);
      const v = engine.getPerfectFitView();
      return { landed: v.landed, lifts: v.lifts, rects: v.rects, sounds: v.sounds, kinds: events.map((e) => e.loop).join(",") };
    });
    expect(counts[1]).toEqual(counts[0]);
    expect(counts[2]).toEqual(counts[0]);
    // the seed draws the solution (Solution seed 0); a fixed solution seed is the same whatever the run's seed
    expect(pfEngine({}, 11).getPerfectFitView().plan.seed).toBe(pfEngine({}, 11).getPerfectFitView().plan.seed);
    expect(pfEngine({ seed: 5 }, 1).getPerfectFitView().plan.seed).toBe(5);
    expect(pfEngine({ seed: 5 }, 2).getPerfectFitView().plan.seed).toBe(5);
  });

  it("emits the ladder, the thumps, the chord and the crack, the chip ladder and the hard cuts – every landing a bounce", () => {
    const pento = pfEngine({}, 4);
    const events = run(pento, Math.floor(8 * 60)); // (the first box's 12 pieces and its completion; the next box starts at 8.05 s)
    const kinds = (k: string) => events.filter((e) => e.loop === k);
    expect(kinds("step")).toHaveLength(12);
    expect(kinds("land")).toHaveLength(12);
    expect(kinds("chord")).toHaveLength(1);
    expect(kinds("impact")).toHaveLength(1);
    expect(kinds("step").map((e) => e.frequency)).toEqual(Array.from({ length: 12 }, (_, k) => pfLadderHz(k)));
    expect(kinds("step").filter((e) => e.accent)).toHaveLength(1);
    expect(events.every((e) => e.melody === false)).toBe(true);
    const tetris = pfEngine({ variant: "tetris", pieceSec: 0.3 }, 4);
    const tEvents = run(tetris, Math.ceil(tetris.getPerfectFitView().plan.loopSec * 60));
    expect(tEvents.filter((e) => e.loop === "step" && e.loopChip)).toHaveLength(70);
    expect(tEvents.filter((e) => e.loop === "cut")).toHaveLength(4);
    expect(tEvents.filter((e) => e.loop === "chord")).toHaveLength(5);
    expect(loopPlayOptions({ type: "hit", wallIndex: 0, loop: "step", loopChip: true })).toMatchObject({ chip: true });
    expect(loopPlayOptions({ type: "hit", wallIndex: 0, loop: "step" }).chip).toBeUndefined();
  });

  it("schedules its sounds on a ToneGenerator at the context's time (fakeAudio): the sine ladder, the chip ladder, the thump", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const playLoop = vi.spyOn(tone, "playLoop");
    const engine = pfEngine({}, 3);
    let sent = 0;
    for (let k = 0; k < 300; k++) {
      engine.update(STEP, 0);
      graph.ctx.currentTime = engine.getElapsedMs() / 1000;
      for (const ev of engine.consumeSoundEvents()) {
        playSoundEvent(tone, ev, () => undefined);
        sent++;
      }
    }
    expect(playLoop).toHaveBeenCalledTimes(sent);
    expect(sent).toBe(engine.getPerfectFitView().sounds);
    // the ladder's sines (C5 up the pentatonic) and the thump's sweep
    expect(graph.oscillators.some((o) => o.type === "sine" && Math.abs(o.frequency - pfLadderHz(0)) < 1e-6)).toBe(true);
    // the Tetris pieces on the chip voice (a square)
    const before = graph.oscillators.length;
    const tetris = pfEngine({ variant: "tetris", pieceSec: 0.3 }, 3);
    for (let k = 0; k < 120; k++) {
      tetris.update(STEP, 0);
      graph.ctx.currentTime = 10 + tetris.getElapsedMs() / 1000;
      for (const ev of tetris.consumeSoundEvents()) playSoundEvent(tone, ev, () => undefined);
    }
    expect(graph.oscillators.slice(before).some((o) => o.type === "square")).toBe(true);
  });
});

describe("Perfect Fit: the finder", () => {
  it("offers its two outcomes and never searches a run length", () => {
    expect(availableOutcomes("perfectFit", { endless: true, neverEscape: false, ballCount: 1, pfPento: true })).toEqual(["most-on-floor", "landings-on-beat"]);
    expect(availableOutcomes("perfectFit", { endless: true, neverEscape: false, ballCount: 1, pfPento: false })).toEqual(["landings-on-beat"]);
  });

  it("finds the solution seed with the most pieces on the floor, and puts every landing on the beat", async () => {
    const request = { targetDurationSec: 30, toleranceSec: 1, maxSeeds: 12, maxSimTimeSec: 60, physicsConfig: config, mode: "perfectFit" as const, modeSettings: { ...base, perfectFit: {} } };
    const floor = await findSimulation({ ...request, outcome: { kind: "most-on-floor", clipSec: 30 } }, () => undefined);
    expect(floor.found).toBe(true);
    expect(floor.outcome).toBe("most-on-floor");
    expect(floor.seedsTested).toBe(12);
    const s = resolvePerfectFitSettings({});
    for (let seed = 1; seed <= 12; seed++) expect(perfectFitPlanOf(s, seed).floor).toBeLessThanOrEqual(floor.perfectFit!.floor);
    // the engine with that solution seed plays that plan
    expect(pfEngine({ seed: floor.perfectFit!.seed }, 99).getPerfectFitView().plan.floor).toBe(floor.perfectFit!.floor);
    expect(floor.duration).toBeCloseTo(floor.perfectFit!.loops * floor.perfectFit!.loopSec, 9);
    expect(PF_FINDER_TRIES).toBeGreaterThanOrEqual(12);
    const beat = findPerfectFitRun({ targetDurationSec: 30, maxSeeds: 1, modeSettings: { perfectFit: { bpm: 120 } } as ModeSettings, outcome: { kind: "landings-on-beat", clipSec: 30 } });
    expect(beat.found).toBe(true);
    expect(beat.perfectFit!.beatSec).toBeCloseTo(0.5, 9);
    expect((beat.perfectFit!.loopSec / 2) % 1).toBeCloseTo(0, 9);
  }, 20_000);
});

describe("Perfect Fit: the settings", () => {
  it("defaults to the three rectangles on the indigo page with the loop HUD, only in Perfect Fit", () => {
    expect(DEFAULT_PERFECT_FIT_FIELDS).toMatchObject({ pfVariant: "pento", pfBoxes: "10×6, 12×5, 15×4", pfPieceSec: 0.55, pfFall: 1, pfSeed: 0, pfSections: "4,4,4,4,12", pfWellW: 10, pfWellH: 16, pfHold: true, pfBeat: false });
    const s = defaultSettings("perfectFit");
    expect(s).toMatchObject({ ...DEFAULT_PERFECT_FIT_FIELDS, backgroundType: "gradient", backgroundColors: ["#1c1f4a", "#15173a"], loopHud: true });
    expect(defaultSettings("classic").loopHud).toBe(false);
    expect(defaultSettings("classic").pfVariant).toBe("pento");
  });

  it("round-trips through the link (pf… keys) and presets, keeps values past the sliders and parses the lists", () => {
    const s = { ...defaultSettings("perfectFit"), pfVariant: "tetris" as const, pfBoxes: "6x10 5×12", pfPieceSec: 0.03, pfFall: 25, pfSeed: 1234, pfSections: "4, 4 ,8", pfWellW: 300, pfWellH: 9000, pfHold: false, pfBeat: true };
    const params = settingsToSearchParams(s);
    expect([params.get("pfV"), params.get("pfBx"), params.get("pfS"), params.get("pfF"), params.get("pfSd"), params.get("pfSc"), params.get("pfW"), params.get("pfH"), params.get("pfHd"), params.get("pfB")]).toEqual(["tetris", "6x10 5×12", "0.03", "25", "1234", "4, 4 ,8", "300", "9000", "0", "1"]);
    const back = settingsFromSearchParams(params);
    // (a value below the slider's minimum is lifted onto it: 0.05 s)
    expect(back).toMatchObject({ pfVariant: "tetris", pfBoxes: "6x10 5×12", pfPieceSec: PF_RANGES.pfPieceSec.min, pfFall: 25, pfSeed: 1234, pfSections: "4, 4 ,8", pfWellW: 300, pfWellH: 9000, pfHold: false, pfBeat: true });
    expect(presetToSettings({ ...s, mode: "perfectFit" })).toMatchObject({ pfWellW: 300, pfFall: 25 });
    expect(resolvePerfectFitFields({ pfVariant: "hexomino", pfPieceSec: "x", pfHold: "yes" })).toMatchObject({ pfVariant: "pento", pfPieceSec: 0.55, pfHold: true });
    expect(parseBoxes("10×6, 12x5;15*4 7 × 0 600x1")).toEqual(BOXES);
    expect(parseSections("4,4, 4;4 12 x 0 -3")).toEqual([4, 4, 4, 4, 12]);
    // the engine runs the well at its memory-safety ceilings
    const engineSettings = resolvePerfectFitSettings(perfectFitSettingsOf({ ...back, bpm: 90 }));
    expect([engineSettings.wellW, engineSettings.wellH, engineSettings.bpm]).toEqual([300, MEMORY_CEILINGS.pfWellH, 90]);
    expect(resolvePerfectFitSettings({ wellW: 1e9 }).wellW).toBe(MEMORY_CEILINGS.pfWellW);
  });

  it("has four presets and a variant switch that carries the look and the seconds a piece", () => {
    expect(PF_PRESET_IDS).toEqual(["threeRects", "everyPiece", "speedRun", "bigWell"]);
    expect(perfectFitPresetPatch("everyPiece")).toMatchObject({ pfVariant: "tetris", pfSections: "4,4,4,4,12", pfWellW: 10, pfHold: true, backgroundColors: ["#0a0b14", "#0a0b14"] });
    expect(perfectFitPresetPatch("speedRun")).toMatchObject({ pfVariant: "pento", pfPieceSec: 0.15 });
    expect(perfectFitPresetPatch("bigWell")).toMatchObject({ pfVariant: "tetris", pfWellW: 20, pfWellH: 40 });
    const big = planPerfectFit({ ...input({ variant: "tetris" }), sections: parseSections(perfectFitPresetPatch("bigWell").pfSections), wellW: 20, wellH: 40, pieceSec: 0.3 });
    expect(big.lines).toBe(40);
    const s = defaultSettings("perfectFit");
    expect(perfectFitVariantPatch(s, "tetris")).toMatchObject({ pfVariant: "tetris", pfPieceSec: 0.3, backgroundType: "solid", backgroundColors: ["#0a0b14", "#0a0b14"] });
    expect(perfectFitVariantPatch({ ...s, pfPieceSec: 0.4, backgroundColors: ["#000000", "#000000"] }, "tetris")).toEqual({ pfVariant: "tetris" });
  });

  it("captions the clip in the account's words and keeps en, pl and es in step", () => {
    expect(loopCaptionContext({ ...defaultSettings("perfectFit") })).toMatchObject({ hookKey: "perfectFitPento", count: 12 });
    expect(loopCaptionContext({ ...defaultSettings("perfectFit"), pfVariant: "tetris" } as never)).toMatchObject({ hookKey: "perfectFitTetris", count: 70 });
    const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
    expect(keys(pl.PerfectFit)).toEqual(keys(en.PerfectFit));
    expect(keys(es.PerfectFit)).toEqual(keys(en.PerfectFit));
    for (const m of [en, pl, es]) expect(String(m.PerfectFit.numberWords).split("|")).toHaveLength(21);
    expect(en.PerfectFit.canvasTitlePento).toBe("all 12 pentominoes");
    expect(en.PerfectFit.canvasTitleTetris).toBe("every piece fits");
  });
});

describe("Perfect Fit: the renderer", () => {
  it("draws every phase without throwing and reports what it drew (data-pf-*)", () => {
    for (const patch of [{}, { variant: "tetris" as const, pieceSec: 0.3 }]) {
      const engine = pfEngine(patch, 2);
      const view = engine.getPerfectFitView();
      const layer = new PerfectFitLayer();
      const ctx = fakeCanvas(800, 600).getContext("2d") as unknown as CanvasRenderingContext2D;
      for (let t = 0; t < view.plan.loopSec; t += 0.2) {
        layer.drawStage(ctx, view, t, { dpr: 1, showGlow: true }, PERFECT_FIT_ENGLISH);
        layer.drawBodies(ctx, view, t, { dpr: 1, showGlow: true }, PERFECT_FIT_ENGLISH);
      }
      const data: Record<string, string> = {};
      writePerfectFitDataset(view, layer, (k, v) => (data[k] = v));
      expect(Object.keys(data).sort()).toEqual([...PERFECT_FIT_DATA_KEYS].sort());
      // the words under the box are one centred block (the watermark keeps clear of it), and they end above the bottom 9 % of
      // the square – where the live badge (from 94 %) and the video badge (from 92.3 %) sit in its bottom corners
      layer.drawStage(ctx, view, 1, { dpr: 1, showGlow: false }, PERFECT_FIT_ENGLISH);
      const f = view.frame;
      const r = layer.labelRect;
      expect(r.w).toBeGreaterThan(0);
      expect(r.w).toBeLessThan(0.9 * f.side);
      expect(r.x + r.w / 2).toBeCloseTo(f.cx, 6);
      expect(r.y).toBeGreaterThan(f.cy - f.side / 2 + 0.75 * f.side);
      expect(r.y + r.h).toBeLessThan(f.cy - f.side / 2 + 0.92 * f.side);
    }
    // the words: the box as rows × columns with its classic count, the banners in words
    expect(PERFECT_FIT_ENGLISH.box(6, 10)).toBe("6 × 10");
    expect(PERFECT_FIT_ENGLISH.ways(2339)).toBe("one of 2,339 ways");
    expect(PERFECT_FIT_ENGLISH.banner(4)).toBe("four lines");
    expect(PERFECT_FIT_ENGLISH.banner(12)).toBe("twelve lines");
    expect(PERFECT_FIT_ENGLISH.lines(28)).toBe("28 lines cleared");
  });
});
