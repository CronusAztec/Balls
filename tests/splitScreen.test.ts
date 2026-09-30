import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { SoundEvent } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, simulateSeed, type FinderProgress, type FinderRequest, type FinderResult, type ModeSettings } from "@/lib/simulation/finder";
import { MultiArenaRunner, arenaFinderRequest, arenaPhysicsConfig, configPatch, findArenaSeeds, playArenaSound, type ArenaHooks, type ArenaSoundSink } from "@/lib/simulation/multi";
import {
  EXTRA_ARENA_LEVEL,
  PARTICLE_BUDGET,
  SPLIT_SCREEN_RANGES,
  arenaGrid,
  arenaMarkMs,
  arenaParticleBudget,
  arenaViewports,
  bannerAnchor,
  decodeArenas,
  defaultSplitScreenFields,
  encodeArenas,
  formatRaceSeconds,
  mergeArenaSettings,
  patchArena,
  raceStandings,
  resolveSplitScreenFields,
  resolvedArenas,
  sanitizeArenaLabel,
  splitRestartKey,
  withArenaSeeds,
  worldToCanvas,
  type ArenaViewport,
} from "@/lib/splitScreen";

const area = (v: { width: number; height: number }) => v.width * v.height;
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("split-screen: viewport maths", () => {
  it("keeps one arena as the whole canvas and its world", () => {
    expect(arenaViewports(800, 600, 1, "row")).toEqual([{ index: 0, x: 0, y: 0, width: 800, height: 600, world: { width: 800, height: 600 }, scale: 1 }]);
    expect(arenaGrid(1, "grid")).toEqual({ cols: 1, rows: 1 });
  });

  it("lays two arenas side by side (row) or stacked (grid), four in a row or a 2 × 2 grid", () => {
    expect(arenaGrid(2, "row")).toEqual({ cols: 2, rows: 1 });
    expect(arenaGrid(2, "grid")).toEqual({ cols: 1, rows: 2 });
    expect(arenaGrid(4, "row")).toEqual({ cols: 4, rows: 1 });
    expect(arenaGrid(4, "grid")).toEqual({ cols: 2, rows: 2 });
  });

  it("tiles the centred square the recorder exports, in reading order", () => {
    const row = arenaViewports(800, 600, 2, "row");
    expect(row.map((v) => [v.x, v.y, v.width, v.height])).toEqual([
      [100, 0, 300, 600],
      [400, 0, 300, 600],
    ]);
    const grid = arenaViewports(1080, 1920, 4, "grid");
    expect(grid.map((v) => [v.x, v.y, v.width, v.height])).toEqual([
      [0, 420, 540, 540],
      [540, 420, 540, 540],
      [0, 960, 540, 540],
      [540, 960, 540, 540],
    ]);
    for (const [w, h, n, layout] of [
      [800, 600, 2, "row"],
      [800, 600, 2, "grid"],
      [800, 600, 4, "row"],
      [800, 600, 4, "grid"],
      [390, 844, 4, "grid"],
      [1280, 720, 2, "row"],
    ] as const) {
      const vps = arenaViewports(w, h, n, layout);
      const side = Math.min(w, h);
      const ox = (w - side) / 2;
      const oy = (h - side) / 2;
      expect(vps).toHaveLength(n);
      // Inside the square, no overlap, and together exactly the square.
      expect(close(vps.reduce((s, v) => s + area(v), 0), side * side, 1e-6)).toBe(true);
      for (const v of vps) {
        expect(v.x).toBeGreaterThanOrEqual(ox - 1e-9);
        expect(v.y).toBeGreaterThanOrEqual(oy - 1e-9);
        expect(v.x + v.width).toBeLessThanOrEqual(ox + side + 1e-9);
        expect(v.y + v.height).toBeLessThanOrEqual(oy + side + 1e-9);
        for (const u of vps) {
          if (u === v) continue;
          const overlapW = Math.min(u.x + u.width, v.x + v.width) - Math.max(u.x, v.x);
          const overlapH = Math.min(u.y + u.height, v.y + v.height) - Math.max(u.y, v.y);
          expect(overlapW <= 1e-9 || overlapH <= 1e-9).toBe(true);
        }
      }
    }
  });

  it("gives every arena a world of its viewport's shape whose shorter side is the exported square's (as one arena's world)", () => {
    for (const [w, h, n, layout] of [
      [800, 600, 2, "row"],
      [800, 600, 2, "grid"],
      [800, 600, 4, "row"],
      [1080, 1920, 4, "grid"],
    ] as const) {
      const side = Math.min(w, h);
      for (const v of arenaViewports(w, h, n, layout)) {
        expect(close(Math.min(v.world.width, v.world.height), side)).toBe(true);
        expect(close(v.world.width / v.world.height, v.width / v.height)).toBe(true);
        expect(close(v.world.width * v.scale, v.width)).toBe(true);
        expect(close(v.world.height * v.scale, v.height)).toBe(true);
        expect(v.scale).toBeLessThanOrEqual(1);
      }
    }
    const [a, b] = arenaViewports(800, 600, 2, "row");
    expect(a.world).toEqual({ width: 600, height: 1200 });
    expect(a.scale).toBe(0.5);
    expect(b.world).toEqual({ width: 600, height: 1200 });
  });

  it("maps a world point into its viewport (the world's corners onto the viewport's, its centre onto the viewport's)", () => {
    const vp: ArenaViewport = arenaViewports(1080, 1920, 4, "grid")[3];
    expect(worldToCanvas(vp, 0, 0)).toEqual({ x: vp.x, y: vp.y });
    const far = worldToCanvas(vp, vp.world.width, vp.world.height);
    expect(close(far.x, vp.x + vp.width) && close(far.y, vp.y + vp.height)).toBe(true);
    const mid = worldToCanvas(vp, vp.world.width / 2, vp.world.height / 2);
    expect(close(mid.x, vp.x + vp.width / 2) && close(mid.y, vp.y + vp.height / 2)).toBe(true);
  });

  it("puts the race banner between the rows of a grid and under the rings of a row", () => {
    expect(bannerAnchor("grid", 4)).toBe(0.5);
    expect(bannerAnchor("grid", 2)).toBe(0.5);
    expect(bannerAnchor("row", 2)).toBeGreaterThan(0.75);
  });
});

