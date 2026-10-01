import { describe, expect, it } from "vitest";
import {
  MZ_BIT,
  MZ_E,
  MZ_GAP_ENTRANCE,
  MZ_GAP_EXIT,
  MZ_MICRO_STEP,
  MZ_N,
  MZ_OPPOSITE,
  MZ_S,
  MZ_W,
  buildMazeField,
  carveMaze,
  emptyMazeContact,
  explorerChoice,
  generateMaze,
  mazeBallRadius,
  mazeConnected,
  mazeDirection,
  mazeDistances,
  mazeEdgeClosed,
  mazeExitsOf,
  mazeNeighbour,
  mazePassageCount,
  mazeRowsFor,
  mazeWallH,
  mazeWallV,
  resolveMazeCell,
  shortestChoice,
  wallFollowChoice,
  type MazeBody,
  type MazeGrid,
} from "@/lib/physics/mazeGrid";
import {
  DEFAULT_MAZE_SETTINGS,
  MAZE_RANGES,
  MZ_FINISH_HOLD_MS,
  MZ_NOTE_STEPS,
  MZ_PALETTE,
  defaultMazeFields,
  mazeBallName,
  mazeForcedWinner,
  mazeHandOf,
  mazeNoteFrequency,
  mazeNoteMidi,
  mazeProgress,
  mazeSettingsOf,
  resolveMazeFields,
  resolveMazeSettings,
  type MazeSettings,
} from "@/lib/physics/modes/maze";
import { midiToFrequency } from "@/lib/audio/scales";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { BATTLE_WINNER_MODES, forcedWinnerApplies } from "@/lib/physics/rigged";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateOutcomeRun, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeMatches } from "@/lib/simulation/outcomes";
import { slowViewEligible } from "@/lib/simulation/camera";
import { effectiveBallCount, teamResult } from "@/lib/teams";
import type { PhysicsEngine } from "@/lib/physics/engine";

/**
 * Maze escape (lib/physics/mazeGrid.ts, lib/physics/modes/maze.ts; feature odd-maze): the seeded perfect maze (n − 1
 * passages, connected, deterministic), its BFS distance map, the cell collision (one-sided edges, posts, the gaps), the
 * brains' choices, the settings (resolve, URL, presets), and the mode in the engine: containment at any speed and canvas
 * size, determinism, the notes rising toward the exit, the winner (first out, the clip limit's nearest), the rig and the
 * finder (duration and winner).
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

/** Mulberry32, like the engine's generator. */
function rng(seed: number) {
  let state = seed | 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function engineFor(maze: Partial<MazeSettings>, seed = 1, patch: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...patch }, "maze", { ...modeSettings, maze }, seed);
}

/** Runs the engine for up to `ms` (or until it finishes), collecting the sound events; `each` sees every frame. */
function run(engine: PhysicsEngine, ms: number, each?: () => void): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let t = 0; t < ms && !engine.isSimulationFinished(); t += 1000 / 60) {
    engine.update(1000 / 60, 0);
    events.push(...engine.consumeSoundEvents());
    each?.();
  }
  return events;
}

