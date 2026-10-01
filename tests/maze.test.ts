import { describe, expect, it } from "vitest";
import {
  MZ_BALL_FRACTION,
  MZ_BIT,
  MZ_E,
  MZ_GAP_ENTRANCE,
  MZ_GAP_EXIT,
  MZ_MAX_WALL_FRACTION,
  MZ_MICRO_STEP,
  MZ_MIN_WALL,
  MZ_N,
  MZ_OPPOSITE,
  MZ_S,
  MZ_W,
  MZ_WALL_FRACTION,
  buildMazeField,
  carveMaze,
  emptyMazeContact,
  explorerChoice,
  explorerExhausted,
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
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateOutcomeRun, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeMatches } from "@/lib/simulation/outcomes";
import { slowViewEligible } from "@/lib/simulation/camera";
import { effectiveBallCount, teamResult } from "@/lib/teams";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MEMORY_CEILINGS } from "@/lib/uncap"; // --- uncap-all ---
import { liveWorldOf } from "@/lib/simulation/world";

/**
 * Maze escape (lib/physics/mazeGrid.ts, lib/physics/modes/maze.ts; feature odd-maze): the seeded perfect maze (n − 1
 * passages, connected, deterministic), its BFS distance map, the cell collision (one-sided edges, posts, the gaps), the
 * brains' choices, the settings (resolve, URL, presets), and the mode in the engine: containment at any speed and canvas
 * size, determinism, the notes rising toward the exit, the winner (first out, the clip limit's nearest), the rig and the
 * finder (duration and winner).
 *
 * The runs play in the worlds the page simulates (lib/simulation/world.ts): 800 × 450 in a 16:9 frame – the default here –
 * and 450 × 450 in a phone's square one. The maze sits in the world's 450 px square, so the columns' ceiling makes cells of
 * 1.26 px there (a bigger test canvas hid corridors narrower than a ball).
 */

/** The page's worlds: a 16:9 frame's and a square frame's (world px). */
const WIDE = liveWorldOf({ width: 1600, height: 900 });
const SQUARE = liveWorldOf({ width: 900, height: 900 });
const WORLDS = [WIDE, SQUARE].map(({ width, height }) => ({ width, height }));