describe("split-screen: the override merge", () => {
  const shared = defaultSettings("classic");

  it("returns the shared settings themselves when nothing applies", () => {
    expect(mergeArenaSettings(shared, undefined, 1)).toBe(shared);
    expect(mergeArenaSettings(shared, { label: "B" }, 1)).toBe(shared);
    expect(mergeArenaSettings(shared, { label: "B", gravity: shared.gravity, ballSpeed: shared.ballSpeed }, 1)).toBe(shared);
  });

  it("lays gravity, ball speed, colour and mode over the shared settings, leaving the rest", () => {
    const merged = mergeArenaSettings(shared, { label: "B", gravity: 900, ballSpeed: 650, ballColor: "#ff3366", mode: "shatter", seed: 5 }, 1);
    expect(merged).not.toBe(shared);
    expect([merged.gravity, merged.ballSpeed, merged.ballColor, merged.mode]).toEqual([900, 650, "#ff3366", "shatter"]);
    expect(merged.wallCount).toBe(shared.wallCount);
    expect(merged.rotationSpeed).toBe(shared.rotationSpeed);
    expect(shared.gravity).toBe(300);
  });

  it("never changes the first arena's mode (it plays the Mode picker's)", () => {
    const merged = mergeArenaSettings(shared, { label: "A", mode: "portal", gravity: 100 }, 0);
    expect(merged.mode).toBe("classic");
    expect(merged.gravity).toBe(100);
    const arenas = resolvedArenas({ arenaCount: 2, arenas: [{ label: "", mode: "portal" }, { label: "Blue", mode: "grow" }] });
    expect(arenas).toEqual([{ label: "A" }, { label: "Blue", mode: "grow" }]);
  });

  it("fills the arenas in play: default letters, no overrides for missing entries, as many as the count", () => {
    expect(resolvedArenas({ arenaCount: 4, arenas: [{ label: "Red", gravity: 500 }] })).toEqual([{ label: "Red", gravity: 500 }, { label: "B" }, { label: "C" }, { label: "D" }]);
    expect(resolvedArenas({ arenaCount: 2, arenas: [{ label: "x" }, { label: "y" }, { label: "z" }] })).toHaveLength(2);
    expect(resolvedArenas({ arenaCount: 1, arenas: [] })).toEqual([{ label: "A" }]);
  });

  it("edits one arena: removes an override set to undefined, grows the list, keeps a space while typing", () => {
    let arenas = patchArena([], 2, { label: "Team ", seed: 7 });
    expect(arenas).toEqual([{ label: "" }, { label: "" }, { label: "Team ", seed: 7 }]);
    arenas = patchArena(arenas, 2, { seed: undefined, gravity: 1200 });
    expect(arenas[2]).toEqual({ label: "Team ", gravity: 1200 });
    expect(sanitizeArenaLabel("  a|b~c\u0007  ")).toBe("abc");
    expect(sanitizeArenaLabel("x".repeat(40))).toHaveLength(16);
    expect(withArenaSeeds([{ label: "Red", seed: 1 }], 3, [11, undefined, 33])).toEqual([{ label: "Red", seed: 11 }, { label: "" }, { label: "", seed: 33 }]);
  });

  it("restarts the race for a new count, seed or mode – not for a label, colour, gravity or speed (those follow live)", () => {
    const base = { arenaCount: 2 as const, arenas: [{ label: "A" }, { label: "B" }] };
    const key = splitRestartKey(base);
    expect(splitRestartKey({ ...base, arenas: [{ label: "Red", ballColor: "#ff0000", gravity: 10, ballSpeed: 60 }, { label: "Blue" }] })).toBe(key);
    expect(splitRestartKey({ ...base, arenas: [{ label: "A" }, { label: "B", seed: 4 }] })).not.toBe(key);
    expect(splitRestartKey({ ...base, arenas: [{ label: "A" }, { label: "B", mode: "grow" }] })).not.toBe(key);
    expect(splitRestartKey({ ...base, arenaCount: 4 })).not.toBe(key);
    expect(splitRestartKey({ arenaCount: 1, arenas: [{ label: "A", seed: 3 }] })).toBe("1");
  });

  it("builds an arena engine's physics config from the merged settings, like the page's own", () => {
    const merged = mergeArenaSettings(shared, { label: "B", gravity: 1000, ballSpeed: 200, ballColor: "#00ff00" }, 1);
    const config = arenaPhysicsConfig(merged);
    expect([config.gravity, config.ballSpeed, config.ballColor, config.wallCount, config.rotationSpeed]).toEqual([1000, 200, "#00ff00", shared.wallCount, shared.rotationSpeed]);
    expect(config.timeline).toEqual([]);
    expect("timeline" in arenaPhysicsConfig(merged, false)).toBe(false);
    expect(arenaPhysicsConfig({ ...merged, rotationEnabled: false }).rotationSpeed).toBe(0);
  });

  it("sends only what changed in a live update", () => {
    const a = arenaPhysicsConfig(shared, false);
    expect(configPatch(a, arenaPhysicsConfig(shared, false))).toBeNull();
    expect(configPatch(a, arenaPhysicsConfig({ ...shared, ballColor: "#123456" }, false))).toEqual({ ballColor: "#123456" });
    expect(Object.keys(configPatch(undefined, a) ?? {})).toEqual(Object.keys(a));
  });

  it("shares the particle budget between the arenas", () => {
    expect(arenaParticleBudget(1)).toBe(PARTICLE_BUDGET);
    expect(arenaParticleBudget(2) * 2).toBeLessThanOrEqual(PARTICLE_BUDGET);
    expect(arenaParticleBudget(4) * 4).toBeLessThanOrEqual(PARTICLE_BUDGET);
  });
});

