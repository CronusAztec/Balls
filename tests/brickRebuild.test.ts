import { describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas, fakeDocument } from "./fakeCanvas";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import {
  BR_BALL_CEILING,
  BR_CELL_CEILING,
  BR_IMAGE_CEILING,
  BR_PLUCK_SPAN,
  DEFAULT_BRICK_REBUILD,
  applyImage,
  brickDegree,
  brickDropBeat,
  brickField,
  brickGridSize,
  brickMask,
  brickPluckFrequency,
  cellAt,
  expectedBalls,
  rebuildLandMs,
  rebuildOrder,
  spawnDue,
  sweepBody,
  symmetryImages,
  type BrickRebuildSettings,
} from "@/lib/physics/brickRebuild";
import { BR_MAX_COLOURS, emblemPicture, layerRanks, mandalaPicture, quantisePixels, textPicture } from "@/lib/physics/brickPicture";
import { BR_NOTES_PER_TICK, resolveBrickRebuildSettings, type BrickRebuildView } from "@/lib/physics/modes/brickRebuild";
import {
  BRICK_REBUILD_LOOK,
  BRICK_REBUILD_RANGES,
  BR_PRESET_IDS,
  DEFAULT_BRICK_REBUILD_FIELDS,
  brickRebuildBallsShown,
  brickRebuildHudKeys,
  brickRebuildHudValues,
  brickRebuildModeDefaults,
  brickRebuildPresetFields,
  brickRebuildSettingsOf,
  readBrickRebuildParams,
  resolveBrickRebuildFields,
  writeBrickRebuildParams,
} from "@/lib/physics/brickRebuildSettings";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import { brickRebuildMatches, brickRebuildMiss, findBrickRebuildRun, type BrickRebuildRun } from "@/lib/simulation/brickRebuildFinder";
import { loopHudCount } from "@/lib/loop/hud";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { MODE_CATEGORIES } from "@/lib/modes";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { BrickRebuildLayer, writeBrickRebuildDataset } from "@/components/simulator/brickRebuildRenderer";
import { brickCoverRect } from "@/components/simulator/brickUpload";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- brick-rebuild --- Brick Smash (lib/physics/modes/brickRebuild.ts): the quantiser, the swept collision, the spawn rule, the
 * counter down to 0 and back up, the seam back to the first frame and the exact replay of every cycle, the rebuild's layer order,
 * the kaleidoscope's symmetric breaks, the gold capsules' splits, the settings and their URL keys, the presets, the sounds, the
 * HUD, the finder's outcomes, the renderer's cached layer and the fingerprints at 30, 60 and 120 fps.
 */

// Whole runs of the engine (a smash is ~20 s of simulation): generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 120_000 });

