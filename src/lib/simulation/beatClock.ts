/**
 * Beat clock: maps *simulation* time to a beat phase, either from a detected beat grid (see
 * lib/audio/beats.ts) or from a manual BPM, and gives a pulse that is 1 on every beat and decays
 * exponentially until the next one. It is pure and deterministic – no wall clock, no audio time –
 * so the Paint mode's beat-synced motion replays identically for the recorder and for a seed.
 *
 * With a song grid the simulation clock and the song are aligned by the music bed: the bed starts
 * with the run at `offset` seconds into the track (its start offset), pauses and restarts with it,
 * so song time = offset + simulation time (wrapped at the track length when the bed loops). With
 * the manual source beat 0 is at simulation time 0 and beats follow every 60 / BPM seconds.
 */

export type BeatSource = "song" | "bpm";

export interface BeatGrid {
  bpm: number;
  /** Beat instants in song seconds, ascending. */
  beatTimes: readonly number[];
  /** Song length in seconds (the grid wraps here when the song loops). */
  duration: number;
}

export interface BeatClockConfig {
  source: BeatSource;
  grid: BeatGrid | null;
  /** Tempo of the "bpm" source (the beat-lock BPM setting). */
  manualBpm: number;
  /** Song seconds already elapsed at simulation time 0 (the music bed's start offset). */
  offset: number;
  /** The song starts over at its end (a looping music bed): the beat grid wraps with it. */
  loop: boolean;
  /** Pulse decay in beats: pulse = exp(−decay · timeSinceBeat / period); 3 leaves ~5 % at the next beat. */
  decay: number;
}

export const BEAT_PULSE_DECAY = 3;

export const DEFAULT_BEAT_CLOCK: BeatClockConfig = { source: "song", grid: null, manualBpm: 120, offset: 0, loop: true, decay: BEAT_PULSE_DECAY };

export interface BeatSample {
  /** False when the clock has no tempo to follow (song source without a usable grid). */
  active: boolean;
  bpm: number;
  /** Seconds per beat (0 while inactive). */
  period: number;
  /** Beats since the run started (−1 before the first beat); counts on across song loops. */
  index: number;
  /** Seconds since the last beat (Infinity before the first beat). */
  sinceBeat: number;
  /** 1 on a beat, decaying exponentially to ~0 at the next one; 0 while inactive or before the first beat. */
  pulse: number;
  /** Song position in seconds that the simulation time maps to (the time itself with the manual source). */
  songTime: number;
}

/** 1 at a beat, exponential decay in units of the beat period; 0 for a negative time or without a period. */
export function pulseValue(sinceBeat: number, period: number, decay: number): number {
  if (!(period > 0) || !(sinceBeat >= 0) || !Number.isFinite(sinceBeat)) return 0;
  return Math.exp((-Math.max(0, decay) * sinceBeat) / period);
}

/** Index of the last beat at or before `time` (binary search), −1 when `time` is before the first beat. */
export function beatIndexBefore(beatTimes: readonly number[], time: number): number {
  let lo = 0;
  let hi = beatTimes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** A grid the clock can follow: a tempo, at least two beats and a song length that holds them. */
export function isUsableGrid(grid: BeatGrid | null | undefined): grid is BeatGrid {
  return !!grid && grid.bpm > 0 && grid.beatTimes.length >= 2 && grid.duration > 0;
}

export function freshBeatSample(): BeatSample {
  return { active: false, bpm: 0, period: 0, index: -1, sinceBeat: Infinity, pulse: 0, songTime: 0 };
}

export class BeatClock {
  private config: BeatClockConfig = { ...DEFAULT_BEAT_CLOCK };
  private readonly scratch = freshBeatSample();

  setConfig(patch: Partial<BeatClockConfig>) {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): BeatClockConfig {
    return { ...this.config };
  }

  /** True while there is a tempo to follow: the manual BPM, or a usable song grid in "song" mode. */
  isActive(): boolean {
    const c = this.config;
    return c.source === "bpm" ? c.manualBpm > 0 : isUsableGrid(c.grid);
  }

  /** The tempo in effect (0 while inactive). */
  getBpm(): number {
    const c = this.config;
    if (c.source === "bpm") return c.manualBpm > 0 ? c.manualBpm : 0;
    return isUsableGrid(c.grid) ? c.grid.bpm : 0;
  }

  /** Beat phase at simulation time `t` (seconds). Writes into `out` (a fresh object by default) so hot loops can reuse one. */
  sample(t: number, out: BeatSample = freshBeatSample()): BeatSample {
    const c = this.config;
    out.active = false;
    out.bpm = 0;
    out.period = 0;
    out.index = -1;
    out.sinceBeat = Infinity;
    out.pulse = 0;
    out.songTime = t;
    if (c.source === "bpm") {
      if (!(c.manualBpm > 0)) return out;
      const period = 60 / c.manualBpm;
      const time = Math.max(0, t);
      const index = Math.floor(time / period + 1e-9);
      out.active = true;
      out.bpm = c.manualBpm;
      out.period = period;
      out.index = index;
      out.sinceBeat = Math.max(0, time - index * period);
      out.pulse = pulseValue(out.sinceBeat, period, c.decay);
      return out;
    }
    const grid = c.grid;
    if (!isUsableGrid(grid)) return out;
    const beats = grid.beatTimes;
    const n = beats.length;
    const period = 60 / grid.bpm;
    let song = c.offset + t;
    let cycle = 0;
    if (c.loop) {
      cycle = Math.floor(song / grid.duration);
      song -= cycle * grid.duration;
    }
    out.active = true;
    out.bpm = grid.bpm;
    out.period = period;
    out.songTime = song;
    const i = beatIndexBefore(beats, song);
    if (i >= 0) {
      out.index = cycle * n + i;
      out.sinceBeat = song - beats[i];
    } else if (c.loop && cycle > 0) {
      // Before the first beat of a repeat: the last beat of the previous pass is the one still ringing.
      out.index = cycle * n - 1;
      out.sinceBeat = song + (grid.duration - beats[n - 1]);
    } else return out; // before the very first beat
    out.pulse = pulseValue(out.sinceBeat, period, c.decay);
    return out;
  }

  /** Shorthand for `sample(t).pulse` without an allocation. */
  pulse(t: number): number {
    return this.sample(t, this.scratch).pulse;
  }
}