describe("split-screen: settings and the URL", () => {
  it("is off by default in every mode and stays out of the URL", () => {
    for (const mode of ["classic", "shatter", "drop", "race"] as const) {
      const s = defaultSettings(mode);
      expect([s.arenaCount, s.arenaLayout, s.arenas, s.soundArena]).toEqual([1, "row", [], "first"]);
      const params = settingsToSearchParams(s);
      for (const key of ["ac", "al", "ar", "sa"]) expect(params.has(key)).toBe(false);
    }
  });

  it("uses the Ball section's gravity and speed ranges for the overrides", () => {
    expect(SPLIT_SCREEN_RANGES.arenaGravity).toEqual(RANGES.gravity);
    expect(SPLIT_SCREEN_RANGES.arenaBallSpeed).toEqual(RANGES.ballSpeed);
    expect(RANGES.arenaCount).toEqual({ min: 1, max: 4, step: 1 });
  });

  it("round-trips the race through ac / al / sa / ar", () => {
    const s: SimulatorSettings = {
      ...defaultSettings("classic"),
      arenaCount: 4,
      arenaLayout: "grid",
      soundArena: "all",
      arenas: [{ label: "Red", ballColor: "#ff3366", gravity: 600 }, { label: "Blue", seed: -123456, mode: "shatter" }, { label: "", ballSpeed: 650 }, { label: "Gold 4", seed: 2147483647 }],
    };
    const params = settingsToSearchParams(s);
    expect(params.get("ac")).toBe("4");
    expect(params.get("al")).toBe("grid");
    expect(params.get("sa")).toBe("all");
    expect(params.get("ar")).toBe("Red~g600~cff3366|Blue~s-123456~mshatter|~v650|Gold 4~s2147483647");
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect([back.arenaCount, back.arenaLayout, back.soundArena]).toEqual([4, "grid", "all"]);
    expect(back.arenas).toEqual(s.arenas);
  });

  it("drops what it does not know from a URL: bad counts, layouts, sounds, colours, modes and numbers", () => {
    const back = settingsFromSearchParams(new URLSearchParams("mode=classic&ac=3&al=diagonal&sa=loud&ar=" + encodeURIComponent("Red~gabc~cxyz~mnope~v99999~s12.7|B~zzz")));
    expect(back.arenaCount).toBe(2);
    expect(back.arenaLayout).toBe("row");
    expect(back.soundArena).toBe("first");
    expect(back.arenas).toEqual([{ label: "Red", ballSpeed: 800, seed: 13 }, { label: "B" }]);
    expect(settingsFromSearchParams(new URLSearchParams("ac=9")).arenaCount).toBe(4);
    expect(settingsFromSearchParams(new URLSearchParams("ac=-1")).arenaCount).toBe(1);
    expect(decodeArenas("")).toEqual([]);
    expect(encodeArenas([{ label: "A" }, { label: "" }, { label: "" }])).toBe("A");
    expect(decodeArenas("a|b|c|d|e|f")).toHaveLength(4);
  });

  it("validates a preset's (or project file's) race like a URL's", () => {
    const s = presetToSettings({ mode: "portal", arenaCount: 2, arenaLayout: "grid", soundArena: "all", arenas: [{ label: "L|1", gravity: -50, mode: "nope" as never }, "junk" as never] });
    expect([s.arenaCount, s.arenaLayout, s.soundArena]).toEqual([2, "grid", "all"]);
    expect(s.arenas).toEqual([{ label: "L1", gravity: 0 }, { label: "" }]);
    expect(resolveSplitScreenFields({ arenaCount: "4", arenaLayout: 3, soundArena: null, arenas: "x" })).toEqual(defaultSplitScreenFields());
  });
});