const config: PhysicsConfig = { width: 450, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const STEP = 1000 / 60;

function engineOf(patch: Partial<BrickRebuildSettings> = {}, seed = 1, cfg: PhysicsConfig = config) {
  const engine = new PhysicsEngine(cfg);
  engine.setBrickRebuildSettings(patch);
  engine.setSeed(seed);
  engine.initMode("brickRebuild");
  return engine;
}

/** Steps `engine` until `done` (or `maxSec` of simulation); returns the sound events heard on the way. */
function runUntil(engine: PhysicsEngine, done: (v: BrickRebuildView) => boolean, maxSec = 120, onStep?: (v: BrickRebuildView) => void): SoundEvent[] {
  const v = engine.getBrickRebuildView();
  const events: SoundEvent[] = [];
  for (let i = 0; i < maxSec * 60 && !done(v); i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
    onStep?.(v);
  }
  return events;
}

/** The run's state as numbers: every ball's place and velocity, every brick's hits. */
function snapshot(engine: PhysicsEngine): number[] {
  const out: number[] = [];
  for (const b of engine.getBalls()) out.push(b.x, b.y, b.vx, b.vy);
  out.push(...engine.getBrickRebuildView().hp);
  return out;
}

describe("Brick Smash: the picture", () => {
  it("the quantiser reproduces a 2-colour picture exactly (and caps a richer one at 8 colours, the same every time)", () => {
    const cols = 12;
    const rows = 7;
    const rgba = new Uint8ClampedArray(4 * cols * rows);
    const want: number[] = [];
    for (let p = 0; p < cols * rows; p++) {
      const red = (p % 3 === 0) !== (p % 5 === 0);
      want.push(red ? 0 : 1);
      rgba.set(red ? [220, 30, 40, 255] : [10, 20, 90, 255], 4 * p);
    }
    const pic = quantisePixels(rgba, cols, rows);
    expect(pic.palette).toHaveLength(2);
    const red = pic.palette.indexOf("#dc1e28");
    const navy = pic.palette.indexOf("#0a145a");
    expect([red, navy].sort()).toEqual([0, 1]);
    for (let p = 0; p < cols * rows; p++) expect(pic.colours[p]).toBe(want[p] === 0 ? red : navy);
    // a rainbow of 64 colours: at most 8, deterministic
    const rich = new Uint8ClampedArray(4 * 64);
    for (let p = 0; p < 64; p++) rich.set([(p * 37) % 256, (p * 91) % 256, (p * 13) % 256, 255], 4 * p);
    const a = quantisePixels(rich, 8, 8);
    const b = quantisePixels(rich, 8, 8);
    expect(a.palette.length).toBeLessThanOrEqual(BR_MAX_COLOURS);
    expect([...a.colours]).toEqual([...b.colours]);
    expect(a.palette).toEqual(b.palette);
  });

  it("builds the emblem (navy field, teal ring, amber square), the mandala with the run's symmetry and text in pixels", () => {
    const e = emblemPicture(30, 30);
    expect(e.palette).toEqual(["#1b2350", "#2fb7b4", "#f4c55c"]);
    expect(e.colours[0]).toBe(0);
    expect(e.colours[15 * 30 + 15]).toBe(2);
    expect([...e.colours].filter((c) => c === 1).length).toBeGreaterThan(50);
    const ranks = layerRanks(e.colours, 3);
    expect([...ranks]).toEqual([0, 1, 2]); // the field, then the ring, then the accent
    const m = mandalaPicture(30, 8, true, 0.22);
    for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) expect(m.colours[j * 30 + i]).toBe(m.colours[i * 30 + j]); // a mirror axis
    const t = textPicture("HI", 30, 30);
    expect([...t.colours].some((c) => c === 2)).toBe(true);
  });

  it("cover-fits an upload into the wall's proportions (the overflow cropped evenly)", () => {
    const r = brickCoverRect(200, 100, 30, 30, 300, 300);
    expect(r.h).toBeCloseTo(30, 9);
    expect(r.w).toBeCloseTo(60, 9);
    expect(r.x).toBeCloseTo(-15, 9);
  });
});

describe("Brick Smash: the swept collision", () => {
  it("never tunnels: a 1 px ball at 5,000 px/s bounces off a one-brick-thin wall from any angle", () => {
    const f = brickField(450, 800, { cols: 30, rows: 30, wallPct: 78, symmetry: 1, hole: 0 });
    const hp = new Int32Array(f.cols * f.rows);
    const row = 20;
    for (let i = 0; i < f.cols; i++) hp[row * f.cols + i] = 1;
    const wallTop = f.gy + row * f.ch;
    const wallBottom = wallTop + f.ch;
    for (let k = 0; k < 400; k++) {
      const angle = -Math.PI / 2 + ((k / 400) * 2 - 1) * 1.4;
      const b = { x: f.x0 + 5 + ((f.x1 - f.x0 - 10) * k) / 400, y: f.y1 - 3, vx: 5000 * f.scale * Math.cos(angle), vy: 5000 * f.scale * Math.sin(angle), r: 1 * f.scale };
      let hits = 0;
      for (let s = 0; s < 240; s++) {
        sweepBody(f, hp, b, 1 / 240, () => hits++, () => undefined);
        expect(b.y, `ball ${k} step ${s}`).toBeGreaterThan(wallBottom - 1e-6);
      }
      expect(hits).toBeGreaterThan(0);
    }
    expect(wallTop).toBeLessThan(wallBottom);
  });

  it("no ball's centre ever sits inside a standing brick in an engine run at 5,000 px/s with 1 px balls", () => {
    const engine = engineOf({ speed: 5000, size: 1 }, 3);
    const v = engine.getBrickRebuildView();
    let worst = 0;
    runUntil(engine, (view) => view.phase !== "smash", 30, () => {
      for (const b of engine.getBalls()) {
        const cell = cellAt(v.field, b.x, b.y);
        if (cell >= 0 && v.mask[cell] && v.hp[cell] > 0) worst++;
      }
    });
    expect(worst).toBe(0);
    expect(v.escaped).toBe(0);
    expect(v.nonFinite).toBe(0);
    expect(v.firstEnd).toBe("cleared");
  });
});

