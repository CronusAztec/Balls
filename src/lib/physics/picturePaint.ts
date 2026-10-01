import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---
/**
 * Picture Paint: the settings and the pure maths behind "reveal any picture in Paint mode, on the
 * beat of a song". The Paint mode (modes/paint.ts) owns the run-time state; everything here is
 * deterministic and free of DOM / Web Audio so it is unit-tested on its own:
 *
 *  - the settings block (`PicturePaintSettings`, defaults, slider ranges, clamping) that lives in
 *    `SimulatorSettings` and travels in the URL (`pbr`, `pgh`, `pbeat`, `pbs`, `pbp`, `pgd`, `pps`);
 *  - the coverage summary the guided rebounds steer by: the 100×100 paint grid is reduced to a
 *    24×24 map of "how much of this block is revealed", the largest unrevealed cluster is found by
 *    a flood fill and its weighted centroid is the target the next rebound is nudged toward;
 *  - the pacing maths: how big the brush should be right now to finish the reveal when the song
 *    (or the clip) ends, and whether the run is on schedule.
 */

export type PaintBeatSource = "song" | "bpm";
export const PAINT_BEAT_SOURCES: readonly PaintBeatSource[] = ["song", "bpm"];

export function isPaintBeatSource(value: unknown): value is PaintBeatSource {
  return typeof value === "string" && (PAINT_BEAT_SOURCES as readonly string[]).includes(value);
}

/** The Picture Paint fields of `SimulatorSettings`. */
export interface PicturePaintSettings {
  /** Brush dab radius as a multiple of the ball radius, 0.5–3 (URL `pbr`). */
  paintBrush: number;
  /** Opacity of the greyscale ghost of the unrevealed picture, 0–0.4 (URL `pgh`). */
  paintGhost: number;
  /** The ball speeds up on every beat and glides in between; brush and glow pulse with it (URL `pbeat`). */
  paintBeatSync: boolean;
  /** Where the beat comes from: the detected grid of the loaded song, or the manual BPM setting (URL `pbs`). */
  paintBeatSource: PaintBeatSource;
  /** How hard a beat kicks the ball: speed × (1 + pulse × beatPulse), 0–1 (URL `pbp`). */
  paintBeatPulse: number;
  /** Rebounds are nudged toward the least-revealed region (URL `pgd`). */
  paintGuided: boolean;
  /** The brush is re-sized every second so the reveal finishes with the song or the clip (URL `pps`). */
  paintPaceToSong: boolean;
}

