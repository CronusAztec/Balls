import { afterEach, describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_CATEGORIES, MODE_CARD_ORDER, modesInCategory } from "@/lib/modes";
import {
  COUNT_GATES_CLOSE_MS,
  DEFAULT_MULTIPLIERS_SETTINGS,
  GATE_KINDS,
  MULTIPLIERS_RANGES,
  OB_BLOCKER,
  OB_DOOR,
  boardPitch,
  countGatePitch,
  countTolerance,
  doorOpenAt,
  gateFactor,
  generateBoardLayout,
  multipliersSettingFields,
  multipliersSettingsOf,
  parseGateMix,
  placeBoard,
  resolveMultipliersSettings,
  sanitizeGateMix,
  type MultipliersSettings,
} from "@/lib/physics/modes/multipliers";
import { SpatialHash, createPairBuffer } from "@/lib/physics/spatialHash";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { countTarget, findSimulation, runNeverFinishes, simulateMultipliersSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

// Whole runs of the engine: generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 30_000 });

const config: PhysicsConfig = {
  width: 1244,
  height: 700,
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

function board(settings: Partial<MultipliersSettings>, seed: number, patch: Partial<PhysicsConfig> = {}) {
  const engine = new PhysicsEngine({ ...config, ...patch });
  engine.setMultipliersSettings(settings);
  engine.setSeed(seed);
  engine.initMode("multipliers");
  return engine;
}

/** Runs to the finish (or `maxSec`), consuming the sounds every frame; returns the sound events seen. */
function runOut(engine: PhysicsEngine, maxSec = 240, each?: (frame: number) => void) {
  const events = { hit: 0, multiplier: 0, gap: 0, maxPerFrame: 0 };
  for (let f = 0; f < maxSec * 60 && !engine.isSimulationFinished(); f++) {
    engine.update(1000 / 60, 0);
    const evs = engine.consumeSoundEvents();
    events.maxPerFrame = Math.max(events.maxPerFrame, evs.filter((e) => e.type === "hit").length);
    for (const e of evs) if (e.type === "hit" || e.type === "multiplier" || e.type === "gap") events[e.type]++;
    each?.(f);
  }
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe("the multipliers board: layout and maths", () => {
  it("is registered as a mode of the escape family", () => {
    expect(MODE_IDS).toContain("multipliers");
    expect(MODE_CARD_ORDER).toContain("multipliers");
    expect(MODE_CATEGORIES.multipliers).toBe("escape");
    expect(modesInCategory("escape").at(-1)).toBe("multipliers");
  });

  it("draws rows of 2–4 gates from the seed, weighted by the gate mix", () => {
    const random = (() => {
      let s = 7;
      return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    })();
    const layout = generateBoardLayout({ ...DEFAULT_MULTIPLIERS_SETTINGS, rows: 20, gateMix: "100001" }, random);
    expect(layout.rows).toHaveLength(20);
    for (const row of layout.rows) {
      expect(row.slots).toBeGreaterThanOrEqual(2);
      expect(row.slots).toBeLessThanOrEqual(4);
      expect(row.gates).toHaveLength(row.slots);
      for (const g of row.gates) expect(["count", "release"]).toContain(g.kind);
      if (row.blocker) {
        expect(row.slots).toBeGreaterThanOrEqual(3);
        expect(row.blocker.hp).toBeGreaterThanOrEqual(3);
        expect(row.blocker.hp).toBeLessThanOrEqual(8);
      }
    }
    const onlyCount = generateBoardLayout({ ...DEFAULT_MULTIPLIERS_SETTINGS, rows: 12, gateMix: "900000" }, random);
    expect(onlyCount.rows.every((r) => r.gates.every((g) => g.kind === "count"))).toBe(true);
    expect([2, 3, 5]).toContain(gateFactor("count", 0.1));
    expect(gateFactor("count", 0.9)).toBe(5);
    expect(gateFactor("speed", 0.9)).toBe(2);
    expect(gateFactor("size", 0.1)).toBe(1.25);
    expect(gateFactor("reverse", 0.4)).toBe(2);
  });

  it("lays the board out in the recorded square, growing downwards, with bands that hold every obstacle", () => {
    const layout = generateBoardLayout({ ...DEFAULT_MULTIPLIERS_SETTINGS, rows: 10 }, Math.random);
    const b = placeBoard(layout, 1244, 700);
    expect(b.side).toBe(700);
    expect(b.left).toBeCloseTo(622 - 0.45 * 700, 6);
    expect(b.right).toBeCloseTo(622 + 0.45 * 700, 6);
    expect(b.rowY).toHaveLength(10);
    for (let r = 1; r < 10; r++) expect(b.rowY[r] - b.rowY[r - 1]).toBeCloseTo(b.rowGap, 9);
    expect(b.homeY).toBeGreaterThan(b.rowY[9]);
    expect(b.floorY).toBeGreaterThan(b.homeY);
    expect(b.cameraMax).toBeGreaterThan(0);
    // Every gate spans its slot, the slots of a row tile the board.
    for (let r = 0; r < 10; r++) {
      const first = b.rowGate[r];
      const last = r + 1 < 10 ? b.rowGate[r + 1] : b.gates.length;
      expect(b.gates[first].x0).toBeCloseTo(b.left, 6);
      expect(b.gates[last - 1].x1).toBeCloseTo(b.right, 6);
    }
    // Every obstacle sits in at least one band, and doors / blockers point back at their gate / blocker.
    const seen = new Set<number>();
    for (let k = 0; k < b.bandItems.length; k++) seen.add(b.bandItems[k]);
    expect(seen.size).toBe(b.obstacles.length);
    for (let i = 0; i < b.obstacles.length; i++) {
      if (b.kind[i] === OB_DOOR) expect(b.gates[b.ref[i]].door).toBe(i);
      if (b.kind[i] === OB_BLOCKER) expect(b.blockers[b.ref[i]].obstacle).toBe(i);
    }
  });

  it("opens a release door on its own clock and pitches hits like a plinko piano", () => {
    const gate = { period: 2, openFor: 0.35, phase: 0 };
    expect(doorOpenAt(gate, 0)).toBe(true);
    expect(doorOpenAt(gate, 0.3)).toBe(true);
    expect(doorOpenAt(gate, 0.4)).toBe(false);
    expect(doorOpenAt(gate, 2.1)).toBe(true);
    expect(boardPitch(0)).toBeCloseTo(261.63, 1);
    expect(boardPitch(1)).toBeGreaterThan(boardPitch(0.5));
    expect(countGatePitch(5)).toBeGreaterThan(countGatePitch(3));
    expect(countTolerance(100)).toBe(5);
    expect(countTolerance(4)).toBe(1);
  });
});

describe("the multipliers board in the engine", () => {
  it("starts the balls at the top of a ring-less board and plays it to HOME: clones, gates, arrivals, the finish", () => {
    const engine = board({ rows: 8, startBalls: 2 }, 1);
    expect(engine.isMultipliersMode()).toBe(true);
    expect(engine.getCircularWalls()).toHaveLength(0);
    expect(engine.getObstacles()).toHaveLength(0);
    expect(engine.getBalls()).toHaveLength(2);
    const view = engine.getMultipliersView();
    let homeSeen = 0;
    const sounds = runOut(engine, 240, () => {
      expect(view.home).toBeGreaterThanOrEqual(homeSeen);
      homeSeen = view.home;
      // The board's finish is a multipliers celebration from the step it happens in (the page holds it on screen).
      expect(engine.endsWithMultiplierFinish()).toBe(engine.isSimulationFinished());
    });
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.endsWithMultiplierFinish()).toBe(true);
    expect(view.done).toBe(true);
    expect(view.active).toBe(0);
    expect(engine.getBalls()).toHaveLength(0);
    expect(view.gatePasses).toBeGreaterThan(0);
    expect(view.home + view.absorbed + view.lost).toBe(2 + view.clones);
    expect(view.home).toBeGreaterThan(0);
    // The notes stay within the per-frame budget; stat gates sounded their arpeggio.
    expect(sounds.hit).toBeGreaterThan(0);
    expect(sounds.maxPerFrame).toBeLessThanOrEqual(10);
    // The camera ends on HOME.
    expect(view.cameraY).toBeGreaterThan(0.8 * view.board!.cameraMax);
  });

  it("clones at count gates within the ball cap, and absorbs every second ball at a ÷2 gate", () => {
    const capped = board({ rows: 12, startBalls: 10, maxBalls: 50, gateMix: "900000" }, 3);
    let most = 0;
    runOut(capped, 240, () => {
      most = Math.max(most, capped.getBalls().length);
    });
    const v = capped.getMultipliersView();
    expect(most).toBeLessThanOrEqual(50);
    expect(v.clones).toBeGreaterThan(40);
    expect(v.home + v.absorbed + v.lost).toBe(10 + v.clones);
    const reverse = board({ rows: 4, startBalls: 10, gateMix: "000010" }, 3);
    runOut(reverse);
    const r = reverse.getMultipliersView();
    expect(r.clones).toBe(0);
    expect(r.absorbed).toBeGreaterThan(0);
    expect(r.home + r.absorbed + r.lost).toBe(10);
  });

  it("stacks speed, size and damage multipliers at their gates (uncapped), and wears blockers down", () => {
    const engine = board({ rows: 12, startBalls: 4, gateMix: "011100" }, 5);
    let maxSpeed = 1;
    let maxSize = 1;
    let maxDamage = 1;
    runOut(engine, 240, () => {
      for (const b of engine.getBalls()) {
        if (!b.mult) continue;
        maxSpeed = Math.max(maxSpeed, b.mult.speed);
        maxSize = Math.max(maxSize, b.mult.size);
        maxDamage = Math.max(maxDamage, b.mult.damage);
      }
    });
    expect(maxSpeed).toBeGreaterThan(1.5);
    expect(maxDamage).toBeGreaterThanOrEqual(2);
    expect(maxSize * maxSpeed * maxDamage).toBeGreaterThan(8);
    const summary = engine.getMultiplierView();
    expect(summary.active).toBe(true);
    // With a cap the stats stop there.
    const capped = board({ rows: 12, startBalls: 4, gateMix: "011100" }, 5, { mpUnlimited: false, mpCap: 2 });
    runOut(capped, 240, () => {
      for (const b of capped.getBalls()) if (b.mult) expect(Math.max(b.mult.speed, b.mult.size, b.mult.damage)).toBeLessThanOrEqual(2);
    });
  });

  it("finds every pair of touching balls with the spatial hash, like a brute-force check", () => {
    const engine = board({ rows: 6, startBalls: 10, gateMix: "900001", maxBalls: 400 }, 8);
    for (let f = 0; f < 60 * 6; f++) engine.update(1000 / 60, 0);
    const balls = engine.getBalls();
    expect(balls.length).toBeGreaterThan(30);
    const n = balls.length;
    const xs = Float64Array.from(balls, (b) => b.x);
    const ys = Float64Array.from(balls, (b) => b.y);
    const rs = Float64Array.from(balls, (b) => b.radius);
    const maxR = Math.max(...rs);
    const hash = new SpatialHash();
    hash.build(xs, ys, n, 2 * maxR + 2, Math.min(...xs) - maxR, Math.min(...ys) - maxR, Math.max(...xs) + maxR, Math.max(...ys) + maxR);
    const out = createPairBuffer();
    const count = hash.collectContacts(xs, ys, rs, 2, out);
    const found = new Set<string>();
    for (let p = 0; p < count; p++) {
      const i = out.pairs[2 * p];
      const j = out.pairs[2 * p + 1];
      found.add(i < j ? `${i}-${j}` : `${j}-${i}`);
    }
    let brute = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) < rs[i] + rs[j] + 2) {
          brute++;
          expect(found.has(`${i}-${j}`)).toBe(true);
        }
      }
    expect(count).toBe(brute);
    // The solver keeps the piles apart: no two balls overlap by more than a few pixels.
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(xs[i] - xs[j], ys[i] - ys[j])).toBeGreaterThan(rs[i] + rs[j] - 4);
  });

  it("keeps every ball inside the side walls and finite, and a ball grown wider than the board outgrows it", () => {
    const engine = board({ rows: 8, startBalls: 3 }, 12);
    const b0 = engine.getMultipliersView().board!;
    let bad = 0;
    runOut(engine, 60, () => {
      for (const b of engine.getBalls()) if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && b.x - b.radius > b0.left - 1 && b.x + b.radius < b0.right + 1)) bad++;
    });
    expect(bad).toBe(0);
    const big = board({ rows: 8, startBalls: 1, gateMix: "001000" }, 4);
    const ball = big.getBalls()[0];
    big.applyBallMultiplier(ball, "size", 50); // 400 px: wider than the 630 px board
    runOut(big, 60);
    expect(big.getMultiplierView().outgrown).toBe(true);
    expect(big.isSimulationFinished()).toBe(true);
  }, 30_000);

  it("is deterministic for a seed and differs between seeds", () => {
    const run = (seed: number) => {
      const engine = board({ rows: 8, startBalls: 3 }, seed);
      const path: number[] = [];
      runOut(engine, 240, (f) => {
        if (f % 60 === 0) for (const b of engine.getBalls().slice(0, 5)) path.push(Math.round(b.x * 100), Math.round(b.y * 100));
      });
      const v = engine.getMultipliersView();
      return { path, home: v.home, clones: v.clones, time: engine.getElapsedMs() };
    };
    expect(run(31)).toEqual(run(31));
    expect(run(31)).not.toEqual(run(32));
  });

  it("keeps its board and its balls on a canvas resize", () => {
    const engine = board({ rows: 6, startBalls: 4 }, 9);
    for (let f = 0; f < 90; f++) engine.update(1000 / 60, 0);
    const before = engine.getMultipliersView().board!;
    const rel = engine.getBalls().map((b) => [(b.x - before.originX) / before.side, (b.y - before.originY) / before.side]);
    engine.setConfig({ width: 800, height: 600 });
    const after = engine.getMultipliersView().board!;
    expect(after.side).toBe(600);
    expect(after.gates.map((g) => g.kind)).toEqual(before.gates.map((g) => g.kind));
    engine.getBalls().forEach((b, i) => {
      expect((b.x - after.originX) / after.side).toBeCloseTo(rel[i][0], 6);
      expect((b.y - after.originY) / after.side).toBeCloseTo(rel[i][1], 6);
    });
  });

  it("rigs the finder by count: a seed whose final count is within 5 % of the target", async () => {
    const request: FinderRequest = {
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 3,
      maxSimTimeSec: 60,
      physicsConfig: config,
      mode: "multipliers",
      modeSettings: { ...modeSettings, multipliers: { rows: 6, startBalls: 2 } },
    };
    expect(runNeverFinishes("multipliers", request.modeSettings)).toBe(false);
    expect(countTarget(request)).toBe(0);
    vi.spyOn(Date, "now").mockReturnValue(123456);
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    // The first seed the finder tries: its count is the target, so the search stops at once.
    const firstSeed = (123456 | 0) + 0;
    const { count } = simulateMultipliersSeed(firstSeed, request, 240_000);
    expect(count).toBeGreaterThan(0);
    const rigged = { ...request, modeSettings: { ...request.modeSettings, multipliers: { rows: 6, startBalls: 2, target: count } } };
    expect(countTarget(rigged)).toBe(count);
    const result = await findSimulation(rigged, () => undefined);
    expect(result.found).toBe(true);
    expect(result.seed).toBe(firstSeed);
    expect(result.count).toBe(count);
    // The found seed replays to that count in the page's engine.
    const engine = board({ rows: 6, startBalls: 2 }, result.seed);
    runOut(engine);
    expect(engine.getMultipliersView().home).toBe(count);
    // An unreachable target reports the closest count instead.
    const far = { ...request, modeSettings: { ...request.modeSettings, multipliers: { rows: 6, startBalls: 2, target: 5000 } } };
    const miss = await findSimulation(far, () => undefined);
    expect(miss.found).toBe(false);
    expect(miss.seedsTested).toBe(3);
    expect(miss.count).toBeGreaterThan(0);
  });
});