async function withFrames<T>(body: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  try {
    return await body();
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}

/* ------------------------------------------------------------------ the maze */

describe("the seeded perfect maze", () => {
  it("has cells − 1 passages, every cell connected, symmetric passages and nothing through the outer wall", () => {
    for (const [cols, seed] of [
      [6, 1],
      [12, 2],
      [23, 3],
      [40, 4],
    ] as const) {
      const grid = generateMaze(cols, mazeRowsFor(cols), rng(seed));
      expect(grid.cells).toBe(cols * mazeRowsFor(cols));
      expect(mazePassageCount(grid)).toBe(grid.cells - 1);
      expect(mazeConnected(grid)).toBe(true);
      for (let c = 0; c < grid.cells; c++) {
        for (let d = 0; d < 4; d++) {
          if (!(grid.open[c] & MZ_BIT[d])) continue;
          const n = mazeNeighbour(grid.cols, grid.rows, c, d);
          expect(n).toBeGreaterThanOrEqual(0); // no passage leads out of the grid
          expect(grid.open[n] & MZ_BIT[MZ_OPPOSITE[d]]).toBeTruthy();
        }
      }
      expect(grid.entranceCol).toBeGreaterThanOrEqual(0);
      expect(grid.entranceCol).toBeLessThan(cols);
      expect(grid.exitCell).toBe((grid.rows - 1) * cols + grid.exitCol);
    }
  });

  it("derives its rows from the portrait field", () => {
    expect(mazeRowsFor(6)).toBe(9);
    expect(mazeRowsFor(12)).toBe(17);
    expect(mazeRowsFor(40)).toBe(57);
    expect(mazeRowsFor(1)).toBeGreaterThanOrEqual(2);
  });

  it("is the same maze for the same random numbers, another for others", () => {
    const a = generateMaze(12, 17, rng(7));
    const b = generateMaze(12, 17, rng(7));
    const c = generateMaze(12, 17, rng(8));
    expect([...a.open]).toEqual([...b.open]);
    expect([a.entranceCol, a.exitCol]).toEqual([b.entranceCol, b.exitCol]);
    expect([...a.open]).not.toEqual([...c.open]);
  });

  it("carves from any start cell into a spanning tree", () => {
    const open = new Uint8Array(5 * 4);
    carveMaze(open, 5, 4, 13, rng(3));
    expect(mazePassageCount({ open, cells: 20 })).toBe(19);
    expect(mazeConnected({ open, cols: 5, rows: 4, cells: 20 })).toBe(true);
  });

  it("measures every cell's BFS distance to the exit once", () => {
    const grid = generateMaze(12, 17, rng(11));
    expect(grid.dist[grid.exitCell]).toBe(0);
    let max = 0;
    for (let c = 0; c < grid.cells; c++) {
      const d = grid.dist[c];
      expect(d).toBeGreaterThanOrEqual(0);
      if (d > max) max = d;
      if (c === grid.exitCell) continue;
      // exactly one neighbour one step closer (a tree), the others one step further
      let closer = 0;
      for (let k = 0; k < 4; k++) {
        if (!(grid.open[c] & MZ_BIT[k])) continue;
        const n = mazeNeighbour(grid.cols, grid.rows, c, k);
        expect(Math.abs(grid.dist[n] - d)).toBe(1);
        if (grid.dist[n] === d - 1) closer++;
      }
      expect(closer).toBe(1);
    }
    expect(grid.maxDist).toBe(max);
    expect([...mazeDistances(grid.open, grid.cols, grid.rows, grid.exitCell)]).toEqual([...grid.dist]);
    // An unreachable cell (no passages at all) stays at −1.
    const lonely = mazeDistances(new Uint8Array(4), 2, 2, 0);
    expect([...lonely]).toEqual([0, -1, -1, -1]);
  });

  it("stands its walls where there is no passage, with the entrance and exit gaps in the outer wall", () => {
    const grid = generateMaze(8, 11, rng(5));
    for (let c = 0; c < grid.cols; c++) {
      expect(mazeWallH(grid, c, 0)).toBe(c !== grid.entranceCol);
      expect(mazeWallH(grid, c, grid.rows)).toBe(c !== grid.exitCol);
    }
    for (let r = 0; r < grid.rows; r++) {
      expect(mazeWallV(grid, 0, r)).toBe(true);
      expect(mazeWallV(grid, grid.cols, r)).toBe(true);
    }
    const c = 3 * grid.cols + 4;
    expect(mazeWallV(grid, 5, 3)).toBe(!(grid.open[c] & MZ_BIT[MZ_E]));
    expect(mazeWallH(grid, 4, 4)).toBe(!(grid.open[c] & MZ_BIT[MZ_S]));
  });
});

/* ------------------------------------------------------------------ geometry and collision */

describe("the field and the cell collision", () => {
  it("fits the maze into the portrait column of the centred square, the balls into the corridors", () => {
    const f = buildMazeField(1000, 600, 12, 17);
    expect(f.side).toBe(600);
    expect(f.width).toBeCloseTo(12 * f.cell);
    expect(f.height).toBeCloseTo(17 * f.cell);
    expect(f.width).toBeLessThanOrEqual(0.56 * 600 + 1e-9);
    expect(f.height).toBeLessThanOrEqual(0.8 * 600 + 1e-9);
    expect(f.left + f.width / 2).toBeCloseTo(500);
    expect(f.top + f.height / 2).toBeCloseTo(300);
    expect(f.top - f.cell).toBeGreaterThanOrEqual(f.sy); // the entrance chute is inside the square
    expect(mazeBallRadius(8, 40)).toBe(8);
    expect(mazeBallRadius(30, 28)).toBeCloseTo(0.27 * 28);
    expect(mazeBallRadius(Number.NaN, 100)).toBe(8);
    // A ball at its largest still leaves room in a corridor.
    expect(2 * (mazeBallRadius(30, f.cell) + f.wall / 2)).toBeLessThan(f.cell);
  });

  const grid: MazeGrid = generateMaze(6, 9, rng(9));
  const field = buildMazeField(600, 600, grid.cols, grid.rows);
  const s = field.cell;
  const R = 6 + field.wall / 2;
  /** A cell with its north edge closed and its east edge open. */
  const cellWith = (closed: number, open: number) => {
    for (let c = 0; c < grid.cells; c++) {
      const row = Math.floor(c / grid.cols);
      const col = c % grid.cols;
      if (row === 0 || row === grid.rows - 1) continue;
      if (!(grid.open[c] & MZ_BIT[closed]) && grid.open[c] & MZ_BIT[open]) return { col, row };
    }
    throw new Error("no such cell");
  };

  it("pushes a ball that crossed a closed edge back into its cell and mirrors its speed (restitution 1)", () => {
    const { col, row } = cellWith(MZ_N, MZ_E);
    const x0 = field.left + col * s;
    const y0 = field.top + row * s;
    const b: MazeBody = { x: x0 + s / 2, y: y0 - 2, vx: 30, vy: -500, radius: 6 };
    const contact = emptyMazeContact();
    const speed = resolveMazeCell(grid, field, col, row, b, 0, contact);
    expect(speed).toBe(500);
    expect(b.y).toBeCloseTo(y0 + R);
    expect(b.vy).toBe(500);
    expect(b.vx).toBe(30);
    expect(contact.dir).toBe(MZ_N);
    // Not touching: nothing happens.
    const free: MazeBody = { x: x0 + s / 2, y: y0 + s / 2, vx: 10, vy: 10, radius: 6 };
    expect(resolveMazeCell(grid, field, col, row, free, 0)).toBe(0);
    expect(free).toEqual({ x: x0 + s / 2, y: y0 + s / 2, vx: 10, vy: 10, radius: 6 });
  });

  it("lets a ball through an open edge, bouncing off the corner posts only", () => {
    const { col, row } = cellWith(MZ_N, MZ_E);
    const x1 = field.left + (col + 1) * s;
    const y0 = field.top + row * s;
    const b: MazeBody = { x: x1 + 1, y: y0 + s / 2, vx: 400, vy: 0, radius: 6 };
    expect(resolveMazeCell(grid, field, col, row, b, 0)).toBe(0);
    expect(b.x).toBe(x1 + 1);
    // The post at the top-right corner of the cell (the north wall ends there).
    const p: MazeBody = { x: x1 + 0.5, y: y0 + 0.5 * R, vx: 0, vy: -300, radius: 6 };
    expect(resolveMazeCell(grid, field, col, row, p, 0)).toBeGreaterThan(0);
    expect(Math.hypot(p.x - x1, p.y - y0)).toBeCloseTo(R);
    expect(p.vy).toBeGreaterThan(0);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(300);
  });

  it("opens the entrance while a ball has not entered and the exit to the balls it is open to", () => {
    expect(mazeEdgeClosed(grid, grid.entranceCol, 0, MZ_N, MZ_GAP_ENTRANCE)).toBe(false);
    expect(mazeEdgeClosed(grid, grid.entranceCol, 0, MZ_N, 0)).toBe(true);
    expect(mazeEdgeClosed(grid, grid.exitCol, grid.rows - 1, MZ_S, MZ_GAP_EXIT)).toBe(false);
    expect(mazeEdgeClosed(grid, grid.exitCol, grid.rows - 1, MZ_S, 0)).toBe(true);
    // The chute is closed but toward the entrance.
    expect(mazeEdgeClosed(grid, grid.entranceCol, -1, MZ_S, 0)).toBe(false);
    for (const d of [MZ_N, MZ_E, MZ_W]) expect(mazeEdgeClosed(grid, grid.entranceCol, -1, d, 0)).toBe(true);
    // A rival pushed back from the sealed exit reports it.
    const x0 = field.left + grid.exitCol * s;
    const y1 = field.top + grid.rows * s;
    const b: MazeBody = { x: x0 + s / 2, y: y1 - 1, vx: 0, vy: 300, radius: 6 };
    const contact = emptyMazeContact();
    resolveMazeCell(grid, field, grid.exitCol, grid.rows - 1, b, 0, contact);
    expect(contact.sealedExit).toBe(true);
    expect(b.vy).toBe(-300);
  });
});

/* ------------------------------------------------------------------ the brains */

describe("the brains", () => {
  const grid = generateMaze(10, 14, rng(21));

  it("the wall follower tries left, straight, right, back (or right first with the right hand)", () => {
    const all = 15;
    expect(wallFollowChoice(all, MZ_N, "left")).toBe(MZ_W);
    expect(wallFollowChoice(all, MZ_N, "right")).toBe(MZ_E);
    expect(wallFollowChoice(MZ_BIT[MZ_N] | MZ_BIT[MZ_E], MZ_N, "left")).toBe(MZ_N);
    expect(wallFollowChoice(MZ_BIT[MZ_S], MZ_N, "left")).toBe(MZ_S); // a dead end: back
    expect(wallFollowChoice(0, MZ_E, "right")).toBe(MZ_W);
    expect(mazeHandOf("alternate", 0)).toBe("left");
    expect(mazeHandOf("alternate", 3)).toBe("right");
    expect(mazeHandOf("right", 0)).toBe("right");
  });

  it("a wall follower walking the grid always reaches the exit", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = generateMaze(9, 13, rng(seed));
      let cell = g.entranceCell;
      let heading = MZ_S;
      let steps = 0;
      for (; steps < 4 * g.cells; steps++) {
        const d = wallFollowChoice(mazeExitsOf(g, cell, true), heading, seed % 2 ? "left" : "right");
        if (cell === g.exitCell && d === MZ_S) break;
        cell = mazeNeighbour(g.cols, g.rows, cell, d);
        heading = d;
      }
      expect(steps).toBeLessThan(2 * g.cells);
    }
  });

  it("the explorer prefers unvisited passages, sees the exit and backtracks", () => {
    const visited = new Uint8Array(grid.cells);
    const c = grid.entranceCell;
    const mask = mazeExitsOf(grid, c, true);
    const d = explorerChoice(grid, c, mask, visited, -1, rng(1));
    expect(mask & MZ_BIT[d]).toBeTruthy();
    // With every neighbour visited it goes back to its parent.
    for (let k = 0; k < grid.cells; k++) visited[k] = 1;
    const back = [MZ_N, MZ_E, MZ_S, MZ_W].find((k) => mask & MZ_BIT[k])!;
    expect(explorerChoice(grid, c, mask, visited, back, rng(1))).toBe(back);
    // At the exit cell with the exit open it takes it.
    expect(explorerChoice(grid, grid.exitCell, mazeExitsOf(grid, grid.exitCell, true), visited, -1, rng(1))).toBe(MZ_S);
    // A depth-first walk of the grid finds the exit within 2 × cells moves.
    const seen = new Uint8Array(grid.cells);
    const path = [grid.entranceCell];
    seen[grid.entranceCell] = 1;
    const random = rng(4);
    let found = false;
    for (let step = 0; step < 2 * grid.cells && !found; step++) {
      const cell = path[path.length - 1];
      const parent = path.length >= 2 ? mazeDirection(grid.cols, cell, path[path.length - 2]) : -1;
      const dir = explorerChoice(grid, cell, mazeExitsOf(grid, cell, true), seen, parent, random);
      if (cell === grid.exitCell && dir === MZ_S) found = true;
      else {
        const next = mazeNeighbour(grid.cols, grid.rows, cell, dir);
        if (path.length >= 2 && next === path[path.length - 2]) path.pop();
        else path.push(next);
        seen[next] = 1;
      }
    }
    expect(found).toBe(true);
  });

  it("the rig's shortest way follows the distance map down to the exit", () => {
    let cell = grid.entranceCell;
    for (let step = 0; step < grid.dist[grid.entranceCell]; step++) {
      const d = shortestChoice(grid, cell, mazeExitsOf(grid, cell, true));
      const next = mazeNeighbour(grid.cols, grid.rows, cell, d);
      expect(grid.dist[next]).toBe(grid.dist[cell] - 1);
      cell = next;
    }
    expect(cell).toBe(grid.exitCell);
    expect(shortestChoice(grid, cell, mazeExitsOf(grid, cell, true))).toBe(MZ_S);
    expect(mazeDirection(grid.cols, 5, 6)).toBe(MZ_E);
    expect(mazeDirection(grid.cols, grid.cols, 0)).toBe(MZ_N);
    expect(mazeDirection(grid.cols, grid.cols - 1, grid.cols)).toBe(-1); // wraps a row: not neighbours
  });
});