export const DEFAULT_PICTURE_PAINT: PicturePaintSettings = {
  paintBrush: 1,
  paintGhost: 0.12,
  paintBeatSync: true,
  paintBeatSource: "song",
  paintBeatPulse: 0.5,
  paintGuided: true,
  paintPaceToSong: true,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const PICTURE_PAINT_RANGES = {
  paintBrush: { min: 0.5, max: 3, step: 0.1 },
  paintGhost: { min: 0, max: 0.4, step: 0.02 },
  paintBeatPulse: { min: 0, max: 1, step: 0.05 },
} as const;

export const PICTURE_PAINT_KEYS = Object.keys(DEFAULT_PICTURE_PAINT) as (keyof PicturePaintSettings)[];

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps every value to its range; unknown sources and non-boolean flags fall back. */
export function resolvePicturePaintSettings(source: Partial<PicturePaintSettings> | null | undefined): PicturePaintSettings {
  const out = { ...DEFAULT_PICTURE_PAINT };
  if (!source) return out;
  if (source.paintBrush !== undefined) out.paintBrush = clampNumber(source.paintBrush, PICTURE_PAINT_RANGES.paintBrush, out.paintBrush);
  if (source.paintGhost !== undefined) out.paintGhost = clampNumber(source.paintGhost, PICTURE_PAINT_RANGES.paintGhost, out.paintGhost);
  if (source.paintBeatPulse !== undefined) out.paintBeatPulse = clampNumber(source.paintBeatPulse, PICTURE_PAINT_RANGES.paintBeatPulse, out.paintBeatPulse);
  if (typeof source.paintBeatSync === "boolean") out.paintBeatSync = source.paintBeatSync;
  if (isPaintBeatSource(source.paintBeatSource)) out.paintBeatSource = source.paintBeatSource;
  if (typeof source.paintGuided === "boolean") out.paintGuided = source.paintGuided;
  if (typeof source.paintPaceToSong === "boolean") out.paintPaceToSong = source.paintPaceToSong;
  return out;
}

/** Picks the Picture Paint fields out of a bigger object (the SimulatorSettings, a preset…). */
export function picturePaintOf(source: PicturePaintSettings): PicturePaintSettings {
  return {
    paintBrush: source.paintBrush,
    paintGhost: source.paintGhost,
    paintBeatSync: source.paintBeatSync,
    paintBeatSource: source.paintBeatSource,
    paintBeatPulse: source.paintBeatPulse,
    paintGuided: source.paintGuided,
    paintPaceToSong: source.paintPaceToSong,
  };
}

/* ------------------------------------------------------------------ mode options */

/** What the Paint mode runs with (set through `engine.setPaintOptions()`); without a picture it is the classic Paint mode. */
export interface PaintModeOptions {
  /** A picture is loaded: dabs are sized by the brush, the reveal mask is stamped, guidance and pacing may apply. */
  picture: boolean;
  brush: number;
  beatSync: boolean;
  beatPulse: number;
  guided: boolean;
  paceToSong: boolean;
  /** Seconds the reveal should take (the song or the clip); 0 disables pacing. */
  targetSec: number;
}

export const DEFAULT_PAINT_MODE_OPTIONS: PaintModeOptions = { picture: false, brush: 1, beatSync: true, beatPulse: 0.5, guided: true, paceToSong: true, targetSec: 0 };

/**
 * How long the reveal should take: the loaded song's first pass (from its start offset) or the
 * clip, whichever ends first; without a song the clip. Never shorter than `minSec`.
 */
export function paintTargetSeconds(songDuration: number, songOffset: number, clipSec: number, minSec = 5): number {
  const clip = Math.max(minSec, Number.isFinite(clipSec) ? clipSec : minSec);
  if (!(songDuration > 0)) return clip;
  const song = songDuration - Math.max(0, songOffset);
  if (!(song > 0)) return clip;
  return Math.max(minSec, Math.min(song, clip));
}

/* ------------------------------------------------------------------ coverage */

/** Coverage at which the reveal counts as finished (the classic Paint threshold). */
export const COVERAGE_DONE = 0.95;
/** Side of the low-res coverage summary the guidance steers by. */
export const SUMMARY_SIZE = 24;
/** Largest rebound nudge in radians (the same clamp the cinematic director uses). */
export const GUIDE_MAX_NUDGE = (18 * Math.PI) / 180;
/** A summary block is "unrevealed" below this painted fraction. */
export const UNREVEALED_THRESHOLD = 0.5;

export interface CoverageTarget {
  /** Centroid of the cluster in arena-square coordinates (0–1 across the arena's bounding square). */
  x: number;
  y: number;
  /** Sum of the unrevealed fractions of the cluster's blocks. */
  weight: number;
  /** Blocks in the cluster. */
  cells: number;
}

/**
 * Reduces an n×n paint grid (1 = painted; only cells inside the inscribed circle count) to an m×m
 * summary of painted fractions, written into `out` (length m·m). Blocks without a cell inside the
 * circle read 1, so the corners never look unrevealed.
 */
export function summarizeCoverage(grid: Uint8Array, n: number, m: number, out: Float32Array = new Float32Array(m * m)): Float32Array {
  const painted = new Float32Array(m * m);
  const total = new Float32Array(m * m);
  const c = n / 2;
  for (let y = 0; y < n; y++) {
    const by = Math.min(m - 1, Math.floor((y * m) / n));
    const dy = y + 0.5 - c;
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      if (dx * dx + dy * dy > c * c) continue;
      const bi = by * m + Math.min(m - 1, Math.floor((x * m) / n));
      total[bi]++;
      if (grid[y * n + x]) painted[bi]++;
    }
  }
  for (let i = 0; i < m * m; i++) out[i] = total[i] > 0 ? painted[i] / total[i] : 1;
  return out;
}