describe("multipliers board settings", () => {
  it("default to 8 rows, one ball, 500 at most and no target, and stay out of default links", () => {
    for (const mode of MODE_IDS) expect(multipliersSettingsOf(defaultSettings(mode))).toEqual(DEFAULT_MULTIPLIERS_SETTINGS);
    const params = settingsToSearchParams(defaultSettings("multipliers"));
    for (const key of ["mprw", "mpgm", "mpsb", "mpmb", "mptg"]) expect(params.has(key)).toBe(false);
    expect(GATE_KINDS).toHaveLength(6);
    expect(parseGateMix("421111")).toEqual({ count: 4, speed: 2, size: 1, damage: 1, reverse: 1, release: 1 });
  });

  it("round-trip through the URL keys", () => {
    const s = { ...defaultSettings("multipliers"), ...multipliersSettingFields({ rows: 14, gateMix: "900303", startBalls: 4, maxBalls: 1200, target: 250 }) };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("multipliers");
    expect(params.get("mprw")).toBe("14");
    expect(params.get("mpgm")).toBe("900303");
    expect(params.get("mpsb")).toBe("4");
    expect(params.get("mpmb")).toBe("1200");
    expect(params.get("mptg")).toBe("250");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("clamp URL parameters and presets; a gate mix without any weight falls back", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=multipliers&mprw=99&mpsb=0.4&mpmb=10&mptg=-5&mpgm=00x0"));
    expect(s.mpRows).toBe(99); // --- uncap-all --- (kept; the board builds at most its memory-safety ceiling)
    expect(s.mpStartBalls).toBe(1);
    expect(s.mpMaxBalls).toBe(MULTIPLIERS_RANGES.mpMaxBalls.min);
    expect(s.mpTarget).toBe(0);
    expect(s.mpGateMix).toBe(DEFAULT_MULTIPLIERS_SETTINGS.gateMix);
    expect(sanitizeGateMix("12")).toBe("120000");
    expect(sanitizeGateMix("1234567")).toBe("123456");
    expect(resolveMultipliersSettings({ rows: 7.6, gateMix: undefined })).toMatchObject({ rows: 8, gateMix: "421111" });
    const p = presetToSettings({ mode: "multipliers", mpRows: 3, mpGateMix: "abc", mpMaxBalls: 1e9 });
    expect(p.mpRows).toBe(4);
    expect(p.mpGateMix).toBe("421111");
    expect(p.mpMaxBalls).toBe(1e9); // --- uncap-all --- (kept; the board holds at most its memory-safety ceiling)
  });
});

describe("clone colours", () => {
  it("give every generation of clones the next colour of a small palette", async () => {
    const { CLONE_COLORS, nextCloneColor } = await import("@/lib/physics/modes/multipliers");
    expect(nextCloneColor("#FFFFFF")).toBe(CLONE_COLORS[0]);
    expect(nextCloneColor(CLONE_COLORS[0])).toBe(CLONE_COLORS[1]);
    expect(nextCloneColor(CLONE_COLORS[CLONE_COLORS.length - 1])).toBe(CLONE_COLORS[0]);
    const engine = board({ rows: 6, startBalls: 2, gateMix: "900000" }, 2);
    const colors = new Set<string>();
    runOut(engine, 240, () => {
      for (const b of engine.getBalls()) colors.add(b.color);
    });
    expect(colors.size).toBeGreaterThan(2);
    expect(colors.size).toBeLessThanOrEqual(CLONE_COLORS.length + 1);
  });
});

describe("review fix (modes-gerald-odd): a ball grown by size gates", () => {
  it("outgrows the board when it wedges between the rows, instead of silently vanishing as a lost ball", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 12; seed++) {
      const engine = board({ rows: 20, gateMix: "001000", startBalls: 1, maxBalls: 200 }, seed, { width: 800, height: 600 });
      runOut(engine, 400);
      const label = `seed ${seed}`;
      expect(engine.isSimulationFinished(), label).toBe(true);
      expect(engine.getMultiplierView().outgrown, label).toBe(true);
      expect(engine.getMultipliersView().lost, label).toBe(0);
    }
  });

  it("does not cut a busy board short: a grown ball stuck while others are still in play is lost as before", { timeout: 120_000 }, () => {
    // Count and size gates: grown balls wedge now and then among hundreds of others (ending on the first one sent these boards
    // home with 209–300 balls still in play and 713 / 1249 home instead of 2296 / 2005).
    for (const seed of [2, 4]) {
      const engine = board({ rows: 20, gateMix: "211100", startBalls: 3, maxBalls: 300 }, seed);
      runOut(engine, 400);
      const label = `seed ${seed}`;
      const v = engine.getMultipliersView();
      expect(engine.isSimulationFinished(), label).toBe(true);
      expect(engine.getMultiplierView().outgrown, label).toBe(false);
      expect(v.active, label).toBe(0);
      expect(v.home, label).toBeGreaterThan(2000);
    }
  });
});

describe("review fix (modes-gerald-odd): the count gates' closing time", () => {
  it("stops cloning at COUNT_GATES_CLOSE_MS, so a crowded board of big balls that keeps refilling itself drains and ends", { timeout: 120_000 }, () => {
    // Big balls, count gates only, a small board: it refills as fast as balls arrive (without the closing time it runs 413 s).
    const engine = board({ rows: 20, gateMix: "900000", startBalls: 10, maxBalls: 200 }, 1, { width: 300, height: 300, ballRadius: 20 });
    let clonesAfterClose = -1;
    for (let f = 0; f < 600 * 60 && !engine.isSimulationFinished(); f++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (clonesAfterClose < 0 && engine.getElapsedMs() >= COUNT_GATES_CLOSE_MS + 100) clonesAfterClose = engine.getMultipliersView().clones;
    }
    const v = engine.getMultipliersView();
    expect(clonesAfterClose).toBeGreaterThan(1000); // it was still multiplying at closing time
    expect(engine.isSimulationFinished()).toBe(true);
    expect(v.clones).toBe(clonesAfterClose);
    expect(v.active).toBe(0);
    expect(engine.getElapsedMs()).toBeLessThan(COUNT_GATES_CLOSE_MS + 60_000);
  });
});
