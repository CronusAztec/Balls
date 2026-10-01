import { pointsForPlace } from "@/lib/physics/raceStandings";
import { RACER_CEILING } from "@/lib/uncap"; // --- review fix (uncap-all) ---

/**
 * Cups of the Square Racing Grand Prix: with the Cup switch on, every race that reaches its podium adds its F1 points
 * (25-18-15-12-10-8-6-4-2-1) to a table kept in the browser's localStorage, so consecutive races – Restart, a new seed,
 * a new track – build up a championship shown after each podium. Pure maths plus a tiny store:
 *
 * - `addRaceToCup()` scores one race into a cup (a new cup when the number of racers changed) exactly once per run –
 *   `runKey` identifies the run, so the page and the canvas can both ask for "the table with this race in it";
 * - `rankCup()` orders the table: points, then countback (more wins, then more second places, …), then racer number;
 * - `parseCup()` validates what comes back from storage (anything malformed is no cup);
 * - `raceCupStore` holds the current cup for the page (the panel's summary and reset button, the canvas' table) and
 *   persists it; it reads storage lazily and never throws when storage is unavailable.
 *
 * Nothing here reaches the physics: a cup never changes a race, so seeds and the finder are unaffected.
 */

export const RACE_CUP_STORAGE_KEY = "jumpingballslive:race-cup";
/** Bumped when the stored shape changes (an old cup is then dropped). */
export const RACE_CUP_VERSION = 1;

export interface RaceCup {
  version: number;
  /** Racers in this cup (a race with another count starts a new cup). */
  racers: number;
  /** Races scored so far. */
  races: number;
  /** Points per racer. */
  points: number[];
  /** Finishing places per racer: places[i][p] = how often racer i finished (p + 1)-th. */
  places: number[][];
  /** The run scored last (so it is never scored twice). */
  lastRun: string;
}

/** A finished race: the racers in finishing order (finishers only; DNFs score nothing). */
export interface RaceResult {
  racers: number;
  order: readonly number[];
}

export function emptyCup(racers: number): RaceCup {
  const n = Math.max(0, Math.min(RACER_CEILING, Math.round(racers))); // --- review fix (uncap-all) --- (every racer of any grid the race builds)
  return { version: RACE_CUP_VERSION, racers: n, races: 0, points: new Array(n).fill(0), places: Array.from({ length: n }, () => new Array(n).fill(0)), lastRun: "" };
}

/** The cup with `result` scored once: a new cup when there is none or its racer count differs; `cup` itself when this run is already in it. */
export function addRaceToCup(cup: RaceCup | null, result: RaceResult, runKey: string): RaceCup {
  if (cup && cup.racers === result.racers && runKey !== "" && cup.lastRun === runKey) return cup;
  // A race nobody finished is no race of the cup (nothing to score, nothing counted).
  if (result.order.length === 0) return cup && cup.racers === result.racers ? cup : emptyCup(result.racers);
  const base = cup && cup.racers === result.racers ? cup : emptyCup(result.racers);
  const next: RaceCup = { version: RACE_CUP_VERSION, racers: base.racers, races: base.races + 1, points: [...base.points], places: base.places.map((p) => [...p]), lastRun: runKey };
  result.order.forEach((racer, index) => {
    if (!Number.isInteger(racer) || racer < 0 || racer >= next.racers) return;
    next.points[racer] += pointsForPlace(index + 1);
    if (index < next.racers) next.places[racer][index]++;
  });
  return next;
}

/** Points racer `i` scored in `result` (its F1 points for its place, 0 for a DNF). */
export function racePoints(result: RaceResult, racer: number): number {
  const index = result.order.indexOf(racer);
  return index < 0 ? 0 : pointsForPlace(index + 1);
}

/** Racers ordered by points, then countback (more wins, then more seconds, …), then racer number. Writes into `out`. */
export function rankCup(cup: RaceCup, out: number[] = []): number[] {
  out.length = 0;
  for (let i = 0; i < cup.racers; i++) out.push(i);
  out.sort((a, b) => {
    if (cup.points[a] !== cup.points[b]) return cup.points[b] - cup.points[a];
    for (let p = 0; p < cup.racers; p++) {
      const d = (cup.places[b]?.[p] ?? 0) - (cup.places[a]?.[p] ?? 0);
      if (d !== 0) return d;
    }
    return a - b;
  });
  return out;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1e9;
}

/** A cup read back from storage (a JSON string or a parsed object), or null when it is not a valid cup of this version. */
export function parseCup(value: unknown): RaceCup | null {
  let data: unknown = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const c = data as Partial<Record<keyof RaceCup, unknown>>;
  if (c.version !== RACE_CUP_VERSION || !isCount(c.racers) || c.racers < 1 || c.racers > RACER_CEILING || !isCount(c.races)) return null;
  const n = c.racers;
  if (!Array.isArray(c.points) || c.points.length !== n || !c.points.every(isCount)) return null;
  if (!Array.isArray(c.places) || c.places.length !== n || !c.places.every((p) => Array.isArray(p) && p.length === n && p.every(isCount))) return null;
  return { version: RACE_CUP_VERSION, racers: n, races: c.races, points: [...(c.points as number[])], places: (c.places as number[][]).map((p) => [...p]), lastRun: typeof c.lastRun === "string" ? c.lastRun.slice(0, 80) : "" };
}

/* ------------------------------------------------------------------ storage and the page's store */

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadRaceCup(): RaceCup | null {
  try {
    return parseCup(storage()?.getItem(RACE_CUP_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveRaceCup(cup: RaceCup | null) {
  try {
    const s = storage();
    if (!s) return;
    if (cup) s.setItem(RACE_CUP_STORAGE_KEY, JSON.stringify(cup));
    else s.removeItem(RACE_CUP_STORAGE_KEY);
  } catch {
    /* storage full or blocked: the cup lives on for this page only */
  }
}

type Listener = () => void;

/** The current cup for the page (panel and canvas); `useSyncExternalStore`-friendly (stable snapshot between changes). */
export class RaceCupStore {
  private cup: RaceCup | null = null;
  private loaded = false;
  private readonly listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = (): RaceCup | null => {
    if (!this.loaded) {
      this.loaded = true;
      this.cup = loadRaceCup();
    }
    return this.cup;
  };

  /** Scores a race (once per run key) and saves the cup; a race nobody finished leaves the cup as it is. */
  addRace(result: RaceResult, runKey: string) {
    if (result.order.length === 0) return;
    const current = this.get();
    const next = addRaceToCup(current, result, runKey);
    if (next === current) return;
    this.cup = next;
    saveRaceCup(next);
    this.emit();
  }

  /** Starts over: no races, no points. */
  reset() {
    this.loaded = true;
    this.cup = null;
    saveRaceCup(null);
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const raceCupStore = new RaceCupStore();