/**
 * The largest connected cluster (4-neighbourhood) of unrevealed summary blocks, weighted by how
 * unrevealed each block is, with its weighted centroid; null once nothing is left below the threshold.
 */
export function largestUnrevealedCluster(summary: Float32Array, m: number, threshold = UNREVEALED_THRESHOLD): CoverageTarget | null {
  const visited = new Uint8Array(m * m);
  const stack: number[] = [];
  let best: CoverageTarget | null = null;
  for (let start = 0; start < m * m; start++) {
    if (visited[start] || summary[start] >= threshold) continue;
    let weight = 0;
    let cells = 0;
    let sx = 0;
    let sy = 0;
    visited[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const w = 1 - summary[i];
      const x = i % m;
      const y = (i - x) / m;
      weight += w;
      cells++;
      sx += w * (x + 0.5);
      sy += w * (y + 0.5);
      const visit = (j: number) => {
        if (!visited[j] && summary[j] < threshold) {
          visited[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < m - 1) visit(i + 1);
      if (y > 0) visit(i - m);
      if (y < m - 1) visit(i + m);
    }
    if (weight > 0 && (!best || weight > best.weight)) best = { x: sx / weight / m, y: sy / weight / m, weight, cells };
  }
  return best;
}

/** Signed angle from `a` to `b`, wrapped into (−π, π]. */
export function signedAngleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Turns a rebound angle toward the point (toX, toY) seen from (fromX, fromY), by at most `maxNudge` radians × `strength`. */
export function steerAngle(outAngle: number, fromX: number, fromY: number, toX: number, toY: number, maxNudge = GUIDE_MAX_NUDGE, strength = 1): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx * dx + dy * dy < 1e-6) return outAngle;
  const desired = Math.atan2(dy, dx);
  const delta = signedAngleDelta(outAngle, desired);
  const nudge = Math.max(-maxNudge, Math.min(maxNudge, delta)) * Math.max(0, Math.min(1, strength));
  return outAngle + nudge;
}

/* ------------------------------------------------------------------ pacing */

export const PACE_MIN = 0.7;
export const PACE_MAX = 2.5;
/** How often the brush is re-paced (simulation milliseconds). */
export const PACE_INTERVAL_MS = 1000;
/** The brush never changes by more than this factor per pacing step, so the strokes stay smooth. */
export const PACE_STEP_DOWN = 0.85;
export const PACE_STEP_UP = 1.2;
/** Deviation from the schedule (in coverage fraction) still reported as "on schedule". */
export const PACE_TOLERANCE = 0.05;

export type PaceStatus = "onSchedule" | "behind" | "ahead";

/** Coverage the reveal should have reached `elapsedSec` into a `targetSec` schedule (linear up to COVERAGE_DONE). */
export function expectedCoverage(elapsedSec: number, targetSec: number): number {
  if (!(targetSec > 0)) return 0;
  return COVERAGE_DONE * Math.max(0, Math.min(1, elapsedSec / targetSec));
}

export function paceStatus(coverage: number, elapsedSec: number, targetSec: number, tolerance = PACE_TOLERANCE): PaceStatus {
  const expected = expectedCoverage(elapsedSec, targetSec);
  if (coverage < expected - tolerance) return "behind";
  if (coverage > expected + tolerance) return "ahead";
  return "onSchedule";
}

/**
 * Next brush scale: the current one nudged by the ratio of the expected to the actual coverage
 * (behind → bigger brush, ahead → smaller), limited to a gentle step and clamped to PACE_MIN…PACE_MAX.
 * 1 when there is no schedule.
 */
export function paceBrushScale(current: number, coverage: number, elapsedSec: number, targetSec: number): number {
  if (!(targetSec > 0)) return 1;
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const expected = expectedCoverage(elapsedSec, targetSec);
  const ratio = (expected + 0.02) / (Math.max(0, coverage) + 0.02);
  const step = Math.max(PACE_STEP_DOWN, Math.min(PACE_STEP_UP, ratio));
  return Math.max(PACE_MIN, Math.min(PACE_MAX, base * step));
}