describe("Brick Smash: the smash, the rebuild and the loop", () => {
  it("spawns a ball every `every` breaks: the balls at the clear are the start balls + ⌊broken / every⌋, at most the ceiling", () => {
    // (without spawns five balls take minutes to clear 900 bricks: a 12 × 8 wall)
    for (const [every, balls, cols, rows] of [[4, 3, 30, 30], [7, 2, 30, 30], [0, 5, 12, 8]] as const) {
      const engine = engineOf({ every, balls, cols, rows, speed: 900 }, 2);
      const v = engine.getBrickRebuildView();
      runUntil(engine, (view) => view.phase !== "smash", 90);
      expect(v.firstEnd).toBe("cleared");
      expect(v.broken).toBe(v.total);
      expect(v.firstBalls).toBe(expectedBalls(balls, v.realBroken, every));
      expect(v.spawned).toBe(every > 0 ? Math.floor(v.total / every) : 0);
    }
    expect(spawnDue(8, 4)).toBe(true);
    expect(spawnDue(7, 4)).toBe(false);
    expect(spawnDue(4, 0)).toBe(false);
    expect(expectedBalls(3, 1e9, 1)).toBe(BR_BALL_CEILING);
  });

  it("counts down to 0, rebuilds to W·H, and the seam puts the run back at its first frame – every cycle replays the first", () => {
    const engine = engineOf({}, 1);
    const v = engine.getBrickRebuildView();
    expect(v.bricks).toBe(900);
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    const first = snapshot(engine);
    let min = Infinity;
    runUntil(engine, (view) => view.phase === "rebuild", 90, (view) => (min = Math.min(min, view.bricks)));
    expect(min).toBe(0);
    expect(v.clearedMs).toBeGreaterThan(0);
    runUntil(engine, (view) => view.seams >= 1, 30, (view) => {
      if (view.phase === "rebuild") expect(view.bricks).toBeLessThanOrEqual(900);
    });
    // the seam's step: the run's first step again, bit for bit
    expect(snapshot(engine)).toEqual(first);
    const cycle1 = v.cycleSec;
    expect(cycle1).toBeCloseTo(v.firstClearSec + DEFAULT_BRICK_REBUILD.settle + DEFAULT_BRICK_REBUILD.rebuild, 1);
    expect(engine.getLoopSeams()).toMatchObject({ count: 1 });
    runUntil(engine, (view) => view.seams >= 2, 60);
    expect(v.cycleSec).toBe(cycle1);
    expect(engine.getCycleSeconds()).toBe(cycle1);
  });

  it("reports W·H bricks the step before the seam, and the next seam once the smash is over", () => {
    const engine = engineOf({ speed: 900 }, 4);
    const v = engine.getBrickRebuildView();
    expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: -1 });
    expect(engine.getCycleSeconds()).toBeNull();
    runUntil(engine, (view) => view.phase !== "smash", 60);
    const next = engine.getLoopSeams()!.nextMs;
    expect(next).toBeGreaterThan(0);
    runUntil(engine, () => engine.getElapsedMs() >= next - 1, 30);
    expect(v.phase).toBe("rebuild");
    expect(v.bricks).toBe(900);
    expect(v.landed).toBe(v.orderCount);
    expect(v.startAlpha).toBe(1);
    expect(v.ballAlpha).toBe(0);
    engine.update(STEP, 0);
    const seams = engine.getLoopSeams()!;
    expect(seams.count).toBe(1);
    expect(seams.lastMs).toBeCloseTo(next, 6);
    expect(Number.isInteger(Math.round(v.cycleSec * 60 * 1e6) / 1e6)).toBe(true); // a whole number of steps
  });

  it("rebuilds in colour layers (the field, the ring, the accent), each from the middle out, landing evenly over the rebuild", () => {
    const engine = engineOf({ speed: 900 }, 5);
    const v = engine.getBrickRebuildView();
    runUntil(engine, (view) => view.phase === "rebuild", 60);
    expect(v.orderCount).toBe(900);
    let last = -1;
    for (let k = 0; k < v.orderCount; k++) {
      const rank = v.layerRank[v.picture.colours[v.order[k]]];
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
    expect(v.landMs[v.orderCount - 1]).toBeCloseTo(v.rebuildMs, 6);
    expect(rebuildLandMs(0, 10, 4)).toBeCloseTo(700, 9);
    expect(rebuildLandMs(9, 10, 4)).toBeCloseTo(4000, 9);
    const rows = rebuildOrder([0, 31, 899, 450], { cols: 30, rows: 30 }, "rows", new Uint8Array(900), new Int32Array(1), new Int32Array(900));
    expect([...rows]).toEqual([899, 450, 31, 0]);
  });

  it("the kaleidoscope breaks its mosaic symmetrically: every brick and its eight images stand or fall together", () => {
    const engine = engineOf({ symmetry: 8, symmetryMode: "mirror", balls: 2, every: 0, speed: 900, hole: 28 }, 1);
    const v = engine.getBrickRebuildView();
    expect(v.images).toBe(8);
    expect(v.field.layout).toBe("mandala");
    const f = v.field;
    const p = { x: 0, y: 0 };
    let checks = 0;
    runUntil(engine, (view) => view.broken > view.total / 2, 60);
    for (let cell = 0; cell < v.hp.length; cell++) {
      if (!v.mask[cell]) continue;
      const cx = f.gx + ((cell % f.cols) + 0.5) * f.cw - f.cx;
      const cy = f.gy + (Math.floor(cell / f.cols) + 0.5) * f.ch - f.cy;
      for (let i = 1; i < 8; i++) {
        applyImage(cx, cy, i, 8, "mirror", p);
        const other = cellAt(f, f.cx + p.x, f.cy + p.y);
        expect(v.hp[other] > 0, `cell ${cell} image ${i}`).toBe(v.hp[cell] > 0);
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(1000);
    expect(engine.getBalls()).toHaveLength(2);
    expect(symmetryImages(3, "mirror")).toBe(6);
    expect(symmetryImages(3, "rotate")).toBe(3);
    expect(symmetryImages(1e9, "rotate")).toBe(BR_IMAGE_CEILING);
  });

  it("gold capsules: the paddle's catches split every ball into `split`, never past the ball ceiling", () => {
    const engine = engineOf({ capsules: true, capsuleChance: 0.3, every: 0, split: 3, speed: 900 }, 2);
    const v = engine.getBrickRebuildView();
    expect(v.paddleOn).toBe(true);
    let most = 0;
    runUntil(engine, (view) => view.phase !== "smash", 60, (view) => (most = Math.max(most, view.balls)));
    expect(v.caught).toBeGreaterThan(0);
    expect(v.splits).toBe(v.caught);
    expect(most).toBeGreaterThan(3 * 3);
    expect(most).toBeLessThanOrEqual(BR_BALL_CEILING);
  });

  it("is deterministic at 30, 60 and 120 fps (fixed steps: the frame rate never matters)", () => {
    const at = (fps: number) => {
      const engine = engineOf({}, 7);
      for (let i = 0; i < fps * 6; i++) engine.update(1000 / fps, 0);
      return snapshot(engine);
    };
    const sixty = at(60);
    expect(at(30)).toEqual(sixty);
    expect(at(120)).toEqual(sixty);
  });

  it("keeps a grid within the memory-safety ceiling and lays the box out at the reference proportions", () => {
    expect(brickGridSize(1e6, 1e6)).toEqual({ cols: 200, rows: 200 });
    const g = brickGridSize(1000, 10);
    expect(g.cols * g.rows).toBeLessThanOrEqual(BR_CELL_CEILING);
    expect(MEMORY_CEILINGS.brCols).toBe(BR_CELL_CEILING);
    expect(MEMORY_CEILINGS.brRows).toBe(BR_CELL_CEILING);
    expect(MEMORY_CEILINGS.brBalls).toBe(BR_BALL_CEILING);
    expect(MEMORY_CEILINGS.brSymmetry).toBe(BR_IMAGE_CEILING);
    const portrait = brickField(450, 800, DEFAULT_BRICK_REBUILD);
    expect((portrait.x1 - portrait.x0) / (portrait.y1 - portrait.y0)).toBeCloseTo(645 / 817, 9);
    expect(portrait.x1 - portrait.x0).toBeCloseTo(0.9 * 450, 6);
    expect(brickMask(portrait).every((m) => m === 1)).toBe(true);
    const engine = engineOf({ cols: 1e6, rows: 1e6, balls: 1e6 }, 1);
    expect(engine.getBrickRebuildView().total).toBe(40_000);
    expect(engine.getBalls().length).toBe(BR_BALL_CEILING);
  });
});

describe("Brick Smash: the sound", () => {
  it("plucks the breaks by row (at most six a tick), drops the groove on a bar line, washes the rebuild, dings and cuts at the seam", () => {
    const engine = engineOf({}, 1);
    const v = engine.getBrickRebuildView();
    const perStep: number[] = [];
    const events: SoundEvent[] = [];
    for (let i = 0; i < 60 * 60 && v.seams < 1; i++) {
      engine.update(STEP, 0);
      const evs = engine.consumeSoundEvents();
      perStep.push(evs.filter((e) => e.loop === "pluck").length);
      events.push(...evs);
    }
    expect(v.seams).toBe(1);
    expect(Math.max(...perStep)).toBeLessThanOrEqual(BR_NOTES_PER_TICK);
    const plucks = events.filter((e) => e.loop === "pluck");
    expect(plucks.length).toBeGreaterThan(100);
    const pitches = new Set(plucks.map((e) => e.frequency));
    for (const f of pitches) expect([...Array(BR_PLUCK_SPAN + 1).keys()].map(brickPluckFrequency)).toContain(f);
    expect(brickDegree(0, 30)).toBe(BR_PLUCK_SPAN);
    expect(brickDegree(29, 30)).toBe(0);
    const kinds = events.map((e) => e.loop);
    expect(kinds.filter((k) => k === "impact").length).toBe(2); // the drop and the last brick
    expect(kinds).toContain("bed");
    expect(kinds.filter((k) => k === "kick").length).toBe(v.kicks);
    expect(v.kicks).toBeGreaterThan(10);
    const at = (kind: string) => kinds.indexOf(kind as never);
    expect(at("wash")).toBeGreaterThan(at("kick"));
    expect(at("ding")).toBeGreaterThan(at("wash"));
    expect(at("glide")).toBeGreaterThan(at("wash"));
    expect(kinds.lastIndexOf("cut" as never)).toBeGreaterThan(at("ding"));
    expect(kinds).toContain("bedStop");
    // the drop: the first bar line at or after 4 s at 120 BPM – beat 8
    expect(brickDropBeat(4, 120)).toBe(8);
    expect(brickDropBeat(4.1, 120)).toBe(12);
    expect(brickDropBeat(0, 120)).toBe(0);
  });

  it("plays its events through the loop library (playLoop): the plucks, the wash and the ding", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    try {
      const tone = new ToneGenerator();
      await tone.start();
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
      graph.ctx.currentTime = 1;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "pluck", frequency: brickPluckFrequency(5), level: 1, loopBright: true, melody: false }, () => undefined);
      expect(graph.oscillators.filter((o) => o.startAt === 1).map((o) => o.frequency)).toEqual(expect.arrayContaining([brickPluckFrequency(5), 2 * brickPluckFrequency(5)]));
      graph.ctx.currentTime = 2;
      const before = graph.sources.length + graph.ramps.length;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "wash", loopSec: 4, level: 0.8, melody: false }, () => undefined);
      expect(graph.sources.length + graph.ramps.length).toBeGreaterThan(before);
      graph.ctx.currentTime = 3;
      const oscs = graph.oscillators.length;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "ding", level: 0.8, melody: false }, () => undefined);
      expect(graph.oscillators.length).toBeGreaterThan(oscs);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Brick Smash: settings, presets and the page", () => {
  it("defaults to the reference (30 × 30, 78 %, 3 balls, a spawn every 4, 450 px/s, 5 px, 1 hit, 1 s drop, 4 s rebuild) and the cream look", () => {
    expect(DEFAULT_BRICK_REBUILD_FIELDS).toMatchObject({ brCols: 30, brRows: 30, brWall: 78, brBalls: 3, brEvery: 4, brSpeed: 450, brSize: 5, brHp: 1, brSettle: 1, brRebuild: 4, brOrder: "layers", brPicture: "emblem", brSymmetry: 1, brCapsules: false });
    const s = defaultSettings("brickRebuild");
    expect(s.backgroundColors).toEqual(["#ecebe3", "#ecebe3"]);
    expect(s.loopHud).toBe(true);
    expect(brickRebuildModeDefaults("classic")).toEqual({});
    expect(defaultSettings("classic").backgroundColors).not.toEqual(BRICK_REBUILD_LOOK.backgroundColors);
    for (const key of Object.keys(BRICK_REBUILD_RANGES)) expect(key in s, key).toBe(true);
  });

  it("round-trips every field through a link (br… keys) and keeps typed values past the sliders", () => {
    const s = { ...defaultSettings("brickRebuild"), brCols: 64, brRows: 12, brWall: 60, brBalls: 7, brEvery: 2, brSpeed: 7000, brSize: 2.5, brHp: 3, brDuration: 90, brSettle: 0.5, brRebuild: 6, brOrder: "rows" as const, brPicture: "text" as const, brText: "HELLO 2026", brDrop: 2, brBed: false, brCapsules: true, brCapsuleChance: 0.25, brSplit: 4, brSymmetry: 6, brSymmetryMode: "rotate" as const, brHole: 30, brOutline: false };
    const params = settingsToSearchParams(s);
    for (const key of ["brC", "brR", "brW", "brB", "brE", "brV", "brS", "brH", "brT", "brSt", "brRb", "brO", "brP", "brTx", "brD", "brBd", "brCp", "brCc", "brSp", "brK", "brKm", "brHo", "brOl"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(DEFAULT_BRICK_REBUILD_FIELDS) as (keyof typeof DEFAULT_BRICK_REBUILD_FIELDS)[]) expect([key, back[key]]).toEqual([key, s[key]]);
    // invalid values fall back; a value below its minimum is lifted onto it
    const bad = settingsFromSearchParams(new URLSearchParams("mode=brickRebuild&brC=abc&brR=1&brO=sideways&brKm=x&brBd=maybe"));
    expect([bad.brCols, bad.brRows, bad.brOrder, bad.brSymmetryMode, bad.brBed]).toEqual([30, 2, "layers", "mirror", true]);
    const fields = { ...DEFAULT_BRICK_REBUILD_FIELDS };
    const p = new URLSearchParams();
    writeBrickRebuildParams({ ...fields, brText: "x".repeat(99) }, fields, p);
    readBrickRebuildParams(p, fields);
    expect(fields.brText).toHaveLength(40);
    expect(resolveBrickRebuildFields({ brSymmetry: 2.6 }).brSymmetry).toBe(3);
  });

  it("hands the engine the page's fields with the tempo, the counts at their ceilings", () => {
    const s = { ...defaultSettings("brickRebuild"), bpm: 100, brCols: 1e9, brSymmetry: 1e9 };
    const r = brickRebuildSettingsOf(s);
    expect(r.bpm).toBe(100);
    expect(r.cols).toBe(MEMORY_CEILINGS.brCols);
    expect(r.symmetry).toBe(MEMORY_CEILINGS.brSymmetry);
    expect(resolveBrickRebuildSettings({ hp: Number.NaN, order: "nope" as never }).hp).toBe(1);
  });

  it("has six presets, each a valid set of fields (the reference pace, an avalanche, a big picture, classic, capsules, kaleidoscope)", () => {
    expect(BR_PRESET_IDS).toHaveLength(6);
    for (const id of BR_PRESET_IDS) {
      const f = brickRebuildPresetFields(id);
      expect(resolveBrickRebuildFields(f)).toEqual(f);
      const merged = presetToSettings({ mode: "brickRebuild", ...f });
      expect(merged.brCols).toBe(f.brCols);
    }
    expect(brickRebuildPresetFields("emblem")).toMatchObject({ brCols: 30, brRows: 30, brBalls: 3, brEvery: 4 });
    expect(brickRebuildPresetFields("avalanche").brEvery).toBe(1);
    expect(brickRebuildPresetFields("bigPicture")).toMatchObject({ brCols: 100, brRows: 100, brPicture: "upload" });
    expect(brickRebuildPresetFields("classic")).toMatchObject({ brBalls: 1, brEvery: 0 });
    expect(brickRebuildPresetFields("capsules")).toMatchObject({ brCapsules: true, brSplit: 3 });
    expect(brickRebuildPresetFields("kaleidoscope")).toMatchObject({ brSymmetry: 8, brBalls: 2 });
  });

  it("words the HUD by its variant (the counter 'N bricks') and counts the bricks standing", () => {
    expect(brickRebuildHudKeys(DEFAULT_BRICK_REBUILD_FIELDS).title).toBe("BrickRebuild.canvasTitle");
    expect(brickRebuildHudKeys({ ...DEFAULT_BRICK_REBUILD_FIELDS, brCapsules: true }).title).toBe("BrickRebuild.canvasTitleCapsules");
    expect(brickRebuildHudKeys({ ...DEFAULT_BRICK_REBUILD_FIELDS, brSymmetry: 8 }).title).toBe("BrickRebuild.canvasTitleKaleidoscope");
    expect(brickRebuildHudValues({ ...DEFAULT_BRICK_REBUILD_FIELDS, brSymmetry: 8, brBalls: 2 })).toEqual({ every: 4, real: 2, others: 14, split: 3 });
    expect(brickRebuildBallsShown({ brBalls: 2, brSymmetry: 8, brSymmetryMode: "mirror" })).toEqual({ real: 2, shown: 16 });
    expect(en.BrickRebuild.canvasTitle).toBe("smash the logo, then fix it");
    const engine = engineOf({}, 1);
    expect(loopHudCount(engine)).toBe(900);
    const ctx = loopCaptionContext({ ...defaultSettings("brickRebuild"), mode: "brickRebuild" });
    expect(ctx).toMatchObject({ hookKey: "brickRebuild", count: 900 });
    const kaleidoscope = { ...defaultSettings("brickRebuild"), brSymmetry: 8, brBalls: 2 };
    expect(loopCaptionContext(kaleidoscope)).toMatchObject({ hookKey: "brickRebuildKaleidoscope", count: 2 });
  });

  it("has every key in English, Polish and Spanish, the same keys in each", () => {
    const keys = (o: object, prefix = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const enKeys = keys(en.BrickRebuild).sort();
    expect(keys(pl.BrickRebuild).sort()).toEqual(enKeys);
    expect(keys(es.BrickRebuild).sort()).toEqual(enKeys);
    for (const cat of [en, pl, es]) {
      expect(cat.Modes.brickRebuild.name).toBeTruthy();
      expect(cat.Controls.modeBrickRebuild).toBeTruthy();
      expect(cat.Modes.brickRebuild.description.length).toBeLessThanOrEqual(cat === en ? 110 : 140);
      for (const k of ["outcomeBricksClearedBy", "outcomeLastBrickOnBar", "outcomeFinalBalls", "missNoClear"]) expect((cat.Rigged as Record<string, string>)[k], k).toBeTruthy();
    }
  });

  it("is an escape-family mode with a hero moment, and the mode's id is registered", () => {
    expect(MODE_IDS).toContain("brickRebuild");
    expect(MODE_CATEGORIES.brickRebuild).toBe("escape");
    expect(HERO_MOMENTS.brickRebuild.atSec).toBeGreaterThan(0);
  });
});