describe("split-screen: the race standings", () => {
  it("times an arena by its first escape, else its finish", () => {
    expect(arenaMarkMs({ escapeMs: 1200, finishMs: 1500 })).toBe(1200);
    expect(arenaMarkMs({ escapeMs: -1, finishMs: 1500 })).toBe(1500);
    expect(arenaMarkMs({ escapeMs: -1, finishMs: -1 })).toBe(-1);
  });

  it("names the first arena to escape (or finish), with its time, and the order behind it", () => {
    expect(raceStandings([{ escapeMs: -1, finishMs: -1 }, { escapeMs: -1, finishMs: -1 }])).toEqual({ order: [], winners: [], kind: null, timeMs: -1 });
    const s = raceStandings([
      { escapeMs: 9000, finishMs: 9500 },
      { escapeMs: -1, finishMs: -1 },
      { escapeMs: 4250, finishMs: 5000 },
      { escapeMs: -1, finishMs: 7000 },
    ]);
    expect(s).toEqual({ order: [2, 3, 0], winners: [2], kind: "escaped", timeMs: 4250 });
    expect(raceStandings([{ escapeMs: -1, finishMs: 3000 }, { escapeMs: -1, finishMs: 2000 }]).kind).toBe("finished");
    expect(formatRaceSeconds(4250)).toBe("4.25");
  });

  it("calls a tie when arenas escape on the same step", () => {
    const s = raceStandings([
      { escapeMs: 3000, finishMs: -1 },
      { escapeMs: 3000, finishMs: -1 },
      { escapeMs: 5000, finishMs: -1 },
    ]);
    expect(s.winners).toEqual([0, 1]);
    expect(s.order).toEqual([0, 1, 2]);
  });
});

/* ------------------------------------------------------------------ the runner with real engines */

