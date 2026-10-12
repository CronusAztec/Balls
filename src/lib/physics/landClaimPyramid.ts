import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { degreeToMidi, scalarDegree } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- land-claim-pyramid --- Land Claim's pyramid layout (the loop family's "1,144 blocks, 146 balls, and the summit goes last"):
 * the Land Claim rule – every ball that hits a column knocks its top block off, every eighth block knocked off adds another
 * ball – on a height map instead of the arena's wall. A G × G grid of columns stands in the middle of a square floor; a column's
 * height is `steps` minus its Chebyshev distance to the centre (a stepped pyramid, a ziggurat), scaled so the pyramid holds
 * exactly `blocks` blocks when that is set (1,144 by default: 11 × 11 columns, six steps of four blocks). The physics is top
 * down – every column with a block left is a square obstacle on the floor, a hit takes its top block (it flies off in the
 * hitter's colour) and a column knocked bare is floor again – and the canvas shows it isometrically
 * (components/simulator/landClaimPyramidRenderer.ts). The outer steps go first and the summit last – the payoff.
 *
 * This module is pure: the settings (URL keys lcl, lcg, lcs, lcbk, lcrb, lcrs), the presets, the height map, the floor and its
 * contacts, the start places, the pitch rule, the layer palette, the rebuild's maths and the run's view. The stepping lives in
 * `LandClaimMode` (lib/physics/modes/landClaim.ts, its `--- land-claim-pyramid ---` block); every random choice of a pyramid run
 * comes from the run's own generator (`LcpRandom`), seeded once from `ctx.random()` at init, so a seed replays exactly and the
 * loop's seam can start the run over from its first frame.
 *
 * Rebuild and loop (`rebuild`): when the last block falls – or the duration runs out – the run holds `LCP_HOLD_SEC` (the summit's
 * payoff and the cleared chord), then rebuilds over `rebuildSec`: the columns grow back from the floor (the outer steps reach
 * their height first, the summit last), the balls that were added melt back into the pyramid and the starting balls glide
 * back to their corners. The seam – the first step at or after the rebuild's end – restores the run's first frame exactly
 * (the generator rewound), so every cycle replays the first and a clip of whole cycles loops forever (the loop contract).
 */

/* ------------------------------------------------------------------ settings */

export const LC_LAYOUTS = ["wall", "pyramid"] as const;
export type LcLayout = (typeof LC_LAYOUTS)[number];

export function isLcLayout(value: unknown): value is LcLayout {
  return typeof value === "string" && (LC_LAYOUTS as readonly string[]).includes(value);
}

/** The pyramid's settings (part of LandClaimSettings). */
export interface LcPyramidSettings {
  /** wall (the arena's wall of columns – the default, so old runs replay) | pyramid (a stepped pyramid in the middle of a floor). */
  layout: LcLayout;
  /** Columns along a side of the grid (G), 3–40 on the slider, any number from 3 typed (at most `LCP_SIZE_CEILING`). */
  pyramidSize: number;
  /** Steps of the natural pyramid: a column stands `steps` − its Chebyshev distance to the centre (1–40, any number from 1). */
  steps: number;
  /** Blocks in all: the natural heights scaled to exactly this many; 0 = the natural count (at most `LCP_BLOCK_CEILING`). */
  blocks: number;
  /** Rebuild and loop: the pyramid builds itself again and the run starts over from its first frame (a seamless loop). */
  rebuild: boolean;
  /** Seconds the rebuild lasts (0.5–8 on the slider, any number from 0.1). */
  rebuildSec: number;
}

export const DEFAULT_LC_PYRAMID_SETTINGS: LcPyramidSettings = {
  layout: "wall",
  pyramidSize: 11,
  steps: 6,
  blocks: 1144,
  rebuild: false,
  rebuildSec: 2.5,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names; a value past a slider is kept as typed. */
export const LC_PYRAMID_RANGES = {
  lcPyramidSize: { min: 3, max: 40, step: 1 },
  lcSteps: { min: 1, max: 40, step: 1 },
  lcBlocks: { min: 0, max: 5000, step: 1 },
  lcRebuildSec: { min: 0.1, max: 8, step: 0.1 },
} as const;

/** The competitors of a pyramid: from one (the clip plays one colour) – the wall's battles start at two. */
export const LCP_TEAMS_RANGE = { min: 1, max: 12, step: 1 } as const;

/**
 * Memory-safety ceilings (`MEMORY_CEILINGS` of lib/uncap.ts names them; a test keeps them equal): the grid's side (a cell is a
 * few numbers – 1,000 × 1,000 is a million cells) and the blocks in all (`LC_BLOCK_CEILING` of the wall: a natural pyramid
 * past it is scaled down to it).
 */
export const LCP_SIZE_CEILING = 1_000;
export const LCP_BLOCK_CEILING = 1_000_000;

/** The pyramid's fields of the SimulatorSettings object (URL keys lcl, lcg, lcs, lcbk, lcrb, lcrs). */
export interface LcPyramidSettingFields {
  lcLayout: LcLayout;
  lcPyramidSize: number;
  lcSteps: number;
  lcBlocks: number;
  lcRebuild: boolean;
  lcRebuildSec: number;
}

/** A typed number: a finite value lifted onto the slider's minimum – never held to its maximum (uncap-all) –, else `fallback`. */
function typedNumber(value: unknown, range: { min: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) : fallback;
}

/**
 * Validates the pyramid's settings into `out` (the defaults when absent): whole counts, the grid and the blocks at their
 * memory-safety ceilings, a value below its slider lifted onto it, a value past it kept; an unknown layout and a non-boolean
 * switch fall back.
 */
export function resolveLcPyramidSettings(config: Partial<Record<keyof LcPyramidSettings, unknown>> | null | undefined, out: LcPyramidSettings = { ...DEFAULT_LC_PYRAMID_SETTINGS }): LcPyramidSettings {
  if (!config) return out;
  const R = LC_PYRAMID_RANGES;
  if (isLcLayout(config.layout)) out.layout = config.layout;
  if (config.pyramidSize !== undefined) out.pyramidSize = memoryCeiling("lcPyramidSize", Math.round(typedNumber(config.pyramidSize, R.lcPyramidSize, out.pyramidSize)));
  if (config.steps !== undefined) out.steps = Math.round(typedNumber(config.steps, R.lcSteps, out.steps));
  if (config.blocks !== undefined) out.blocks = memoryCeiling("lcBlocks", Math.round(typedNumber(config.blocks, R.lcBlocks, out.blocks)));
  if (typeof config.rebuild === "boolean") out.rebuild = config.rebuild;
  if (config.rebuildSec !== undefined) out.rebuildSec = typedNumber(config.rebuildSec, R.lcRebuildSec, out.rebuildSec);
  return out;
}

/** The pyramid's settings of a bigger object (the SimulatorSettings, a preset) – raw, `resolveLcPyramidSettings()` validates them. */
export function lcPyramidSettingsOf(source: LcPyramidSettingFields): LcPyramidSettings {
  return { layout: source.lcLayout, pyramidSize: source.lcPyramidSize, steps: source.lcSteps, blocks: source.lcBlocks, rebuild: source.lcRebuild, rebuildSec: source.lcRebuildSec };
}

/** Resolved settings in the SimulatorSettings field names. */
export function lcPyramidSettingFields(settings: LcPyramidSettings): LcPyramidSettingFields {
  return { lcLayout: settings.layout, lcPyramidSize: settings.pyramidSize, lcSteps: settings.steps, lcBlocks: settings.blocks, lcRebuild: settings.rebuild, lcRebuildSec: settings.rebuildSec };
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const LCP_URL_KEYS = { lcg: "lcPyramidSize", lcs: "lcSteps", lcbk: "lcBlocks", lcrs: "lcRebuildSec" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: lcl, lcg, lcs, lcbk, lcrb and lcrs. */
export function writeLcPyramidParams(settings: LcPyramidSettingFields, base: LcPyramidSettingFields, params: URLSearchParams) {
  if (settings.lcLayout !== base.lcLayout) params.set("lcl", settings.lcLayout);
  for (const [key, field] of Object.entries(LCP_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.lcRebuild !== base.lcRebuild) params.set("lcrb", settings.lcRebuild ? "1" : "0");
}

/** Reads the pyramid's URL parameters into `next` (raw: the Land Claim resolver validates them; an unknown layout is left out). */
export function readLcPyramidParams(params: URLSearchParams, next: Partial<LcPyramidSettingFields>) {
  const layout = params.get("lcl");
  if (isLcLayout(layout)) next.lcLayout = layout;
  for (const [key, field] of Object.entries(LCP_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const rebuild = params.get("lcrb");
  if (rebuild === "1") next.lcRebuild = true;
  else if (rebuild === "0") next.lcRebuild = false;
}

/** Whether a run of these settings loops (the pyramid with Rebuild and loop on): it never finishes, and Find Simulation searches its first cycle. */
export function lcPyramidLoops(settings: Pick<LcPyramidSettings, "layout" | "rebuild">): boolean {
  return settings.layout === "pyramid" && settings.rebuild;
}

/* ------------------------------------------------------------------ presets */

export const LCP_PRESET_IDS = ["pyramid1144"] as const;
export type LcpPresetId = (typeof LCP_PRESET_IDS)[number];

export function isLcpPresetId(value: unknown): value is LcpPresetId {
  return typeof value === "string" && (LCP_PRESET_IDS as readonly string[]).includes(value);
}

/** The page of the clip: a dark navy background (#0b1020), the loop HUD's title and grey counter, no drama layer (no mood runs on the loop's clock). */
export const LCP_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#0b1020", "#0b1020"],
  themeId: "",
  loopHud: true,
  loopHudTitle: "",
  loopHudSubtitle: "",
  cinematicEnabled: false,
  showTrails: false,
} as const;

/**
 * "Pyramid, 1,144 blocks" – the clip: an 11 × 11 pyramid of six steps scaled to 1,144 blocks, one colour (yellow) starting
 * with three balls at the floor's corners, a new ball every eighth block (3 + 1,144 ÷ 8 = 146 balls when the summit falls),
 * Rebuild and loop on, the loop HUD instead of Land Claim's own, and a clip that covers the longest cycle.
 */
export function lcPyramidPresetPatch(id: LcpPresetId) {
  void id;
  const duration = 40;
  const rebuildSec = DEFAULT_LC_PYRAMID_SETTINGS.rebuildSec;
  return {
    lcLayout: "pyramid" as LcLayout,
    lcPyramidSize: 11,
    lcSteps: 6,
    lcBlocks: 1144,
    lcRebuild: true,
    lcRebuildSec: rebuildSec,
    lcTeams: 1,
    lcBalls: 3,
    lcEvery: 8,
    lcDuration: duration,
    lcHud: false,
    lcTitle: "",
    teams: [] as { name: string; color: string; emoji: string }[],
    ballRadius: 8,
    gravity: 0,
    recordingDuration: lcPyramidClipSec(duration, rebuildSec),
    ...LCP_LOOK,
    backgroundColors: [...LCP_LOOK.backgroundColors],
  };
}

/** The clip (s) that covers a whole cycle of a looping pyramid run of at most `durationSec` (the knock-down, the hold and the rebuild). */
export function lcPyramidClipSec(durationSec: number, rebuildSec: number): number {
  return Math.max(10, Math.ceil(durationSec + LCP_HOLD_SEC + Math.max(0, rebuildSec)) + 1);
}

/* ------------------------------------------------------------------ constants */

/** The floor's side as a share of the centred square's (the canvas fits the isometric slab around it). */
export const LCP_FLOOR_SHARE = 0.5;
/** The pyramid's base as a share of the floor's side (the margin round it is where the balls start). */
export const LCP_GRID_SHARE = 0.62;
/** Cruising speed: this share of the floor's side a second at Ball Speed 400. */
export const LCP_SPEED = 1.4;
/** A ball's radius: this share of the floor's side at Ball Size 8 (no maximum: the Ball Size applies however big). */
export const LCP_BALL_SCALE = 0.016;
/** The largest random turn (radians) of a bounce: no periodic orbit traps a ball. */
export const LCP_SCATTER = 0.08;
/** A starting ball heads for the pyramid within this angle (radians, either way) of the diagonal. */
export const LCP_START_SPREAD = 0.45;
/** How far from the floor's walls (radii) a corner ball starts, and the spacing (radii) of the balls sharing a corner. */
export const LCP_CORNER_MARGIN = 1.6;
export const LCP_CORNER_SPACING = 2.8;
/** Seconds the cleared pyramid holds before the rebuild (the summit's payoff, the cleared chord). */
export const LCP_HOLD_SEC = 0.9;
/** The rebuild: the columns rise over this share of it (each stops at its own height: the outer steps first, the summit last). */
export const LCP_RISE_SHARE = 0.85;
/** The rebuild: the added balls melt into the pyramid over this share of it; the starting balls reach their corners by its end. */
export const LCP_MELT_SHARE = 0.6;
/** The knock's pluck: degrees of the C-major pentatonic from C3, low blocks low (12 degrees: C3–E5). */
export const LCP_ROOT_MIDI = 48;
export const LCP_SPAN = 12;
/** The summit's impact chord (C major: C4 E4 G4 C5) and the cleared chord's root (C3); the reset glide from C2 up to C3. */
export const LCP_SUMMIT_CHORD: readonly number[] = [261.63, 329.63, 392.0, 523.25];
export const LCP_CLEAR_ROOT_HZ = 130.81;
export const LCP_GLIDE_FROM_HZ = 65.41;
/** Spawn chimes: at most one per this many simulation ms. */
export const LCP_CHIME_GAP_MS = 140;
/** New pluck notes a 60 Hz step at most (`LOOP_NOTES_PER_TICK` of the loop library's voice budget – a test keeps them equal). */
export const LCP_NOTES_PER_STEP = 6;
/** The one colour of a pyramid played alone (the clip's small yellow balls). */
export const LCP_SOLO_COLOR = "#ffd23f";
export const LCP_SOLO_NAME = "YELLOW";
/** The layers' colours from the base up: teal, green, yellow, and the orange of the summit. */
export const LCP_LAYER_STOPS: readonly string[] = ["#22b8a7", "#4fcb68", "#f0d24a", "#f28c38"];

/* ------------------------------------------------------------------ the height map */

/** The ring (Chebyshev distance to the centre, in cells) of column (i, j) of a G × G grid: 0 is the summit (one column, four on an even grid). */
export function lcPyramidRing(i: number, j: number, grid: number): number {
  const g = grid - 1;
  return Math.floor(Math.max(Math.abs(2 * i - g), Math.abs(2 * j - g)) / 2);
}

/** Rings of a G × G grid (the summit's ring 0 included). */
export function lcPyramidRings(grid: number): number {
  return Math.floor((Math.max(1, Math.round(grid)) + 1) / 2);
}

/** Columns of ring `ring` of a G × G grid: 1 then 8, 16, 24… on an odd grid; 4 then 12, 20… on an even one. */
export function lcPyramidRingCells(grid: number, ring: number): number {
  const g = Math.max(1, Math.round(grid));
  if (g % 2 === 1) return ring === 0 ? 1 : 8 * ring;
  return 8 * ring + 4;
}

/** The natural pyramid's blocks: Σ over the rings of their columns × max(0, steps − ring). */
export function lcPyramidNaturalTotal(grid: number, steps: number): number {
  const rings = lcPyramidRings(grid);
  const s = Math.max(1, Math.round(steps));
  let total = 0;
  for (let r = 0; r < rings; r++) total += lcPyramidRingCells(grid, r) * Math.max(0, s - r);
  return total;
}

/**
 * The columns' heights (index `j · G + i`, i along the floor's x, j along its y): the natural `steps − ring` (never below 0), or –
 * with `blocks` > 0 – scaled to exactly `blocks` blocks: every ring's natural height times blocks ÷ natural, floored; what is
 * left over goes to whole rings from the summit outwards, again while one fits (so an inner ring never stands lower than an outer
 * one), and the last few blocks to the summit's columns. A natural pyramid past `LCP_BLOCK_CEILING` is scaled down to it.
 */
export function lcPyramidHeights(grid: number, steps: number, blocks: number): Int32Array {
  const g = Math.max(1, Math.round(grid));
  const s = Math.max(1, Math.round(steps));
  const rings = lcPyramidRings(g);
  const natural = lcPyramidNaturalTotal(g, s);
  let target = blocks > 0 ? Math.min(Math.round(blocks), LCP_BLOCK_CEILING) : 0;
  if (target === 0 && natural > LCP_BLOCK_CEILING) target = LCP_BLOCK_CEILING;
  const ringHeight = new Float64Array(rings);
  let extra = 0;
  if (target === 0 || target === natural) {
    for (let r = 0; r < rings; r++) ringHeight[r] = Math.max(0, s - r);
  } else {
    const k = target / natural;
    let sum = 0;
    for (let r = 0; r < rings; r++) {
      ringHeight[r] = Math.floor(Math.max(0, s - r) * k + 1e-9);
      sum += lcPyramidRingCells(g, r) * ringHeight[r];
    }
    let left = target - sum;
    let progress = true;
    while (left > 0 && progress) {
      progress = false;
      for (let r = 0; r < rings && left > 0; r++) {
        if (s - r <= 0) break; // (only the rings of the natural pyramid stand)
        const n = lcPyramidRingCells(g, r);
        if (n <= left) {
          ringHeight[r]++;
          left -= n;
          progress = true;
        }
      }
    }
    extra = left; // fewer than the summit's columns
  }
  const out = new Int32Array(g * g);
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) out[j * g + i] = ringHeight[lcPyramidRing(i, j, g)];
  for (let j = 0; j < g && extra > 0; j++) {
    for (let i = 0; i < g && extra > 0; i++) {
      if (lcPyramidRing(i, j, g) === 0) {
        out[j * g + i]++;
        extra--;
      }
    }
  }
  return out;
}

/** The blocks of a height map. */
export function lcPyramidTotal(heights: ArrayLike<number>): number {
  let total = 0;
  for (let k = 0; k < heights.length; k++) total += Math.max(0, heights[k]);
  return total;
}

/** The summit's columns (ring 0: one on an odd grid, four on an even one), by index. */
export function lcPyramidSummitCells(grid: number): Int32Array {
  const g = Math.max(1, Math.round(grid));
  const out: number[] = [];
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) if (lcPyramidRing(i, j, g) === 0) out.push(j * g + i);
  return Int32Array.from(out);
}

/** Balls a run has after `blocks` blocks knocked off: the start plus one every `every`-th block (`every` 0: never). */
export function lcPyramidBallsAfter(start: number, blocks: number, every: number): number {
  return start + (every > 0 ? Math.floor(Math.max(0, blocks) / every) : 0);
}

/* ------------------------------------------------------------------ the floor */

/** Where the floor and the pyramid sit on a canvas of `width` × `height` (world px; the physics is top down, the canvas isometric). */
export interface LcPyramidField {
  width: number;
  height: number;
  /** The centred square the recorder exports (its side) and the floor's centre. */
  side: number;
  cx: number;
  cy: number;
  /** The floor's side and half of it (px). */
  floor: number;
  half: number;
  /** Columns along a side, a column's side (px) and the grid's near edge relative to the centre (−G · cell / 2). */
  grid: number;
  cell: number;
  gx0: number;
}

/** The floor and the grid on a canvas of `width` × `height`: the floor centred, `LCP_FLOOR_SHARE` of the square; the pyramid's base `LCP_GRID_SHARE` of the floor. */
export function lcPyramidField(width: number, height: number, grid: number): LcPyramidField {
  const side = Math.max(40, Math.min(width, height));
  const floor = LCP_FLOOR_SHARE * side;
  const g = Math.max(1, Math.round(grid));
  const cell = (LCP_GRID_SHARE * floor) / g;
  return { width, height, side, cx: width / 2, cy: height / 2, floor, half: floor / 2, grid: g, cell, gx0: (-g * cell) / 2 };
}

/** A ball's radius (px) at Ball Size `ballSize` on a floor of side `floor`. */
export function lcPyramidBallRadius(ballSize: number, floor: number): number {
  return floor * LCP_BALL_SCALE * ((ballSize || 8) / 8);
}

/** The cruising speed (px/s) at Ball Speed `ballSpeed` on a floor of side `floor`. */
export function lcPyramidCruise(ballSpeed: number, floor: number): number {
  return ((ballSpeed || 400) / 400) * LCP_SPEED * floor;
}

/** The deepest contact of a ball (`lcPyramidContact()`): how deep, the normal (towards the ball), the column (−1: a wall) and the touch point (relative to the centre). */
export interface LcpContact {
  depth: number;
  nx: number;
  ny: number;
  cell: number;
  px: number;
  py: number;
}

export function createLcpContact(): LcpContact {
  return { depth: 0, nx: 0, ny: 0, cell: -1, px: 0, py: 0 };
}

/**
 * The deepest overlap of a ball at (px, py) (relative to the centre) of radius `r` with the floor's four walls and the columns
 * that still have a block (`heights` > 0) – each a square obstacle – into `out`. False when nothing overlaps. A ball whose centre
 * is inside a column leaves it through its nearest face.
 */
export function lcPyramidContact(field: LcPyramidField, heights: ArrayLike<number>, px: number, py: number, r: number, out: LcpContact): boolean {
  let best = 0;
  out.cell = -1;
  const h = field.half;
  // the walls: left, right, back, front
  let dist = px + h;
  if (r - dist > best) {
    best = r - dist;
    out.nx = 1;
    out.ny = 0;
    out.px = -h;
    out.py = py;
  }
  dist = h - px;
  if (r - dist > best) {
    best = r - dist;
    out.nx = -1;
    out.ny = 0;
    out.px = h;
    out.py = py;
  }
  dist = py + h;
  if (r - dist > best) {
    best = r - dist;
    out.nx = 0;
    out.ny = 1;
    out.px = px;
    out.py = -h;
  }
  dist = h - py;
  if (r - dist > best) {
    best = r - dist;
    out.nx = 0;
    out.ny = -1;
    out.px = px;
    out.py = h;
  }
  // the columns near the ball
  const g = field.grid;
  const c = field.cell;
  const x0 = field.gx0;
  let i0 = Math.floor((px - r - x0) / c);
  let i1 = Math.floor((px + r - x0) / c);
  let j0 = Math.floor((py - r - x0) / c);
  let j1 = Math.floor((py + r - x0) / c);
  if (i1 >= 0 && j1 >= 0 && i0 < g && j0 < g && c > 0) {
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 > g - 1) i1 = g - 1;
    if (j1 > g - 1) j1 = g - 1;
    for (let j = j0; j <= j1; j++) {
      const y0 = x0 + j * c;
      const y1 = y0 + c;
      for (let i = i0; i <= i1; i++) {
        const k = j * g + i;
        if (!(heights[k] > 0)) continue;
        const ax = x0 + i * c;
        const bx = ax + c;
        const qx = px < ax ? ax : px > bx ? bx : px;
        const qy = py < y0 ? y0 : py > y1 ? y1 : py;
        const dx = px - qx;
        const dy = py - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0) {
          const d = Math.sqrt(d2);
          if (r - d > best) {
            best = r - d;
            out.nx = dx / d;
            out.ny = dy / d;
            out.cell = k;
            out.px = qx;
            out.py = qy;
          }
        } else {
          // the centre is inside the column: out through its nearest face
          const fl = px - ax;
          const fr = bx - px;
          const fb = py - y0;
          const ff = y1 - py;
          let m = fl;
          let nx = -1;
          let ny = 0;
          let tx = ax;
          let ty = py;
          if (fr < m) {
            m = fr;
            nx = 1;
            ny = 0;
            tx = bx;
            ty = py;
          }
          if (fb < m) {
            m = fb;
            nx = 0;
            ny = -1;
            tx = px;
            ty = y0;
          }
          if (ff < m) {
            m = ff;
            nx = 0;
            ny = 1;
            tx = px;
            ty = y1;
          }
          if (r + m > best) {
            best = r + m;
            out.nx = nx;
            out.ny = ny;
            out.cell = k;
            out.px = tx;
            out.py = ty;
          }
        }
      }
    }
  }
  out.depth = best;
  return best > 0;
}

/** (x, y) (relative to the centre) moved back onto the floor for a ball of radius `r`: written into `out`. */
export function lcPyramidInside(field: LcPyramidField, x: number, y: number, r: number, out: { x: number; y: number }) {
  const room = Math.max(0, field.half - r);
  out.x = x < -room ? -room : x > room ? room : x;
  out.y = y < -room ? -room : y > room ? room : y;
  return out;
}

/** Whether a ball at (x, y) (relative to the centre) of radius `r` stands on the floor and in no column (±0.5 px). */
export function lcPyramidClear(field: LcPyramidField, heights: ArrayLike<number>, x: number, y: number, r: number, scratch: LcpContact): boolean {
  if (Math.abs(x) + r > field.half + 0.5 || Math.abs(y) + r > field.half + 0.5) return false;
  return !(lcPyramidContact(field, heights, x, y, Math.max(0, r - 0.5), scratch) && scratch.cell >= 0);
}

/* ------------------------------------------------------------------ the run's generator */

/**
 * A pyramid run's own seeded generator (mulberry32), seeded once from `ctx.random()` at init: the start places and headings,
 * the bounces' scatter and the spawns' headings come from it in the order they happen. Its state can be saved and restored,
 * so the loop's seam rewinds it to where the first frame left it.
 */
export class LcpRandom {
  state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** The floor's corners in the order the balls take them (clockwise from the back): their signs. */
const CORNER_SX = [-1, 1, 1, -1];
const CORNER_SY = [-1, -1, 1, 1];

/**
 * The start of ball `index` (counted over the whole run, every competitor's in their rounds) on a floor of radius-`r` balls:
 * at corner (`first` + index) mod 4, the balls sharing a corner spaced along its diagonal towards the pyramid, a little seeded
 * jitter, heading for the pyramid within `LCP_START_SPREAD` of the diagonal. A corner with no room left (a crowd) puts the ball
 * anywhere on the free floor round the pyramid (a few seeded tries). Draws from `rng` in a fixed order: jitter x, jitter y,
 * heading (and the tries of a crowded start). Written into `out` (relative to the centre).
 */
export function lcPyramidStart(field: LcPyramidField, index: number, first: number, r: number, rng: LcpRandom, out: { x: number; y: number; heading: number }) {
  const corner = (((first + index) % 4) + 4) % 4;
  const sx = CORNER_SX[corner];
  const sy = CORNER_SY[corner];
  const slot = Math.floor(index / 4);
  const reach = field.half - LCP_CORNER_MARGIN * r;
  // the room along the diagonal between the corner ball and the pyramid's base corner (in radii)
  const baseCorner = -field.gx0 + r * 1.5;
  const roomAlong = Math.max(0, (reach - baseCorner) * Math.SQRT2);
  const along = slot * LCP_CORNER_SPACING * r;
  const jx = (rng.next() - 0.5) * 0.6 * r;
  const jy = (rng.next() - 0.5) * 0.6 * r;
  const heading = Math.atan2(-sy, -sx) + (2 * rng.next() - 1) * LCP_START_SPREAD;
  out.heading = heading;
  if (along <= roomAlong) {
    out.x = sx * (reach - along / Math.SQRT2) + jx;
    out.y = sy * (reach - along / Math.SQRT2) + jy;
  } else {
    // a crowd: anywhere on the free floor round the pyramid
    out.x = sx * reach;
    out.y = sy * reach;
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = (2 * rng.next() - 1) * reach;
      const y = (2 * rng.next() - 1) * reach;
      if (Math.max(Math.abs(x), Math.abs(y)) > -field.gx0 + r) {
        out.x = x;
        out.y = y;
        break;
      }
    }
  }
  const inside = lcPyramidInside(field, out.x, out.y, r, { x: 0, y: 0 });
  out.x = inside.x;
  out.y = inside.y;
  return out;
}

/* ------------------------------------------------------------------ pitch and colour */

/** The degree (0 … `LCP_SPAN`) of a knocked block on row `row` (0 at the floor) of a pyramid `maxRows` blocks tall: lower layers lower. */
export function lcPyramidDegree(row: number, maxRows: number): number {
  return scalarDegree(row, 0, Math.max(1, maxRows - 1), LCP_SPAN);
}

/** The knock's pluck (Hz): its degree of C-major pentatonic from C3 (C3–E5). */
export function lcPyramidKnockFrequency(row: number, maxRows: number): number {
  return midiToFrequency(degreeToMidi(lcPyramidDegree(row, maxRows), LCP_ROOT_MIDI));
}

/**
 * A new ball's chime (Hz): an octave over the plucks' root and rising with the balls in play – `balls` from the run's `start`
 * to the most it can reach (`most`: the start plus one every eighth block) climbs nine pentatonic degrees (C4–A5), so the chimes
 * climb as the balls multiply.
 */
export function lcPyramidChimeFrequency(balls: number, start: number, most: number): number {
  return midiToFrequency(degreeToMidi(5 + scalarDegree(balls, start, Math.max(start + 1, most), 9), LCP_ROOT_MIDI));
}

/** The step (0 … steps − 1) block `row` of a pyramid `maxRows` tall belongs to (its colour band). */
export function lcPyramidStepOf(row: number, maxRows: number, steps: number): number {
  const s = Math.max(1, Math.round(steps));
  const step = Math.floor((Math.max(0, row) * s) / Math.max(1, maxRows));
  return step < 0 ? 0 : step > s - 1 ? s - 1 : step;
}

function hexChannels(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour ("#rrggbb") of step `step` of `steps`: teal at the base, through green and yellow, to the summit's orange. */
export function lcPyramidLayerColor(step: number, steps: number): string {
  const stops = LCP_LAYER_STOPS;
  const t = steps > 1 ? Math.max(0, Math.min(1, step / (steps - 1))) : 1;
  const x = t * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x));
  const f = x - k;
  const a = hexChannels(stops[k]);
  const b = hexChannels(stops[k + 1]);
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${hex(a[0] + (b[0] - a[0]) * f)}${hex(a[1] + (b[1] - a[1]) * f)}${hex(a[2] + (b[2] - a[2]) * f)}`;
}

/* ------------------------------------------------------------------ the rebuild */

export function smoothStep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** The rebuild's rising level (blocks) at progress `q` (0–1) of a pyramid `maxRows` tall: every column grows at this rate to its own height. */
export function lcPyramidRebuildLevel(q: number, maxRows: number): number {
  const p = q <= 0 ? 0 : q >= LCP_RISE_SHARE ? 1 : q / LCP_RISE_SHARE;
  return maxRows * p;
}

/** A column's height during the rebuild: what it kept (`kept`), raised to the rising `level`, never past its own (`full`). */
export function lcPyramidShownHeight(full: number, kept: number, level: number): number {
  const h = level > kept ? level : kept;
  return h < full ? h : full;
}

/** The blocks the HUD counts during the rebuild: every column's whole blocks at the rising `level` (the full count at its end). */
export function lcPyramidShownBlocks(full: ArrayLike<number>, kept: ArrayLike<number>, level: number): number {
  const whole = Math.floor(level + 1e-9);
  let n = 0;
  for (let k = 0; k < full.length; k++) n += Math.floor(lcPyramidShownHeight(full[k], kept[k], whole));
  return n;
}

/* ------------------------------------------------------------------ the view */

export type LcpPhase = "knock" | "hold" | "rebuild";

/** A pyramid run's state for the canvas, the HUD, the finder and the tests (`LandClaimView.pyramid`; the same object every call). */
export interface LcPyramidView {
  field: LcPyramidField;
  grid: number;
  steps: number;
  /** The tallest column at the start (blocks): the pitch and the colours are scaled to it. */
  maxRows: number;
  /** The columns' heights at the start and when the rebuild began (what it grows from). */
  full: Int32Array;
  kept: Int32Array;
  /** The summit's columns. */
  summit: Int32Array;
  total: number;
  /** Rebuild and loop, and its length (s). */
  rebuild: boolean;
  rebuildSec: number;
  phase: LcpPhase;
  /** The rebuild's progress (0–1) and its rising level (blocks); the blocks the HUD counts (the remaining ones, counting up again in the rebuild). */
  progress: number;
  level: number;
  shown: number;
  /** Balls the run starts with (the first ones of the engine's list). */
  startBalls: number;
  /** Simulation ms: the cycle's start (0 or the last seam), the hold's end and the seam (−1 until the cycle has ended). */
  cycleStartMs: number;
  holdEndMs: number;
  seamMs: number;
  /** Seams so far, the last one (simulation ms) and the last whole cycle (s; 0 before the first). */
  seams: number;
  lastSeamMs: number;
  cycleSec: number;
  /** This cycle: when the summit's last block fell (simulation ms, −1 before), the blocks still standing elsewhere then, when the pyramid was cleared (−1 before) and why it ended ("cleared", "time" or ""). */
  summitMs: number;
  summitLeft: number;
  clearMs: number;
  end: "" | "cleared" | "time";
  /** The first cycle's (the finder's and the tests'): the summit's fall (s into the cycle, −1 never), the blocks left then (−1), the clear (s, −1), and the balls at its end. */
  firstSummitSec: number;
  firstSummitLeft: number;
  firstClearSec: number;
  firstEndBalls: number;
  /** Cycles that ended (cleared or out of time). */
  ends: number;
  /** Pluck notes, chimes, summits and clears sounded (the smoke test's and the tests' counters). */
  plucks: number;
  chimes: number;
  summits: number;
  clears: number;
  /** Changes of the heights (the canvas repaints when it moved). */
  version: number;
}

export function createLcPyramidView(): LcPyramidView {
  return {
    field: lcPyramidField(800, 600, DEFAULT_LC_PYRAMID_SETTINGS.pyramidSize),
    grid: DEFAULT_LC_PYRAMID_SETTINGS.pyramidSize,
    steps: DEFAULT_LC_PYRAMID_SETTINGS.steps,
    maxRows: 0,
    full: new Int32Array(0),
    kept: new Int32Array(0),
    summit: new Int32Array(0),
    total: 0,
    rebuild: false,
    rebuildSec: DEFAULT_LC_PYRAMID_SETTINGS.rebuildSec,
    phase: "knock",
    progress: 0,
    level: 0,
    shown: 0,
    startBalls: 0,
    cycleStartMs: 0,
    holdEndMs: -1,
    seamMs: -1,
    seams: 0,
    lastSeamMs: 0,
    cycleSec: 0,
    summitMs: -1,
    summitLeft: -1,
    clearMs: -1,
    end: "",
    firstSummitSec: -1,
    firstSummitLeft: -1,
    firstClearSec: -1,
    firstEndBalls: -1,
    ends: 0,
    plucks: 0,
    chimes: 0,
    summits: 0,
    clears: 0,
    version: 0,
  };
}

/** Whether the summit fell last in the first cycle (the finder's "the summit falls last": the centre column was the last one standing). */
export function lcPyramidSummitLast(view: Pick<LcPyramidView, "firstSummitLeft">): boolean {
  return view.firstSummitLeft === 0;
}

/* ------------------------------------------------------------------ the knock's notes */

/**
 * The knocks of one step as notes: one per degree (n knocks of a degree sound √n × one, at most twice), the loudest
 * `limit` degrees, each `0.8 + 0.2 × impact` loud (the impact: the hit's normal speed over the cruise). Pure: `add()` notes a
 * knock, `flush()` hands the step's notes out lowest first and starts the next step.
 */
export class LcpStepNotes {
  private readonly count = new Int32Array(LCP_SPAN + 1);
  private readonly impact = new Float64Array(LCP_SPAN + 1);
  private readonly row = new Int32Array(LCP_SPAN + 1);
  private any = false;

  add(row: number, maxRows: number, impact: number) {
    const d = lcPyramidDegree(row, maxRows);
    this.count[d]++;
    this.impact[d] = Math.max(this.impact[d], impact);
    this.row[d] = row;
    this.any = true;
  }

  /** The step's notes (lowest degree first, at most `limit`): calls `emit(row, level)` for each, then clears. */
  flush(limit: number, emit: (row: number, level: number) => void): number {
    if (!this.any) return 0;
    let emitted = 0;
    for (let d = 0; d <= LCP_SPAN; d++) {
      const n = this.count[d];
      if (n <= 0) continue;
      if (emitted < limit) {
        const speed = this.impact[d] < 0 ? 0 : this.impact[d] > 1 ? 1 : this.impact[d];
        emit(this.row[d], (0.8 + 0.2 * speed) * Math.min(2, Math.sqrt(n)));
        emitted++;
      }
      this.count[d] = 0;
      this.impact[d] = 0;
    }
    this.any = false;
    return emitted;
  }

  clear() {
    this.count.fill(0);
    this.impact.fill(0);
    this.any = false;
  }
}