describe("Brick Smash: Find Simulation", () => {
  const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 4, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 8, multiplySpawnCount: 2, shatterSegmentsPerWall: 8, shatterHpPerSegment: 3, growRate: 0.05, portalCount: 2, twoBalls: false, drop: {}, box: {}, brickRebuild: { speed: 900 } };

  it("offers its three outcomes (never a run length: the run loops forever)", () => {
    expect(runNeverFinishes("brickRebuild", modeSettings)).toBe(true);
    expect(availableOutcomes("brickRebuild", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["bricks-cleared-by", "last-brick-on-bar", "final-balls"]);
  });

  it("judges a run: cleared by, on a bar line (±20 ms), at least N balls", () => {
    const run: BrickRebuildRun = { clearedMs: 12_010, balls: 228, cycleMs: 17_010 };
    expect(brickRebuildMatches({ kind: "bricks-cleared-by", atSec: 12.5 }, run)).toBe(true);
    expect(brickRebuildMatches({ kind: "bricks-cleared-by", atSec: 12 }, run)).toBe(false);
    expect(brickRebuildMiss({ kind: "bricks-cleared-by", atSec: 12 }, run)).toBeCloseTo(0.01, 9);
    expect(brickRebuildMatches({ kind: "last-brick-on-bar", atSec: 2 }, run)).toBe(true);
    expect(brickRebuildMatches({ kind: "last-brick-on-bar", atSec: 2 }, { ...run, clearedMs: 12_030 })).toBe(false);
    expect(brickRebuildMatches({ kind: "final-balls", count: 228 }, run)).toBe(true);
    expect(brickRebuildMatches({ kind: "final-balls", count: 229 }, run)).toBe(false);
    expect(brickRebuildMiss({ kind: "last-brick-on-bar", atSec: 2 }, { ...run, clearedMs: -1 })).toBe(Infinity);
  });

  it("searches seeds headlessly, a slice a frame, and the run found replays in the page's engine", async () => {
    let clock = 0;
    const now = () => (clock += 1);
    const schedule = (fn: () => void) => void Promise.resolve().then(fn);
    const physicsConfig = { ...config };
    const result = await findBrickRebuildRun({ maxSeeds: 3, outcome: { kind: "final-balls", clipSec: 30, count: 50 } }, 61, (seed) => createEngineForSettings(physicsConfig, "brickRebuild", modeSettings, seed), () => undefined, undefined, now, schedule, 11);
    expect(result.found).toBe(true);
    expect(result.outcome).toBe("final-balls");
    expect(result.brickRebuild!.balls).toBeGreaterThanOrEqual(50);
    expect(result.duration).toBeCloseTo(result.brickRebuild!.cycleSec, 9);
    // the page's run of that seed ends its smash the same way
    const engine = createEngineForSettings(physicsConfig, "brickRebuild", modeSettings, result.seed);
    runUntil(engine, (v) => v.firstEnd !== "", 70);
    expect(engine.getBrickRebuildView().firstBalls).toBe(result.brickRebuild!.balls);
    expect(engine.getBrickRebuildView().firstClearSec).toBeCloseTo(result.brickRebuild!.clearedSec, 9);
    // nothing can be cleared in a tenth of a second: the closest run comes back, not found
    const miss = await findBrickRebuildRun({ maxSeeds: 2, outcome: { kind: "bricks-cleared-by", clipSec: 30, atSec: 0.1 } }, 61, (seed) => createEngineForSettings(physicsConfig, "brickRebuild", modeSettings, seed), () => undefined, undefined, now, schedule, 11);
    expect(miss.found).toBe(false);
    expect(miss.seedsTested).toBe(2);
    expect(miss.brickRebuild!.clearedSec).toBeGreaterThan(1);
  });
});