const MODE_SETTINGS: ModeSettings = {
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

/** The page's side, as Simulator.tsx builds it (the mode's settings for classic / portal / grow are the engine defaults here). */
const HOOKS: ArenaHooks = {
  create: (page) => new PhysicsEngine({ ...page.config }),
  init: (engine, s, seed, world) => {
    engine.setConfig({ ...arenaPhysicsConfig(s), width: world.width, height: world.height });
    engine.setSeed(seed);
    engine.setBouncier(s.bouncierEnabled);
    engine.setWallBreakStyle(s.wallBreakStyle);
    engine.setCinematicEnabled(s.cinematicEnabled);
    engine.initMode(s.mode);
  },
  initPage: (page) => page.initMode(page.getCurrentModeName()),
  live: () => {},
};

function pageEngine(s: SimulatorSettings, width = 800, height = 600, seed: number | null = 42) {
  const page = new PhysicsEngine({ ...arenaPhysicsConfig(s), width, height });
  page.setSeed(seed);
  page.initMode(s.mode);
  return page;
}

const step = (engines: readonly PhysicsEngine[], frames: number) => {
  for (let f = 0; f < frames; f++) for (const e of engines) e.update(1000 / 60, 0);
};

describe("split-screen: the arena runner", () => {
  it("builds one engine per further arena, in its viewport's world, sharing the particle budget", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 4, arenaLayout: "grid", arenas: [{ label: "A" }, { label: "B", gravity: 900 }, { label: "C", mode: "grow" }, { label: "D", ballSpeed: 700, seed: 9 }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    let notified = 0;
    runner.subscribe(() => notified++);
    runner.sync(page, s, HOOKS);
    const engines = runner.getEngines();
    expect(engines).toHaveLength(4);
    expect(engines[0]).toBe(page);
    expect(notified).toBeGreaterThan(0);
    expect(runner.isActive()).toBe(true);
    // The page's world was the whole canvas: the viewports tile its centred square, every engine gets its viewport's world.
    const vps = runner.viewports();
    expect(vps.map((v) => [v.width, v.height])).toEqual([
      [300, 300],
      [300, 300],
      [300, 300],
      [300, 300],
    ]);
    for (const e of engines) expect([e.config.width, e.config.height]).toEqual([600, 600]);
    // The whole canvas stays known (the viral bot plans its single-view clips in it during a race).
    expect(runner.canvasSize()).toEqual({ width: 800, height: 600 });
    expect(engines.map((e) => e.config.gravity)).toEqual([300, 900, 300, 300]);
    expect(engines.map((e) => e.config.ballSpeed)).toEqual([400, 400, 400, 700]);
    expect(engines.map((e) => e.getCurrentModeName())).toEqual(["classic", "classic", "grow", "classic"]);
    expect(engines[3].getSeed()).toBe(9);
    // Four arenas together draw no more particles than one did.
    for (const e of engines) for (let i = 0; i < 20; i++) e.spawnConfetti(300, 300);
    expect(engines.reduce((sum, e) => sum + e.getParticles().length, 0)).toBeLessThanOrEqual(PARTICLE_BUDGET);
    // Back to one arena: the others go, the page's budget comes back.
    runner.sync(page, { ...s, arenaCount: 1 }, HOOKS);
    expect(runner.getEngines()).toEqual([page]);
    expect(runner.isActive()).toBe(false);
    expect(runner.canvasSize()).toBeNull();
    for (let i = 0; i < 20; i++) page.spawnConfetti(300, 300);
    expect(page.getParticles().length).toBeGreaterThan(PARTICLE_BUDGET / 4);
  });

  it("plays an arena's seed exactly as the finder simulates it (so a found seed replays in its arena)", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A" }, { label: "B", gravity: 700, ballSpeed: 550, seed: 1234 }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    const arena = runner.getEngines()[1];
    const plan = runner.finderPlan();
    expect(plan).not.toBeNull();
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, physicsConfig: { ...page.config }, mode: "classic", modeSettings: MODE_SETTINGS };
    const arenaRequest = arenaFinderRequest(request, plan!, 1);
    expect([arenaRequest.physicsConfig.gravity, arenaRequest.physicsConfig.ballSpeed, arenaRequest.physicsConfig.width, arenaRequest.physicsConfig.height]).toEqual([700, 550, 600, 1200]);
    const headless = createEngineForSettings(arenaRequest.physicsConfig, arenaRequest.mode, arenaRequest.modeSettings, 1234);
    step([arena, headless], 240);
    expect(arena.getElapsedMs()).toBeCloseTo(headless.getElapsedMs(), 6);
    const pos = (e: PhysicsEngine) => e.getBalls().map((b) => [Math.round(b.x * 1e6), Math.round(b.y * 1e6)]);
    expect(pos(arena)).toEqual(pos(headless));
    expect(arena.getBrokenWalls().size).toBe(headless.getBrokenWalls().size);
  });

  it("marks each arena's finish on the step it finished, the finder's run length, even when a frame notices it late (8×)", () => {
    const base = { ...defaultSettings("classic"), wallCount: 2, gapSize: 0.9 };
    const s: SimulatorSettings = { ...base, arenaCount: 2, arenaLayout: "grid", arenas: [{ label: "A", seed: 21 }, { label: "B", seed: 22, ballSpeed: 600 }] };
    const page = pageEngine(s, 800, 600, 21);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    const plan = runner.finderPlan()!;
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 120, physicsConfig: { ...page.config }, mode: "classic", modeSettings: MODE_SETTINGS };
    const expected = [simulateSeed(21, request, 120000), simulateSeed(22, arenaFinderRequest(request, plan, 1), 120000)];
    expect(expected.every((ms) => ms < 120000)).toBe(true);
    let now = 0;
    for (let f = 0; f < 60 * 120 && !runner.allFinished(); f++) {
      runner.beforeFrame();
      step(runner.getEngines(), 8); // eight steps per frame, as at 8× (the finish is noticed up to seven steps late)
      now += 1000 / 60;
      runner.afterFrame(now);
    }
    expect(runner.allFinished()).toBe(true);
    runner.marksOf().forEach((m, i) => expect(m.finishMs).toBeCloseTo(expected[i], 6));
  });

  it("starts the other arenas over when the page's engine restarts, and on the same frame", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A" }, { label: "B", seed: 77 }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    const [, other] = runner.getEngines();
    const start = other.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]);
    for (let f = 0; f < 60; f++) {
      runner.beforeFrame();
      step(runner.getEngines(), 1);
      runner.afterFrame(f * 16);
    }
    expect(other.getElapsedMs()).toBeGreaterThan(900);
    page.initMode("classic"); // the page's Restart
    runner.beforeFrame();
    expect(other.getElapsedMs()).toBe(0);
    expect(other.getBalls().map((b) => [b.x, b.y, b.vx, b.vy])).toEqual(start); // its fixed seed: the same start again
    step(runner.getEngines(), 1);
    runner.afterFrame(2000);
    expect(other.getElapsedMs()).toBe(page.getElapsedMs());
  });

  it("follows a setting live mid-run, and from scratch before the run", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A" }, { label: "B" }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    const other = runner.getEngines()[1];
    step(runner.getEngines(), 30);
    const elapsed = other.getElapsedMs();
    runner.sync(page, { ...s, gravity: 1500, ballColor: "#abcdef" }, HOOKS);
    expect(other.getElapsedMs()).toBe(elapsed);
    expect(other.config.gravity).toBe(1500);
    expect(other.getBalls()[0].color).toBe("#abcdef");
    // Before the run starts (the page's clock at 0), an arena is rebuilt with the new settings.
    page.initMode("classic");
    runner.sync(page, { ...s, gravity: 1500, wallCount: 3 }, HOOKS);
    expect(other.getElapsedMs()).toBe(0);
    expect(other.getCircularWalls()).toHaveLength(3);
  });

  it("keeps the first arena's seed on the page's engine before a run starts", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A", seed: 555 }, { label: "B" }] };
    const page = pageEngine(s, 800, 600, null);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    expect(page.getSeed()).toBe(555);
  });

  it("times the race: marks each arena's first escape or finish on its own clock, and holds the finished race", () => {
    // One wide-open ring and a fast ball: every arena escapes within a few seconds.
    const base = { ...defaultSettings("classic"), wallCount: 1, gapSize: 1, ballSpeed: 800, gravity: 0 };
    const s: SimulatorSettings = { ...base, arenaCount: 2, arenas: [{ label: "A", seed: 3 }, { label: "B", seed: 8, ballSpeed: 300 }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    let now = 0;
    for (let f = 0; f < 60 * 30 && !runner.allFinished(); f++) {
      runner.beforeFrame();
      step(runner.getEngines(), 1);
      now += 1000 / 60;
      runner.afterFrame(now);
    }
    const marks = runner.marksOf();
    expect(marks.every((m) => arenaMarkMs(m) >= 0)).toBe(true);
    const standings = runner.standings();
    expect(standings.order).toHaveLength(2);
    expect(arenaMarkMs(marks[standings.order[0]])).toBeLessThanOrEqual(arenaMarkMs(marks[standings.order[1]]));
    expect(standings.timeMs).toBe(arenaMarkMs(marks[standings.winners[0]]));
    if (runner.allFinished()) {
      expect(runner.holding(now + 10, 1500)).toBe(true);
      expect(runner.holding(now + 5000, 1500)).toBe(false);
    }
    // A restart clears the race.
    page.initMode("classic");
    runner.beforeFrame();
    expect(runner.standings().winners).toEqual([]);
  });

  it("empties the other arenas' sound queues every frame, and plays them only when every arena is heard", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A" }, { label: "B" }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    const other = runner.getEngines()[1];
    step(runner.getEngines(), 120);
    runner.drainSounds(null);
    expect(other.consumeSoundEvents()).toEqual([]);
    step(runner.getEngines(), 120);
    const heard: [SoundEvent, number][] = [];
    runner.drainSounds((ev, arena) => heard.push([ev, arena]));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every(([, arena]) => arena === 1)).toBe(true);
  });

  it("counts the walls another arena broke for its faces, heard or not, until the canvas takes them", () => {
    // Two wide-open rings and a fast ball: the second arena breaks a wall within a few seconds.
    const base = { ...defaultSettings("classic"), wallCount: 2, gapSize: 1, ballSpeed: 800, gravity: 0 };
    const s: SimulatorSettings = { ...base, arenaCount: 2, arenas: [{ label: "A", seed: 1 }, { label: "B", seed: 2 }] };
    const page = pageEngine(s);
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    let breaks = 0;
    for (let f = 0; f < 60 * 20 && breaks === 0; f++) {
      step(runner.getEngines(), 1);
      runner.drainSounds(null);
      breaks = runner.takeWallBreaks(1);
    }
    expect(breaks).toBeGreaterThan(0);
    expect(runner.takeWallBreaks(1)).toBe(0);
    expect(runner.takeWallBreaks(0)).toBe(0); // the page notes the first arena's own
  });
});