/* ------------------------------------------------------------------ settings */

describe("maze settings", () => {
  it("defaults, ranges and the notes", () => {
    expect(DEFAULT_MAZE_SETTINGS).toMatchObject({ cols: 12, balls: 3, brain: "explorer", hand: "alternate", trailColor: "#e0202e", wallColor: "#2ecc71", duration: 60, badge: true, hud: true, fog: 0 });
    for (const key of Object.keys(MAZE_RANGES) as (keyof typeof MAZE_RANGES)[]) expect(RANGES[key]).toEqual(MAZE_RANGES[key]);
    expect(MAZE_RANGES.mzCols).toMatchObject({ min: 6, max: 40 });
    expect(MAZE_RANGES.mzBalls).toMatchObject({ min: 1, max: 8 });
    expect(MAZE_RANGES.mzGravity).toMatchObject({ min: 0, max: 1 });
    expect(MAZE_RANGES.mzTrail).toMatchObject({ min: 0, max: 1 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveMazeFields(d)).toEqual(defaultMazeFields());
      const params = settingsToSearchParams(d);
      for (const key of ["mzc", "mzn", "mzb", "mzh", "mzg", "mzs", "mzt", "mztc", "mzto", "mzf", "mzwc", "mzd", "mzbg", "mzhud"]) expect(params.has(key)).toBe(false);
    }
    // The ladder: C major pentatonic up from C4, rising toward the exit.
    expect(mazeNoteMidi(0)).toBe(60);
    expect(mazeNoteMidi(4)).toBe(69);
    expect(mazeNoteMidi(MZ_NOTE_STEPS - 1)).toBe(93);
    expect(mazeNoteFrequency(40, 40)).toBeCloseTo(midiToFrequency(60));
    expect(mazeNoteFrequency(0, 40)).toBeCloseTo(midiToFrequency(93));
    expect(mazeNoteFrequency(99, 40)).toBeCloseTo(midiToFrequency(60)); // beyond the entrance's distance: the lowest note
    let last = 0;
    for (let d = 40; d >= 0; d--) {
      const f = mazeNoteFrequency(d, 40);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(mazeProgress(40, 40)).toBe(0);
    expect(mazeProgress(10, 40)).toBeCloseTo(0.75);
    expect(mazeProgress(0, 40)).toBe(1);
    expect(mazeProgress(-1, 40)).toBe(0);
    expect(mazeBallName(0)).toBe(MZ_PALETTE[0].name);
    expect(mazeBallName(9)).toBe(MZ_PALETTE[1].name);
  });

  it("resolve clamps onto the sliders and drops bad values", () => {
    expect(resolveMazeSettings({ cols: 99, balls: 0, gravity: 1.7, speed: 0.01, trail: -1, fog: 2, duration: 1000 })).toMatchObject({ cols: 40, balls: 1, gravity: 1, speed: 0.25, trail: 0, fog: 1, duration: 180 });
    expect(resolveMazeSettings({ cols: 12.6, gravity: 0.333, speed: 1.234, duration: 42 })).toMatchObject({ cols: 13, gravity: 0.35, speed: 1.25, duration: 40 });
    const junk = { brain: "genius", hand: "both", trailColor: "red", wallColor: "#12345", trailOwn: "yes", badge: 1, hud: null, cols: "many" } as unknown as Partial<MazeSettings>;
    expect(resolveMazeSettings(junk)).toEqual(DEFAULT_MAZE_SETTINGS);
    expect(resolveMazeSettings({ trailColor: "#ABCDEF" }).trailColor).toBe("#abcdef");
  });

  it("round-trip through the URL and presets; bad values fall back", () => {
    const s = { ...defaultSettings("maze"), mzCols: 20, mzBalls: 6, mzBrain: "wallFollow" as const, mzHand: "right" as const, mzGravity: 0.6, mzSpeed: 1.5, mzTrail: 0.5, mzTrailColor: "#00ff88", mzTrailOwn: true, mzFog: 0.8, mzWallColor: "#ff00ff", mzDuration: 90, mzBadge: false, mzHud: false };
    const params = settingsToSearchParams(s);
    expect(params.get("mzc")).toBe("20");
    expect(params.get("mzb")).toBe("wallFollow");
    expect(params.get("mzh")).toBe("right");
    expect(params.get("mztc")).toBe("#00ff88");
    expect(params.get("mzto")).toBe("1");
    expect(params.get("mzhud")).toBe("0");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=maze&mzc=4&mzn=50&mzb=ai&mzh=x&mzg=9&mzs=-1&mzt=abc&mztc=red&mzwc=%23zzzzzz&mzd=5&mzbg=maybe"));
    expect(mazeSettingsOf(bad)).toEqual({ ...DEFAULT_MAZE_SETTINGS, cols: 6, balls: 8, gravity: 1, speed: 0.25, duration: 10 });
    const loaded = presetToSettings({ mode: "maze", mzCols: 100, mzBrain: "bounce", mzFog: "thick", mzTrailOwn: "on" } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(mazeSettingsOf(loaded)).toMatchObject({ cols: 40, brain: "bounce", fog: 0, trailOwn: false });
  });

  it("registers the mode: its id, its card after the String Battle, the battle family, the camera, the rig and the finder", () => {
    expect(MODE_IDS).toContain("maze");
    expect(MODE_CARD_ORDER.indexOf("maze")).toBe(MODE_CARD_ORDER.indexOf("stringBattle") + 1);
    expect(MODE_CATEGORIES.maze).toBe("battle");
    expect(modesInCategory("battle")).toContain("maze");
    expect(slowViewEligible("maze")).toBe(true);
    expect(BATTLE_WINNER_MODES).toContain("maze");
    expect(forcedWinnerApplies("maze", 3, 2)).toBe(true);
    expect(forcedWinnerApplies("maze", 3, 3)).toBe(false);
    expect(forcedWinnerApplies("maze", 1, 0)).toBe(false);
    expect(availableOutcomes("maze", { endless: false, neverEscape: false, ballCount: 3 })).toEqual(["duration", "winner"]);
    expect(availableOutcomes("maze", { endless: false, neverEscape: false, ballCount: 1 })).toEqual(["duration"]);
    expect(runNeverFinishes("maze", { drop: {}, box: {} })).toBe(false);
    expect(effectiveBallCount({ ...defaultSettings("maze"), mzBalls: 5 })).toBe(5);
    expect(effectiveBallCount({ ...defaultSettings("maze"), mzBalls: 8 })).toBe(6); // six of them are teams
    expect(effectiveBallCount({ ...defaultSettings("classic"), mzBalls: 5 })).toBe(1);
    expect(mazeForcedWinner(2, 3)).toBe(2);
    expect(mazeForcedWinner(6, 8)).toBe(-1); // the seventh ball is no team
    expect(mazeForcedWinner(0, 1)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ the mode in the engine */

describe("the maze in the engine", () => {
  it("builds the maze, queues the balls in the chute and drops them in one after another", () => {
    const engine = engineFor({ balls: 4 }, 3);
    const view = engine.getMazeView();
    expect(view.grid.cols).toBe(12);
    expect(view.grid.rows).toBe(17);
    expect(view.count).toBe(4);
    expect(engine.getBalls()).toHaveLength(4);
    const f = view.field;
    for (const b of engine.getBalls()) {
      expect(b.y).toBeLessThan(f.top);
      expect(b.gravityScale).toBe(0);
    }
    expect(engine.getBalls().map((b) => b.team)).toEqual([0, 1, 2, 3]);
    run(engine, 200);
    expect(view.runners[0].released).toBe(true);
    expect(view.runners[3].released).toBe(false);
    run(engine, 1200);
    expect(view.runners.every((r) => r.released)).toBe(true);
    expect(view.runners.some((r) => r.row >= 0)).toBe(true);
    expect(view.paintCount).toBeGreaterThan(0);
    expect(view.paint[1]).toBe(-1); // the first stroke comes from the chute
    expect(view.visitedCells).toBeGreaterThan(0);
  });

  it("keeps every ball inside the maze at any speed, pull, size and canvas", { timeout: 30_000 }, () => {
    const cases: [Partial<MazeSettings>, Partial<PhysicsConfig>][] = [
      [{ cols: 40, speed: 3, gravity: 1, brain: "bounce", balls: 8 }, { width: 800, height: 600, ballRadius: 30 }],
      [{ cols: 40, speed: 3, gravity: 1, brain: "explorer", balls: 8 }, { width: 360, height: 900, ballRadius: 30 }],
      [{ cols: 6, speed: 3, gravity: 1, brain: "bounce", balls: 8 }, { width: 1920, height: 1080, ballRadius: 30 }],
      [{ cols: 25, speed: 3, gravity: 0, brain: "wallFollow", balls: 8 }, { width: 300, height: 300, ballRadius: 4 }],
      [{ cols: 9, speed: 2.5, gravity: 1, brain: "bounce", balls: 5 }, { width: 1080, height: 1920, ballRadius: 30, windX: 0.5, windY: 0.5 }],
    ];
    for (const [maze, patch] of cases) {
      const engine = engineFor({ ...maze, duration: 180 }, 17, patch);
      const view = engine.getMazeView();
      const f = view.field;
      let outside = 0;
      let checked = 0;
      run(engine, 15_000, () => {
        for (const b of engine.getBalls()) {
          const r = view.runners[b.id - view.runners[0].id];
          if (r.exited) continue;
          checked++;
          const inMaze = b.x >= f.left && b.x <= f.left + f.width && b.y >= f.top && b.y <= f.top + f.height;
          const x0 = f.left + view.grid.entranceCol * f.cell;
          const inChute = b.x >= x0 && b.x <= x0 + f.cell && b.y >= f.top - f.cell && b.y <= f.top;
          if (!inMaze && !inChute) outside++;
          // never inside a wall: the centre is at least the contact distance from the cell's closed edges
          if (inMaze) {
            const col = Math.floor((b.x - f.left) / f.cell);
            const row = Math.floor((b.y - f.top) / f.cell);
            const reach = b.radius + f.wall / 2 - 1e-6;
            const cell = row * view.grid.cols + col;
            const x = b.x - (f.left + col * f.cell);
            const y = b.y - (f.top + row * f.cell);
            const slack = reach - MZ_MICRO_STEP * reach; // at most one micro-step into a wall before the next push-out
            if (col === r.col && row === r.row && cell !== view.grid.entranceCell && cell !== view.grid.exitCell) {
              if (!(view.grid.open[cell] & MZ_BIT[MZ_W]) && x < slack) outside++;
              if (!(view.grid.open[cell] & MZ_BIT[MZ_E]) && f.cell - x < slack) outside++;
              if (!(view.grid.open[cell] & MZ_BIT[MZ_N]) && y < slack) outside++;
              if (!(view.grid.open[cell] & MZ_BIT[MZ_S]) && f.cell - y < slack) outside++;
            }
          }
        }
      });
      expect(checked).toBeGreaterThan(100);
      expect(outside).toBe(0);
      expect(view.leaks).toBe(0);
    }
  });

  it("replays a seed exactly: positions, notes, paint and the verdict", { timeout: 30_000 }, () => {
    const trace = (seed: number) => {
      const engine = engineFor({ balls: 4, brain: "explorer" }, seed);
      const events = run(engine, 40_000);
      const view = engine.getMazeView();
      return {
        balls: engine.getBalls().map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]),
        notes: events.filter((e) => e.type === "hit").map((e) => Math.round(e.frequency ?? 0)),
        paint: view.paintCount,
        winner: view.winner,
        verdictMs: view.verdictMs,
        places: view.runners.map((r) => r.place),
        maze: [...view.grid.open],
      };
    };
    const a = trace(31);
    expect(trace(31)).toEqual(a);
    expect(trace(32)).not.toEqual(a);
  });

  it("plays a note per wall hit whose pitch follows the cell's distance to the exit", () => {
    const engine = engineFor({ balls: 1, brain: "wallFollow" }, 5);
    const view = engine.getMazeView();
    const pitches: { f: number; d: number }[] = [];
    for (let t = 0; t < 60_000 && !engine.isSimulationFinished(); t += 1000 / 60) {
      engine.update(1000 / 60, 0);
      for (const e of engine.consumeSoundEvents()) if (e.type === "hit" && !e.accent) pitches.push({ f: e.frequency ?? 0, d: view.runners[0].dist });
    }
    expect(pitches.length).toBeGreaterThan(10);
    const ladder = Array.from({ length: MZ_NOTE_STEPS }, (_, k) => midiToFrequency(mazeNoteMidi(k)));
    for (const p of pitches) expect(ladder.some((f) => Math.abs(f - p.f) < 1e-6)).toBe(true);
    // Near the exit the notes are higher than near the entrance.
    const near = pitches.filter((p) => p.d <= view.entranceDist / 4).map((p) => p.f);
    const far = pitches.filter((p) => p.d >= (3 * view.entranceDist) / 4).map((p) => p.f);
    if (near.length && far.length) expect(Math.min(...near)).toBeGreaterThan(Math.max(...far));
    expect(view.notes).toBe(pitches.length);
  });

  it("the first ball out wins – an escape in the team stats, the wall-break sound – and the run finishes after the hold", { timeout: 30_000 }, () => {
    const engine = engineFor({ balls: 3, brain: "wallFollow" }, 8);
    const view = engine.getMazeView();
    const events = run(engine, 120_000);
    expect(view.verdict).toBe("exit");
    expect(view.winner).toBeGreaterThanOrEqual(0);
    expect(view.runners[view.winner].place).toBe(1);
    expect(events.filter((e) => e.type === "gap")).toHaveLength(1);
    const stats = engine.getTeamStats();
    expect(stats[view.winner].escapes).toBe(1);
    expect(stats.slice(0, 3).reduce((n, s) => n + s.escapes, 0)).toBe(1);
    expect(teamResult(stats, 3).winner).toBe(view.winner);
    expect(view.finished).toBe(true);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(view.finishedMs - view.endMs).toBeGreaterThanOrEqual(MZ_FINISH_HOLD_MS);
    // Wall followers always get out: every ball is out, the exited balls left the engine.
    expect(view.exited).toBe(3);
    expect(view.runners.map((r) => r.place).sort()).toEqual([1, 2, 3]);
    expect(engine.getBalls()).toHaveLength(0);
    expect(view.slowMos).toBe(1);
  });

  it("at the clip limit with nobody out the ball nearest the exit wins", () => {
    const engine = engineFor({ balls: 3, brain: "bounce", gravity: 0, cols: 30, duration: 10 }, 12);
    const view = engine.getMazeView();
    run(engine, 30_000);
    expect(view.verdict).toBe("time");
    expect(view.endMs).toBeGreaterThanOrEqual(10_000);
    expect(view.endMs).toBeLessThan(10_100);
    const best = Math.min(...view.runners.map((r) => r.dist));
    expect(view.runners[view.winner].dist).toBe(best);
    expect(engine.getTeamStats()[view.winner].escapes).toBe(1);
    expect(view.finished).toBe(true);
  });

  it("the rig: the forced winner wins every seed, the exit sealed to the others until it is out", { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 8; seed++) {
      const engine = engineFor({ balls: 4, brain: "explorer" }, seed, { forcedWinner: 2 });
      const view = engine.getMazeView();
      expect(view.forcedWinner).toBe(2);
      run(engine, 120_000);
      expect(view.winner).toBe(2);
      expect(view.verdict).toBe("exit");
      expect(teamResult(engine.getTeamStats(), 4).winner).toBe(2);
    }
    // Off with one ball, or a slot beyond the balls.
    expect(engineFor({ balls: 1 }, 1, { forcedWinner: 0 }).getMazeView().forcedWinner).toBe(-1);
    expect(engineFor({ balls: 3 }, 1, { forcedWinner: 4 }).getMazeView().forcedWinner).toBe(-1);
  });

  it("keeps the balls in their cells through a canvas resize", () => {
    const engine = engineFor({ balls: 5, brain: "explorer" }, 4);
    const view = engine.getMazeView();
    run(engine, 4000);
    const before = view.runners.map((r) => [r.col, r.row]);
    engine.setConfig({ width: 500, height: 900 });
    const f = view.field;
    expect(f.side).toBe(500);
    for (const b of engine.getBalls()) {
      const r = view.runners[b.id - view.runners[0].id];
      if (r.exited) continue;
      expect(Math.floor((b.x - f.left) / f.cell)).toBe(r.col);
      expect(Math.floor((b.y - f.top) / f.cell)).toBe(r.row);
    }
    expect(view.runners.map((r) => [r.col, r.row])).toEqual(before);
    run(engine, 4000);
    expect(view.leaks).toBe(0);
  });

  it("a new init builds a new maze and starts over", () => {
    const engine = engineFor({ balls: 2 }, 3);
    const view = engine.getMazeView();
    const generation = view.generation;
    run(engine, 5000);
    engine.setMazeSettings({ cols: 20, balls: 5 });
    engine.initMode("maze");
    expect(view.generation).toBe(generation + 1);
    expect(view.grid.cols).toBe(20);
    expect(view.count).toBe(5);
    expect(view.paintCount).toBe(0);
    expect(view.verdict).toBe("");
    expect(engine.getBalls()).toHaveLength(5);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("Find Simulation", () => {
  const request = (patch: Partial<FinderRequest> = {}): FinderRequest => ({
    targetDurationSec: 30,
    toleranceSec: 0.5,
    maxSeeds: 40,
    maxSimTimeSec: 120,
    physicsConfig: config,
    mode: "maze",
    modeSettings: { ...modeSettings, maze: {} },
    ...patch,
  });

  it("replays a seed's length exactly and finds a run of a given length", { timeout: 60_000 }, async () => {
    const len = simulateSeed(99, request(), 120_000);
    expect(simulateSeed(99, request(), 120_000)).toBe(len);
    expect(len).toBeLessThanOrEqual(1000 * DEFAULT_MAZE_SETTINGS.duration + MZ_FINISH_HOLD_MS + 20);
    const target = Math.round(len / 1000);
    const found = await withFrames(() => findSimulation(request({ targetDurationSec: target, toleranceSec: 2 }), () => undefined));
    expect(found.found).toBe(true);
    expect(Math.abs(simulateSeed(found.seed, request(), 120_000) / 1000 - target)).toBeLessThanOrEqual(2);
  });

  it("judges the winner outcome by the first ball out, one team per ball", () => {
    const outcome = { kind: "winner" as const, clipSec: 30, team: 0 };
    const runOf = simulateOutcomeRun(6, request(), outcome);
    expect(runOf.teams).toHaveLength(3);
    const engine = createEngineForSettings(config, "maze", { ...modeSettings, maze: {} }, 6);
    run(engine, 200_000);
    const winner = engine.getMazeView().winner;
    const won = simulateOutcomeRun(6, request(), { ...outcome, team: winner });
    expect(won.finished).toBe(true);
    expect(outcomeMatches({ ...outcome, team: winner }, won)).toBe(true);
    const lost = simulateOutcomeRun(6, request(), { ...outcome, team: (winner + 1) % 3 });
    expect(outcomeMatches({ ...outcome, team: (winner + 1) % 3 }, lost)).toBe(false);
  });

  it("finds a seed where the chosen ball wins – and the rig makes it the first seed", { timeout: 60_000 }, async () => {
    const outcome = { kind: "winner" as const, clipSec: 30, team: 1 };
    const found = await withFrames(() => findSimulation(request({ outcome }), () => undefined));
    expect(found.found).toBe(true);
    const engine = createEngineForSettings(config, "maze", { ...modeSettings, maze: {} }, found.seed);
    run(engine, 200_000);
    expect(engine.getMazeView().winner).toBe(1);
    const rigged = await withFrames(() => findSimulation(request({ outcome: { ...outcome, team: 2 }, physicsConfig: { ...config, forcedWinner: 2 } }), () => undefined));
    expect(rigged.found).toBe(true);
    expect(rigged.seedsTested).toBe(1);
  });
});