describe("Brick Smash: the renderer", () => {
  it("caches the bricks: a frame repaints only the cells that changed, and mirrors the run in data-br-*", () => {
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    try {
      const engine = engineOf({ speed: 900 }, 1);
      const v = engine.getBrickRebuildView();
      const layer = new BrickRebuildLayer();
      const target = fakeCanvas(450, 800);
      const ctx = target.ctx as unknown as CanvasRenderingContext2D;
      const opts = { dpr: 1, hudOn: true };
      layer.drawStage(ctx, v, opts);
      expect(layer.repaints).toBe(1);
      expect(layer.redrawn).toBe(900);
      layer.drawStage(ctx, v, opts);
      expect(layer.redrawn).toBe(0);
      runUntil(engine, (view) => view.broken >= 5, 10);
      layer.drawStage(ctx, v, opts);
      expect(layer.redrawn).toBeGreaterThanOrEqual(5);
      expect(layer.redrawn).toBeLessThan(900);
      layer.drawBodies(ctx, v, engine.getBalls(), opts);
      expect(layer.ballsDrawn).toBe(engine.getBalls().length);
      const data: Record<string, string> = {};
      writeBrickRebuildDataset(v, layer, (k, val) => (data[k] = val));
      expect(data.brPhase).toBe("smash");
      expect(Number(data.brBricks)).toBe(v.bricks);
      expect(data.brPicture).toBe("emblem");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