describe("split-screen: sounds and the finder", () => {
  it("plays another arena's events the page's way, its bounces softer", () => {
    const calls: string[] = [];
    const sink: ArenaSoundSink = {
      playWallHit: (w, f, a, c, level, melody) => calls.push(`hit ${w} ${level}${melody === false ? " accompaniment" : ""}`),
      playGapPass: () => calls.push("gap"),
      playInteraction: (k) => calls.push(`int ${k}`),
      playMultiplier: (n, melody) => calls.push(`mult ${n}${melody === false ? " accompaniment" : ""}`),
      playBumper: () => calls.push("bumper"),
      playStringBattle: (k) => calls.push(`sb ${k}`),
      playRaceArpeggio: (k) => calls.push(`race ${k}`),
      playPew: (f) => calls.push(`pew ${f}`), // --- boris-vortex ---
      playBeatDrop: (drum, pad, f, accent, level) => calls.push(`bd ${drum} ${pad ?? "-"} ${f ?? "-"}${accent ? " accent" : ""} ${level}`), // --- beat-drop ---
    };
    playArenaSound(sink, { type: "hit", wallIndex: 2 });
    playArenaSound(sink, { type: "hit", wallIndex: 1, level: 0.5 });
    playArenaSound(sink, { type: "gap", wallIndex: 0 });
    playArenaSound(sink, { type: "merge", wallIndex: 0 });
    playArenaSound(sink, { type: "multiplier", wallIndex: 0, multiplier: 4 });
    playArenaSound(sink, { type: "hit", wallIndex: 0, bumper: true });
    playArenaSound(sink, { type: "hit", wallIndex: 0, sbSound: "pluck" });
    playArenaSound(sink, { type: "hit", wallIndex: 0, race: "fanfare" });
    // An event that accompanies the tune (a paddle's wall bounce, a runner's crash) uses up no melody note, as on the page.
    playArenaSound(sink, { type: "hit", wallIndex: 3, melody: false });
    playArenaSound(sink, { type: "multiplier", wallIndex: 0, multiplier: 2, melody: false });
    // A ball swallowed by the Sound Vortex pews (its event is a "hit" on the innermost ring, not a bounce).
    playArenaSound(sink, { type: "hit", wallIndex: 12, frequency: 880, pew: true });
    // --- beat-drop --- a Beat Drop landing plays its drum and pad accent (not a wall hit), a little softer like a bounce.
    playArenaSound(sink, { type: "hit", wallIndex: 0, frequency: 330, bdDrum: "kick", bdPad: "spring", accent: true, melody: false });
    playArenaSound(sink, { type: "hit", wallIndex: 0, bdDrum: "hat", level: 0.5, melody: false });
    expect(calls).toEqual([`hit 2 ${EXTRA_ARENA_LEVEL}`, `hit 1 ${0.5 * EXTRA_ARENA_LEVEL}`, "gap", "int merge", "mult 4", "bumper", "sb pluck", "race fanfare", `hit 3 ${EXTRA_ARENA_LEVEL} accompaniment`, "mult 2 accompaniment", "pew 880", `bd kick spring 330 accent ${EXTRA_ARENA_LEVEL}`, `bd hat - - ${0.5 * EXTRA_ARENA_LEVEL}`]);
  });

  const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, physicsConfig: { width: 300, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#fff", ballRadius: 8, audioIntensity: 0 }, mode: "classic", modeSettings: MODE_SETTINGS };
  const plan = { shared: { gravity: 300, ballSpeed: 400, ballColor: "#fff" }, arenas: [{ label: "A" }, { label: "B", gravity: 50, mode: "portal" as const }, { label: "C", ballSpeed: 90 }], worlds: [{ width: 300, height: 600 }, { width: 300, height: 600 }, { width: 250, height: 500 }] };

  it("searches every arena with its own overrides and world, keeping the seeds and the longest run", async () => {
    const seen: FinderRequest[] = [];
    const find = async (r: FinderRequest): Promise<FinderResult> => {
      seen.push(r);
      return { found: true, seed: 100 + seen.length, duration: 20 + seen.length, seedsTested: 3 };
    };
    const result = await findArenaSeeds(find, request, () => {}, undefined, plan);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(request);
    expect([seen[1].mode, seen[1].physicsConfig.gravity, seen[1].physicsConfig.ballSpeed]).toEqual(["portal", 50, 400]);
    expect([seen[2].mode, seen[2].physicsConfig.gravity, seen[2].physicsConfig.ballSpeed, seen[2].physicsConfig.width]).toEqual(["classic", 300, 90, 250]);
    expect(result.arenaSeeds).toEqual([101, 102, 103]);
    expect(result.seed).toBe(101);
    expect(result.duration).toBe(23);
  });

  it("searches only the page's arena outside a race, or when the first arena was not found", async () => {
    let calls = 0;
    const miss = async (): Promise<FinderResult> => {
      calls++;
      return { found: false, seed: 5, duration: 12, seedsTested: 10 };
    };
    expect((await findArenaSeeds(miss, request, () => {}, undefined, plan)).arenaSeeds).toBeUndefined();
    expect(calls).toBe(1);
    const hit = async (): Promise<FinderResult> => ({ found: true, seed: 5, duration: 12, seedsTested: 1 });
    expect((await findArenaSeeds(hit, request, () => {}, undefined, null)).arenaSeeds).toBeUndefined();
    // An arena whose run never ends has no seed to search: it keeps its own.
    let n = 0;
    const endlessSecond = async (): Promise<FinderResult> => (n++ === 1 ? { found: false, seed: 0, duration: 0, seedsTested: 0, endless: true } : { found: true, seed: 7 + n, duration: 10, seedsTested: 2 });
    expect((await findArenaSeeds(endlessSecond, request, () => {}, undefined, plan)).arenaSeeds).toEqual([8, undefined, 10]);
  });

  it("finds nothing when the search is aborted while another arena is searched (Cancel, a mode change, a preset load)", async () => {
    // The first arena was found; the abort comes during the second or the third arena's search.
    for (const abortAt of [1, 2]) {
      const controller = new AbortController();
      let calls = 0;
      const find = async (_r: FinderRequest, _p: unknown, signal?: AbortSignal): Promise<FinderResult> => {
        const index = calls++;
        if (index === abortAt) {
          controller.abort();
          expect(signal?.aborted).toBe(true);
          return { found: false, seed: 9, duration: 44, seedsTested: 300 };
        }
        return { found: true, seed: 5, duration: 30, seedsTested: 4 };
      };
      const result = await findArenaSeeds(find, request, () => {}, controller.signal, plan);
      expect(calls).toBe(abortAt + 1);
      expect(result.found).toBe(false);
      expect(result.arenaSeeds).toBeUndefined();
    }
    // Aborted just as the first arena's search was found: nothing more is searched, and nothing is found either.
    const controller = new AbortController();
    let calls = 0;
    const foundThenAborted = async (): Promise<FinderResult> => {
      calls++;
      controller.abort();
      return { found: true, seed: 5, duration: 30, seedsTested: 4 };
    };
    const race = await findArenaSeeds(foundThenAborted, request, () => {}, controller.signal, plan);
    expect([calls, race.found, race.arenaSeeds]).toEqual([1, false, undefined]);
    // The same outside a race.
    const single = new AbortController();
    const hitThenAborted = async (): Promise<FinderResult> => {
      single.abort();
      return { found: true, seed: 5, duration: 30, seedsTested: 4 };
    };
    expect((await findArenaSeeds(hitThenAborted, request, () => {}, single.signal, null)).found).toBe(false);
  });

  it("reports which arena is being searched", async () => {
    const progress: (number | undefined)[] = [];
    const find = async (_r: FinderRequest, onProgress: (p: FinderProgress) => void): Promise<FinderResult> => {
      onProgress({ seedsTested: 50, maxSeeds: 100, currentSeed: 1, bestDuration: 12, bestSeed: 1 });
      return { found: true, seed: 5, duration: 30, seedsTested: 60 };
    };
    await findArenaSeeds(find, request, (p) => progress.push(p.arena), undefined, plan);
    expect(progress).toEqual([undefined, 1, 2]);
  });
});