const config: PhysicsConfig = {
  width: WIDE.width,
  height: WIDE.height,
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

  it("keeps every corridor wider than a ball in the page's worlds, up to the columns' memory-safety ceiling", () => {
    // The maze sits in the world's 450 px square: a cell is 252 / cols px. With a 1 px wall and a 0.5 px ball the contact
    // distance (radius + half the wall) outgrew half a cell from about 116 columns on, and no ball got out of the chute.
    const share = MZ_BALL_FRACTION + MZ_MAX_WALL_FRACTION / 2;
    for (const world of WORLDS) {
      for (const cols of [6, 12, 40, 50, 51, 80, 116, 150, MEMORY_CEILINGS.mzCols]) {
        const f = buildMazeField(world.width, world.height, cols, mazeRowsFor(cols));
        expect(f.side).toBe(450);
        for (const size of [0.01, 0.5, 8, 30, 1e6]) {
          const contact = mazeBallRadius(size, f.cell) + f.wall / 2;
          expect(contact, `${world.width}×${world.height}, ${cols} columns, Ball Size ${size}`).toBeLessThanOrEqual(share * f.cell + 1e-9);
          expect(2 * contact).toBeLessThan(f.cell);
          expect(mazeBallRadius(size, f.cell)).toBeGreaterThan(0);
        }
        // Nothing changes where the pixel minimums fit (up to about 50 columns): the wall and the ball as before.
        if (cols <= 50) {
          expect(f.wall).toBe(Math.max(MZ_MIN_WALL, MZ_WALL_FRACTION * f.cell));
          expect(mazeBallRadius(8, f.cell)).toBe(Math.max(0.5, Math.min(8, MZ_BALL_FRACTION * f.cell)));
        }
      }
    }
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

  it("the explorer has run out only at the root of its search with every open neighbour explored and no exit in sight", () => {
    const all = new Uint8Array(grid.cells).fill(1);
    const none = new Uint8Array(grid.cells);
    const c = grid.entranceCell;
    const mask = mazeExitsOf(grid, c, true);
    const open = [MZ_N, MZ_E, MZ_S, MZ_W].find((k) => mask & MZ_BIT[k])!;
    expect(explorerExhausted(grid, c, mask, all, -1)).toBe(true); // the root, everything explored: start over
    expect(explorerExhausted(grid, c, mask, all, open)).toBe(false); // a previous cell to go back to
    expect(explorerExhausted(grid, c, mask, none, -1)).toBe(false); // something left to explore
    // At the exit cell with the exit open it is never out of options; with the rig's seal it may be.
    const exitMask = mazeExitsOf(grid, grid.exitCell, true);
    expect(explorerExhausted(grid, grid.exitCell, exitMask, all, -1)).toBe(false);
    expect(explorerExhausted(grid, grid.exitCell, mazeExitsOf(grid, grid.exitCell, false), all, -1)).toBe(true);
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

  it("resolve: the minimums, no maximum (the memory-safety ceilings for what a run builds), values on their steps, bad values dropped", () => {
    expect(resolveMazeSettings({ cols: 99, balls: 0, gravity: 1.7, speed: 0.01, trail: -1, fog: 2, duration: 1000 })).toMatchObject({ cols: 99, balls: 1, gravity: 1.7, speed: 0.25, trail: 0, fog: 2, duration: 1000 });
    expect(resolveMazeSettings({ cols: 1e9, balls: 1e9, gravity: 1e9, speed: 1e9, trail: 1e9, fog: 1e9, duration: 1e9 })).toMatchObject({ cols: MEMORY_CEILINGS.mzCols, balls: MEMORY_CEILINGS.mzBalls, gravity: 1e9, speed: 1e9, trail: 1e9, fog: 1e9, duration: 1e9 });
    expect(resolveMazeSettings({ cols: Infinity, speed: Number.NaN, duration: -5 })).toMatchObject({ cols: DEFAULT_MAZE_SETTINGS.cols, speed: DEFAULT_MAZE_SETTINGS.speed, duration: 10 });
    expect(resolveMazeSettings({ cols: 12.6, gravity: 0.333, speed: 1.234, duration: 42 })).toMatchObject({ cols: 13, gravity: 0.35, speed: 1.25, duration: 40 });
    const junk = { brain: "genius", hand: "both", trailColor: "red", wallColor: "#12345", trailOwn: "yes", badge: 1, hud: null, cols: "many" } as unknown as Partial<MazeSettings>;
    expect(resolveMazeSettings(junk)).toEqual(DEFAULT_MAZE_SETTINGS);
    expect(resolveMazeSettings({ trailColor: "#ABCDEF" }).trailColor).toBe("#abcdef");
  });

  it("round-trip through the URL and presets; bad values fall back, big ones are kept", () => {
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
    expect(mazeSettingsOf(bad)).toEqual({ ...DEFAULT_MAZE_SETTINGS, cols: 6, balls: 50, gravity: 9, speed: 0.25, duration: 10 });
    // (uncap-all: the link keeps the typed 50 balls; the run builds its memory-safety ceiling)
    expect(resolveMazeSettings(mazeSettingsOf(bad)).balls).toBe(MEMORY_CEILINGS.mzBalls);
    const loaded = presetToSettings({ mode: "maze", mzCols: 100, mzBrain: "bounce", mzFog: "thick", mzTrailOwn: "on" } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(mazeSettingsOf(loaded)).toMatchObject({ cols: 100, brain: "bounce", fog: 0, trailOwn: false });
  });

  it("registers the mode: its id, its card after the String Battle and Territory, the battle family, the camera, the rig and the finder", () => {
    expect(MODE_IDS).toContain("maze");
    expect(MODE_CARD_ORDER.indexOf("maze")).toBe(MODE_CARD_ORDER.indexOf("territory") + 1); // (--- odd-territory --- Territory follows the String Battle)
    expect(modesInCategory("battle").slice(0, 3)).toEqual(["stringBattle", "territory", "maze"]);
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
      // The columns' ceiling in the page's worlds: cells of 1.26 px, a ball of any size still fits its corridor.
      [{ cols: MEMORY_CEILINGS.mzCols, speed: 3, gravity: 1, brain: "bounce", balls: 8 }, { ...WORLDS[0], ballRadius: 30 }],
      [{ cols: 150, speed: 1, gravity: 0.35, brain: "explorer", balls: 8 }, { ...WORLDS[1], ballRadius: 0.1 }],
      // The slowest speed under the strongest pull: the steering's climb runs past MZ_MAX_SPEED × the cruising speed.
      [{ cols: 6, speed: 0.25, gravity: 1, brain: "wallFollow", balls: 8 }, { ...WORLDS[0], ballRadius: 30 }],
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

  it("a bounce-math pitch rule shifts the ball's notes (an octave up: every note on the ladder × 2)", () => {
    const engine = engineFor({ balls: 1, brain: "wallFollow" }, 5);
    const ladder = Array.from({ length: MZ_NOTE_STEPS }, (_, k) => midiToFrequency(mazeNoteMidi(k)));
    const notes: number[] = [];
    for (let t = 0; t < 20_000 && !engine.isSimulationFinished(); t += 1000 / 60) {
      for (const b of engine.getBalls()) b.pitchShift = 12;
      engine.update(1000 / 60, 0);
      for (const e of engine.consumeSoundEvents()) if (e.type === "hit" && !e.accent) notes.push(e.frequency ?? 0);
    }
    expect(notes.length).toBeGreaterThan(5);
    for (const f of notes) expect(ladder.some((l) => Math.abs(2 * l - f) < 1e-6)).toBe(true);
  });

  it("uncap-all: runs past its sliders as typed whatever the Wide sliders switch – the columns and the balls up to their memory-safety ceilings", { timeout: 60_000 }, () => {
    const big = { cols: 1e9, balls: 1e9, speed: 1e9, gravity: 1e9, duration: 1e12, trail: 5, fog: 5 };
    expect(resolveMazeSettings(big)).toMatchObject({ cols: MEMORY_CEILINGS.mzCols, balls: MEMORY_CEILINGS.mzBalls, speed: 1e9, gravity: 1e9, duration: 1e12, trail: 5, fog: 5 });
    expect(resolveMazeSettings({ cols: 43, balls: 11 })).toMatchObject({ cols: 43, balls: 11 });
    // The page keeps the typed values (links and presets carry them exactly), whatever the switch; the run builds the ceilings.
    const typed = { mzCols: 1e9, mzBalls: 1e9, mzSpeed: 1e9, mzGravity: 1e9, mzDuration: 1e9, mzTrail: 5, mzFog: 5 };
    for (const unlimited of [false, true]) {
      const s = presetToSettings({ ...defaultSettings("maze"), unlimited, ...typed });
      expect([unlimited, s.unlimited]).toEqual([unlimited, unlimited]);
      expect(s).toMatchObject(typed);
      expect(pastAnyMemoryCeiling(s)).toBe(true);
      expect(settingsFromSearchParams(settingsToSearchParams(s))).toMatchObject(typed);
      expect(resolveMazeSettings(mazeSettingsOf(s))).toMatchObject({ cols: MEMORY_CEILINGS.mzCols, balls: MEMORY_CEILINGS.mzBalls, speed: 1e9, gravity: 1e9, duration: 1e9, trail: 5, fog: 5 });
    }
    expect(pastAnyMemoryCeiling(defaultSettings("maze"))).toBe(false);
    // A race of 32 explorers in a maze of the columns' ceiling, in the page's worlds (the maze in their 450 px square:
    // cells of 1.26 px): every ball gets in, explores and paints (a bit each in the paint masks), each cell and passage
    // at most once per ball, and nothing goes through a wall.
    for (const world of WORLDS) {
      const where = `${world.width}×${world.height}`;
      const engine = engineFor({ cols: 1e9, balls: 1e9, brain: "explorer" }, 3, world);
      const view = engine.getMazeView();
      expect(view.grid.cols).toBe(MEMORY_CEILINGS.mzCols);
      expect(view.count).toBe(MEMORY_CEILINGS.mzBalls);
      run(engine, 12_000); // (the last of the 32 drops in after 31 × MZ_RELEASE_MS)
      const painters = new Set<number>();
      for (let i = 0; i < view.paintCount; i++) painters.add(view.paint[3 * i + 2]);
      expect(painters.size, where).toBe(MEMORY_CEILINGS.mzBalls);
      expect(view.runners.filter((r) => r.entered).length, where).toBe(MEMORY_CEILINGS.mzBalls);
      expect(Math.min(...view.runners.map((r) => r.visited)), `${where}: cells the least travelled ball visited`).toBeGreaterThanOrEqual(50);
      expect(view.paintCount).toBeLessThanOrEqual(MEMORY_CEILINGS.mzBalls * 2 * view.grid.cells);
      expect(view.leaks).toBe(0);
    }
    // An absurd pull and speed melt (the balls slow down in their cells) but never leave the maze – an absurd pull at an
    // ordinary speed too (its climb speed is far past MZ_MAX_SPEED × the cruising speed).
    for (const world of WORLDS) {
      for (const [speed, gravity, brain] of [[1e9, 1e9, "bounce"], [1, 1e9, "explorer"]] as const) {
        const wild = engineFor({ speed, gravity, balls: 4, brain }, 5, world);
        run(wild, 3_000);
        expect(wild.getMazeView().leaks).toBe(0);
        for (const b of wild.getBalls()) expect([b.x, b.y, b.vx, b.vy].every(Number.isFinite)).toBe(true);
      }
    }
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

  it("explorers never get stuck: every one of them gets out (a fresh search when one has run out at its root)", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const gravity of [0, 0.35, 1]) {
        const engine = engineFor({ balls: 3, brain: "explorer", gravity, duration: 180 }, seed);
        const view = engine.getMazeView();
        run(engine, 200_000);
        expect(view.exited, `seed ${seed}, pull ${gravity}`).toBe(3);
        expect(view.verdict).toBe("exit");
        expect(view.endMs, `seed ${seed}, pull ${gravity}`).toBeLessThan(180_000);
      }
    }
  });

  it("explorers climb against the strongest pull at the slowest speed: the speed caps admit the climb (Speed 0.25, Pull 1)", { timeout: 60_000 }, () => {
    // There the speed that lifts a steered ball one cell against the pull is more than MZ_MAX_SPEED × its cruising speed
    // (12 columns: 181 px/s against a cap of 156). Capped, the explorers bounced at the foot of every upward corridor: a ball
    // got out of 3 of 12 six-column mazes within the clip, and of 2 of 12 default ones within 180 s.
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineFor({ cols: 6, balls: 3, brain: "explorer", speed: 0.25, gravity: 1 }, seed);
      const view = engine.getMazeView();
      run(engine, 70_000);
      expect(view.verdict, `6 columns, seed ${seed}`).toBe("exit");
      expect(view.leaks).toBe(0);
    }
    let out = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineFor({ balls: 3, brain: "explorer", speed: 0.25, gravity: 1, duration: 180 }, seed);
      run(engine, 190_000);
      if (engine.getMazeView().verdict === "exit") out++;
      expect(engine.getMazeView().leaks).toBe(0);
    }
    // (10 of 12 – as many as at that speed's default Pull of 0.35)
    expect(out, "default mazes a ball got out of within 180 s").toBeGreaterThanOrEqual(9);
  });

  it("the rig: at the clip limit the forced winner takes the verdict even when another ball is nearer the exit", () => {
    for (const seed of [1, 2, 3]) {
      const engine = engineFor({ balls: 3, brain: "bounce", cols: 40, speed: 0.25, gravity: 0, duration: 10 }, seed, { forcedWinner: 1 });
      const view = engine.getMazeView();
      run(engine, 30_000);
      expect(view.verdict).toBe("time");
      expect(view.winner).toBe(1);
      expect(teamResult(engine.getTeamStats(), 3).winner).toBe(1);
    }
  });

  it("a ball past the six teams can win the race – no team is credited with its escape", { timeout: 60_000 }, () => {
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const engine = engineFor({ balls: 8, brain: "wallFollow", duration: 180 }, seed);
      const view = engine.getMazeView();
      run(engine, 200_000);
      expect(view.verdict).toBe("exit");
      const escapes = engine.getTeamStats().reduce((n, s) => n + s.escapes, 0);
      if (view.winner >= 6) {
        found = true;
        expect(view.teamCount).toBe(6);
        expect(escapes).toBe(0);
        expect(view.runners[view.winner].team).toBe(-1);
      } else expect(escapes).toBe(1);
    }
    expect(found).toBe(true);
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
