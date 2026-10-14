/**
 * --- daily-gallery --- The daily challenge: one mode and one seed a day, the same for every visitor (the rules, the pool, the
 * dates, the streak and the history are in lib/dailyCore.ts, which this file re-exports, so `@/lib/daily` keeps every name).
 *
 * --- daily-core --- What is here is the part that needs the simulator's settings: each pool entry's look as a canonical share
 * query (`poolEntryQuery`, `DailyChallenge.query`, `dailySettings`), which is what the studio opens a challenge with. Only code that
 * already loads the studio imports this file; the landing page's card imports lib/dailyCore.ts instead, so the page's first
 * scripts do not contain every mode's settings (tests/perfGuards.test.ts keeps it that way).
 */
import { settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { dailyChallengeCore, dailyKeyFromParam, dailyPoolEntry, utcDateKey, type DailyChallengeCore, type DailyPoolEntry } from "./dailyCore";

export * from "./dailyCore";

export interface DailyChallenge extends DailyChallengeCore {
  /** The challenge's settings as a canonical share query (`mode=…&…`, no seed). */
  query: string;
}

/** The canonical share query of a pool entry (`mode=…` plus its look, as `settingsToSearchParams` writes it). */
export function poolEntryQuery(entry: DailyPoolEntry): string {
  const params = new URLSearchParams(entry.look);
  params.set("mode", entry.mode);
  return settingsToSearchParams(settingsFromSearchParams(params)).toString();
}

/** The challenge of a date key (any real date; see dailyFromParam for what a link may open). */
export function dailyChallenge(key: string): DailyChallenge {
  return { ...dailyChallengeCore(key), query: poolEntryQuery(dailyPoolEntry(key)) };
}

/** Today's challenge (UTC). */
export function todaysChallenge(now: Date = new Date()): DailyChallenge {
  return dailyChallenge(utcDateKey(now));
}

/**
 * The challenge a `daily=` link parameter opens: `1` (or `today`) is today's, a date key is that day's – from challenge #1 up
 * to tomorrow (a day of clock skew; later days stay a surprise). Anything else is null and the link opens as usual.
 */
export function dailyFromParam(value: string | null | undefined, now: Date = new Date()): DailyChallenge | null {
  const key = dailyKeyFromParam(value, now);
  return key === null ? null : dailyChallenge(key);
}

/** The simulator settings of a challenge (the page pins `challenge.seed` on top). */
export function dailySettings(challenge: DailyChallenge): SimulatorSettings {
  return settingsFromSearchParams(new URLSearchParams(challenge.query));
}
