import { isUsableGrid, type BeatClockConfig, type BeatGrid } from "./beatClock";

/**
 * Beat schedule (feature jdm-rhythm-runner): the *times* of the beats of a beat clock (lib/simulation/beatClock.ts – the
 * clock Picture Paint follows), so a mode can plan ahead and put things ON the beat: the Beat Runner lands every jump on
 * one. `BeatClock.sample(t)` answers "which beat is it at t"; this answers the inverse, "when is beat i", with the same
 * mapping and the same beat numbering (`BeatSample.index`):
 *  - the manual BPM ("bpm" source, or a "song" source without a usable grid): beat i at i · 60 / BPM, from 0;
 *  - a detected song grid ("song" source): the music bed starts `offset` seconds into the song with the run, so beat i
 *    of pass `cycle` (index = cycle · n + i) sounds at simulation time cycle · duration + beatTimes[i] − offset. Beats
 *    before the run started (song time < offset) are never scheduled. A song that does not loop has no more beats after
 *    its last one; the schedule then continues at the grid's tempo (the run keeps going after the song).
 * Pure and deterministic.
 */

/** The tempo the schedule follows (BPM), whatever the source: the grid's tempo, else the manual one (0 when there is none). */
export function scheduleBpm(config: BeatClockConfig): number {
  if (config.source === "song" && isUsableGrid(config.grid)) return config.grid.bpm;
  return config.manualBpm > 0 ? config.manualBpm : 0;
}

/** Seconds per beat of the schedule (0 without a tempo). */
export function schedulePeriod(config: BeatClockConfig): number {
  const bpm = scheduleBpm(config);
  return bpm > 0 ? 60 / bpm : 0;
}

/** True when the schedule follows the song grid (else the manual BPM). */
export function followsSongGrid(config: BeatClockConfig): boolean {
  return config.source === "song" && isUsableGrid(config.grid);
}

/** Simulation time (s) of beat `index` (numbered like `BeatClock.sample().index`); NaN without a tempo. */
export function beatTimeSec(config: BeatClockConfig, index: number): number {
  const i = Math.floor(index);
  if (!followsSongGrid(config)) {
    const period = schedulePeriod(config);
    return period > 0 ? i * period : NaN;
  }
  const grid = config.grid!;
  const beats = grid.beatTimes;
  const n = beats.length;
  const period = 60 / grid.bpm;
  if (config.loop) {
    const cycle = Math.floor(i / n);
    const k = i - cycle * n;
    return cycle * grid.duration + beats[k] - config.offset;
  }
  if (i < n) return (i >= 0 ? beats[i] : beats[0] + i * period) - config.offset;
  return beats[n - 1] + (i - n + 1) * period - config.offset;
}

/** The first beat index whose time is at or after `t` (s, with a 1e-9 tolerance); −1 without a tempo. */
export function firstBeatAtOrAfter(config: BeatClockConfig, t: number): number {
  const time = Math.max(0, t);
  if (!followsSongGrid(config)) {
    const period = schedulePeriod(config);
    if (!(period > 0)) return -1;
    return Math.max(0, Math.ceil(time / period - 1e-9));
  }
  const grid = config.grid!;
  const beats = grid.beatTimes;
  const n = beats.length;
  const song = config.offset + time - 1e-9;
  let cycle = 0;
  let within = song;
  if (config.loop) {
    cycle = Math.max(0, Math.floor(song / grid.duration));
    within = song - cycle * grid.duration;
  }
  // Binary search for the first beat ≥ within in this pass.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < within) lo = mid + 1;
    else hi = mid;
  }
  if (lo < n) return cycle * n + lo;
  if (config.loop) return (cycle + 1) * n;
  // Past the last beat of a song that does not loop: the extrapolated beats at the grid's tempo.
  const period = 60 / grid.bpm;
  const after = Math.ceil((song - beats[n - 1]) / period);
  return n - 1 + Math.max(1, after);
}

/**
 * True when two configurations schedule the same beats: the same source in effect (a "song" source without a usable grid
 * follows the manual BPM) and then, for a song, the same grid (the same analysis or equal beats), offset and loop, for the
 * manual BPM the same tempo. An input the schedule does not follow – the BPM while it follows a song's grid, a song (its
 * grid, offset or loop) while it follows the BPM – is left out, so a change there leaves every beat where it was.
 */
export function sameBeatSchedule(a: BeatClockConfig, b: BeatClockConfig): boolean {
  const song = followsSongGrid(a);
  if (song !== followsSongGrid(b)) return false;
  if (!song) return schedulePeriod(a) === schedulePeriod(b);
  return a.offset === b.offset && a.loop === b.loop && sameGrid(a.grid!, b.grid!);
}

function sameGrid(a: BeatGrid, b: BeatGrid): boolean {
  if (a === b) return true;
  if (a.bpm !== b.bpm || a.duration !== b.duration || a.beatTimes.length !== b.beatTimes.length) return false;
  if (a.beatTimes === b.beatTimes) return true;
  for (let i = 0; i < a.beatTimes.length; i++) if (a.beatTimes[i] !== b.beatTimes[i]) return false;
  return true;
}

/** The first `count` beat times at or after `t` (for tests, previews and tools). */
export function beatTimesFrom(config: BeatClockConfig, t: number, count: number): number[] {
  const first = firstBeatAtOrAfter(config, t);
  if (first < 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(beatTimeSec(config, first + i));
  return out;
}
