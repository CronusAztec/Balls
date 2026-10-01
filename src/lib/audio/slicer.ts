import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---
/**
 * Song slicer arithmetic – the viral "each bounce plays the next bit of a song" format.
 *
 * A cursor (seconds into the song) advances by one slice per bounce. These pure helpers
 * decide which piece of the song a bounce plays and where the cursor lands afterwards, so
 * the maths is unit-testable without Web Audio. Playback lives in slicePlayer.ts.
 */

/** Remainders shorter than this are not worth playing: the song counts as finished instead. */
export const MIN_SLICE_SEC = 0.02;

/** Hard limits for the options, independent of the UI slider ranges. */
export const SLICE_LIMITS = {
  sliceSec: { min: 0.01, max: 10 },
  fadeSec: { min: 0, max: 1 },
} as const;

export interface SliceOptions {
  /** Length of one slice in seconds. */
  sliceSec: number;
  /** Fade-in / fade-out length in seconds (clamped to half the slice so the two never overlap). */
  fadeSec: number;
  /** Start the song over when it ends; otherwise bounces fall back to the default tones. */
  loop: boolean;
}

export interface SlicePlan {
  /** Offset into the song where the slice starts, in seconds. */
  start: number;
  /** Slice length in seconds (the last slice of a song may be shorter). */
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** Cursor position after the slice has played in full: where the next bounce continues from. */
  cursorAfter: number;
  /** True when the cursor wrapped to the beginning because the song had ended. */
  wrapped: boolean;
}

/** Clamps user-supplied options (URL parameters, presets) into a range the player can work with. */
export function normalizeSliceOptions(options: Partial<SliceOptions>, base: SliceOptions): SliceOptions {
  const clamp = (value: unknown, range: { min: number; max: number }, fallback: number) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? atLeastMin(n, range) : fallback; // --- uncap-all --- (never a maximum)
  };
  return {
    sliceSec: clamp(options.sliceSec ?? base.sliceSec, SLICE_LIMITS.sliceSec, base.sliceSec),
    fadeSec: clamp(options.fadeSec ?? base.fadeSec, SLICE_LIMITS.fadeSec, base.fadeSec),
    loop: options.loop ?? base.loop,
  };
}

/** True when the cursor has (as good as) reached the end of the song. */
export function songEnded(cursor: number, songDuration: number): boolean {
  return cursor >= songDuration - MIN_SLICE_SEC;
}

/**
 * Plans the slice a bounce should play from the current cursor. Returns null when there
 * is nothing to play: no song, a non-positive slice length, or the song has ended and
 * looping is off (the caller then falls back to its normal bounce sound).
 */
export function planSlice(cursor: number, songDuration: number, options: SliceOptions): SlicePlan | null {
  const { sliceSec, fadeSec, loop } = options;
  if (!(songDuration > 0) || !(sliceSec > 0)) return null;
  let start = Number.isFinite(cursor) ? Math.max(0, cursor) : 0;
  let wrapped = false;
  if (songEnded(start, songDuration)) {
    if (!loop) return null;
    start = 0;
    wrapped = true;
  }
  const end = Math.min(start + sliceSec, songDuration);
  const duration = end - start;
  const fade = Math.max(0, Math.min(fadeSec, duration / 2));
  return { start, duration, fadeIn: fade, fadeOut: fade, cursorAfter: end, wrapped };
}

/**
 * Song position reached by a slice that started at `startedAt` (audio-clock seconds) and
 * is being read at `now`: it advances while the slice plays and holds at the slice's end.
 * Used both for the HUD progress bar and to continue from the right spot when a slice is
 * cut short by the next bounce.
 */
export function positionAt(start: number, duration: number, startedAt: number, now: number): number {
  return start + Math.min(Math.max(0, now - startedAt), duration);
}

/** Song position as a 0–1 fraction for the progress bar. */
export function sliceProgress(position: number, songDuration: number): number {
  if (!(songDuration > 0)) return 0;
  return Math.max(0, Math.min(1, position / songDuration));
}

/** How many bounces it takes to play the whole song once. */
export function sliceCount(songDuration: number, sliceSec: number): number {
  if (!(songDuration > 0) || !(sliceSec > 0)) return 0;
  return Math.ceil(songDuration / sliceSec - 1e-9);
}

/** "m:ss" for the file info line in the panel. */
export function formatSongTime(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
